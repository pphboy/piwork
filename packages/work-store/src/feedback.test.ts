import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { BRAIN_LIMITS, type AgentEvidence, type AgentWaitRef, type ServiceEvent } from "@piwork/contracts";
import { FeedbackError, FeedbackStore, WorkStore, WorkBusyError } from "./index.js";

const workId = "work-1111111111111111";
const serviceId = "service-1111111111111111";
const now = "2026-10-03T00:00:00.000Z";
function event(id: string, type = "agent.requested"): ServiceEvent {
  return { contractVersion: 1, eventId: id, origin: { workId, serviceId }, serviceName: "todo", type,
    occurredAt: now, stateVersion: "v1", actor: "user",
    payload: type === "agent.requested" ? { reason: "review", goal: "Verify the review includes overdue tasks", evidenceRefs: [] } : { path: "/review" } };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "piwork-feedback-")); const path = join(dir, "history.sqlite");
  const store = WorkStore.open(path);
  store.createSession({ workId, sessionId: "session-test", sdkHistoryPath: "/private/session", createdAt: now, updatedAt: now, contextIdentity: "context1" });
  return { store, path, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function accept(store: WorkStore, id: string, key = "run1", phase: "handling" | "verifying" | "adopting" = "handling") {
  return store.acceptRun({ workId, sessionId: "session-test", submissionKey: key, promptDigest: key, requestDigest: key, contextIdentity: "context1", now,
    agentRequest: { requestId: id, phase } });
}
function proof(store: WorkStore, id: string, runId: string | null, overrides: Partial<Omit<AgentEvidence, "evidenceId">> = {}) {
  return store.feedback.addEvidence(workId, { requestId: id, runId, kind: "query", objectRef: "review", observedAt: now,
    stateVersion: "v2", codeVersion: "code2", summary: "Actual review checks passed", verified: true, serviceName: "todo", ...overrides },
  { checks: [{ name: "overdue", passed: true, summary: "included" }] });
}
function error(code: string) { return (e: unknown) => e instanceof FeedbackError && e.code === code; }

test("resume transaction fences current wait deadlines and preserves competing state and original objects", () => {
  for (const kind of ["action", "job", "apply"] as const) for (const cutoff of ["wait", "request"] as const) for (const offset of [-1, 0, 1]) {
    const f = fixture(); try {
      const id = f.store.feedback.receiveEvent(event(`resume-${kind}-${cutoff}-${offset}`), ["review"], now).requestId!;
      const run = accept(f.store, id).run;
      const registeredAt = cutoff === "request" ? new Date(Date.parse(now) + BRAIN_LIMITS.requestTimeoutMs - 30000).toISOString() : now;
      f.store.feedback.wait(workId, id, { kind, ...(kind !== "apply" ? { serviceName: "todo" } : {}), id: "original-wait",
        deadlineAt: new Date(Date.parse(registeredAt) + (kind === "apply" && cutoff === "request" ? BRAIN_LIMITS.applyTimeoutMs + 60000 : 60000)).toISOString(),
        nextPhase: kind === "apply" ? "adopting" : "verifying", verificationGoal: "Verify original effect" }, registeredAt);
      f.store.completeRun(run.runId, "succeeded", "Original wait", null, registeredAt);
      const before = f.store.feedback.internal(workId, id)!;
      const returnedAt = new Date(Date.parse(before.request.waitRef!.deadlineAt) + offset).toISOString();
      assert.equal(f.store.feedback.resume(workId, id, "original-wait", returnedAt), offset < 0, `${kind}/${cutoff}/${offset}`);
      const after = f.store.feedback.internal(workId, id)!;
      if (offset >= 0) assert.deepEqual(after, before, "rejected resume leaves the original persisted goal unchanged");
      else {
        assert.equal(after.request.state, "pending"); assert.equal(after.phase, kind === "apply" ? "adopting" : "verifying");
        assert.deepEqual(after.request.waitRef, before.request.waitRef); assert.equal(after.request.expiresAt, before.request.expiresAt);
        assert.equal(after.request.autoRunCount, before.request.autoRunCount);
      }
      assert.equal(f.store.activeRun(workId), undefined); assert.equal(f.store.getRun(run.runId)?.state, "succeeded");
    } finally { f.cleanup(); }
  }
  for (const outcome of ["cancelled", "terminal", "historical", "wrong-id"] as const) {
    const f = fixture(); const db = new DatabaseSync(f.path); try {
      const id = f.store.feedback.receiveEvent(event(`resume-${outcome}`), ["review"], now).requestId!;
      const run = accept(f.store, id).run;
      f.store.feedback.wait(workId, id, { kind: "job", serviceName: "todo", id: "original-job", deadlineAt: "2026-10-03T00:01:00.000Z", nextPhase: "verifying", verificationGoal: "Original result" }, now);
      f.store.completeRun(run.runId, "succeeded", "Original wait", null, now);
      if (outcome === "cancelled") f.store.feedback.cancel(workId, id, undefined, now);
      if (outcome === "terminal") f.store.feedback.finish(workId, id, "needs_attention", null, { code: "PRIOR_TERMINAL", message: "Already settled" }, [], now);
      if (outcome === "historical") db.prepare("UPDATE agent_requests SET disposition='historical' WHERE request_id=?").run(id);
      const before = f.store.feedback.internal(workId, id);
      assert.equal(f.store.feedback.resume(workId, id, outcome === "wrong-id" ? "other-job" : "original-job", now), false);
      assert.deepEqual(f.store.feedback.internal(workId, id), before);
    } finally { db.close(); f.cleanup(); }
  }
});

test("package wait transaction cannot overwrite an expired original deadline or a competing final state", () => {
  for (const mode of ["running", "recovery", "preparation", "apply", "cancelled", "terminal", "historical"] as const) {
    const f = fixture(); const db = new DatabaseSync(f.path);
    try {
      const id = f.store.feedback.receiveEvent(event(`candidate-${mode}`), ["review"], now).requestId!;
      const run = accept(f.store, id).run;
      f.store.feedback.setPackageSubmission(workId, id, { submissionKey: "original-candidate", requestId: id, verificationGoal: "Verify original capability", verificationTarget: { contractVersion: 1, toolName: "package:piwork-brain:review_probe", input: {}, checkNames: ["review_format"] }, expectedSourceDigest: `sha256:${"a".repeat(64)}`, activeDigest: `sha256:${"b".repeat(64)}`, desiredDigest: `sha256:${"b".repeat(64)}`, activeContextId: "context1" });
      const ref: AgentWaitRef = { kind: "package-operation", id: "original-operation", nextPhase: "adopting", verificationGoal: "Verify original capability",
        deadlineAt: new Date(Date.parse(now) + 60000).toISOString() };
      if (mode === "recovery") f.store.interruptActiveRuns(now);
      else if (mode !== "running") {
        f.store.feedback.registerPackageWait(workId, id, ref, now);
        f.store.completeRun(run.runId, "succeeded", "Original wait", null, now);
      }
      if (mode === "apply") f.store.feedback.registerPackageWait(workId, id, { ...ref, kind: "apply", deadlineAt: new Date(Date.parse(now) + BRAIN_LIMITS.applyTimeoutMs).toISOString() }, now);
      if (mode === "cancelled") f.store.feedback.cancel(workId, id, undefined, now);
      if (mode === "terminal") f.store.feedback.finish(workId, id, "needs_attention", null, { code: "PRIOR_TERMINAL", message: "Prior settlement" }, [], now);
      if (mode === "historical") db.prepare("UPDATE agent_requests SET disposition='historical' WHERE request_id=?").run(id);
      const before = f.store.feedback.internal(workId, id)!;
      const cutoff = before.request.waitRef?.deadlineAt ?? before.request.expiresAt;
      for (const offset of [0, 1]) {
        const returnedAt = new Date(Date.parse(cutoff) + offset).toISOString();
        assert.throws(() => f.store.feedback.registerPackageWait(workId, id, { ...ref, kind: "apply",
          deadlineAt: new Date(Date.parse(returnedAt) + BRAIN_LIMITS.applyTimeoutMs).toISOString() }, returnedAt),
        error(mode === "historical" ? "REQUEST_RETRY_NOT_ALLOWED" : ["cancelled", "terminal"].includes(mode) ? "REQUEST_NOT_RUNNING" : "REQUEST_EXPIRED"));
        assert.deepEqual(f.store.feedback.internal(workId, id), before, "rejected transition must leave the whole persisted original unchanged");
      }
    } finally { db.close(); f.cleanup(); }
  }
});

test("facts never create goals; event receipts are durable, content-sensitive and replay before capacity checks", () => {
  const f = fixture(); try {
    assert.equal(f.store.feedback.receiveEvent(event("page", "ui.visited"), ["review"], now).requestId, null);
    const first = f.store.feedback.receiveEvent(event("same"), ["review"], now);
    for (let i = 0; i < 99; i++) f.store.feedback.receiveEvent(event(`request-${i}`), ["review"], now);
    assert.deepEqual(f.store.feedback.receiveEvent(event("same"), ["review"], now), { ...first, reused: true });
    assert.throws(() => f.store.feedback.receiveEvent(event("full"), ["review"], now), error("REQUEST_CAPACITY_EXCEEDED"));
    assert.throws(() => f.store.feedback.receiveEvent({ ...event("same"), stateVersion: "different" }, ["review"], now), error("SERVICE_EVENT_CONFLICT"));
    assert.equal(f.store.feedback.listRequests(workId).items.length, 50);
    assert.throws(() => f.store.feedback.receiveEvent({ ...event("recursive"), causationRequestId: first.requestId! }, ["review"], now), error("SERVICE_CAPABILITY_INVALID"));
    assert.throws(() => f.store.feedback.receiveEvent({ ...event("wide"), payload: { reason: "review", goal: "中".repeat(3000), evidenceRefs: [] } }, ["review"], now), error("SERVICE_CAPABILITY_INVALID"));
  } finally { f.cleanup(); }
});

test("failed durable receipt transaction leaves neither a fact nor a pending request", () => {
  const f = fixture(); const db = new DatabaseSync(f.path); try {
    db.exec("CREATE TRIGGER inject_failure BEFORE INSERT ON agent_requests BEGIN SELECT RAISE(ABORT,'storage failure'); END;");
    assert.throws(() => f.store.feedback.receiveEvent(event("failed"), ["review"], now), /storage failure/);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM service_events").get() as { n: number }).n, 0);
    db.exec("DROP TRIGGER inject_failure");
    assert.equal(f.store.feedback.receiveEvent(event("failed"), ["review"], now).reused, false);
  } finally { db.close(); f.cleanup(); }
});

test("independent simultaneous producers return the same committed receipt", async () => {
  const f = fixture(); try {
    const source = `const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.module).then(({ WorkStore }) => {
        const s = WorkStore.open(workerData.path);
        const receipt = s.feedback.receiveEvent(workerData.event, ['review'], workerData.now);
        s.close(); parentPort.postMessage(receipt);
      }).catch(e => { throw e });`;
    const receipts = await Promise.all(Array.from({ length: 4 }, () => new Promise<{ requestId: string }>((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: { module: new URL("./index.js", import.meta.url).href, path: f.path, event: event("parallel"), now } });
      worker.once("message", resolve); worker.once("error", reject); worker.once("exit", (code) => { if (code) reject(new Error(`worker exit ${code}`)); });
    })));
    assert.equal(new Set(receipts.map((r) => r.requestId)).size, 1);
    assert.equal(f.store.feedback.listRequests(workId).items.length, 1);
  } finally { f.cleanup(); }
});

