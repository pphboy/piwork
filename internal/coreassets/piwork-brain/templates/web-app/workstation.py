"""Persistent example business logic. No dependency on a UI framework or the platform SDK."""
import os
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import threading
import time
import uuid
from piwork_protocol import WorkProtocol, ProtocolError, canonical, now


class Workstation:
    def __init__(self, data, code, identity=None, identity_path="/etc/piwork/interaction/config.json"):
        self.data, self.code = Path(data), Path(code)
        self.data.mkdir(parents=True, exist_ok=True)
        self.executor = "executor-" + uuid.uuid4().hex
        self.protocol = WorkProtocol(self.data / "workstation.sqlite", self.version(), identity_path, identity)
        self.threads = []
        with self.protocol.transaction() as db:
            db.executescript("""
CREATE TABLE IF NOT EXISTS ws_meta(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO ws_meta VALUES(1,1);
CREATE TABLE IF NOT EXISTS todos(id TEXT PRIMARY KEY, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ws_jobs(id TEXT PRIMARY KEY, action_id TEXT NOT NULL, executor TEXT NOT NULL,
 state TEXT NOT NULL, deadline TEXT NOT NULL, snapshot_json TEXT NOT NULL, result_json TEXT, error_json TEXT);
""")
            db.execute("UPDATE ws_jobs SET state='failed', error_json=? WHERE state IN ('accepted','running') AND executor!=?",
                       (canonical({"code": "JOB_EXECUTOR_INTERRUPTED", "message": "Original executor stopped; this Job was not replayed"}), self.executor))

    def version(self):
        return os.environ.get("PIWORK_WEB_CODE_VERSION") or json.loads((self.code / "review_config.json").read_text()).get("codeVersion", "workstation-v1")

    def state(self, db):
        return str(db.execute("SELECT version FROM ws_meta WHERE id=1").fetchone()[0])

    def bump(self, db):
        db.execute("UPDATE ws_meta SET version=version+1 WHERE id=1")

    def capabilities(self):
        with self.protocol.transaction() as db:
            version = self.state(db)
        object_schema = {"type": "object", "properties": {}, "additionalProperties": False}
        wait = json.loads((self.code / "review_config.json").read_text()).get("exportWaitMs", 60000)
        if not isinstance(wait, int) or not 1 <= wait <= 60000:
            raise ProtocolError("WAIT_CONFIGURATION_INVALID", 400)
        def mutation(schema, verification, mode="sync"):
            return {"inputSchema": schema, "description": "Update this workstation with a stable Action ID",
                    "mutation": True, "requiresExpectedStateVersion": True, "verificationQuery": verification,
                    "mode": mode, "maxWaitMs": wait if mode == "async" else 60000}
        return {"contractVersion": 1, "logicalServiceName": self.protocol.identity["serviceName"],
                "codeVersion": self.version(), "stateVersion": version,
                "queries": {name: {"inputSchema": object_schema, "description": description} for name, description in
                            [("todos", "Current Todo state"), ("review", "Personal review including completed work"), ("exports", "Original export results and files")]},
                "actions": {
                    "todo_add": mutation({"type": "object", "properties": {"title": {"type": "string", "minLength": 1, "maxLength": 200}}, "required": ["title"], "additionalProperties": False}, "todos"),
                    "todo_complete": mutation({"type": "object", "properties": {"id": {"type": "string", "maxLength": 128}}, "required": ["id"], "additionalProperties": False}, "review"),
                    "export_review": mutation(object_schema, "exports", "async")},
                "events": {"facts": ["page.visited", "business.action", "job.completed"],
                           "requestReasons": ["review_missing", "export_review"]}, "jobs": True}

    def query(self, name, value):
        if value != {}:
            raise ProtocolError("QUERY_INPUT_INVALID", 400)
        with self.protocol.transaction() as db:
            todos = [dict(row) for row in db.execute("SELECT * FROM todos ORDER BY rowid")]
            config = json.loads((self.code / "review_config.json").read_text())
            if name == "todos":
                result, checks = todos, [{"name": "todos_readable", "passed": True, "summary": "Business database was queried"}]
            elif name == "review":
                completed = [row for row in todos if row["completed"]]
                result = {"completed": completed if config["includeCompleted"] else [], "open": [row for row in todos if not row["completed"]]}
                checks = [{"name": "completed_in_review", "passed": len(result["completed"]) == len(completed), "summary": "Review accounts for actual completed Todos"}]
            elif name == "exports":
                result = [self.job_row(row) for row in db.execute("SELECT * FROM ws_jobs ORDER BY rowid")]
                checks = [{"name": "exports_exist", "passed": bool(result) and result[-1]["state"] == "succeeded" and all((self.data / Path(path).name).is_file() for path in result[-1]["artifacts"]), "summary": "Original export Jobs completed and files exist"}]
            else:
                raise ProtocolError("QUERY_NOT_FOUND", 404)
            return {"stateVersion": self.state(db), "codeVersion": self.version(), "observedAt": now(), "value": result, "checks": checks}

    def perform(self, name, action_id, value, expected, actor="agent", request_id=None, export_delay=8):
        def handler(db):
            job_id = None
            if name == "todo_add":
                if set(value) != {"title"} or not isinstance(value["title"], str) or not 0 < len(value["title"]) <= 200:
                    raise ProtocolError("ACTION_INPUT_INVALID", 400)
                entity = "todo-" + uuid.uuid4().hex
                db.execute("INSERT INTO todos(id,title) VALUES(?,?)", (entity, value["title"]))
                outcome = {"id": entity}
            elif name == "todo_complete":
                if set(value) != {"id"} or not isinstance(value["id"], str):
                    raise ProtocolError("ACTION_INPUT_INVALID", 400)
                entity = value["id"]
                if not db.execute("UPDATE todos SET completed=1 WHERE id=?", (entity,)).rowcount:
                    raise ProtocolError("TODO_NOT_FOUND", 404)
                outcome = {"id": entity, "completed": True}
            elif name == "export_review":
                if value != {}:
                    raise ProtocolError("ACTION_INPUT_INVALID", 400)
                entity = job_id = "job-" + uuid.uuid4().hex
                snapshot = [dict(row) for row in db.execute("SELECT * FROM todos ORDER BY rowid")]
                deadline = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                db.execute("INSERT INTO ws_jobs(id,action_id,executor,state,deadline,snapshot_json) VALUES(?,?,?,'running',?,?)",
                           (job_id, action_id, self.executor, deadline, canonical(snapshot)))
                outcome = {"export": job_id}
            else:
                raise ProtocolError("ACTION_NOT_FOUND", 404)
            self.bump(db)
            self.protocol.event(db, "business.action", {"action": name}, self.state(db), entity_ref=entity,
                                action_id=action_id, job_id=job_id, causation_request_id=request_id, actor=actor)
            return {"state": "running" if job_id else "succeeded", "result": outcome, "jobId": job_id}
        result = self.protocol.action(name, action_id, value, expected, self.state, handler)
        if result.get("jobId"):
            with self.protocol.transaction() as db:
                row = db.execute("SELECT * FROM ws_jobs WHERE id=?", (result["jobId"],)).fetchone()
                start = row and row["state"] == "running" and row["executor"] == self.executor and row["id"] not in [key for key, _ in self.threads]
                if start:
                    thread = threading.Thread(target=self.export, args=(row["id"], request_id, export_delay), daemon=True)
                    self.threads.append((row["id"], thread)); thread.start()
        return result

    def export(self, job_id, request_id, delay):
        time.sleep(delay)
        with self.protocol.transaction() as db:
            row = db.execute("SELECT * FROM ws_jobs WHERE id=?", (job_id,)).fetchone()
            if row["state"] != "running" or row["executor"] != self.executor:
                return
            filename = job_id + ".json"
            temporary = self.data / (filename + ".tmp")
            temporary.write_text(row["snapshot_json"])
            temporary.replace(self.data / filename)
            db.execute("UPDATE ws_jobs SET state='succeeded',result_json=? WHERE id=?", (canonical({"file": "data/workstation/" + filename}), job_id))
            self.bump(db)
            self.protocol.event(db, "job.completed", {"state": "succeeded"}, self.state(db), job_id=job_id,
                                action_id=row["action_id"], causation_request_id=request_id, actor="service")

    def job_row(self, row):
        result = json.loads(row["result_json"]) if row["result_json"] else None
        return {"jobId": row["id"], "actionId": row["action_id"], "state": row["state"], "deadlineAt": row["deadline"],
                "observedAt": now(), "artifacts": [result["file"]] if result else [], "result": result,
                **({"error": json.loads(row["error_json"])} if row["error_json"] else {})}

    def job(self, job_id):
        with self.protocol.transaction() as db:
            row = db.execute("SELECT * FROM ws_jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise ProtocolError("JOB_NOT_FOUND", 404)
            return self.job_row(row)

    def visit(self, pathname):
        with self.protocol.transaction() as db:
            return self.protocol.event(db, "page.visited", {"pathname": pathname}, self.state(db), actor="user")

    def feedback(self, reason, goal):
        if reason not in self.capabilities()["events"]["requestReasons"] or not isinstance(goal, str) or not goal.strip():
            raise ProtocolError("REQUEST_REASON_INVALID", 400)
        with self.protocol.transaction() as db:
            return self.protocol.event(db, "agent.requested", {"reason": reason, "goal": goal, "evidenceRefs": []}, self.state(db), actor="user")

    def receipt(self, event_id):
        with self.protocol.transaction() as db:
            row = db.execute("SELECT disposition,receipt_json,error FROM pi_outbox WHERE event_id=?", (event_id,)).fetchone()
            if not row:
                raise ProtocolError("EVENT_NOT_FOUND", 404)
            return {"eventId": event_id, "delivery": row["disposition"], "receipt": json.loads(row["receipt_json"]) if row["receipt_json"] else None, "error": row["error"]}

    def close(self):
        self.protocol.close()
        for _, thread in self.threads:
            thread.join(timeout=5)
