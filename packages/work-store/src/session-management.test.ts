import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { WORK_SCHEMA_V8_SQL } from './schema-v8.js';
import { SessionManagementError, SessionManagementStore } from './session-management.js';
import { WorkStore } from './store.js';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(WORK_SCHEMA_V8_SQL);
  db.prepare("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at) VALUES('work','session','/var/data/sessions/s.jsonl','2026-01-01','2026-01-01')").run();
  const store = new SessionManagementStore(db);
  return { db, store };
}
const errorCode = (code: string) => (error: unknown) => error instanceof SessionManagementError && error.code === code;

test('rename uses a durable original-key receipt and rejects stale or reused writes', () => {
  const { db, store } = fixture();
  try {
    assert.equal(store.read('work', 'session').revision, 0);
    assert.throws(() => store.rename('work', 'session', 0, '   ', 'empty'), errorCode('SESSION_INVALID'));
    assert.throws(() => store.rename('work', 'session', 0, '界'.repeat(121), 'too-long'), errorCode('SESSION_INVALID'));
    assert.throws(() => store.rename('work', 'session', 0, 'Valid', 'invalid-date', 'manual', '2026-02-30T00:00:00Z'), errorCode('SESSION_INVALID'));
    const first = store.rename('work', 'session', 0, '  Reading plan  ', 'rename-key');
    assert.equal(first.title, 'Reading plan');
    assert.equal(first.manualLock, true);
    assert.equal(first.revision, 1);
    assert.deepEqual(store.rename('work', 'session', 0, 'Reading plan', 'rename-key'), first);
    assert.deepEqual(store.lookup('work', 'rename-key')?.state, first);
    assert.throws(() => store.rename('work', 'session', 0, 'Other', 'rename-key'), errorCode('SESSION_OPERATION_CONFLICT'));
    assert.throws(() => store.rename('work', 'session', 0, 'Other', 'different-key'), errorCode('SESSION_REVISION_CONFLICT'));
    assert.throws(() => store.read('other-work', 'session'), errorCode('SESSION_NOT_FOUND'));
    assert.equal(store.read('work', 'session').title, 'Reading plan');
  } finally { db.close(); }
});

test('manual rename wins over a late automatic result; explicit Auto name remains possible', () => {
  const { db, store } = fixture();
  try {
    db.exec("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at) VALUES('work','session','run','key','digest','succeeded','2026-01-01','2026-01-01')");
    assert.equal(store.claimAutomatic('work', 'session', 'run'), 0);
    store.rename('work', 'session', 0, 'Manual name', 'rename-key');
    assert.equal(store.completeAutomatic('work', 'session', 'run', 0, 'Late generated name'), false);
    assert.equal(store.read('work', 'session').title, 'Manual name');
    const explicit = store.rename('work', 'session', 1, 'New generated name', 'auto-key', 'auto');
    assert.equal(explicit.title, 'New generated name');
    assert.equal(explicit.manualLock, true);
    assert.equal(store.claimAutomatic('work', 'session', 'run'), undefined);
  } finally { db.close(); }
});

test('logical deletion is fenced by Run and request state and retains the original records', () => {
  for (const active of ['accepted', 'running', 'cancelling']) {
    const { db, store } = fixture();
    try {
      db.prepare('INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at) VALUES(?,?,?,?,?,?,?)')
        .run('work', 'session', 'run', 'key', 'digest', active, '2026-01-01');
      assert.throws(() => store.delete('work', 'session', 0, 'delete-key'), errorCode('SESSION_BUSY'));
      assert.equal(store.read('work', 'session').deletedAt, null);
      db.prepare("UPDATE runs SET state='succeeded',finished_at='2026-01-02' WHERE run_id='run'").run();
      const deleted = store.delete('work', 'session', 0, 'delete-key', '2026-01-03T00:00:00Z');
      assert.equal(deleted.deletedAt, '2026-01-03T00:00:00Z');
      assert.deepEqual(store.delete('work', 'session', 0, 'delete-key'), deleted);
      assert.equal(db.prepare("SELECT count(*) AS n FROM runs WHERE run_id='run'").get()?.n, 1);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE session_id='session'").get()?.n, 1);
      assert.throws(() => store.rename('work', 'session', 1, 'Late', 'late-key'), errorCode('SESSION_DELETED'));
      assert.throws(() => db.prepare("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at) VALUES('work','session','late','new-key','digest','accepted','2026-01-04')").run(), /SESSION_DELETED/);
    } finally { db.close(); }
  }
});

test('invalid or interrupted automatic naming leaves the previous title and does not automatically replay', () => {
  const { db, store } = fixture();
  try {
    db.exec("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at) VALUES('work','session','run','key','digest','succeeded','2026-01-01','2026-01-01')");
    assert.equal(store.claimAutomatic('work', 'session', 'run'), 0);
    assert.equal(store.completeAutomatic('work', 'session', 'run', 0, '  '), false);
    assert.equal(store.read('work', 'session').title, null);
    assert.equal(store.read('work', 'session').autoState, 'failed');
    assert.equal(store.claimAutomatic('work', 'session', 'run'), undefined);
    db.exec("UPDATE session_management SET auto_state='pending' WHERE work_id='work'");
    assert.equal(store.markInterruptedAutomaticUnknown('work'), 1);
    assert.equal(store.read('work', 'session').autoState, 'unknown');
    assert.equal(store.claimAutomatic('work', 'session', 'run'), undefined);
  } finally { db.close(); }
});