test("Run slot, request phase, budget and submit receipt share one admission transaction", () => {
  const f = fixture(); try {
    const id = f.store.feedback.receiveEvent(event("goal"), ["review"], now).requestId!;
    assert.throws(() => accept(f.store, id, "wrong", "verifying"), error("REQUEST_NOT_READY"));
    assert.equal(f.store.activeRun(workId), undefined);
    assert.equal(f.store.feedback.getRequest(workId, id)?.autoRunCount, 0);
    const a = accept(f.store, id);
    assert.deepEqual(accept(f.store, id), { run: a.run, reused: true });
    assert.equal(f.store.feedback.getRequest(workId, id)?.autoRunCount, 1);
    assert.deepEqual(f.store.feedback.getRequest(workId, id)?.runIds, [a.run.runId]);
    const second = f.store.feedback.receiveEvent(event("goal2"), ["review"], now).requestId!;
    assert.throws(() => accept(f.store, second, "busy"), WorkBusyError);
    assert.equal(f.store.feedback.getRequest(workId, second)?.state, "pending");
    for (let count = 1; count <= 4; count++) {
      const run = count === 1 ? a : accept(f.store, id, `run${count}`, "verifying");
      f.store.feedback.wait(workId, id, { kind: "job", serviceName: "todo", id: "job1", deadlineAt: "2026-10-03T02:00:00.000Z", nextPhase: "verifying", verificationGoal: "Verify original output" }, now);
      f.store.completeRun(run.run.runId, "succeeded", "Waiting", null, now);
      assert.equal(f.store.feedback.resume(workId, id, "job1", now), true);
    }
    assert.throws(() => accept(f.store, id, "run5", "verifying"), error("REQUEST_BUDGET_EXCEEDED"));
    assert.equal(f.store.activeRun(workId), undefined);
  } finally { f.cleanup(); }
});

