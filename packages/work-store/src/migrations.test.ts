import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateWorkDatabase, upgradeWorkDatabaseToV6, WORK_SCHEMA_VERSION } from "./migrations.js";
import { PREVIOUS_SCHEMA_SQL } from "./previous-schema.js";
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

test("fresh history initializes schema 7 and same-version reopen preserves records", () => {
 const db = new DatabaseSync(":memory:");
 try {
  migrateWorkDatabase(db);
  assert.equal(WORK_SCHEMA_VERSION,7);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n,13);
  assert.deepEqual(db.prepare("SELECT version FROM schema_migrations").all().map(r=>r.version),[7]);
  db.prepare("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at,model_preference_json,source_json) VALUES(?,?,?,?,?,?,?)")
   .run("work-1","session-1","/var/data/sessions/one.jsonl","2026-10-03T00:00:00Z","2026-10-03T00:00:00Z",'{"modelRef":null}','{"kind":"chat"}');
  migrateWorkDatabase(db);
  assert.equal(db.prepare("SELECT model_preference_json FROM sessions").get()?.model_preference_json,'{"modelRef":null}');
 } finally {db.close();}
});

for(const version of [5,6] as const)test(`schema ${version} upgrades once to 7 and preserves Run contexts and Memory`, () => {
 const root=mkdtempSync(join(tmpdir(),"piwork-v6-upgrade-")),path=join(root,"work.sqlite"),workId="work-upgrade-12345678";
 try {
  let store=WorkStore.open(path,{workId});
  store.createSession({workId,sessionId:'session-1',sdkHistoryPath:'/var/data/sessions/one.jsonl',createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z'});
  const original=store.acceptRun({workId,sessionId:'session-1',submissionKey:'old-run',requestDigest:'old-run',promptDigest:'old-run',contextIdentity:'old-context',memoryEnabled:false}).run;store.appendEvent(original.runId,'text',JSON.stringify({delta:'保留的部分回复'}));store.compactRunEvents(original.runId,1);store.completeRun(original.runId,'succeeded','original answer',null);
  store.close();const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE; CREATE TEMP TABLE saved_sessions AS SELECT * FROM sessions; DROP TABLE sessions;');
  const definition=PREVIOUS_SCHEMA_SQL.match(/CREATE TABLE sessions[\s\S]*?STRICT;/)![0];db.exec(definition);db.exec("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at,model_preference_json,source_json) SELECT * FROM saved_sessions; UPDATE sessions SET active_context_identity='old-context'; COMMIT");if (version === 5) db.exec("DROP TABLE run_output_chunks");db.prepare("UPDATE schema_migrations SET version=?").run(version);db.close();
  const before=readFileSync(path),memoryBefore=readFileSync(join(root,'memory.sqlite'));
  assert.throws(()=>WorkStore.open(path,{workId}),/MIGRATION_REQUIRED/);
  assert.deepEqual(readFileSync(path),before);assert.deepEqual(readFileSync(join(root,'memory.sqlite')),memoryBefore);
  const historyMigration={operationId:'operation-12345678',workId,fromSchema:version,toSchema:7 as const,storeId:'backup-12345678',backupManifestDigest:'a'.repeat(64)};
  store=WorkStore.open(path,{workId,historyMigration});assert.equal(store.schemaVersion,7);assert.equal(store.getSession(workId,'session-1')?.sessionId,'session-1');store.close();
  store=WorkStore.open(path,{workId});assert.equal(store.schemaVersion,7);assert.equal(store.getRun(original.runId)?.contextIdentity,'old-context');
  assert.deepEqual(store.historyOutputChunks(workId,'session-1',original.runId,1).map(chunk=>chunk.data),version===6?['保留的部分回复']:[]);
  const next=store.acceptRun({workId,sessionId:'session-1',submissionKey:'new-run',requestDigest:'new-run',promptDigest:'new-run',contextIdentity:'new-context',memoryEnabled:false}).run;assert.equal(next.contextIdentity,'new-context');store.completeRun(next.runId,'succeeded','new answer',null);store.close();
  const current=new DatabaseSync(path,{readOnly:true});assert.equal(current.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='active_context_identity'),false);current.close();
  assert.deepEqual(readFileSync(join(root,'memory.sqlite')),memoryBefore);
 } finally {rmSync(root,{recursive:true,force:true});}
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
