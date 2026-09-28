"""Entrypoint for the Core-managed file helper container."""

import argparse
import sys

from conditions import evaluate_conditions, normalize_range
from filesystem import Workspace
from protocol import ProtocolError, run


def handle_request(session, request):
    action = request["action"]
    path = request["pathSegments"]
    conditions = request["conditions"]
    mutation_depth = request["depth"] if request["depth"] is not None else "infinity"

    def check(info):
        return evaluate_conditions(conditions, info, action)

    with Workspace() as work:
        if action == "CLEANUP":
            count = work.cleanup_temporaries(request["temporaries"])
            session.send_result(204, entries=count)
            return
        if action == "PROPFIND":
            if request["depth"] not in (0, 1):
                raise ProtocolError("FILE_DEPTH_UNSUPPORTED")
            own = work.stat_entry(path)
            session.send_meta(own)
            entries = 1
            if own["kind"] == "directory" and request["depth"] == 1:
                for item in work.list_children(path):
                    session.send_meta(item)
                    entries += 1
            session.send_result(207, entries=entries)
            return
        if action in ("GET", "HEAD"):
            metadata = work.stat_optional(path)
            conditional_status = check(metadata)
            if metadata is None:
                raise ProtocolError("FILE_NOT_FOUND")
            session.send_meta(metadata)
            if conditional_status == 304:
                session.send_result(304)
                return
            if metadata["kind"] == "directory":
                if action == "GET":
                    raise ProtocolError("FILE_METHOD_NOT_ALLOWED")
                session.send_result(200)
                return
            if metadata["kind"] != "file":
                raise ProtocolError("FILE_TYPE_UNSUPPORTED")
            if action == "HEAD":
                session.send_result(200)
                return
            selected = normalize_range(request["range"], metadata["size"])
            start, end = selected if selected is not None else (0, None)
            total = 0
            for chunk in work.read_chunks(path, start, end):
                session.send_data(chunk)
                total += len(chunk)
            session.send_result(206 if selected is not None else 200, bytes_count=total)
            return
        if action == "PUT":
            status, count = work.put_file(path, session, check_condition=check)
            session.send_result(status, bytes_count=count)
            return
        if action == "MKCOL":
            session.send_result(work.mkcol(path, session, check_condition=check))
            return
        if action == "DELETE":
            status, failures = work.delete(path, session, depth=mutation_depth, check_condition=check)
        elif action == "COPY":
            destination = request["destinationSegments"]
            if destination is None:
                raise ProtocolError("FILE_REQUEST_INVALID")
            status, failures = work.copy(path, destination, session,
                                         overwrite=request["overwrite"] is not False,
                                         depth=mutation_depth, check_condition=check)
        elif action == "MOVE":
            destination = request["destinationSegments"]
            if destination is None:
                raise ProtocolError("FILE_REQUEST_INVALID")
            status, failures = work.move(path, destination, session,
                                         overwrite=request["overwrite"] is not False,
                                         depth=mutation_depth, check_condition=check)
        else:
            raise ProtocolError("FILE_REQUEST_INVALID")
        for failure in failures:
            session.send_failure(failure["code"], failure["pathSegments"])
        session.send_result(status, entries=len(failures))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--work-id", required=True)
    parser.add_argument("--epoch", type=int, required=True)
    args = parser.parse_args()
    return run(sys.stdin.buffer, sys.stdout.buffer, args.job_id, args.work_id, args.epoch, handle_request)


if __name__ == "__main__":
    raise SystemExit(main())
