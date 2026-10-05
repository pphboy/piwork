import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { WorkStore } from "./store.js";
import { WorkHistorySnapshot, WorkHistoryValidationError } from "./snapshot.js";
import { migrateWorkDatabase } from "./migrations.js";
import { FeedbackError } from "./feedback.js";

const NOW = "2026-09-23T00:00:00.000Z", SOURCE = "work-source-1234567890", CONTEXT = "context-source";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-history-")); const volume = join(root, "private"); mkdirSync(join(volume, "sessions"), { recursive: true });
  const sdk = Buffer.from('{"type":"session","version":3,"id":"session-local","cwd":"/var/data/workspace"}\n{"type":"message","text":"work-source context-source exact original bytes"}\n');
  writeFileSync(join(volume, "sessions", "one.jsonl"), sdk);
  const business = new DatabaseSync(join(volume, "business.sqlite")); business.exec("CREATE TABLE user_data(value TEXT); INSERT INTO user_data VALUES ('work-source')"); business.close();
  const store = WorkStore.open(join(volume, "work.sqlite"));
  store.createSessionIdempotent({ workId: SOURCE, sessionId: "session-local", sdkHistoryPath: "/var/data/sessions/one.jsonl", createdAt: NOW, updatedAt: NOW, contextIdentity: CONTEXT }, "session-key");
  const accepted = store.acceptRun({ workId: SOURCE, sessionId: "session-local", submissionKey: "submit-key", requestDigest: "request-digest", promptDigest: "prompt-digest", contextIdentity: CONTEXT, now: NOW });
  store.appendEvent(accepted.run.runId, "text", '{ "text": "work-source", "workId": "user text work-source" }', NOW);
  store.completeRun(accepted.run.runId, "succeeded", "work-source context-source", null, NOW);
  return { root, volume, store, sdk, runId: accepted.run.runId, scope: { sourceWorkId: SOURCE, contextIds: new Set([CONTEXT]), scratchDirectory: root }, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
function fingerprint(volume: string): Map<string, string> {
  return new Map(readdirSync(volume).filter((name) => name.startsWith("work.sqlite") || name === "business.sqlite").map((name) => [name, createHash("sha256").update(readFileSync(join(volume, name))).digest("hex")]));
}
function edit(volume: string, sql: string): void {
  const database = new DatabaseSync(join(volume, "work.sqlite")); try { database.exec(sql); } finally { database.close(); }
}

test("schema4 snapshot reads committed WAL without migration or source mutation", () => {
  const f = fixture();
  try {
    assert.ok(existsSync(join(f.volume, "work.sqlite-wal")));
    const before = fingerprint(f.volume), snapshot = WorkHistorySnapshot.open(f.volume, f.scope);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.summary, { sessions: 1, runs: 1, events: 2 }); snapshot.close(); snapshot.close();
    assert.deepEqual(fingerprint(f.volume), before);
    assert.ok(!readdirSync(f.root).some((name) => name.startsWith("work-history-")));
  } finally { f.close(); }
});