test("cancel/completion races preserve the first durable terminal and cancellation waits for SDK termination", () => {
  const f = fixture(); try {
    const id = f.store.feedback.receiveEvent(event("cancel"), ["review"], now).requestId!; const run = accept(f.store, id);
    const p = proof(f.store, id, run.run.runId);
    assert.equal(f.store.feedback.cancel(workId, id).state, "cancelling");
    assert.equal(f.store.feedback.finish(workId, id, "completed", "done", null, [p.evidenceId], now), false);
    assert.equal(f.store.activeRun(workId)?.state, "cancelling");
    f.store.completeRun(run.run.runId, "cancelled", null, null, now);
    assert.equal(f.store.feedback.getRequest(workId, id)?.state, "cancelled");
    assert.equal(f.store.feedback.finish(workId, id, "completed", "late", null, [p.evidenceId], now), false);
    const id2 = f.store.feedback.receiveEvent(event("complete"), ["review"], now).requestId!; const run2 = accept(f.store, id2, "next");
    const p2 = proof(f.store, id2, run2.run.runId);
    assert.equal(f.store.feedback.finish(workId, id2, "completed", "verified", null, [p2.evidenceId], now), true);
    assert.equal(f.store.feedback.cancel(workId, id2).state, "completed");
  } finally { f.cleanup(); }
});

