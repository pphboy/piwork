import os
import tempfile
import unittest
from unittest.mock import patch

from conditions import evaluate_conditions, normalize_range
from filesystem import Workspace
from main import handle_request
from protocol import ProtocolError


EMPTY_CONDITIONS = {"ifMatch": None, "ifNoneMatch": None,
                    "ifModifiedSince": None, "ifUnmodifiedSince": None}


class RecordingSession:
    job_id = "filejob-test"

    def __init__(self):
        self.metadata = []
        self.data = bytearray()
        self.result = None
        self.failures = []

    def send_meta(self, value):
        self.metadata.append(value)

    def send_data(self, value):
        self.data.extend(value)

    def send_result(self, status, bytes_count=0, entries=0):
        self.result = (status, bytes_count, entries)

    def send_failure(self, code, path):
        self.failures.append((code, path))

    def prepare(self, *_args):
        pass


class ConditionAndCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        with open(os.path.join(self.root, "file"), "wb") as output:
            output.write(b"abcdefghij")
        with open(os.path.join(self.root, "empty"), "wb"):
            pass
        self.modified = {"modifiedMs": 1_700_000_000_000}

    def tearDown(self):
        self.temp.cleanup()

    def test_existence_etag_and_date_conditions(self):
        with self.assertRaises(ProtocolError) as failed_match:
            evaluate_conditions({**EMPTY_CONDITIONS, "ifMatch": '"opaque"'}, self.modified, "PUT")
        self.assertEqual(failed_match.exception.code, "FILE_PRECONDITION_FAILED")
        self.assertIsNone(evaluate_conditions({**EMPTY_CONDITIONS, "ifMatch": "*"}, self.modified, "PUT"))
        self.assertEqual(evaluate_conditions({**EMPTY_CONDITIONS, "ifNoneMatch": "*"}, self.modified, "GET"), 304)
        with self.assertRaises(ProtocolError):
            evaluate_conditions({**EMPTY_CONDITIONS, "ifNoneMatch": "*"}, self.modified, "PUT")
        self.assertIsNone(evaluate_conditions({**EMPTY_CONDITIONS, "ifNoneMatch": '"other"'}, self.modified, "GET"))
        with self.assertRaises(ProtocolError) as unmodified:
            evaluate_conditions({**EMPTY_CONDITIONS, "ifUnmodifiedSince": "Wed, 15 Nov 2023 00:00:00 GMT"},
                                {"modifiedMs": 1_700_010_000_000}, "PUT")
        self.assertEqual(unmodified.exception.code, "FILE_PRECONDITION_FAILED")
        self.assertEqual(evaluate_conditions({**EMPTY_CONDITIONS, "ifModifiedSince": "Wed, 15 Nov 2023 00:00:00 GMT"},
                                             self.modified, "GET"), 304)
        self.assertIsNone(evaluate_conditions({**EMPTY_CONDITIONS, "ifModifiedSince": "invalid"}, self.modified, "GET"))
        with self.assertRaises(ProtocolError) as malformed:
            evaluate_conditions({**EMPTY_CONDITIONS, "ifMatch": "not-an-etag"}, self.modified, "PUT")
        self.assertEqual(malformed.exception.code, "FILE_REQUEST_INVALID")

    def test_single_ranges_cover_middle_suffix_open_end_and_unavailable(self):
        self.assertEqual(normalize_range({"start": 2, "end": 5}, 10), (2, 5))
        self.assertEqual(normalize_range({"start": 8, "end": None}, 10), (8, 9))
        self.assertEqual(normalize_range({"suffix": 3}, 10), (7, 9))
        self.assertEqual(normalize_range({"suffix": 20}, 10), (0, 9))
        for selected, size in [({"start": 10, "end": None}, 10), ({"suffix": 1}, 0)]:
            with self.assertRaises(ProtocolError) as unsatisfied:
                normalize_range(selected, size)
            self.assertEqual(unsatisfied.exception.code, "FILE_RANGE_UNSATISFIABLE")

    def test_main_get_and_head_stream_selected_bytes_without_etag(self):
        base = {"action": "GET", "pathSegments": ["file"], "destinationSegments": None,
                "depth": None, "overwrite": None, "conditions": EMPTY_CONDITIONS,
                "range": {"suffix": 4}, "expectedLength": None}
        with patch("main.Workspace", side_effect=lambda: Workspace(self.root)):
            get = RecordingSession()
            handle_request(get, base)
            self.assertEqual(get.result, (206, 4, 0))
            self.assertEqual(bytes(get.data), b"ghij")
            self.assertEqual(get.metadata[0]["size"], 10)
            head = RecordingSession()
            handle_request(head, {**base, "action": "HEAD"})
            self.assertEqual(head.result, (200, 0, 0))
            self.assertEqual(bytes(head.data), b"")
            empty = RecordingSession()
            handle_request(empty, {**base, "pathSegments": ["empty"], "range": None})
            self.assertEqual(empty.result, (200, 0, 0))
            self.assertEqual(bytes(empty.data), b"")

    def test_cleanup_removes_only_exact_recorded_inode(self):
        user = os.path.join(self.root, ".piwork-file-user.tmp")
        with open(user, "wb") as output:
            output.write(b"user")
        owned = os.path.join(self.root, ".piwork-file-owned.tmp")
        with open(owned, "wb") as output:
            output.write(b"owned")
        info = os.stat(owned)
        record = {"temporaryId": "filetemp-1", "parentSegments": [], "name": ".piwork-file-owned.tmp",
                  "device": str(info.st_dev), "inode": str(info.st_ino)}
        with Workspace(self.root) as work:
            self.assertEqual(work.cleanup_temporaries([record]), 1)
            self.assertEqual(work.cleanup_temporaries([record]), 0)
            bad = {**record, "name": ".piwork-file-user.tmp"}
            with self.assertRaises(ProtocolError) as failure:
                work.cleanup_temporaries([bad])
            self.assertEqual(failure.exception.code, "FILE_CLEANUP_REQUIRED")
        self.assertTrue(os.path.exists(user))
        self.assertFalse(os.path.exists(owned))


if __name__ == "__main__":
    unittest.main()
