import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from piwork_protocol import WorkProtocol, ProtocolError


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "service.sqlite"
        self.identity = {"contractVersion": 1, "workId": "work-1", "serviceId": "service-1", "serviceName": "todos", "token": "secret"}
        self.protocol = WorkProtocol(self.path, "code-1", identity=self.identity)
        with self.protocol.transaction() as db:
            db.execute("CREATE TABLE state(version INTEGER)")
            db.execute("INSERT INTO state VALUES(0)")

    def tearDown(self):
        self.protocol.close()
        self.temp.cleanup()

    def test_business_and_event_rollback_together(self):
        with self.assertRaises(ValueError):
            with self.protocol.transaction() as db:
                db.execute("UPDATE state SET version=1")
                self.protocol.event(db, "todo.changed", {}, "1")
                raise ValueError("business failed")
        with self.protocol.transaction() as db:
            self.assertEqual(db.execute("SELECT version FROM state").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM pi_outbox").fetchone()[0], 0)

    def test_lost_reply_reuses_original_event(self):
        with self.protocol.transaction() as db:
            event_id = self.protocol.event(db, "todo.changed", {}, "0")
        received = []
        def sender(event):
            received.append(json.dumps(event, sort_keys=True))
            if len(received) == 1:
                raise TimeoutError()
            return {"eventId": event["eventId"], "requestId": None}
        self.protocol.deliver_once(sender, clock=lambda: 10)
        self.protocol.deliver_once(sender, clock=lambda: 10)
        self.protocol.deliver_once(sender, clock=lambda: 11)
        self.assertEqual(len(received), 2)
        self.assertEqual(received[0], received[1])
        with self.protocol.transaction() as db:
            self.assertEqual(db.execute("SELECT disposition FROM pi_outbox WHERE event_id=?", (event_id,)).fetchone()[0], "delivered")

    def test_explicit_receipt_reconciliation_cannot_replay_an_imported_origin(self):
        with self.protocol.transaction() as db:
            event_id = self.protocol.event(db, "todo.changed", {}, "0")
        sent = []
        def original(method, path, event):
            sent.append(event)
            return {"eventId": event["eventId"], "requestId": "request-original"}
        self.protocol._request = original
        self.assertEqual(self.protocol.retry_event(event_id), self.protocol.retry_event(event_id))
        self.assertEqual(sent[0], sent[1])
        imported = WorkProtocol(self.path, "code-1", identity={**self.identity, "workId": "work-2"})
        try:
            with self.assertRaises(ProtocolError):
                imported.retry_event(event_id)
        finally:
            imported.close()

    def test_action_identity_version_and_original_result(self):
        version = lambda db: db.execute("SELECT version FROM state").fetchone()[0]
        def handler(db):
            db.execute("UPDATE state SET version=version+1")
            self.protocol.event(db, "todo.changed", {}, version(db), action_id="action-1", actor="agent")
            return {"state": "succeeded", "result": "changed", "error": None, "jobId": None}
        result = self.protocol.action("complete", "action-1", {}, "0", version, handler)
        self.assertEqual(self.protocol.action("complete", "action-1", {}, "0", version, handler), result)
        self.assertEqual(self.protocol.action_get("action-1"), result)
        with self.assertRaises(ProtocolError):
            self.protocol.action("complete", "action-1", {"other": True}, "0", version, handler)
        failed = self.protocol.action("complete", "action-2", {}, "0", version, handler)
        self.assertEqual(failed["error"]["code"], "ACTION_STATE_CONFLICT")
        with self.protocol.transaction() as db:
            self.assertEqual(version(db), 1)

    def test_path_and_import_origin(self):
        with self.protocol.transaction() as db:
            self.protocol.event(db, "page.visited", {"pathname": "/review?password=private#input", "dom": "private"}, "0")
            event = json.loads(db.execute("SELECT event_json FROM pi_outbox").fetchone()[0])
            self.assertEqual(event["payload"], {"pathname": "/review"})
        imported = WorkProtocol(self.path, "code-1", identity={**self.identity, "workId": "work-2"})
        self.assertFalse(imported.deliver_once(lambda _: self.fail("historical event delivered")))
        with imported.transaction() as db:
            self.assertEqual(db.execute("SELECT disposition FROM pi_outbox").fetchone()[0], "historical")

    def test_permanent_delivery_failure_remains_visible(self):
        with self.protocol.transaction() as db:
            self.protocol.event(db, "todo.changed", {}, "0")
        def sender(_):
            raise HTTPError("private", 409, "conflict", {}, None)
        self.protocol.deliver_once(sender)
        with self.protocol.transaction() as db:
            row = db.execute("SELECT disposition,error FROM pi_outbox").fetchone()
            self.assertEqual(tuple(row), ("undelivered", "HTTP_409"))


if __name__ == "__main__":
    unittest.main()