test("interruption never replays effects; Retry is a new idempotent verification goal; historical is read only", () => {
  const f = fixture(); const db = new DatabaseSync(f.path); try {
    const id = f.store.feedback.receiveEvent(event("lost"), ["review"], now).requestId!; const run = accept(f.store, id);
    f.store.feedback.recordAction(workId, id, { serviceName: "todo", actionId: "action1", actionName: "update", input: { title: "one" }, expectedStateVersion: "v1", verificationQuery: "review", status: "calling" });
    assert.throws(() => f.store.feedback.recordAction(workId, id, { serviceName: "todo", actionId: "action1", actionName: "update", input: { title: "two" }, expectedStateVersion: "v1", verificationQuery: "review", status: "calling" }), error("ACTION_IDEMPOTENCY_CONFLICT"));
    f.store.interruptActiveRuns(now);
    assert.equal(f.store.getRun(run.run.runId)?.state, "interrupted");
    assert.equal(f.store.feedback.getRequest(workId, id)?.state, "pending");
    assert.equal(f.store.feedback.needsRecovery(workId, id), true);
    assert.throws(() => f.store.feedback.retry(workId, id, "premature", now), error("REQUEST_RETRY_NOT_ALLOWED"));
    // The host has tried the original read and cannot prove the result.
    f.store.feedback.finish(workId, id, "needs_attention", null, { code: "ACTION_RESULT_UNKNOWN", message: "Original Action is unreadable" }, [], now);
    const retry = f.store.feedback.retry(workId, id, "intent1", now);
    assert.notEqual(retry.requestId, id); assert.equal(retry.retryOf, id);
    assert.equal(retry.source.phase, "verifying");
    assert.deepEqual(f.store.feedback.retry(workId, id, "intent1", now), retry);
    assert.throws(() => f.store.feedback.retry(workId, retry.requestId, "intent2", now), error("REQUEST_RETRY_NOT_ALLOWED"));
    db.prepare("UPDATE agent_requests SET disposition='historical' WHERE request_id=?").run(retry.requestId);
    assert.throws(() => accept(f.store, retry.requestId, "historical", "verifying"), error("REQUEST_NOT_READY"));
    assert.throws(() => f.store.feedback.retry(workId, retry.requestId, "intent3", now), error("REQUEST_RETRY_NOT_ALLOWED"));
    db.prepare("UPDATE service_events SET disposition='historical'").run();
    assert.throws(() => f.store.feedback.receiveEvent(event("lost"), ["review"], now), error("SERVICE_EVENT_ORIGIN_MISMATCH"));
  } finally { db.close(); f.cleanup(); }
});