test("rebuild maps only Work/context identities and retains local IDs, idempotency, text, SDK and business DB", () => {
  const f = fixture();
  try {
    const original = fingerprint(f.volume), snapshot = WorkHistorySnapshot.open(f.volume, f.scope); assert.ok(snapshot);
    try {
      for (const targetWork of ["work-target-a", "work-target-b"]) {
        const target = join(f.root, targetWork); cpSync(f.volume, target, { recursive: true });
        snapshot.rebuild(target, targetWork, new Map([[CONTEXT, `context-${targetWork}`]]));
        assert.ok(!existsSync(join(target, "work.sqlite-wal"))); assert.ok(!existsSync(join(target, "work.sqlite-shm")));
        assert.deepEqual(readFileSync(join(target, "sessions", "one.jsonl")), f.sdk);
        assert.deepEqual(readFileSync(join(target, "business.sqlite")), readFileSync(join(f.volume, "business.sqlite")));
        const reopened = WorkStore.open(join(target, "work.sqlite"));
        try {
          assert.equal(reopened.getSession(SOURCE, "session-local"), undefined);
          assert.equal(reopened.getSession(targetWork, "session-local")?.contextIdentity, `context-${targetWork}`);
          const run = reopened.getRun(f.runId); assert.ok(run); assert.equal(run.workId, targetWork); assert.equal(run.contextIdentity, `context-${targetWork}`);
          assert.equal(run.finalText, "work-source context-source");
          assert.equal(reopened.readEvents(f.runId)[0]?.payloadJson, '{ "text": "work-source", "workId": "user text work-source" }');
          assert.equal(reopened.acceptRun({ workId: targetWork, sessionId: "session-local", submissionKey: "submit-key", requestDigest: "request-digest", promptDigest: "prompt-digest" }).reused, true);
          assert.equal(reopened.createSessionIdempotent({ workId: targetWork, sessionId: "ignored", sdkHistoryPath: "ignored", createdAt: NOW, updatedAt: NOW }, "session-key").session.sessionId, "session-local");
        } finally { reopened.close(); }
        const again = WorkHistorySnapshot.open(target, { sourceWorkId: targetWork, contextIds: new Set([`context-${targetWork}`]), scratchDirectory: f.root }); assert.ok(again); again.close();
      }
    } finally { snapshot.close(); }
    assert.deepEqual(fingerprint(f.volume), original);
  } finally { f.close(); }
});

test("offline check refuses trigger, view, virtual table, unknown tables/columns/schema, without repair", () => {
  const cases = [
    "CREATE TRIGGER malicious AFTER INSERT ON sessions BEGIN DELETE FROM runs; END",
    "CREATE VIEW malicious AS SELECT * FROM runs",
    "CREATE VIRTUAL TABLE malicious USING fts5(content)",
    "CREATE TABLE malicious(value TEXT)",
    "ALTER TABLE runs ADD COLUMN unexpected TEXT",
    "UPDATE schema_migrations SET version = 99 WHERE version = 4",
    "DELETE FROM schema_migrations WHERE version = 4",
    "CREATE INDEX unrecognized ON runs(state)",
  ];
  for (const sql of cases) {
    const f = fixture();
    try {
      edit(f.volume, sql); const before = fingerprint(f.volume);
      assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError);
      assert.deepEqual(fingerprint(f.volume), before);
    } finally { f.close(); }
  }
});

test("offline check refuses foreign references, cross-Work rows, unknown contexts and invalid event sequences", () => {
  for (const sql of [
    "PRAGMA foreign_keys = OFF; UPDATE runs SET session_id = 'missing'",
    "UPDATE submit_idempotency SET work_id = 'another-work'",
    "UPDATE sessions SET active_context_identity = 'missing-context'",
    "UPDATE runs SET context_identity = 'missing-context'",
    "UPDATE runs SET latest_sequence = 10",
    "UPDATE run_events SET sequence = 5 WHERE sequence = 1",
    "UPDATE submit_idempotency SET submission_key = 'mismatched'",
  ]) {
    const f = fixture();
    try { edit(f.volume, sql); assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError); }
    finally { f.close(); }
  }
});

test("nonterminal Runs and stale work_activity fail quiescence", () => {
  for (const sql of ["UPDATE runs SET state = 'running'", "INSERT INTO work_activity SELECT work_id, run_id, accepted_at FROM runs"]) {
    const f = fixture();
    try {
      edit(f.volume, sql);
      assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), (error: unknown) => error instanceof WorkHistoryValidationError && error.code === "SNAPSHOT_HISTORY_BUSY");
    } finally { f.close(); }
  }
});

test("SDK paths cannot escape private sessions or traverse symlinks, and missing files fail", () => {
  for (const path of ["/etc/passwd", "/var/data/workspace/history.jsonl", "/var/data/sessions/../business.sqlite", "/var/data/sessions/link", "/var/data/sessions/linked-dir/one.jsonl", "/var/data/sessions/missing.jsonl"]) {
    const f = fixture();
    try {
      symlinkSync("/etc/passwd", join(f.volume, "sessions", "link")); symlinkSync(join(f.volume, "sessions"), join(f.volume, "sessions", "linked-dir"));
      edit(f.volume, `UPDATE sessions SET sdk_history_path = '${path}'`);
      assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError);
    } finally { f.close(); }
  }
});

