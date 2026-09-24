import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("worker", Path(__file__).with_name("filesystem.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class FilesystemFailures(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="piwork-worker-test-")
        self.source = Path(self.temporary.name) / "source"
        self.spool = Path(self.temporary.name) / "spool"
        self.source.mkdir()
        self.spool.mkdir()
        (self.source / "file").write_bytes(b"source bytes")
        self.root_fd = os.open(self.source, worker.DIRECTORY)
        self.spool_fd = os.open(self.spool, worker.DIRECTORY)

    def tearDown(self):
        os.close(self.root_fd)
        os.close(self.spool_fd)
        self.temporary.cleanup()

    def test_xattr_is_rejected_without_removing_source_content(self):
        os.setxattr(self.source / "file", "user.piwork-test", b"retained")
        with self.assertRaises(worker.SnapshotError) as result:
            worker.capture(self.root_fd, self.spool_fd)
        self.assertEqual(result.exception.code, "SNAPSHOT_STORAGE_UNSUPPORTED")
        self.assertEqual(os.getxattr(self.source / "file", "user.piwork-test"), b"retained")
        self.assertEqual((self.source / "file").read_bytes(), b"source bytes")

    def test_acl_xattr_has_the_same_no_silent_skip_rule(self):
        with patch.object(worker.os, "listxattr", return_value=["system.posix_acl_access"]):
            with self.assertRaises(worker.SnapshotError):
                worker.capture(self.root_fd, self.spool_fd)

    def test_device_type_is_rejected_before_open(self):
        original = os.stat

        def device(path, **kwargs):
            result = original(path, **kwargs)
            if path == b"file":
                fields = list(result)
                fields[0] = stat.S_IFCHR | 0o600
                return os.stat_result(fields)
            return result

        with patch.object(worker.os, "stat", side_effect=device):
            with self.assertRaises(worker.SnapshotError):
                worker.capture(self.root_fd, self.spool_fd)

    def test_read_failure_does_not_produce_success(self):
        with patch.object(worker.os, "read", side_effect=OSError("injected I/O failure")):
            with self.assertRaises(OSError):
                worker.capture(self.root_fd, self.spool_fd)
        self.assertEqual((self.source / "file").read_bytes(), b"source bytes")

    def test_change_during_copy_is_rejected(self):
        original = worker.spool_blob

        def changed(spool, chunks):
            result = original(spool, chunks)
            (self.source / "file").write_bytes(b"concurrent writer")
            return result

        with patch.object(worker, "spool_blob", side_effect=changed):
            with self.assertRaises(worker.SnapshotError) as result:
                worker.capture(self.root_fd, self.spool_fd)
        self.assertEqual(result.exception.code, "SNAPSHOT_STORAGE_UNREADABLE")


if __name__ == "__main__":
    unittest.main()