test("accepted actions and event payloads cannot complete a goal", () => {
  const f = fixture(); try {
    const id = f.store.feedback.receiveEvent(event("verify"), ["review"], now).requestId!; const run = accept(f.store, id);
    assert.throws(() => proof(f.store, id, run.run.runId, { kind: "event" }), error("VERIFICATION_REQUIRED"));
    const q = proof(f.store, id, run.run.runId);
    f.store.feedback.recordAction(workId, id, { serviceName: "todo", actionId: "a1", actionName: "update", input: {}, expectedStateVersion: "v1", verificationQuery: "review", status: "known" });
    assert.throws(() => f.store.feedback.finish(workId, id, "completed", "done", null, [q.evidenceId], now), error("VERIFICATION_REQUIRED"));
    f.store.feedback.addEvidence(workId, { requestId: id, runId: run.run.runId, serviceName: "todo", kind: "action", objectRef: "a1", observedAt: now, summary: "Committed", verified: true }, { state: "succeeded" });
    assert.equal(f.store.feedback.finish(workId, id, "completed", "Verified", null, [q.evidenceId], now), true);
  } finally { f.cleanup(); }
});

test("original Action reconciliation preserves its registered Job and rejects replacement atomically", () => {
  const f = fixture(); try {
    const id = f.store.feedback.receiveEvent(event("original-job"), ["review"], now).requestId!;
    accept(f.store, id);
    f.store.feedback.recordAction(workId, id, { serviceName: "todo", actionId: "a1", actionName: "export", input: {}, expectedStateVersion: null,
      verificationQuery: "review", status: "known", jobId: "job-original" });
    const before = f.store.feedback.internal(workId, id)!;
    assert.throws(() => f.store.feedback.reconcileAction(workId, id, "todo", "a1", "job-replaced"), error("INVALID_WAIT"));
    assert.deepEqual(f.store.feedback.internal(workId, id), before);
    f.store.feedback.reconcileAction(workId, id, "todo", "a1");
    f.store.feedback.reconcileAction(workId, id, "todo", "a1", "job-original");
    assert.deepEqual(f.store.feedback.internal(workId, id), before);
  } finally { f.cleanup(); }
});

test("completion rejects mismatched persisted Job proofs without changing the goal or effective experience", () => {
  for (const mismatch of ["action", "job", "missing-action"] as const) {
    const f = fixture(); try {
      const id = f.store.feedback.receiveEvent(event(`job-proof-${mismatch}`), ["review"], now).requestId!;
      const run = accept(f.store, id).run;
      f.store.feedback.recordAction(workId, id, { serviceName: "todo", actionId: "a1", actionName: "export", input: {}, expectedStateVersion: null,
        verificationQuery: "review", status: "known", jobId: "job-original" });
      const query = proof(f.store, id, run.runId);
      const details = { state: "succeeded", jobId: mismatch === "job" ? "job-another" : "job-original",
        ...(mismatch === "missing-action" ? {} : { actionId: mismatch === "action" ? "a2" : "a1" }) };
      const bad = f.store.feedback.addEvidence(workId, { requestId: id, runId: run.runId, serviceName: "todo", kind: "job", objectRef: "job-original",
        observedAt: now, summary: "Inconsistent terminal Job", verified: true }, details);
      f.store.feedback.stageExperience(workId, id, { entryId: "original-export", scope: "service:todo", rule: "Verify original export", evidenceIds: [query.evidenceId] }, false, now);
      const before = f.store.feedback.internal(workId, id), head = f.store.feedback.experienceSnapshot(workId);
      for (const ids of [[query.evidenceId], [bad.evidenceId, query.evidenceId]]) {
        assert.throws(() => f.store.feedback.finish(workId, id, "completed", "Unproved result", null, ids, now), error("VERIFICATION_REQUIRED"));
        assert.deepEqual(f.store.feedback.internal(workId, id), before);
        assert.deepEqual(f.store.feedback.experienceSnapshot(workId), head);
      }
      const good = f.store.feedback.addEvidence(workId, { requestId: id, runId: run.runId, serviceName: "todo", kind: "job", objectRef: "job-original",
        observedAt: now, summary: "Original Job succeeded", verified: true }, { state: "succeeded", jobId: "job-original", actionId: "a1" });
      assert.throws(() => f.store.feedback.finish(workId, id, "completed", "Invalid selected proof", null, [bad.evidenceId, query.evidenceId], now), error("VERIFICATION_REQUIRED"));
      assert.deepEqual(f.store.feedback.experienceSnapshot(workId), head);
      assert.equal(f.store.feedback.finish(workId, id, "completed", "Verified original result", null, [good.evidenceId, query.evidenceId], now), true);
      assert.equal(f.store.feedback.getRequest(workId, id)?.state, "completed");
      const committed = f.store.feedback.experienceSnapshot(workId);
      assert.ok(committed.version > head.version); assert.equal(committed.entries[0]?.rule, "Verify original export");
    } finally { f.cleanup(); }
  }
});

