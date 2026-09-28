"""Version 1 framed stdin/stdout protocol for the trusted Work file executor."""

import json
import os
import select
import struct
import time

REQUEST, DATA_IN, END, ACK, CANCEL = 1, 2, 3, 4, 5
META, DATA_OUT, PREPARED, RESULT, ERROR = 17, 18, 19, 20, 21
HEADER_BYTES = 5
MAX_DATA_BYTES = 1024 * 1024
MAX_CONTROL_BYTES = 64 * 1024
IDLE_SECONDS = 60
REQUEST_SECONDS = 30 * 60
ACK_SECONDS = 10
INBOUND = {REQUEST, DATA_IN, END, ACK, CANCEL}
OUTBOUND = {META, DATA_OUT, PREPARED, RESULT, ERROR}
MUTATIONS = {"PUT", "MKCOL", "COPY", "MOVE", "DELETE"}
ACTIONS = MUTATIONS | {"PROPFIND", "GET", "HEAD", "CLEANUP"}


class ProtocolError(Exception):
    def __init__(self, code="FILE_BACKEND_PROTOCOL_ERROR"):
        super().__init__(code)
        self.code = code


class Cancelled(ProtocolError):
    def __init__(self):
        super().__init__("FILE_TRANSFER_TIMEOUT")


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise ProtocolError()
        result[key] = value
    return result


def _read_exact(stream, length, deadline):
    parts = []
    remaining = length
    while remaining:
        timeout = deadline - time.monotonic()
        if timeout <= 0:
            raise ProtocolError("FILE_TRANSFER_TIMEOUT")
        try:
            descriptor = stream.fileno()
        except (AttributeError, OSError):
            descriptor = None
        if descriptor is not None:
            readable, _, _ = select.select([descriptor], [], [], timeout)
            if not readable:
                raise ProtocolError("FILE_TRANSFER_TIMEOUT")
        chunk = os.read(descriptor, remaining) if descriptor is not None else stream.read(remaining)
        if not chunk:
            raise ProtocolError()
        parts.append(chunk)
        remaining -= len(chunk)
    return b"".join(parts)


def read_frame(stream, deadline, allowed=INBOUND):
    header = _read_exact(stream, HEADER_BYTES, deadline)
    kind, size = struct.unpack(">BI", header)
    if kind not in allowed or size > (MAX_DATA_BYTES if kind in (DATA_IN, DATA_OUT) else MAX_CONTROL_BYTES):
        raise ProtocolError()
    data = _read_exact(stream, size, deadline) if size else b""
    if kind in (DATA_IN, DATA_OUT):
        return kind, data
    try:
        payload = json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError() from error
    if not isinstance(payload, dict):
        raise ProtocolError()
    return kind, payload


def write_frame(stream, kind, payload):
    if kind not in OUTBOUND:
        raise ProtocolError()
    if kind == DATA_OUT:
        if not isinstance(payload, bytes):
            raise ProtocolError()
        data = payload
    else:
        if not isinstance(payload, dict):
            raise ProtocolError()
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(data) > (MAX_DATA_BYTES if kind == DATA_OUT else MAX_CONTROL_BYTES):
        raise ProtocolError()
    for section in (struct.pack(">BI", kind, len(data)), data):
        remaining = memoryview(section)
        while remaining:
            written = stream.write(remaining)
            if written is None or written <= 0:
                raise ProtocolError("FILE_RUNTIME_UNAVAILABLE")
            remaining = remaining[written:]
    stream.flush()


def validate_request(payload, job_id, work_id, epoch):
    required = {"version", "jobId", "workId", "epoch", "action", "pathSegments",
                "destinationSegments", "depth", "overwrite", "conditions", "range", "expectedLength"}
    if set(payload) not in (required, required | {"temporaries"}):
        raise ProtocolError()
    if payload["version"] != 1 or payload["jobId"] != job_id or payload["workId"] != work_id:
        raise ProtocolError()
    if type(payload["epoch"]) is not int or payload["epoch"] != epoch or epoch < 0:
        raise ProtocolError()
    if payload["action"] not in ACTIONS:
        raise ProtocolError()
    if not isinstance(payload["pathSegments"], list) or not all(isinstance(part, str) for part in payload["pathSegments"]):
        raise ProtocolError()
    destination = payload["destinationSegments"]
    if destination is not None and (not isinstance(destination, list) or not all(isinstance(part, str) for part in destination)):
        raise ProtocolError()
    if payload["depth"] not in (None, 0, 1, "infinity") or payload["overwrite"] not in (None, True, False):
        raise ProtocolError()
    if not isinstance(payload["conditions"], dict) or set(payload["conditions"]) != {
        "ifMatch", "ifNoneMatch", "ifModifiedSince", "ifUnmodifiedSince"
    } or any(value is not None and not isinstance(value, str) for value in payload["conditions"].values()):
        raise ProtocolError()
    if payload["range"] is not None:
        range_value = payload["range"]
        if not isinstance(range_value, dict):
            raise ProtocolError()
        if set(range_value) == {"suffix"}:
            if type(range_value["suffix"]) is not int or range_value["suffix"] < 1:
                raise ProtocolError()
        elif set(range_value) == {"start", "end"}:
            if type(range_value["start"]) is not int or range_value["start"] < 0 \
                    or (range_value["end"] is not None and
                        (type(range_value["end"]) is not int or range_value["end"] < range_value["start"])):
                raise ProtocolError()
        else:
            raise ProtocolError()
    length = payload["expectedLength"]
    if length is not None and (type(length) is not int or length < 0 or length > 10 * 1024 ** 3):
        raise ProtocolError()
    if payload["action"] != "CLEANUP" and "temporaries" in payload:
        raise ProtocolError()
    if payload["action"] == "CLEANUP" and (not isinstance(payload.get("temporaries"), list)
        or len(payload["temporaries"]) > 10000):
        raise ProtocolError()
    return payload


