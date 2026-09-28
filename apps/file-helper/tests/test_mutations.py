import errno
import os
import tempfile
import unittest
from unittest.mock import patch

from filesystem import Workspace
from protocol import ProtocolError


class FakeSession:
    job_id = "filejob-test"

    def __init__(self, chunks=(), on_prepare=None):
        self.chunks = chunks
        self.on_prepare = on_prepare
        self.prepared = []

    def upload_chunks(self):
        yield from self.chunks

    def prepare(self, phase, *args):
        self.prepared.append((phase, args))
        if self.on_prepare:
            self.on_prepare(phase, args)


class MutationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, data, mode=0o644):
        path = os.path.join(self.root, name)
        with open(path, "wb") as sink:
            sink.write(data)
        os.chmod(path, mode)
        return path

    def test_put_replaces_atomically_preserves_execute_bit_and_other_hardlink(self):
        original = self.write("script.sh", b"old", 0o755)
        hardlink = os.path.join(self.root, "other-link")
        os.link(original, hardlink)
        with Workspace(self.root) as work:
            status, length = work.put_file(["script.sh"], FakeSession([b"new-", b"content"]))
        self.assertEqual((status, length), (204, 11))
        with open(original, "rb") as source:
            self.assertEqual(source.read(), b"new-content")
        with open(hardlink, "rb") as source:
            self.assertEqual(source.read(), b"old")
        self.assertEqual(os.stat(original).st_mode & 0o777, 0o755)
        self.assertFalse(any(name.endswith(".tmp") for name in os.listdir(self.root)))

    def test_new_empty_file_and_independent_copy_preserve_source_mode(self):
        source = self.write("source", b"content", 0o751)
        with Workspace(self.root) as work:
            self.assertEqual(work.put_file(["empty"], FakeSession([])), (201, 0))
            self.assertEqual(work.copy_file(["source"], ["copy"], FakeSession()), (201, 7))
        self.assertEqual(os.stat(os.path.join(self.root, "empty")).st_mode & 0o777, 0o644)
        self.assertEqual(os.stat(os.path.join(self.root, "copy")).st_mode & 0o777, 0o751)
        self.assertNotEqual(os.stat(source).st_ino, os.stat(os.path.join(self.root, "copy")).st_ino)

    def test_upload_interrupt_disk_full_and_commit_denial_keep_old_target(self):
        target = self.write("target", b"original")

        def interrupted():
            yield b"partial"
            raise ProtocolError("FILE_TRANSFER_TIMEOUT")

        with Workspace(self.root) as work:
            with self.assertRaises(ProtocolError):
                work.put_file(["target"], FakeSession(interrupted()))
            with patch("filesystem.os.write", side_effect=OSError(errno.ENOSPC, "disk full")):
                with self.assertRaises(ProtocolError) as full:
                    work.put_file(["target"], FakeSession([b"new"]))
            self.assertEqual(full.exception.code, "FILE_STORAGE_FULL")

            def deny_commit(phase, _args):
                if phase == "commit":
                    raise ProtocolError("FILE_PRECONDITION_FAILED")

            with self.assertRaises(ProtocolError) as denied:
                work.put_file(["target"], FakeSession([b"new"], deny_commit))
            self.assertEqual(denied.exception.code, "FILE_PRECONDITION_FAILED")
        with open(target, "rb") as source:
            self.assertEqual(source.read(), b"original")
        self.assertFalse(any(name.endswith(".tmp") for name in os.listdir(self.root)))

    def test_commit_then_lost_response_keeps_full_new_file(self):
        target = self.write("target", b"old")
        with Workspace(self.root) as work:
            self.assertEqual(work.put_file(["target"], FakeSession([b"complete"])), (204, 8))
        # A lost Core/CLI response cannot roll back a completed rename.
        with open(target, "rb") as source:
            self.assertEqual(source.read(), b"complete")

    def test_replaced_temporary_is_never_deleted_as_platform_owned(self):
        target = self.write("target", b"old")
        replaced_name = None

        def replace_after_creation(phase, args):
            nonlocal replaced_name
            if phase == "temporary" and len(args) == 5 and args[4] is not None:
                name = args[2]
                replaced_name = name
                os.rename(os.path.join(self.root, name), os.path.join(self.root, "displaced-temp"))
                with open(os.path.join(self.root, name), "wb") as sink:
                    sink.write(b"user-owned")

        with Workspace(self.root) as work, self.assertRaises(ProtocolError) as failure:
            work.put_file(["target"], FakeSession([b"replacement"], replace_after_creation))
        self.assertEqual(failure.exception.code, "FILE_CLEANUP_REQUIRED")
        with open(target, "rb") as source:
            self.assertEqual(source.read(), b"old")
        with open(os.path.join(self.root, replaced_name), "rb") as source:
            self.assertEqual(source.read(), b"user-owned")

    def test_type_and_overwrite_preflight_preserve_targets(self):
        self.write("source", b"source")
        target = self.write("target", b"old")
        os.mkdir(os.path.join(self.root, "directory"))
        os.symlink("target", os.path.join(self.root, "link"))
        with Workspace(self.root) as work:
            with self.assertRaises(ProtocolError) as no_replace:
                work.copy_file(["source"], ["target"], FakeSession(), overwrite=False)
            self.assertEqual(no_replace.exception.code, "FILE_PRECONDITION_FAILED")
            for name in ["directory", "link"]:
                with self.assertRaises(ProtocolError):
                    work.put_file([name], FakeSession([b"bad"]))
        with open(target, "rb") as source:
            self.assertEqual(source.read(), b"old")


if __name__ == "__main__":
    unittest.main()
