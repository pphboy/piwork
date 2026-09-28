import os
import tempfile
import unittest

from filesystem import Workspace, validate_segments
from protocol import ProtocolError


class FilesystemTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.temp.name, "workspace")
        self.outside = os.path.join(self.temp.name, "outside")
        os.mkdir(self.root)
        os.mkdir(self.outside)
        with open(os.path.join(self.outside, "sentinel"), "wb") as output:
            output.write(b"outside-secret")

    def tearDown(self):
        self.temp.cleanup()

    def test_unicode_literal_percent_hash_hidden_and_byte_sorting(self):
        for name in ["中文.txt", "a b", "%2e", "#tag", ".hidden", "Z"]:
            with open(os.path.join(self.root, name), "wb") as output:
                output.write(name.encode())
        with Workspace(self.root) as work:
            entries = work.list_children([])
            self.assertEqual([row["pathSegments"][-1] for row in entries],
                             sorted(["中文.txt", "a b", "%2e", "#tag", ".hidden", "Z"], key=lambda value: value.encode()))
            self.assertEqual(b"".join(work.read_chunks(["%2e"])), b"%2e")
            self.assertEqual(work.stat_entry(["中文.txt"])["kind"], "file")
            self.assertEqual(work.stat_entry([])["kind"], "directory")

    def test_invalid_or_oversized_segments_are_rejected_without_decoding_again(self):
        for parts in [[".."], ["."], [""], ["a/b"], ["a\\b"], ["nul\0here"],
                      ["\ud800"], ["\x01"], ["a"] * 129]:
            with self.subTest(parts=parts), self.assertRaises(ProtocolError):
                validate_segments(parts)
        for parts in [["界" * 86], ["a" * 255] * 17]:
            with self.subTest(parts=str(parts)[:20]), self.assertRaises(ProtocolError) as failure:
                validate_segments(parts)
            self.assertEqual(failure.exception.code, "FILE_PATH_TOO_LONG")
        self.assertEqual(validate_segments(["%2e"]), ["%2e"])

    def test_symlink_and_fifo_are_listed_but_never_read_or_followed(self):
        os.symlink(os.path.join(self.outside, "sentinel"), os.path.join(self.root, "link"))
        os.mkfifo(os.path.join(self.root, "pipe"))
        with Workspace(self.root) as work:
            kinds = {row["pathSegments"][-1]: row["kind"] for row in work.list_children([])}
            self.assertEqual(kinds, {"link": "symlink", "pipe": "unsupported"})
            for path in [["link"], ["pipe"]]:
                with self.subTest(path=path), self.assertRaises(ProtocolError) as failure:
                    list(work.read_chunks(path))
                self.assertEqual(failure.exception.code, "FILE_TYPE_UNSUPPORTED")

    def test_hardlink_read_and_parent_symlink_replacement_stay_inside_root(self):
        os.mkdir(os.path.join(self.root, "data"))
        with open(os.path.join(self.root, "data", "source"), "wb") as output:
            output.write(b"safe-data")
        os.link(os.path.join(self.root, "data", "source"), os.path.join(self.root, "data", "hardlink"))
        with Workspace(self.root) as work:
            self.assertEqual(b"".join(work.read_chunks(["data", "hardlink"])), b"safe-data")
            held = work.open_parent(["data", "source"])
            try:
                os.rename(os.path.join(self.root, "data"), os.path.join(self.root, "old-data"))
                os.symlink(self.outside, os.path.join(self.root, "data"))
                with self.assertRaises(ProtocolError):
                    work.verify_parent(held, ["data"])
                with self.assertRaises(ProtocolError):
                    list(work.read_chunks(["data", "sentinel"]))
            finally:
                os.close(held)
        with open(os.path.join(self.outside, "sentinel"), "rb") as source:
            self.assertEqual(source.read(), b"outside-secret")

    def test_unrepresentable_directory_entry_rejects_listing(self):
        root_bytes = os.fsencode(self.root)
        descriptor = os.open(root_bytes, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fd = os.open(b"bad-\xff", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644, dir_fd=descriptor)
            os.close(fd)
        finally:
            os.close(descriptor)
        with Workspace(self.root) as work, self.assertRaises(ProtocolError) as failure:
            work.list_children([])
        self.assertEqual(failure.exception.code, "FILE_NAME_UNSUPPORTED")


if __name__ == "__main__":
    unittest.main()