class ProtocolSession:
    def __init__(self, source, sink, job_id, work_id, epoch, clock=time.monotonic):
        self.source, self.sink = source, sink
        self.job_id, self.work_id, self.epoch = job_id, work_id, epoch
        self.clock = clock
        self.started = clock()
        self.total_deadline = self.started + REQUEST_SECONDS
        self.request = None
        self.upload_ended = False
        self.commit_granted = False
        self.result_sent = False
        self.temporary_ids = {}

    def _deadline(self, seconds=IDLE_SECONDS):
        return min(self.total_deadline, self.clock() + seconds)

    def start(self):
        if self.request is not None:
            raise ProtocolError()
        kind, payload = read_frame(self.source, self._deadline())
        if kind != REQUEST:
            raise ProtocolError()
        self.request = validate_request(payload, self.job_id, self.work_id, self.epoch)
        return self.request

    def upload_chunks(self):
        if self.request is None or self.request["action"] != "PUT" or self.upload_ended:
            raise ProtocolError()
        size = 0
        while True:
            kind, payload = read_frame(self.source, self._deadline())
            if kind == CANCEL:
                raise Cancelled()
            if kind == END:
                if payload != {}:
                    raise ProtocolError()
                if self.request["expectedLength"] is not None and size != self.request["expectedLength"]:
                    raise ProtocolError("FILE_REQUEST_INVALID")
                self.upload_ended = True
                return
            if kind != DATA_IN:
                raise ProtocolError()
            size += len(payload)
            if size > 10 * 1024 ** 3:
                raise ProtocolError("FILE_LIMIT_EXCEEDED")
            yield payload

    def prepare(self, phase, temporary_id=None, parent_segments=None, name=None, device=None, inode=None):
        if self.request is None or self.result_sent or phase not in ("temporary", "commit"):
            raise ProtocolError()
        if phase == "commit":
            if self.commit_granted or (self.request["action"] == "PUT" and not self.upload_ended):
                raise ProtocolError()
        else:
            stage = self.temporary_ids.get(temporary_id)
            if temporary_id is None or stage == "created":
                raise ProtocolError()
            if stage is None and (device is not None or inode is not None):
                raise ProtocolError()
            if stage == "planned" and (device is None or inode is None):
                raise ProtocolError()
        notice = {"epoch": self.epoch, "phase": phase, "temporaryId": temporary_id,
                  "parentSegments": parent_segments or [], "name": name, "device": device, "inode": inode}
        write_frame(self.sink, PREPARED, notice)
        kind, payload = read_frame(self.source, self._deadline(ACK_SECONDS))
        if kind == CANCEL:
            raise Cancelled()
        if kind != ACK or set(payload) != {"epoch", "phase", "temporaryId"} or type(payload["epoch"]) is not int \
                or payload != {"epoch": self.epoch, "phase": phase, "temporaryId": temporary_id}:
            raise ProtocolError()
        if phase == "temporary":
            self.temporary_ids[temporary_id] = "planned" if device is None else "created"
        else:
            self.commit_granted = True

    def send_meta(self, metadata):
        if self.request is None or self.result_sent:
            raise ProtocolError()
        write_frame(self.sink, META, metadata)

    def send_data(self, data):
        if self.request is None or self.result_sent:
            raise ProtocolError()
        write_frame(self.sink, DATA_OUT, data)

    def send_result(self, status, bytes_count=0, entries=0):
        if self.request is None or self.result_sent or (self.request["action"] in MUTATIONS and not self.commit_granted):
            raise ProtocolError()
        if self.request["action"] == "PUT" and not self.upload_ended:
            raise ProtocolError()
        write_frame(self.sink, RESULT, {"status": status, "bytes": bytes_count, "entries": entries})
        self.result_sent = True

    def send_error(self, code, path_segments=None):
        if self.result_sent:
            return
        write_frame(self.sink, ERROR, {"code": code, "pathSegments": path_segments})
        self.result_sent = True

    def send_failure(self, code, path_segments):
        if self.request is None or self.result_sent:
            raise ProtocolError()
        write_frame(self.sink, ERROR, {"code": code, "pathSegments": path_segments})


def run(source, sink, job_id, work_id, epoch, handler):
    session = ProtocolSession(source, sink, job_id, work_id, epoch)
    try:
        request = session.start()
        handler(session, request)
        if not session.result_sent:
            raise ProtocolError()
        return 0
    except ProtocolError as error:
        session.send_error(error.code)
        return 1
    except (OSError, ValueError):
        session.send_error("FILE_RUNTIME_UNAVAILABLE")
        return 1
