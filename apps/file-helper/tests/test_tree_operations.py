import errno
import os
import tempfile
import unittest
from unittest.mock import patch

from filesystem import Workspace
from protocol import ProtocolError


class FakeSession:
    job_id = "filejob-tree"

    def __init__(self):
        self.phases = []

    def prepare(self, phase, *_args):
        self.phases.append(phase)


class TreeOperationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name

    def tearDown(self):
        self.temp.cleanup()

    def make_tree(self):
        os.mkdir(os.path.join(self.root, "source"))
        os.mkdir(os.path.join(self.root, "source", "nested"))
        for path, data in [("source/a", b"a"), ("source/nested/b", b"b")]:
            with open(os.path.join(self.root, path), "wb") as output:
                output.write(data)

    def test_mkcol_copy_depth_move_delete_nested_tree(self):
        self.make_tree()
        with Workspace(self.root) as work:
            self.assertEqual(work.mkcol(["empty"], FakeSession()), 201)
            self.assertEqual(work.copy(["source"], ["shallow"], FakeSession(), depth=0), (201, []))
            self.assertEqual(work.list_children(["shallow"]), [])
            self.assertEqual(work.copy(["source"], ["clone"], FakeSession()), (201, []))
            self.assertEqual(work.move(["clone"], ["moved"], FakeSession()), (201, []))
            self.assertEqual(work.delete(["moved"], FakeSession()), (204, []))
            self.assertEqual(work.delete(["empty"], FakeSession()), (204, []))
        self.assertFalse(os.path.exists(os.path.join(self.root, "moved")))
        self.assertTrue(os.path.exists(os.path.join(self.root, "source", "nested", "b")))

    def test_overwrite_false_root_ancestor_and_missing_parent(self):
        self.make_tree()
        os.mkdir(os.path.join(self.root, "dest"))
        with Workspace(self.root) as work:
            with self.assertRaises(ProtocolError) as precondition:
                work.copy(["source"], ["dest"], FakeSession(), overwrite=False)
            self.assertEqual(precondition.exception.code, "FILE_PRECONDITION_FAILED")
            for method, args in [(work.delete, ([], FakeSession())),
                                 (work.copy, ([], ["other"], FakeSession())),
                                 (work.copy, (["source"], ["source", "child"], FakeSession())),
                                 (work.move, (["source", "nested"], ["source"], FakeSession()))]:
                with self.assertRaises(ProtocolError):
                    method(*args)
            with self.assertRaises(ProtocolError) as missing:
                work.mkcol(["missing", "child"], FakeSession())
            self.assertEqual(missing.exception.code, "FILE_CONFLICT")

    def test_symlink_preflight_rejects_tree_without_partial_copy(self):
        self.make_tree()
        os.symlink("/etc/passwd", os.path.join(self.root, "source", "link"))
        with Workspace(self.root) as work, self.assertRaises(ProtocolError) as failure:
            work.copy(["source"], ["clone"], FakeSession())
        self.assertEqual(failure.exception.code, "FILE_TYPE_UNSUPPORTED")
        self.assertFalse(os.path.exists(os.path.join(self.root, "clone")))

    def test_directory_overwrite_and_partial_copy_report_actual_result(self):
        self.make_tree()
        os.mkdir(os.path.join(self.root, "dest"))
        with open(os.path.join(self.root, "dest", "stale"), "wb") as output:
            output.write(b"stale")
        with Workspace(self.root) as work:
            self.assertEqual(work.copy(["source"], ["dest"], FakeSession()), (204, []))
            self.assertFalse(os.path.exists(os.path.join(self.root, "dest", "stale")))
            original_copy = work.copy_file

            def fail_second(source, destination, session, *args, **kwargs):
                if source[-1] == "b":
                    raise ProtocolError("FILE_PERMISSION_DENIED")
                return original_copy(source, destination, session, *args, **kwargs)

            with patch.object(work, "copy_file", side_effect=fail_second):
                status, failures = work.copy(["source"], ["partial"], FakeSession())
            self.assertEqual(status, 207)
            self.assertEqual(failures, [{"pathSegments": ["partial", "nested", "b"], "code": "FILE_PERMISSION_DENIED"}])
            self.assertTrue(os.path.exists(os.path.join(self.root, "partial", "a")))
            self.assertFalse(os.path.exists(os.path.join(self.root, "partial", "nested", "b")))

    def test_preflight_enforces_exact_10000_tree_entry_boundary(self):
        directory = os.path.join(self.root, "large")
        os.mkdir(directory)
        for index in range(9999):
            with open(os.path.join(directory, f"f{index:04d}"), "wb"):
                pass
        with Workspace(self.root) as work:
            self.assertEqual(work.preflight_tree(["large"])["entries"], 10000)
            with open(os.path.join(directory, "extra"), "wb"):
                pass
            with self.assertRaises(ProtocolError) as limit:
                work.preflight_tree(["large"])
            self.assertEqual(limit.exception.code, "FILE_LIMIT_EXCEEDED")

    def test_permission_change_after_preflight_reports_partial_207(self):
        os.mkdir(os.path.join(self.root, "tree"))
        for name in ["a", "blocked"]:
            with open(os.path.join(self.root, "tree", name), "wb") as output:
                output.write(name.encode())
        real_unlink = os.unlink

        def deny_one(path, *args, **kwargs):
            if path == "blocked":
                raise OSError(errno.EACCES, "permission changed")
            return real_unlink(path, *args, **kwargs)

        with Workspace(self.root) as work, patch("filesystem.os.unlink", side_effect=deny_one):
            status, failures = work.delete(["tree"], FakeSession())
        self.assertEqual(status, 207)
        self.assertEqual(failures, [{"pathSegments": ["tree", "blocked"], "code": "FILE_PERMISSION_DENIED"}])
        self.assertFalse(os.path.exists(os.path.join(self.root, "tree", "a")))
        self.assertTrue(os.path.exists(os.path.join(self.root, "tree", "blocked")))

    def test_move_reports_partial_failure_after_overwrite_removed_target(self):
        self.make_tree()
        os.mkdir(os.path.join(self.root, "dest"))
        with open(os.path.join(self.root, "dest", "stale"), "wb") as output:
            output.write(b"stale")
        with Workspace(self.root) as work, patch("filesystem.os.rename", side_effect=OSError(errno.EACCES, "changed")):
            status, failures = work.move(["source"], ["dest"], FakeSession())
        self.assertEqual(status, 207)
        self.assertEqual(failures, [{"pathSegments": ["dest"], "code": "FILE_PERMISSION_DENIED"}])
        self.assertTrue(os.path.isdir(os.path.join(self.root, "source")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "dest")))


if __name__ == "__main__":
    unittest.main()