test("evidence pagination carries scope; public output omits secrets and host paths; missing differs from empty", () => {
  const f = fixture(); try {
    const run = f.store.acceptRun({ workId, sessionId: "session-test", submissionKey: "manual", requestDigest: "manual", promptDigest: "manual", now });
    const id = f.store.feedback.ensureChatRequest(workId, run.run.runId, "Review actual state", now).requestId;
    assert.deepEqual(f.store.feedback.listEvidence(workId, id), { items: [], nextCursor: null });
    assert.throws(() => f.store.feedback.listEvidence(workId, "missing"), error("REQUEST_NOT_FOUND"));
    for (let i = 0; i < 3; i++) proof(f.store, id, run.run.runId, { summary: "credential=hidden /run/piwork/private.key", objectRef: `query${i}` });
    const first = f.store.feedback.listEvidence(workId, id, 2);
    assert.equal(first.items.length, 2); assert.ok(first.nextCursor);
    assert.equal(f.store.feedback.listEvidence(workId, id, 2, first.nextCursor!).items.length, 1);
    const other = f.store.feedback.receiveEvent(event("other"), ["review"], now).requestId!;
    assert.throws(() => f.store.feedback.listEvidence(workId, other, 2, first.nextCursor!), error("INVALID_CURSOR"));
    assert.throws(() => f.store.feedback.listEvidence(workId, id, 101), error("INVALID_CURSOR"));
    assert.doesNotMatch(JSON.stringify(first), /hidden|private\.key/);
    assert.throws(() => proof(f.store, "missing", run.run.runId), error("EVIDENCE_SCOPE_INVALID"));
    f.store.close(); assert.throws(() => f.store.feedback.listEvidence(workId, id));
  } finally { f.cleanup(); }
});

test("experience commits with verified completion, keeps failed candidates and pins each accepted Run head", () => {
  const f = fixture(); try {
    const id = f.store.feedback.receiveEvent(event("learning"), ["review"], now).requestId!; const run = accept(f.store, id);
    const p = proof(f.store, id, run.run.runId);
    const rule = { entryId: "review-overdue", scope: "service:todo", rule: "Review includes all overdue tasks", evidenceIds: [p.evidenceId] };
    assert.throws(() => f.store.feedback.stageExperience(workId, id, { ...rule, evidenceIds: ["missing"] }, false, now), error("VERIFICATION_REQUIRED"));
    f.store.feedback.stageExperience(workId, id, rule, false, now);
    assert.equal(f.store.feedback.experienceSnapshot(workId).version, 0);
    assert.throws(() => f.store.feedback.stageExperience(workId, id, { ...rule, rule: "中".repeat(1400) }, false, now), error("EXPERIENCE_LIMIT_EXCEEDED"));
    f.store.feedback.finish(workId, id, "completed", "Verified", null, [p.evidenceId], now);
    const head = f.store.feedback.experienceSnapshot(workId);
    assert.equal(head.entries.length, 1); assert.equal(head.entries[0]?.rule, rule.rule);
    assert.equal(f.store.getRun(run.run.runId)?.adoptedExperienceVersion ?? 0, 0);
    f.store.completeRun(run.run.runId, "succeeded", "done", null, now);
    const id2 = f.store.feedback.receiveEvent(event("failed-learning"), ["review"], now).requestId!; const run2 = accept(f.store, id2, "next");
    assert.equal(run2.run.adoptedExperienceVersion, head.version);
    const p2 = proof(f.store, id2, run2.run.runId);
    f.store.feedback.stageExperience(workId, id2, { ...rule, rule: "bad rule", evidenceIds: [p2.evidenceId] }, false, now);
    f.store.feedback.finish(workId, id2, "failed", "not verified", null, [], now);
    assert.deepEqual(f.store.feedback.experienceSnapshot(workId), head);
    assert.deepEqual(f.store.feedback.experienceSnapshot(workId, run2.run.adoptedExperienceVersion), head);
  } finally { f.cleanup(); }
});