test('a live waiting request prevents deletion without canceling the request', () => {
  const { db, store } = fixture();
  try {
    db.exec(`INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at)
      VALUES('work','session','run','key','digest','succeeded','2026-01-01','2026-01-01');
      INSERT INTO agent_requests(work_id,request_id,submission_key,request_digest,source_kind,source_run_id,goal,state,disposition,phase,expires_at,created_at,updated_at)
      VALUES('work','request','request-key','digest','chat','run','goal','waiting_result','live','handling','2026-01-02','2026-01-01','2026-01-01')`);
    assert.throws(() => store.delete('work', 'session', 0, 'delete-key'), errorCode('SESSION_BUSY'));
    assert.equal(db.prepare("SELECT state FROM agent_requests WHERE request_id='request'").get()?.state, 'waiting_result');
    db.exec("UPDATE agent_requests SET state='completed' WHERE request_id='request'");
    assert.ok(store.delete('work', 'session', 0, 'delete-key').deletedAt);
    assert.equal(db.prepare("SELECT state FROM agent_requests WHERE request_id='request'").get()?.state, 'completed');
  } finally { db.close(); }
});

test('logical deletion prevents an in-flight automatic title from restoring the Session', () => {
  const { db, store } = fixture();
  try {
    db.exec("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at) VALUES('work','session','run','key','digest','succeeded','2026-01-01','2026-01-01')");
    assert.equal(store.claimAutomatic('work', 'session', 'run'), 0);
    store.delete('work', 'session', 0, 'delete-key');
    assert.equal(store.completeAutomatic('work', 'session', 'run', 0, 'Late title'), false);
    assert.ok(store.read('work', 'session').deletedAt);
    assert.equal(store.read('work', 'session').title, null);
  } finally { db.close(); }
});

test('explicit Auto name records its original key before model work and protects later Rename', () => {
  const { db, store } = fixture();
  try {
    db.exec("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at) VALUES('work','session','run','key','digest','succeeded','2026-01-01','2026-01-01')");
    store.rename('work', 'session', 0, 'Manual name', 'rename-key');
    const started = store.beginExplicitAuto('work', 'session', 'run', 1, 'auto-key');
    assert.equal(started.started, true);
    assert.equal(store.lookup('work', 'auto-key')?.status, 'pending');
    assert.equal(store.beginExplicitAuto('work', 'session', 'run', 1, 'auto-key').started, false);
    assert.throws(() => store.beginExplicitAuto('work', 'session', 'run', 0, 'auto-key'), errorCode('SESSION_OPERATION_CONFLICT'));
    store.rename('work', 'session', 1, 'New manual name', 'new-rename-key');
    const result = store.finishExplicitAuto('work', 'session', 'run', 1, 'auto-key', 'Late title');
    assert.equal(result?.status, 'failed');
    assert.equal(store.lookup('work', 'auto-key')?.state.title, 'New manual name');
    const next = store.beginExplicitAuto('work', 'session', 'run', 2, 'second-auto-key');
    assert.equal(next.started, true);
    assert.equal(store.finishExplicitAuto('work', 'session', 'run', 2, 'second-auto-key', 'Generated title')?.status, 'accepted');
    assert.equal(store.read('work', 'session').title, 'Generated title');
  } finally { db.close(); }
});

test('interrupted or deleted explicit Auto name never replays the model request', () => {
  for (const action of ['interrupt', 'delete'] as const) {
    const { db, store } = fixture();
    try {
      db.exec("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at) VALUES('work','session','run','key','digest','succeeded','2026-01-01','2026-01-01')");
      assert.equal(store.beginExplicitAuto('work', 'session', 'run', 0, 'auto-key').started, true);
      if (action === 'interrupt') store.markInterruptedAutomaticUnknown('work');
      else store.delete('work', 'session', 0, 'delete-key');
      assert.equal(store.lookup('work', 'auto-key')?.status, action === 'interrupt' ? 'unknown' : 'failed');
      assert.equal(store.beginExplicitAuto('work', 'session', 'run', 0, 'auto-key').started, false);
      assert.notEqual(store.finishExplicitAuto('work', 'session', 'run', 0, 'auto-key', 'Late title')?.status, 'accepted');
      assert.equal(store.read('work', 'session').title, null);
    } finally { db.close(); }
  }
});

