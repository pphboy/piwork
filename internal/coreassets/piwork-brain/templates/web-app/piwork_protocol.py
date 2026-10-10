"""Language-neutral contract v1 example; Python stdlib only, backend use only."""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import hashlib
import hmac
import json
import re
from pathlib import Path
import sqlite3
import ssl
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import uuid


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class ProtocolError(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status
        super().__init__(code)


class WorkProtocol:
    def __init__(self, database, code_version, identity_path="/etc/piwork/interaction/config.json", identity=None):
        self.database, self.code_version = str(database), code_version
        self.identity = identity or json.loads(Path(identity_path).read_text())
        if self.identity.get("contractVersion") != 1:
            raise ValueError("unsupported interaction identity")
        self.origin = {key: self.identity[key] for key in ("workId", "serviceId")}
        self.stop_event = threading.Event()
        with self.transaction() as db:
            db.executescript("""
CREATE TABLE IF NOT EXISTS pi_actions(action_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pi_outbox(event_id TEXT PRIMARY KEY, origin_json TEXT NOT NULL, event_json TEXT NOT NULL,
 disposition TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
 expires_at TEXT, receipt_json TEXT, error TEXT);
""")
            db.execute("UPDATE pi_outbox SET disposition='historical',error='SERVICE_EVENT_ORIGIN_MISMATCH' WHERE disposition='pending' AND origin_json!=?", (canonical(self.origin),))

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.database, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("BEGIN IMMEDIATE")
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    def authorized(self, header):
        return isinstance(header, str) and hmac.compare_digest(header, "Bearer " + self.identity["token"])

    def event(self, db, event_type, payload, state_version, *, event_id=None, entity_ref=None,
              action_id=None, job_id=None, causation_request_id=None, actor=None):
        if event_type == "page.visited":
            pathname = urlsplit(str(payload.get("pathname", "/"))).path
            payload = {"pathname": pathname if pathname.startswith("/") else "/"}
        event_id = event_id or "event-" + uuid.uuid4().hex
        envelope = {"contractVersion": 1, "eventId": event_id, "origin": self.origin,
                    "serviceName": self.identity["serviceName"], "type": event_type,
                    "occurredAt": now(), "stateVersion": str(state_version), "entityRef": entity_ref,
                    "actionId": action_id, "jobId": job_id, "causationRequestId": causation_request_id,
                    "payload": payload}
        if actor is not None:
            envelope["actor"] = actor
        encoded = canonical(envelope)
        if len(encoded.encode()) > 65536 or (event_type == "agent.requested" and len(str(payload.get("goal", "")).encode()) > 8192):
            raise ProtocolError("EVENT_TOO_LARGE", 413)
        expiry = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(timespec="milliseconds").replace("+00:00", "Z") if event_type == "agent.requested" else None
        db.execute("INSERT INTO pi_outbox(event_id,origin_json,event_json,expires_at) VALUES(?,?,?,?)",
                   (event_id, canonical(self.origin), encoded, expiry))
        return event_id

    def action(self, name, action_id, value, expected_state_version, version, handler):
        fingerprint = hashlib.sha256(canonical([name, value, expected_state_version]).encode()).hexdigest()
        with self.transaction() as db:
            prior = db.execute("SELECT * FROM pi_actions WHERE action_id=?", (action_id,)).fetchone()
            if prior:
                if prior["fingerprint"] != fingerprint:
                    raise ProtocolError("ACTION_IDEMPOTENCY_CONFLICT")
                return json.loads(prior["result_json"])
            current = str(version(db))
            conflict = expected_state_version is not None and str(expected_state_version) != current
            outcome = {"state": "failed", "result": None, "error": {"code": "ACTION_STATE_CONFLICT", "message": "State version changed"}, "jobId": None} if conflict else handler(db)
            result = {"actionId": action_id, "actionName": name, "input": value,
                      "expectedStateVersion": expected_state_version, "stateVersion": str(version(db)),
                      "observedAt": now(), **outcome}
            if result.get("error") is None:
                result.pop("error", None)
            db.execute("INSERT INTO pi_actions VALUES(?,?,?)", (action_id, fingerprint, canonical(result)))
            return result

    def action_get(self, action_id):
        with self.transaction() as db:
            row = db.execute("SELECT result_json FROM pi_actions WHERE action_id=?", (action_id,)).fetchone()
            if not row:
                raise ProtocolError("ACTION_NOT_FOUND", 404)
            return json.loads(row[0])

    def _request(self, method, path, value=None):
        body = canonical(value).encode() if value is not None else None
        context = ssl.create_default_context(cafile=self.identity["caPath"])
        req = Request(self.identity["agentUrl"] + path, data=body, method=method,
                      headers={"Authorization": "Bearer " + self.identity["token"], "Content-Type": "application/json"})
        with urlopen(req, timeout=10, context=context) as response:
            encoded = response.read(1048577)
            if len(encoded) > 1048576:
                raise ValueError("feedback response exceeds limit")
            return json.loads(encoded)

    def request_get(self, request_id):
        if not request_id or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in request_id):
            raise ProtocolError("REQUEST_NOT_FOUND", 404)
        return self._request("GET", "/pi/v1/requests/" + request_id)

    def request_cancel(self, request_id):
        self.request_get(request_id)
        return self._request("POST", "/pi/v1/requests/" + request_id + "/cancel", {})

    def retry_event(self, event_id):
        """Reconcile an own original delivery after an uncertain acknowledgement."""
        with self.transaction() as db:
            row = db.execute("SELECT * FROM pi_outbox WHERE event_id=?", (event_id,)).fetchone()
            if not row or row["origin_json"] != canonical(self.origin) or row["disposition"] in ("historical", "expired", "undelivered"):
                raise ProtocolError("EVENT_NOT_FOUND", 404)
            event = json.loads(row["event_json"])
        receipt = self._request("POST", "/pi/v1/events", event)
        if not isinstance(receipt, dict) or receipt.get("eventId") != event_id:
            raise ValueError("unconfirmed event receipt")
        with self.transaction() as db:
            db.execute("UPDATE pi_outbox SET disposition='delivered',receipt_json=?,error=NULL WHERE event_id=?", (canonical(receipt), event_id))
        return receipt

    def deliver_once(self, sender=None, clock=time.time):
        with self.transaction() as db:
            db.execute("UPDATE pi_outbox SET disposition='expired',error='REQUEST_EXPIRED' WHERE disposition='pending' AND expires_at IS NOT NULL AND expires_at<=?", (now(),))
            row = db.execute("SELECT * FROM pi_outbox WHERE disposition='pending' AND next_attempt<=? ORDER BY rowid LIMIT 1", (clock(),)).fetchone()
        if not row:
            return False
        event = json.loads(row["event_json"])
        try:
            receipt = (sender or (lambda e: self._request("POST", "/pi/v1/events", e)))(event)
            if not isinstance(receipt, dict) or receipt.get("eventId") != row["event_id"]:
                raise ValueError("unconfirmed event receipt")
            with self.transaction() as db:
                db.execute("UPDATE pi_outbox SET disposition='delivered',receipt_json=?,error=NULL WHERE event_id=? AND disposition='pending'", (canonical(receipt), row["event_id"]))
        except HTTPError as error:
            permanent = error.code in (400, 401, 403, 404, 409, 413, 422)
            try:
                reported = json.loads(error.read(65536)).get("code", "")
            except (ValueError, AttributeError):
                reported = ""
            code = reported if isinstance(reported, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,127}", reported) else "HTTP_" + str(error.code)
            self._delivery_failed(row, "undelivered" if permanent else "pending", code, clock())
        except (URLError, OSError, ValueError, TimeoutError) as error:
            code = "DELIVERY_TLS_FAILED" if isinstance(getattr(error, "reason", error), ssl.SSLError) else "DELIVERY_UNCONFIRMED"
            self._delivery_failed(row, "pending", code, clock())
        return True

    def _delivery_failed(self, row, disposition, error, clock):
        delay = min(30, 2 ** min(row["attempts"], 5))
        with self.transaction() as db:
            db.execute("UPDATE pi_outbox SET disposition=?,attempts=attempts+1,next_attempt=?,error=? WHERE event_id=? AND disposition='pending'",
                       (disposition, clock + delay, error, row["event_id"]))

    def start_delivery(self):
        def run():
            while not self.stop_event.is_set():
                try:
                    self.deliver_once()
                except sqlite3.Error:
                    pass  # No acknowledgment: the durable row remains for retry.
                self.stop_event.wait(1)
        thread = threading.Thread(target=run, daemon=True, name="pi-feedback-outbox")
        thread.start()
        return thread

    def close(self):
        self.stop_event.set()
