import io
import json
import struct
import time
import unittest

from protocol import (ACK, CANCEL, DATA_IN, DATA_OUT, END, ERROR, MAX_CONTROL_BYTES,
                      MAX_DATA_BYTES, PREPARED, REQUEST, RESULT, ProtocolError,
                      ProtocolSession, read_frame, run, write_frame)


def frame(kind, payload):
    data = payload if isinstance(payload, bytes) else json.dumps(payload, separators=(",", ":")).encode()
    return struct.pack(">BI", kind, len(data)) + data


def request(**changes):
    value = {"version": 1, "jobId": "filejob-test", "workId": "work-test", "epoch": 4,
             "action": "PUT", "pathSegments": ["data", "blob.bin"], "destinationSegments": None,
             "depth": None, "overwrite": None, "conditions": {
                 "ifMatch": None, "ifNoneMatch": None, "ifModifiedSince": None, "ifUnmodifiedSince": None},
             "range": None, "expectedLength": 3}
    value.update(changes)
    return value


def session(data):
    sink = io.BytesIO()
    return ProtocolSession(io.BytesIO(data), sink, "filejob-test", "work-test", 4), sink


class ProtocolTests(unittest.TestCase):
    def test_binary_data_boundary_and_no_json_encoding(self):
        binary = b"\xff\x00" * (MAX_DATA_BYTES // 2)
        output = io.BytesIO()
        write_frame(output, DATA_OUT, binary)
        self.assertEqual(output.getvalue()[5:], binary)
        self.assertEqual(read_frame(io.BytesIO(output.getvalue()), float("inf"), {DATA_OUT}), (DATA_OUT, binary))
        with self.assertRaises(ProtocolError):
            write_frame(io.BytesIO(), DATA_OUT, binary + b"x")
        with self.assertRaises(ProtocolError):
            read_frame(io.BytesIO(struct.pack(">BI", REQUEST, MAX_CONTROL_BYTES + 1)), float("inf"))

    def test_frame_writer_resumes_partial_writes_without_losing_binary_bytes(self):
        class ShortWriter:
            def __init__(self):
                self.data = bytearray()
                self.calls = 0

            def write(self, value):
                self.calls += 1
                piece = bytes(value[:3])
                self.data.extend(piece)
                return len(piece)

            def flush(self):
                pass

        sink = ShortWriter()
        write_frame(sink, DATA_OUT, b"\x00\xff" * 100)
        self.assertGreater(sink.calls, 10)
        self.assertEqual(read_frame(io.BytesIO(sink.data), float("inf"), {DATA_OUT}),
                         (DATA_OUT, b"\x00\xff" * 100))

    def test_truncated_invalid_and_duplicate_json_frames(self):
        for data in [b"", b"\x01", frame(REQUEST, request())[:-1],
                     struct.pack(">BI", 99, 0), frame(REQUEST, b"\xff"),
                     frame(REQUEST, b'{"version":1,"version":2}')]:
            with self.subTest(data=data[:12]), self.assertRaises(ProtocolError):
                read_frame(io.BytesIO(data), float("inf"))

    def test_request_must_be_first_and_epoch_must_match(self):
        for data in [frame(DATA_IN, b"a"), frame(END, {}), frame(REQUEST, request(epoch=5)),
                     frame(REQUEST, request(jobId="other")), frame(REQUEST, request(token="secret"))]:
            current, _ = session(data)
            with self.subTest(data=data[:12]), self.assertRaises(ProtocolError):
                current.start()

    def test_put_requires_end_and_commit_ack_before_success(self):
        wire = frame(REQUEST, request()) + frame(DATA_IN, b"abc") + frame(END, {}) + frame(ACK, {
            "epoch": 4, "phase": "commit", "temporaryId": None})
        current, output = session(wire)
        current.start()
        self.assertEqual(list(current.upload_chunks()), [b"abc"])
        current.prepare("commit")
        current.send_result(201, bytes_count=3)
        first = read_frame(output := io.BytesIO(output.getvalue()), float("inf"), {PREPARED, RESULT})
        second = read_frame(output, float("inf"), {PREPARED, RESULT})
        self.assertEqual(first[0], PREPARED)
        self.assertEqual(second, (RESULT, {"status": 201, "bytes": 3, "entries": 0}))
        with self.assertRaises(ProtocolError):
            current.prepare("commit")
        without_end, _ = session(frame(REQUEST, request()) + frame(DATA_IN, b"abc"))
        without_end.start()
        with self.assertRaises(ProtocolError):
            list(without_end.upload_chunks())

    def test_wrong_ack_duplicate_commit_and_length_mismatch_fail(self):
        current, _ = session(frame(REQUEST, request()) + frame(DATA_IN, b"ab") + frame(END, {}))
        current.start()
        with self.assertRaises(ProtocolError) as mismatch:
            list(current.upload_chunks())
        self.assertEqual(mismatch.exception.code, "FILE_REQUEST_INVALID")
        wrong = frame(REQUEST, request(expectedLength=0)) + frame(END, {}) + frame(ACK, {
            "epoch": 3, "phase": "commit", "temporaryId": None})
        current, _ = session(wrong)
        current.start()
        list(current.upload_chunks())
        with self.assertRaises(ProtocolError):
            current.prepare("commit")

    def test_temporary_requires_plan_ack_then_inode_ack(self):
        ack = frame(ACK, {"epoch": 4, "phase": "temporary", "temporaryId": "filetemp-test"})
        current, output = session(frame(REQUEST, request()) + ack + ack)
        current.start()
        current.prepare("temporary", "filetemp-test", [], ".tmp")
        current.prepare("temporary", "filetemp-test", [], ".tmp", "1", "2")
        self.assertEqual(current.temporary_ids["filetemp-test"], "created")
        with self.assertRaises(ProtocolError):
            current.prepare("temporary", "filetemp-test", [], ".tmp", "1", "2")
        first = read_frame(io.BytesIO(output.getvalue()), float("inf"), {PREPARED})
        self.assertIsNone(first[1]["inode"])

    def test_cancel_and_eof_emit_safe_error(self):
        output = io.BytesIO()
        status = run(io.BytesIO(frame(REQUEST, request()) + frame(CANCEL, {})), output,
                     "filejob-test", "work-test", 4,
                     lambda current, _request: list(current.upload_chunks()))
        self.assertEqual(status, 1)
        kind, payload = read_frame(io.BytesIO(output.getvalue()), float("inf"), {ERROR})
        self.assertEqual((kind, payload), (ERROR, {"code": "FILE_TRANSFER_TIMEOUT", "pathSegments": None}))
        output = io.BytesIO()
        status = run(io.BytesIO(frame(REQUEST, request())), output,
                     "filejob-test", "work-test", 4,
                     lambda current, _request: list(current.upload_chunks()))
        self.assertEqual(status, 1)
        self.assertEqual(read_frame(io.BytesIO(output.getvalue()), float("inf"), {ERROR})[1]["code"], "FILE_BACKEND_PROTOCOL_ERROR")

    def test_expired_frame_deadline_reports_timeout(self):
        with self.assertRaises(ProtocolError) as failure:
            read_frame(io.BytesIO(frame(END, {})), time.monotonic() - 1)
        self.assertEqual(failure.exception.code, "FILE_TRANSFER_TIMEOUT")


if __name__ == "__main__":
    unittest.main()