test('schema 8 WorkStore lists confirmed names, fences new Runs after deletion and preserves replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'piwork-session-management-'));
  const path = join(root, 'work.sqlite');
  let store = WorkStore.open(path, { workId: 'work', targetVersion: 8 });
  try {
    store.createSessionIdempotent({ workId: 'work', sessionId: 'session', sdkHistoryPath: '/var/data/sessions/s.jsonl', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, 'session-key');
    store.sessionManagement.rename('work', 'session', 0, 'Reading plan', 'rename-key');
    assert.equal(store.listSessions('work')[0]?.title, 'Reading plan');
    assert.equal(store.setSessionModelPreference('work', 'session', null).title, 'Reading plan');
    const request = { workId: 'work', sessionId: 'session', submissionKey: 'run-key', requestDigest: 'digest', promptDigest: 'prompt', memoryEnabled: false };
    const accepted = store.acceptRun(request);
    assert.throws(() => store.sessionManagement.delete('work', 'session', 1, 'delete-key'), errorCode('SESSION_BUSY'));
    store.completeRun(accepted.run.runId, 'succeeded', 'Done', null);
    store.sessionManagement.delete('work', 'session', 1, 'delete-key');
    assert.deepEqual(store.listSessions('work'), []);
    assert.ok(store.getSession('work', 'session')?.deletedAt);
    assert.equal(store.acceptRun(request).run.runId, accepted.run.runId);
    assert.throws(() => store.acceptRun({ ...request, submissionKey: 'new-run' }), errorCode('SESSION_DELETED'));
    assert.throws(() => store.setSessionModelPreference('work', 'session', null));
    store.close();
    store = WorkStore.open(path, { workId: 'work', targetVersion: 8 });
    assert.equal(store.getSession('work', 'session')?.title, 'Reading plan');
    assert.ok(store.sessionManagement.lookup('work', 'delete-key')?.state.deletedAt);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('two concurrent writers cannot silently overwrite the same Session revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'piwork-session-concurrent-'));
  const path = join(root, 'work.sqlite');
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(WORK_SCHEMA_V8_SQL);
  db.exec("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at) VALUES('work','session','/var/data/sessions/s.jsonl','2026-01-01','2026-01-01')");
  db.close();
  const barrier = new SharedArrayBuffer(4);
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    (async () => {
      const { SessionManagementStore } = await import(workerData.module);
      const db = new DatabaseSync(workerData.path, { enableForeignKeyConstraints: true });
      db.exec('PRAGMA busy_timeout = 5000');
      parentPort.postMessage({ ready: true });
      Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
      try { const value = new SessionManagementStore(db).rename('work','session',0,workerData.title,workerData.key); parentPort.postMessage({ title: value.title }); }
      catch (error) { parentPort.postMessage({ code: error.code || error.message }); }
      finally { db.close(); }
    })().catch(error => { throw error; });`;
  const workers = ['first', 'second'].map(title => new Worker(source, { eval: true, workerData: { path, title, key: title, barrier, module: pathToFileURL(join(import.meta.dirname, 'session-management.js')).href } }));
  try {
    const ready = workers.map(worker => new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve());
      worker.once('error', reject);
    }));
    const results = workers.map(worker => new Promise<{ title?: string; code?: string }>((resolve, reject) => {
      worker.on('message', value => { if (!value.ready) resolve(value); });
      worker.once('error', reject);
    }));
    await Promise.all(ready);
    Atomics.store(new Int32Array(barrier), 0, 1);
    Atomics.notify(new Int32Array(barrier), 0, 2);
    const values = await Promise.all(results);
    assert.equal(values.filter(value => value.title).length, 1);
    assert.equal(values.filter(value => value.code === 'SESSION_REVISION_CONFLICT').length, 1);
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('schema 7 to 8 requires an authorized stopped-Work migration and preserves existing history', () => {
  const root = mkdtempSync(join(tmpdir(), 'piwork-session-upgrade-'));
  const path = join(root, 'work.sqlite');
  let store = WorkStore.open(path, { workId: 'work', targetVersion: 7 });
  try {
    store.createSession({ workId: 'work', sessionId: 'session', sdkHistoryPath: '/var/data/sessions/s.jsonl', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const accepted = store.acceptRun({ workId: 'work', sessionId: 'session', submissionKey: 'run-key', requestDigest: 'digest', promptDigest: 'prompt', memoryEnabled: false });
    store.close();
    assert.throws(() => WorkStore.open(path, { workId: 'work', targetVersion: 8 }), /WORK_HISTORY_MIGRATION_REQUIRED/);
    const grant = { operationId: 'operation', workId: 'work', fromSchema: 7 as const, toSchema: 8 as const, storeId: 'backup', backupManifestDigest: 'a'.repeat(64) };
    assert.throws(() => WorkStore.open(path, { workId: 'work', targetVersion: 8, historyMigration: grant }), /WORK_HISTORY_BUSY/);
    store = WorkStore.open(path, { workId: 'work', targetVersion: 7 });
    store.completeRun(accepted.run.runId, 'succeeded', 'Done', null);
    store.close();
    store = WorkStore.open(path, { workId: 'work', targetVersion: 8, historyMigration: grant });
    assert.equal(store.schemaVersion, 8);
    assert.equal(store.getRun(accepted.run.runId)?.state, 'succeeded');
    assert.equal(store.getSession('work', 'session')?.title, null);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
