"""HTTP existence, date and single-range rules without ETag claims."""

from email.utils import parsedate_to_datetime
import re

from protocol import ProtocolError


_ETAG = re.compile(r'(?:W/)?"[^"\x00-\x1f\x7f]*"')


def _validate_etag_condition(value):
    if value is None:
        return
    if value == "*":
        return
    if not value or len(value) > 8192:
        raise ProtocolError("FILE_REQUEST_INVALID")
    cursor = 0
    while cursor < len(value):
        while cursor < len(value) and value[cursor] in " \t":
            cursor += 1
        match = _ETAG.match(value, cursor)
        if not match:
            raise ProtocolError("FILE_REQUEST_INVALID")
        cursor = match.end()
        while cursor < len(value) and value[cursor] in " \t":
            cursor += 1
        if cursor == len(value):
            return
        if value[cursor] != ",":
            raise ProtocolError("FILE_REQUEST_INVALID")
        cursor += 1
        if cursor == len(value):
            raise ProtocolError("FILE_REQUEST_INVALID")


def _date_seconds(value):
    if value is None:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        return int(parsed.timestamp()) if parsed.tzinfo is not None else None
    except (TypeError, ValueError, OverflowError):
        return None


def _modified_seconds(info):
    if info is None:
        return None
    if isinstance(info, dict):
        return info["modifiedMs"] // 1000 if info.get("modifiedMs") is not None else None
    return info.st_mtime_ns // 1_000_000_000


def evaluate_conditions(conditions, info, method):
    match_value = conditions["ifMatch"]
    none_value = conditions["ifNoneMatch"]
    _validate_etag_condition(match_value)
    _validate_etag_condition(none_value)
    exists = info is not None
    if match_value is not None:
        if match_value != "*" or not exists:
            raise ProtocolError("FILE_PRECONDITION_FAILED")
    else:
        unmodified = _date_seconds(conditions["ifUnmodifiedSince"])
        if exists and unmodified is not None and _modified_seconds(info) > unmodified:
            raise ProtocolError("FILE_PRECONDITION_FAILED")
    if none_value == "*" and exists:
        if method in ("GET", "HEAD"):
            return 304
        raise ProtocolError("FILE_PRECONDITION_FAILED")
    if none_value is None and method in ("GET", "HEAD"):
        modified = _date_seconds(conditions["ifModifiedSince"])
        if exists and modified is not None and _modified_seconds(info) <= modified:
            return 304
    return None


def normalize_range(value, size):
    if value is None:
        return None
    if size <= 0:
        raise ProtocolError("FILE_RANGE_UNSATISFIABLE")
    if "suffix" in value:
        suffix = value["suffix"]
        if suffix < 1:
            raise ProtocolError("FILE_REQUEST_INVALID")
        return max(0, size - suffix), size - 1
    start = value["start"]
    end = size - 1 if value["end"] is None else min(value["end"], size - 1)
    if start >= size or end < start:
        raise ProtocolError("FILE_RANGE_UNSATISFIABLE")
    return start, end