test("100 effective rules are bounded and concurrent staged commits never discard the prior head", () => {
  const f = fixture(); try {
    const id = f.store.feedback.receiveEvent(event("many"), ["review"], now).requestId!; const run = accept(f.store, id); const p = proof(f.store, id, run.run.runId);
    for (let i = 0; i < 100; i++) f.store.feedback.stageExperience(workId, id, { entryId: `rule${i}`, scope: "work", rule: `Rule ${i}`, evidenceIds: [p.evidenceId] }, false, now);
    f.store.feedback.finish(workId, id, "completed", "verified", null, [p.evidenceId], now); f.store.completeRun(run.run.runId, "succeeded", "done", null, now);
    const head = f.store.feedback.experienceSnapshot(workId);
    const id2 = f.store.feedback.receiveEvent(event("overflow"), ["review"], now).requestId!; const run2 = accept(f.store, id2, "more"); const p2 = proof(f.store, id2, run2.run.runId);
    assert.throws(() => f.store.feedback.stageExperience(workId, id2, { entryId: "extra", scope: "work", rule: "Extra", evidenceIds: [p2.evidenceId] }, false, now), error("EXPERIENCE_LIMIT_EXCEEDED"));
    assert.deepEqual(f.store.feedback.experienceSnapshot(workId), head);
    f.store.feedback.stageExperience(workId, id2, { entryId: "rule0", scope: "work", rule: "Explicit replacement", evidenceIds: [p2.evidenceId] }, false, now);
    f.store.feedback.finish(workId, id2, "completed", "verified", null, [p2.evidenceId], now);
    assert.equal(f.store.feedback.experienceSnapshot(workId).entries.length, 100);
    assert.equal(f.store.feedback.experienceSnapshot(workId).entries.find((e) => e.entryId === "rule1")?.rule, "Rule 1");
    assert.equal(run2.run.adoptedExperienceVersion, head.version);
  } finally { f.cleanup(); }
});

test("waiting candidates merge against intervening learning while each Run retains its original head", () => {
  const f = fixture(); try {
    const a = f.store.feedback.receiveEvent(event("a"), ["review"], now).requestId!; const ra = accept(f.store, a, "a"); const pa = proof(f.store, a, ra.run.runId);
    f.store.feedback.stageExperience(workId, a, { entryId: "a", scope: "work", rule: "Rule A", evidenceIds: [pa.evidenceId] }, false, now);
    f.store.feedback.wait(workId, a, { kind: "job", id: "job-a", deadlineAt: "2026-10-03T02:00:00.000Z", nextPhase: "verifying", verificationGoal: "Verify A" }, now);
    f.store.completeRun(ra.run.runId, "succeeded", "waiting", null, now);
    const b = f.store.feedback.receiveEvent(event("b"), ["review"], now).requestId!; const rb = accept(f.store, b, "b"); const pb = proof(f.store, b, rb.run.runId);
    f.store.feedback.stageExperience(workId, b, { entryId: "b", scope: "work", rule: "Rule B", evidenceIds: [pb.evidenceId] }, false, now);
    f.store.feedback.finish(workId, b, "completed", "verified", null, [pb.evidenceId], now);
    f.store.completeRun(rb.run.runId, "succeeded", "done", null, now);
    const headB = f.store.feedback.experienceSnapshot(workId);
    f.store.feedback.resume(workId, a, "job-a", now);
    const resumed = accept(f.store, a, "a-verify", "verifying"); const p2 = proof(f.store, a, resumed.run.runId);
    f.store.feedback.finish(workId, a, "completed", "verified", null, [p2.evidenceId], now);
    assert.deepEqual(f.store.feedback.experienceSnapshot(workId).entries.map((e) => e.entryId), ["a", "b"]);
    assert.equal(resumed.run.adoptedExperienceVersion, headB.version);
    assert.deepEqual(f.store.feedback.experienceSnapshot(workId, headB.version), headB);
  } finally { f.cleanup(); }
});

