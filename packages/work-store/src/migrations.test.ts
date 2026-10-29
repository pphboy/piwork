import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateWorkDatabase, upgradeWorkDatabaseToV6, WORK_SCHEMA_VERSION } from "./migrations.js";
import { WorkStore } from "./store.js";
import { WORK_SCHEMA_V6_SQL } from "./schema-v6.js";
import { WORK_SCHEMA_V6_OBJECTS } from "./schema-v6-objects.js";
import { sameSchema } from "./migrations.js";

test('schema 6 defines ordered output chunks with scoped foreign keys and preserves schema 5 tables',()=>{
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
 try {
  db.exec(WORK_SCHEMA_V6_SQL);
  assert.ok(sameSchema(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),WORK_SCHEMA_V6_OBJECTS));
  assert.throws(()=>db.prepare("INSERT INTO run_output_chunks VALUES('missing',1,0,'text','{}')").run(),/FOREIGN KEY/);
  db.prepare("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at) VALUES('w','s','/var/data/sessions/s.jsonl','2026-01-01','2026-01-01')").run();
  db.prepare("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at) VALUES('w','s','r','k','d','accepted','2026-01-01')").run();
  db.prepare("INSERT INTO run_output_chunks VALUES('r',1,0,'text','{}')").run();
  assert.throws(()=>db.prepare("INSERT INTO run_output_chunks VALUES('r',2,0,'other','{}')").run(),/CHECK/);
  assert.throws(()=>db.prepare("INSERT INTO run_output_chunks VALUES('r',1,0,'text','{}')").run(),/UNIQUE/);
 } finally {db.close();}
});

test('schema 5 upgrades transactionally only after all Runs stop',()=>{
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
 try {
  migrateWorkDatabase(db,5);
  db.prepare("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at) VALUES('w','s','/var/data/sessions/s.jsonl','2026-01-01','2026-01-01')").run();
  db.prepare("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at) VALUES('w','s','r','k','d','running','2026-01-01')").run();
  assert.throws(()=>upgradeWorkDatabaseToV6(db),/WORK_HISTORY_BUSY/);
  assert.equal(db.prepare('SELECT version FROM schema_migrations').get()?.version,5);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='run_output_chunks'").get(),undefined);
  db.prepare("UPDATE runs SET state='cancelled',finished_at='2026-01-01' WHERE run_id='r'").run();
  upgradeWorkDatabaseToV6(db,'2026-01-02T00:00:00Z');
  assert.equal(db.prepare('SELECT version FROM schema_migrations').get()?.version,6);
  assert.equal(db.prepare("SELECT state FROM runs WHERE run_id='r'").get()?.state,'cancelled');
  upgradeWorkDatabaseToV6(db);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get()?.n,1);
 } finally {db.close();}
});

test('schema 6 upgrade refuses untrusted schema without changing its version or data',()=>{
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
 try {
  migrateWorkDatabase(db,5);db.exec('CREATE TABLE unexpected(value TEXT)');
  db.prepare("INSERT INTO unexpected VALUES('keep')").run();
  assert.throws(()=>upgradeWorkDatabaseToV6(db),/WORK_HISTORY_FORMAT_UNSUPPORTED/);
  assert.equal(db.prepare('SELECT version FROM schema_migrations').get()?.version,5);
  assert.equal(db.prepare('SELECT value FROM unexpected').get()?.value,'keep');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='run_output_chunks'").get(),undefined);
 } finally {db.close();}
});

test("fresh history initializes schema 6 and same-version reopen preserves records", () => {
 const db = new DatabaseSync(":memory:");
 try {
  migrateWorkDatabase(db);
  assert.equal(WORK_SCHEMA_VERSION,6);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n,13);
  assert.deepEqual(db.prepare("SELECT version FROM schema_migrations").all().map(r=>r.version),[6]);
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