test("new Work without DB is supported, but orphan WAL or linked database is not", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-empty-history-"));
  const volume = join(root, "private"); mkdirSync(volume);
  const scope = { sourceWorkId: SOURCE, contextIds: new Set<string>(), scratchDirectory: root };
  try {
    assert.equal(WorkHistorySnapshot.open(volume, scope), undefined);
    writeFileSync(join(volume, "work.sqlite-wal"), "orphan");
    assert.throws(() => WorkHistorySnapshot.open(volume, scope), WorkHistoryValidationError);
    symlinkSync("/etc/passwd", join(volume, "work.sqlite"));
    assert.throws(() => WorkHistorySnapshot.open(volume, scope), WorkHistoryValidationError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function brainFixture() {
  const f = fixture(), goal = f.store.feedback.ensureChatRequest;
  const accept = (key: string) => f.store.acceptRun({ workId: SOURCE, sessionId: "session-local", submissionKey: key, requestDigest: key, promptDigest: key, contextIdentity: CONTEXT, now: NOW }).run;
  const run = accept("learn"), request = goal.call(f.store.feedback, SOURCE, run.runId, "Review original work-source", NOW);
  const proof = f.store.feedback.addEvidence(SOURCE, { requestId: request.requestId, runId: run.runId, kind: "query", serviceName: "todo", objectRef: "review", observedAt: NOW,
    stateVersion: "v1", codeVersion: "c1", summary: "Actual review verified", verified: true }, { checks: [{ name: "review", passed: true }] });
  f.store.feedback.stageExperience(SOURCE, request.requestId, { entryId: "review", scope: "work", rule: "Keep work-source literal in the rule", evidenceIds: [proof.evidenceId] }, false, NOW);
  f.store.feedback.finish(SOURCE, request.requestId, "completed", "verified", null, [proof.evidenceId], NOW);
  f.store.completeRun(run.runId, "succeeded", "done", null, NOW);
  const waitingRun = accept("wait"), waiting = f.store.feedback.ensureChatRequest(SOURCE, waitingRun.runId, "Verify export", NOW);
  f.store.feedback.recordAction(SOURCE, waiting.requestId, { serviceName: "todo", actionId: "export-1", actionName: "export", input: {}, expectedStateVersion: "v1", verificationQuery: "export", status: "known", jobId: "job-1" });
  f.store.feedback.wait(SOURCE, waiting.requestId, { kind: "job", serviceName: "todo", id: "job-1", deadlineAt: "2026-09-24T00:00:00.000Z", nextPhase: "verifying", verificationGoal: "Check original export" }, NOW);
  f.store.completeRun(waitingRun.runId, "succeeded", "waiting", null, NOW);
  f.store.setSessionModelPreference(SOURCE, "session-local", JSON.stringify({ modelRef: "model-source-12345678", label: "Original", provider: "anthropic", model: "claude-sonnet-4-6", baseUrl: "https://model.example", availability: "available" }));
  return { ...f, learned: request.requestId, waiting: waiting.requestId };
}

test("schema4 cold history retains verified experience and waits while imports are historical and independently rebound", () => {
  const f = brainFixture();
  try {
    const original = fingerprint(f.volume), snapshot = WorkHistorySnapshot.open(f.volume, f.scope)!;
    try {
      for (const [suffix, candidates] of [["a", [{ modelRef: "model-target-12345678", label: "Target", provider: "anthropic", model: "claude-sonnet-4-6", baseUrl: "https://model.example" }]], ["b", []]] as const) {
        const workId = `work-target-${suffix}`, target = join(f.root, workId); cpSync(f.volume, target, { recursive: true });
        snapshot.rebuild(target, workId, new Map([[CONTEXT, `context-${workId}`]]), candidates);
        const imported = WorkStore.open(join(target, "work.sqlite"));
        try {
          assert.equal(imported.feedback.getRequest(workId, f.learned)?.state, "completed");
          assert.equal(imported.feedback.getRequest(workId, f.waiting)?.state, "waiting_result");
          assert.equal(imported.feedback.getRequest(workId, f.waiting)?.disposition, "historical");
          assert.deepEqual(imported.feedback.pending(workId), []); assert.deepEqual(imported.feedback.waiting(workId), []);
          assert.equal(imported.feedback.experienceSnapshot(workId).entries[0]?.rule, "Keep work-source literal in the rule");
          assert.throws(() => imported.feedback.cancel(workId, f.waiting), FeedbackError);
          const preference = JSON.parse(imported.getSession(workId, "session-local")!.modelPreferenceJson!);
          assert.equal(preference.availability, suffix === "a" ? "available" : "unavailable");
          assert.equal(preference.modelRef, suffix === "a" ? "model-target-12345678" : "model-source-12345678");
        } finally { imported.close(); }
        const checked = WorkHistorySnapshot.open(target, { ...f.scope, sourceWorkId: workId, contextIds: new Set([`context-${workId}`]) }); checked?.close();
        assert.deepEqual(readFileSync(join(target, "business.sqlite")), readFileSync(join(f.volume, "business.sqlite")));
      }
    } finally { snapshot.close(); }
    assert.deepEqual(fingerprint(f.volume), original);
  } finally { f.close(); }
});

test("schema4 import validation rejects forged completion, unconfirmed experience, dangling scope and malformed original waits", () => {
  const cases = [
    "UPDATE agent_evidence SET verified=0",
    "UPDATE agent_requests SET state='completed' WHERE state='waiting_result'",
    "UPDATE agent_requests SET state='failed' WHERE state='completed'",
    "UPDATE agent_requests SET wait_ref_json='{}' WHERE state='waiting_result'",
    "UPDATE brain_experience_revisions SET evidence_ids_json='[\"missing\"]'",
    "UPDATE agent_evidence SET request_id=NULL WHERE kind='query'",
    "UPDATE sessions SET model_preference_json='{\"apiKey\":\"forbidden\"}'",
  ];
  for (const sql of cases) {
    const f = brainFixture(); try { edit(f.volume, sql); assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError); }
    finally { f.close(); }
  }
});

test("circular Service receipts and candidate Operation waits import historically with only managed refs rebound", () => {
  const f = brainFixture();
  try {
    const event = { contractVersion: 1 as const, eventId: "feedback-origin", origin: { workId: SOURCE, serviceId: "service-origin-123456789" }, serviceName: "todo", type: "agent.requested",
      occurredAt: NOW, stateVersion: "v1", payload: { reason: "review", goal: "Preserve work-source user text", evidenceRefs: [] } };
    const receipt = f.store.feedback.receiveEvent(event, ["review"], NOW);
    const run = f.store.acceptRun({ workId: SOURCE, sessionId: "session-local", submissionKey: "package", requestDigest: "package", promptDigest: "package", contextIdentity: CONTEXT, now: NOW }).run;
    const candidate = f.store.feedback.ensureChatRequest(SOURCE, run.runId, "Verify package", NOW);
    f.store.feedback.setPackageSubmission(SOURCE, candidate.requestId, { submissionKey: "capture", requestId: candidate.requestId, verificationGoal: "Verify loaded tool", expectedSourceDigest: `sha256:${"b".repeat(64)}`, activeDigest: `sha256:${"a".repeat(64)}`, desiredDigest: `sha256:${"a".repeat(64)}`, activeContextId: CONTEXT, verificationTarget: { contractVersion: 1, toolName: "package:piwork-brain:review_probe", input: {}, checkNames: ["review_format"] } });
    f.store.feedback.registerPackageWait(SOURCE, candidate.requestId, { kind: "apply", id: "operation-source-12345678", deadlineAt: "2026-09-30T00:00:00.000Z", nextPhase: "adopting", verificationGoal: "Verify loaded tool" }, NOW);
    f.store.completeRun(run.runId, "succeeded", "waiting", null, NOW);
    const snapshot = WorkHistorySnapshot.open(f.volume, f.scope)!;
    try {
      const target = join(f.root, "imported"); cpSync(f.volume, target, { recursive: true });
      snapshot.rebuild(target, "work-target-1234567890", new Map([[CONTEXT, "context-target"]]), [], new Map([["operation-source-12345678", "operation-target-12345678"]]));
      const restored = WorkStore.open(join(target, "work.sqlite"));
      try {
        assert.equal(restored.feedback.getRequest("work-target-1234567890", candidate.requestId)?.waitRef?.id, "operation-target-12345678");
        assert.equal(restored.feedback.getRequest("work-target-1234567890", receipt.requestId!)?.disposition, "historical");
        assert.deepEqual(restored.feedback.listServiceEvents("work-target-1234567890", "todo").items[0]?.event, event, "event origin and payload are opaque original bytes");
        assert.equal((restored.feedback.internal("work-target-1234567890", candidate.requestId)?.packageSubmission as { activeContextId: string }).activeContextId, "context-target");
        assert.equal(restored.feedback.pending("work-target-1234567890").length, 0);
      } finally { restored.close(); }
      WorkHistorySnapshot.open(target, { ...f.scope, sourceWorkId: "work-target-1234567890", contextIds: new Set(["context-target"]) })?.close();
    } finally { snapshot.close(); }
  } finally { f.close(); }
});

function adoptionFixture() {
  const f = brainFixture();
  const run = f.store.acceptRun({ workId: SOURCE, sessionId: "session-local", submissionKey: "adopt", requestDigest: "adopt", promptDigest: "adopt", contextIdentity: CONTEXT, now: NOW }).run;
  const request = f.store.feedback.ensureChatRequest(SOURCE, run.runId, "Render a verified review", NOW);
  const verificationTarget = { contractVersion: 1 as const, toolName: "package:piwork-brain:review_probe", input: { literalWork: SOURCE, literalContext: CONTEXT }, checkNames: ["review_format"] };
  const artifact = `sha256:${"c".repeat(64)}`, sourceDigest = `sha256:${"b".repeat(64)}`;
  f.store.feedback.setPackageSubmission(SOURCE, request.requestId, { submissionKey: "capture-adopt", requestId: request.requestId, verificationGoal: request.goal,
    expectedSourceDigest: sourceDigest, activeDigest: artifact, desiredDigest: artifact, activeContextId: CONTEXT, verificationTarget });
  f.store.feedback.recordCandidateArtifact(SOURCE, request.requestId, "capture-adopt", artifact, sourceDigest, NOW);
  {
    f.store.appendEvent(run.runId, "tool-start", JSON.stringify({ toolCallId: "actual-sdk-call", toolName: "review_probe", args: verificationTarget.input }), NOW);
    f.store.appendEvent(run.runId, "tool-end", JSON.stringify({ toolCallId: "actual-sdk-call", toolName: "review_probe", isError: false }), NOW);
  }
  const proof = f.store.feedback.addEvidence(SOURCE, { requestId: request.requestId, runId: run.runId, kind: "sdk", objectRef: verificationTarget.toolName,
    observedAt: NOW, codeVersion: "1.0.0", summary: "review_format: passed", verified: true }, {
    verificationContractVersion: 1, adoptionVerified: true, requestId: request.requestId, runId: run.runId, verificationTarget,
    toolName: verificationTarget.toolName, input: verificationTarget.input, toolCallId: "actual-sdk-call", artifactDigest: artifact,
    contextIdentity: CONTEXT, checks: [{ name: "review_format", passed: true, summary: "Actual output checked" }] }, true);
  f.store.feedback.finish(SOURCE, request.requestId, "completed", "Actual review verified", null, [proof.evidenceId], NOW);
  f.store.completeRun(run.runId, "succeeded", "done", null, NOW);
  return { ...f, requestId: request.requestId, proofId: proof.evidenceId, verificationTarget };
}

test("fixed adoption proofs import into two contexts while business input remains opaque", () => {
  const f = adoptionFixture();
  try {
    const snapshot = WorkHistorySnapshot.open(f.volume, f.scope)!;
    try {
      for (const suffix of ["a", "b"]) {
        const id = `work-adoption-${suffix}`, context = `context-adoption-${suffix}`, target = join(f.root, id);
        cpSync(f.volume, target, { recursive: true }); snapshot.rebuild(target, id, new Map([[CONTEXT, context]]));
        const imported = WorkStore.open(join(target, "work.sqlite"));
        try {
          const details = imported.feedback.evidenceDetails(id, f.proofId) as Record<string, unknown>;
          assert.equal(details.contextIdentity, context);
          assert.deepEqual(details.input, f.verificationTarget.input);
          assert.deepEqual(details.verificationTarget, f.verificationTarget);
          assert.equal(imported.feedback.getRequest(id, f.requestId)?.disposition, "historical");
          assert.deepEqual(imported.feedback.pending(id), []);
        } finally { imported.close(); }
        WorkHistorySnapshot.open(target, { ...f.scope, sourceWorkId: id, contextIds: new Set([context]) })?.close();
      }
    } finally { snapshot.close(); }
  } finally { f.close(); }
});

test("new adoption relationship tampering is rejected without executing tools", () => {
  for (const [field, value] of [["requestId", "wrong-request"], ["runId", "wrong-run"], ["toolName", "package:piwork-brain:brain_experience"],
    ["input", { literalWork: "changed" }], ["artifactDigest", `sha256:${"d".repeat(64)}`], ["contextIdentity", "wrong-context"],
    ["checks", [{ name: "review_format", passed: false }]], ["checks", [{ name: "review_format", passed: true }, { name: "review_format", passed: true }]],
    ["verificationContractVersion", 2], ["verificationTarget", null], ["toolCallId", "different-sdk-call"]] as const) {
    const f = adoptionFixture();
    try {
      const database = new DatabaseSync(join(f.volume, "work.sqlite"));
      try {
        const row = database.prepare("SELECT details_json FROM agent_evidence WHERE evidence_id=?").get(f.proofId)!;
        const details = JSON.parse(String(row.details_json)); details[field] = value;
        database.prepare("UPDATE agent_evidence SET details_json=? WHERE evidence_id=?").run(JSON.stringify(details), f.proofId);
      } finally { database.close(); }
      assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError, field);
    } finally { f.close(); }
  }
});


test("SDK tool start must persist the exact fixed verification input", () => {
 for (const args of [undefined, {}, { literalWork: "wrong" }]) {
  const f = adoptionFixture();
  try {
   const db = new DatabaseSync(join(f.volume,"work.sqlite"));
   try { const row = db.prepare("SELECT sequence,payload_json FROM run_events WHERE event_type='tool-start'").get()!;
    const payload = JSON.parse(String(row.payload_json)); payload.args = args;
    db.prepare("UPDATE run_events SET payload_json=? WHERE sequence=?").run(JSON.stringify(payload),row.sequence as number);
   } finally { db.close(); }
   assert.throws(() => WorkHistorySnapshot.open(f.volume,f.scope),WorkHistoryValidationError);
  } finally { f.close(); }
 }
});

test('schema 4 optional Thinking and input mode survive cold validation and rebinding',()=>{
 const f=fixture();try{
  const model={modelRef:'model-source-12345678',label:'Original',provider:'fixture',model:'one',thinkingLevel:'high'};
  f.store.setSessionModelPreference(SOURCE,'session-local',JSON.stringify({...model,availability:'available'}));
  edit(f.volume,`UPDATE runs SET actual_model_json='${JSON.stringify(model)}',model_selector_json='{"kind":"session-preference","inputMode":"text"}'`);
  const snapshot=WorkHistorySnapshot.open(f.volume,f.scope)!;const target=join(f.root,'imported');cpSync(f.volume,target,{recursive:true});
  try{snapshot.rebuild(target,'work-target-1234567890',new Map([[CONTEXT,'context-target']]),[{...model,modelRef:'model-target-12345678',thinkingLevel:undefined}]);}finally{snapshot.close();}
  const imported=WorkStore.open(join(target,'work.sqlite'));try{assert.equal(JSON.parse(imported.getSession('work-target-1234567890','session-local')!.modelPreferenceJson!).thinkingLevel,'high');assert.equal(JSON.parse(imported.getRun(f.runId)!.actualModelJson!).thinkingLevel,'high');assert.equal(JSON.parse(imported.getRun(f.runId)!.modelSelectorJson!).inputMode,'text');}finally{imported.close();}
  for(const invalid of ['"impossible"','null','3']){edit(f.volume,`UPDATE runs SET actual_model_json='{"modelRef":null,"label":"Default","provider":"fixture","model":"one","thinkingLevel":${invalid}}'`);assert.throws(()=>WorkHistorySnapshot.open(f.volume,f.scope),WorkHistoryValidationError);}
 }finally{f.close();}
});
