import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateWorkDatabase, WORK_SCHEMA_VERSION } from "./migrations.js";
import { WorkStore } from "./store.js";

test("fresh history initializes all thirteen current tables and same-version reopen preserves records", () => {
 const db = new DatabaseSync(":memory:");
 try {
  migrateWorkDatabase(db);
  assert.equal(WORK_SCHEMA_VERSION,4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n,13);
  assert.deepEqual(db.prepare("SELECT version FROM schema_migrations").all().map(r=>r.version),[4]);
  db.prepare("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at,model_preference_json,source_json) VALUES(?,?,?,?,?,?,?)")
   .run("work-1","session-1","/var/data/sessions/one.jsonl","2026-10-03T00:00:00Z","2026-10-03T00:00:00Z",'{"modelRef":null}','{"kind":"chat"}');
  migrateWorkDatabase(db);
  assert.equal(db.prepare("SELECT model_preference_json FROM sessions").get()?.model_preference_json,'{"modelRef":null}');
 } finally {db.close();}
});

test("unsupported or corrupt history is rejected before any persistent file mutation", () => {
 for (const mutation of [
  "CREATE TABLE unmanaged(value TEXT)",
  "UPDATE schema_migrations SET version=3",
  "DELETE FROM schema_migrations",
  "CREATE TRIGGER unexpected AFTER INSERT ON sessions BEGIN DELETE FROM runs; END",
  "ALTER TABLE runs ADD COLUMN unexpected TEXT",
  "PRAGMA foreign_keys=OFF; INSERT INTO session_idempotency VALUES('work-1','key','missing','2026-10-03T00:00:00Z')",
 ]) {
  const root=mkdtempSync(join(tmpdir(),"piwork-current-history-")),path=join(root,"work.sqlite");
  try {const db=new DatabaseSync(path);try{migrateWorkDatabase(db);db.exec(mutation);}finally{db.close();}
   const before=readFileSync(path);
   assert.throws(()=>WorkStore.open(path),/WORK_HISTORY_(FORMAT_UNSUPPORTED|INVALID)/);
   assert.deepEqual(readFileSync(path),before);
  } finally {rmSync(root,{recursive:true,force:true});}
 }
});