test("large filtered history reads only page plus one rows from SQLite with stable equal-time cursors", (t) => {
  const f = fixture(), db = new DatabaseSync(f.path); try {
    const expectedRequests: string[] = [], expectedEvents: string[] = [];
    for (let i = 0; i < 700; i++) {
      const item = { ...event(`history-${i}`), serviceName: i % 2 ? "todo" : "journal",
        origin: { workId: i % 7 ? workId : "work-other-1111111111", serviceId: i % 3 ? serviceId : "service-old-1111111111" } };
      const receipt = f.store.feedback.receiveEvent(item, ["review"], now);
      const state = i % 5 ? "failed" : "cancelled";
      f.store.feedback.finish(item.origin.workId, receipt.requestId!, state, null, null, [], now);
      const historical = i % 4 === 0;
      if (historical) db.prepare("UPDATE agent_requests SET disposition='historical' WHERE request_id=?").run(receipt.requestId!);
      if (item.origin.workId === workId && item.serviceName === "todo") expectedEvents.push(item.eventId);
      if (item.origin.workId === workId && item.serviceName === "todo" && item.origin.serviceId === serviceId && state === "failed" && !historical) expectedRequests.push(receipt.requestId!);
    }
    const reads: number[] = [], feedback = new FeedbackStore(db), original = db.prepare.bind(db);
    t.mock.method(db, "prepare", (sql: string) => {
      const statement = original(sql);
      if (sql.startsWith("SELECT request_id,created_at FROM agent_requests") || sql.startsWith("SELECT event_pk,event_json,disposition,created_at FROM service_events")) {
        const all = statement.all.bind(statement);
        t.mock.method(statement, "all", (...args: Parameters<typeof all>) => { const rows = all(...args); reads.push(rows.length); return rows; });
      }
      return statement;
    });
    let cursor: string | undefined, requests: string[] = [];
    do {
      const page = feedback.listRequests(workId, { serviceName: "todo", state: "failed", disposition: "live", limit: 11, ...(cursor ? { cursor } : {}) }, serviceId);
      requests.push(...page.items.map((r) => r.requestId)); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(new Set(requests).size, requests.length); assert.deepEqual(requests, expectedRequests.sort());
    const eventIds: string[] = [];
    do {
      const page = feedback.listServiceEvents(workId, "todo", 11, cursor); eventIds.push(...page.items.map((r) => r.event.eventId)); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(new Set(eventIds).size, eventIds.length); assert.deepEqual(eventIds.sort(), expectedEvents.sort());
    assert.ok(reads.length > 10); assert.ok(reads.every((n) => n <= 12), `SQLite materialized ${Math.max(...reads)} records in a page query`);
    const scoped = feedback.listRequests(workId, { limit: 1, serviceName: "todo" }).nextCursor!;
    assert.throws(() => feedback.listRequests(workId, { serviceName: "journal", cursor: scoped }), error("INVALID_CURSOR"));
    assert.throws(() => feedback.listRequests(workId, { serviceName: "todo", cursor: scoped }, serviceId), error("INVALID_CURSOR"));
    assert.throws(() => feedback.listServiceEvents(workId, "journal", 11, feedback.listServiceEvents(workId, "todo", 1).nextCursor!), error("INVALID_CURSOR"));
    assert.throws(() => feedback.listRequests(workId, { limit: 101 }), error("INVALID_CURSOR"));
    assert.equal(feedback.listRequests(workId).items.length, 50);
    assert.equal(feedback.listRequests(workId, { limit: 100 }).items.length, 100);
    assert.equal(feedback.listServiceEvents(workId, "no-such-service").items.length, 0);
  } finally { t.mock.restoreAll(); db.close(); f.cleanup(); }
});

test("evidence uses bounded SQLite pages with equal-time cursors and excludes other request scopes", (t) => {
 const f=fixture(), db=new DatabaseSync(f.path);
 try {
  const id=f.store.feedback.receiveEvent(event("evidence-pages"),["review"],now).requestId!;
  const other=f.store.feedback.receiveEvent(event("evidence-other"),["review"],now).requestId!;
  for(let i=0;i<300;i++){proof(f.store,i%4?id:other,null);}
  const feedback=new FeedbackStore(db),original=db.prepare.bind(db),reads:number[]=[];
  t.mock.method(db,"prepare",(sql:string)=>{const statement=original(sql);if(sql.startsWith("SELECT evidence_id,observed_at FROM agent_evidence")){const all=statement.all.bind(statement);t.mock.method(statement,"all",(...args:Parameters<typeof all>)=>{const rows=all(...args);reads.push(rows.length);return rows;});}return statement;});
  let cursor:string|undefined;const ids:string[]=[];
  do {const page=feedback.listEvidence(workId,id,11,cursor);ids.push(...page.items.map(e=>e.evidenceId));cursor=page.nextCursor??undefined;}while(cursor);
  assert.equal(ids.length,226);assert.equal(new Set(ids).size,ids.length);assert.ok(reads.every(n=>n<=12));
  const scoped=feedback.listEvidence(workId,id,1).nextCursor!;
  assert.throws(()=>feedback.listEvidence(workId,other,11,scoped),error("INVALID_CURSOR"));
 }finally{t.mock.restoreAll();db.close();f.cleanup();}
});
