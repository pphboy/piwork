import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { BrainCandidates } from "./brain-candidates.js";
import { WorkStore, FeedbackError } from "@piwork/work-store";
import { digestPiPackageTree } from "@piwork/pi-package";
import { BRAIN_LIMITS, type BrainCandidateState, type BrainCandidateSubmission } from "@piwork/contracts";
import type { RunExecutionContext } from "./runs.js";
import { BrainLoop } from "./brain-loop.js";
import { BRAIN_TOOL_NAMES } from "./brain-resources.js";
import { AgentDaemonControl } from "./daemon.js";
import { RunManager } from "./runs.js";
import { AgentSessionService } from "./sessions.js";
import { ServiceBindingRegistry, type ServiceInteractionClient } from "./service-interaction.js";

const WORK = "work-1111111111111111", NOW = "2026-10-03T00:00:00.000Z";

// Exercise the real loop/store boundary; only Core I/O and time are controlled.
function candidateLoop(f: Awaited<ReturnType<typeof fixture>>, candidates = f.candidates) {
  let executed = 0;
  const daemon = new AgentDaemonControl({ workId: WORK, generation: 1, instanceId: "candidate-deadline" });
  daemon.configure({ modelCredentialStatus: "available", contextIdentity: f.loaded.contextId, loadedSkills: [],
    resolvedTools: BRAIN_TOOL_NAMES.map(name => `package:piwork-brain:${name}`), initializationComplete: true });
  const runs = new RunManager(f.store, daemon, { async execute() { executed++; return { finalText: "Unexpected verification" }; } }, f.now);
  const sessions = new AgentSessionService(WORK, f.store, f.root, join(f.root, "sessions"), f.loaded.contextId, f.now);
  const bindings = new ServiceBindingRegistry(WORK, { async bindings() { return { workId: WORK, bindings: [] }; } });
  const loop = new BrainLoop(WORK, f.store, daemon, runs, sessions, bindings, {} as ServiceInteractionClient, candidates, f.now);
  return { loop, executed: () => executed };
}

async function originalCandidate(f: Awaited<ReturnType<typeof fixture>>, mode: "recovery" | "preparation" | "request" | "apply") {
  if (mode === "recovery") {
    const submission: BrainCandidateSubmission = { ...f.intent, requestId: f.request.requestId, expectedSourceDigest: f.sourceDigest,
      activeDigest: f.activeDigest, desiredDigest: f.activeDigest, activeContextId: f.loaded.contextId };
    f.store.feedback.setPackageSubmission(WORK, f.request.requestId, submission);
    await f.control.prepareBrain(submission);
    f.store.interruptActiveRuns(NOW);
  } else {
    if (mode === "request") f.advance(BRAIN_LIMITS.requestTimeoutMs - 120000);
    await f.candidates.prepare(f.context, f.goal(), f.intent);
    f.store.completeRun(f.run.runId, "succeeded", "Original preparation wait", null, f.now().toISOString());
  }
  const digest = `sha256:${"b".repeat(64)}`;
  f.state.candidate = { ...f.state.candidate!, state: "succeeded", phase: "succeeded", artifactDigest: digest };
  f.state.desired = { digest, version: "1.0.0", enabled: true, contextId: "context-new" };
  if (mode === "apply") await f.candidates.poll(f.goal());
  const original = f.goal().request;
  const deadline = original.waitRef?.deadlineAt ?? original.expiresAt;
  return { original, deadline, digest };
}

test("candidate receipt I/O cannot cross the original recovery, preparation, request or Apply deadline", async () => {
  for (const mode of ["recovery", "preparation", "request", "apply"] as const) {
    for (const offset of [-1, 0, 1]) {
      const f = await fixture(); let loop: BrainLoop | undefined;
      try {
        const { original, deadline, digest } = await originalCandidate(f, mode);
        f.advance(Date.parse(deadline) - 1000 - f.now().getTime());
        const native = f.control.brainState; let reads = 0;
        f.control.brainState = async () => { reads++; f.advance(Date.parse(deadline) + offset - f.now().getTime()); return native(); };
        const host = candidateLoop(f); loop = host.loop; loop.start(); await loop.tick();
        const after = f.goal().request, expired = offset >= 0;
        assert.equal(after.state, expired ? "needs_attention" : "waiting_apply", `${mode} / ${offset}`);
        assert.equal(after.error?.code, expired ? "REQUEST_EXPIRED" : undefined);
        assert.equal(after.expiresAt, expired || mode === "apply" ? original.expiresAt : new Date(f.now().getTime() + BRAIN_LIMITS.applyTimeoutMs).toISOString());
        if (expired) assert.deepEqual(after.waitRef, original.waitRef, "expiry cannot replace the original wait");
        assert.equal(f.state.desired?.digest, digest); assert.equal(f.prepares(), 1);
        assert.equal(f.store.getRun(f.run.runId)?.state, mode === "recovery" ? "interrupted" : "succeeded");
        assert.equal(after.autoRunCount, 0); assert.equal(host.executed(), 0); assert.equal(reads, 1);
      } finally { await loop?.close(); await f.close(); }
    }
  }
});

test("late already-loaded receipts and competing cancellation or terminal state do not revive the goal", async () => {
  for (const outcome of ["loaded-expiry", "cancelled", "terminal", "historical"] as const) {
    const f = await fixture(); let loop: BrainLoop | undefined;
    try {
      const { original, deadline, digest } = await originalCandidate(f, "recovery");
      f.advance(Date.parse(deadline) - 1000 - f.now().getTime());
      if (outcome === "loaded-expiry") f.state.active = f.state.desired;
      const native = f.control.brainState;
      f.control.brainState = async () => {
        if (outcome === "cancelled") f.store.feedback.cancel(WORK, f.request.requestId, undefined, f.now().toISOString());
        if (outcome === "terminal") f.store.feedback.finish(WORK, f.request.requestId, "needs_attention", null, { code: "PRIOR_TERMINAL", message: "Already settled" }, [], f.now().toISOString());
        if (outcome === "historical") {
          const db = new DatabaseSync(join(f.root, "work.sqlite"));
          try { db.prepare("UPDATE agent_requests SET disposition='historical' WHERE request_id=?").run(f.request.requestId); }
          finally { db.close(); }
        }
        if (outcome === "loaded-expiry") f.advance(1001);
        return native();
      };
      const candidates = outcome === "loaded-expiry" ? new BrainCandidates(WORK, f.root, f.store, { ...f.loaded, digest }, f.control, f.now) : f.candidates;
      const host = candidateLoop(f, candidates); loop = host.loop; loop.start(); await loop.tick();
      const after = f.goal().request;
      assert.equal(after.state, outcome === "cancelled" ? "cancelled" : outcome === "historical" ? "pending" : "needs_attention");
      assert.equal(after.error?.code, outcome === "loaded-expiry" ? "REQUEST_EXPIRED" : outcome === "terminal" ? "PRIOR_TERMINAL" : undefined);
      assert.equal(after.expiresAt, original.expiresAt); assert.equal(after.waitRef, null);
      assert.equal(after.autoRunCount, 0); assert.equal(host.executed(), 0); assert.equal(f.prepares(), 1);
      assert.equal(f.store.getRun(f.run.runId)?.state, "interrupted"); assert.equal(f.state.desired?.digest, digest);
    } finally { await loop?.close(); await f.close(); }
  }
});
async function fixture(change = true) {
  const root = await mkdtemp(join(tmpdir(), "piwork-brain-candidate-")), source = join(root, ".pi", "packages", "piwork-brain"); await mkdir(source, { recursive: true });
  await writeFile(join(source, "package.json"), '{"name":"piwork-brain","version":"1.0.0"}'); await writeFile(join(source, "brain.md"), "Original cognition");
  const activeDigest = await digestPiPackageTree(source); if (change) await writeFile(join(source, "brain.md"), "Improved cognition; version stays 1.0.0");
  const sourceDigest = await digestPiPackageTree(source), store = WorkStore.open(join(root, "work.sqlite"));
  store.createSession({ workId: WORK, sessionId: "session-one", sdkHistoryPath: join(root, "history.jsonl"), contextIdentity: "context-old", createdAt: NOW, updatedAt: NOW });
  const run = store.acceptRun({ workId: WORK, sessionId: "session-one", submissionKey: "improve", requestDigest: "improve", promptDigest: "improve", contextIdentity: "context-old", now: NOW }).run;
  const request = store.feedback.ensureChatRequest(WORK, run.runId, "Improve brain and prove actual adopted behavior", NOW);
  const context: RunExecutionContext = { workId: WORK, sessionId: "session-one", runId: run.runId, prompt: request.goal, contextIdentity: "context-old", signal: new AbortController().signal, emit() {} };
  const state: { -readonly [Key in keyof BrainCandidateState]: BrainCandidateState[Key] } = { workId: WORK, active: { digest: activeDigest, version: "1.0.0", enabled: true, contextId: "context-old" }, desired: { digest: activeDigest, version: "1.0.0", enabled: true, contextId: "context-old" }, candidate: null };
  let prepares = 0, loseAck = false, unavailable = false, captured: BrainCandidateSubmission | undefined;
  const control = {
    async brainState() { if (unavailable) throw new Error("Control unavailable"); return structuredClone(state); },
    async prepareBrain(input: BrainCandidateSubmission) {
      prepares++; captured = input;
      state.candidate = { operationId: "operation-candidate", state: "pending", phase: "queued", sourceDigest: input.expectedSourceDigest, requestId: input.requestId };
      if (loseAck) throw new Error("Reply lost after durable acceptance"); return { operationId: "operation-candidate" };
    },
  };
  const loaded = { digest: activeDigest, version: "1.0.0", contextId: "context-old", root: join(root, "frozen") };
  let time = Date.parse(NOW); const now = () => new Date(time);
  const candidates = new BrainCandidates(WORK, root, store, loaded, control, now);
  const goal = () => store.feedback.internal(WORK, request.requestId)!;
  const intent = { submissionKey: "original-candidate-key", verificationGoal: "Verify new cognition via loaded SDK tool",
    verificationTarget: { contractVersion: 1 as const, toolName: "package:piwork-brain:brain_review_probe", input: { format: "completed-first" }, checkNames: ["review_format"] } };
  return { root, source, store, request, run, context, state, loaded, control, candidates, goal, intent, sourceDigest, activeDigest,
    loseAck: () => { loseAck = true; }, unavailable: (value: boolean) => { unavailable = value; }, prepares: () => prepares, captured: () => captured,
    advance: (ms: number) => { time += ms; }, now, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test("lost candidate acceptance reuses its persisted descriptor and waits for explicit Apply without holding a Run", async () => {
  const f = await fixture(); try {
    f.loseAck(); await f.candidates.prepare(f.context, f.goal(), f.intent);
    assert.equal(f.prepares(), 1); assert.equal(f.captured()?.expectedSourceDigest, f.sourceDigest); assert.equal(f.captured()?.activeDigest, f.activeDigest);
    assert.equal(f.store.feedback.getRequest(WORK, f.request.requestId)?.waitRef?.id, "operation-candidate");
    f.store.completeRun(f.run.runId, "succeeded", "Waiting for preparation", null, NOW); assert.equal(f.store.activeRun(WORK), undefined);
    const artifactDigest = `sha256:${"b".repeat(64)}`; f.state.candidate = { ...f.state.candidate!, state: "succeeded", phase: "succeeded", artifactDigest, version: "1.0.0" };
    f.state.desired = { digest: artifactDigest, version: "1.0.0", enabled: true, contextId: "context-new" };
    assert.equal((await f.candidates.poll(f.goal())).state, "waiting_apply");
    const deadline = f.store.feedback.getRequest(WORK, f.request.requestId)!.expiresAt;
    assert.equal(Date.parse(deadline) - Date.parse(NOW), BRAIN_LIMITS.applyTimeoutMs);
    f.advance(5000); await f.candidates.poll(f.goal()); assert.equal(f.store.feedback.getRequest(WORK, f.request.requestId)!.expiresAt, deadline, "polls cannot extend Apply indefinitely");
    f.state.active = f.state.desired; assert.equal((await f.candidates.poll(f.goal())).state, "waiting", "Core active alone is not local SDK loaded proof");
    const fresh = new BrainCandidates(WORK, f.root, f.store, { ...f.loaded, digest: artifactDigest, contextId: "context-new" }, f.control, f.now);
    assert.equal((await fresh.poll(f.goal())).state, "ready");
    // A subsequent unrelated desired edit does not revoke an already active, locally loaded candidate.
    f.state.desired = { ...f.state.desired!, digest: `sha256:${"c".repeat(64)}` }; assert.equal((await fresh.poll(f.goal())).state, "ready");
    const projected = await fresh.status(f.goal()); assert.doesNotMatch(JSON.stringify(projected), /sha256|\/tmp\/|activeDigest|sourceDigest/);
    f.store.feedback.cancel(WORK, f.request.requestId, undefined, f.now().toISOString()); assert.equal(f.state.desired.digest, `sha256:${"c".repeat(64)}`);
  } finally { await f.close(); }
});

test("same contents create no helper or artificial Apply; completion still needs actual SDK adoption proof", async () => {
  const f = await fixture(false); try {
    const prepared = await f.candidates.prepare(f.context, f.goal(), f.intent) as { unchanged: boolean }; assert.equal(prepared.unchanged, true);
    assert.equal(f.prepares(), 0); assert.equal(f.goal().request.waitRef, null);
    const query = f.store.feedback.addEvidence(WORK, { requestId: f.request.requestId, runId: f.run.runId, kind: "query", objectRef: "actual-query", observedAt: NOW, summary: "Actual successful checks", verified: true }, { checks: [{ passed: true }] });
    assert.throws(() => f.store.feedback.finish(WORK, f.request.requestId, "completed", "Prepared is not adopted", null, [query.evidenceId], NOW), FeedbackError);
    f.candidates.recordSdkResult(f.context, { toolName: "brain_package_update", toolCallId: "prepare-only", isError: false, args: {}, result: {} }, new Map([["package:piwork-brain:brain_package_update", "brain_package_update"]]));
    assert.equal(f.store.feedback.listEvidence(WORK, f.request.requestId).items.filter((e) => e.kind === "sdk").length, 0);
    f.candidates.recordSdkResult(f.context, { toolName: "brain_review_probe", toolCallId: "actual-call", isError: false, args: f.intent.verificationTarget.input,
      result: { details: { checks: [{ name: "review_format", passed: true, summary: "Actual completed review matches" }] } } }, new Map([[f.intent.verificationTarget.toolName, "brain_review_probe"]]));
    const proof = f.store.feedback.listEvidence(WORK, f.request.requestId).items.find((e) => e.kind === "sdk")!; assert.ok(proof); assert.equal(proof.codeVersion, "1.0.0");
    f.store.feedback.finish(WORK, f.request.requestId, "completed", "Actual SDK tool verified", null, [proof.evidenceId], NOW);
    const status = await f.candidates.status(f.goal()) as { active: boolean; loaded: boolean }; assert.equal(status.active, true); assert.equal(status.loaded, true);
  } finally { await f.close(); }
});

test("a repair candidate captures the retained failed desired baseline independently from the loaded active package", async () => {
  const f = await fixture(); try {
    const failedDigest = `sha256:${"b".repeat(64)}`;
    f.state.desired = { digest: failedDigest, version: "1.0.0", enabled: true, contextId: "context-failed-apply" };
    await f.candidates.prepare(f.context, f.goal(), f.intent);
    assert.equal(f.prepares(), 1);
    assert.equal(f.captured()?.activeDigest, f.activeDigest);
    assert.equal(f.captured()?.desiredDigest, failedDigest);
    assert.equal((f.goal().packageSubmission as BrainCandidateSubmission).desiredDigest, failedDigest);
    assert.equal(f.state.active?.digest, f.activeDigest, "preparation cannot implicitly apply the repair");
    assert.equal(f.state.desired.digest, failedDigest, "the original desired remains until fenced publication");
    assert.equal((await f.candidates.poll(f.goal())).state, "waiting");
  } finally { await f.close(); }
});

test("changed candidate intent, replaced/disabled desired, expiry and lost control never falsely complete", async () => {
  const f = await fixture(); try {
    await f.candidates.prepare(f.context, f.goal(), f.intent);
    await assert.rejects(f.candidates.prepare(f.context, f.goal(), { ...f.intent, verificationGoal: "different" }), FeedbackError);
    await assert.rejects(f.candidates.prepare(f.context, f.goal(), { ...f.intent, verificationTarget: { ...f.intent.verificationTarget, input: { format: "different" } } }), (e: unknown) => e instanceof FeedbackError && e.code === "SUBMIT_CONFLICT");
    await writeFile(join(f.source, "brain.md"), "Another edit under the same key"); await assert.rejects(f.candidates.prepare(f.context, f.goal(), f.intent), FeedbackError); assert.equal(f.prepares(), 1);
    f.store.completeRun(f.run.runId, "succeeded", "Waiting", null, NOW);
    f.state.candidate = { ...f.state.candidate!, state: "succeeded", phase: "succeeded", artifactDigest: `sha256:${"b".repeat(64)}` };
    assert.equal((await f.candidates.poll(f.goal())).state, "replaced");
    f.state.desired = { digest: `sha256:${"b".repeat(64)}`, version: "1.0.0", contextId: "context-new", enabled: false }; assert.equal((await f.candidates.poll(f.goal())).state, "replaced");
    f.state.desired.enabled = true; await f.candidates.poll(f.goal()); f.advance(BRAIN_LIMITS.applyTimeoutMs + 1); f.store.feedback.expire(WORK, f.now().toISOString());
    assert.equal(f.goal().request.state, "needs_attention"); f.unavailable(true); await assert.rejects(f.candidates.status(f.goal()));
    assert.match(await readFile(join(f.source, "brain.md"), "utf8"), /Another edit/);
  } finally { await f.close(); }
});

test("only matching actual SDK checks prove candidate behavior; load/status/Skill facts cannot finish it", async () => {
  for (const variant of ["status", "read", "wrong-input", "missing", "failed", "duplicate", "error"] as const) {
    const f = await fixture(false); try {
      await f.candidates.prepare(f.context, f.goal(), f.intent);
      const toolName = variant === "status" ? "brain_experience" : variant === "read" ? "read" : "brain_review_probe";
      const checks = variant === "missing" ? undefined : variant === "duplicate" ? [{ name: "review_format", passed: true, summary: "One" }, { name: "review_format", passed: true, summary: "Two" }]
        : [{ name: "review_format", passed: variant !== "failed", summary: "Actual probe check" }];
      f.candidates.recordSdkResult(f.context, { toolName, toolCallId: `actual-${variant}`, isError: variant === "error",
        args: variant === "wrong-input" ? { format: "other" } : variant === "status" ? { operation: "status" } : variant === "read" ? { path: join(f.loaded.root, "skills", "deploy-work-service", "SKILL.md") } : f.intent.verificationTarget.input,
        result: { details: { checks } } }, new Map([[f.intent.verificationTarget.toolName, "brain_review_probe"], ["package:piwork-brain:brain_experience", "brain_experience"]]));
      const evidence = f.store.feedback.listEvidence(WORK, f.request.requestId).items;
      assert.equal(evidence.some((e) => e.kind === "sdk" && e.verified), false);
      if (["missing", "failed", "duplicate", "error"].includes(variant)) assert.equal(f.goal().request.state, "needs_attention");
      else assert.throws(() => f.store.feedback.finish(WORK, f.request.requestId, "completed", "Unrelated success", null, evidence.map((e) => e.evidenceId), NOW), FeedbackError);
      const status = await f.candidates.status(f.goal()) as { loaded: boolean }; assert.equal(status.loaded, true);
      assert.equal(f.prepares(), 0);
    } finally { await f.close(); }
  }
});

test("a prior verification Run cannot provide the current Run's candidate completion proof", async () => {
  const f = await fixture(false); try {
    await f.candidates.prepare(f.context, f.goal(), f.intent);
    f.candidates.recordSdkResult(f.context, { toolName: "brain_review_probe", toolCallId: "old-call", args: f.intent.verificationTarget.input, isError: false,
      result: { details: { checks: [{ name: "review_format", passed: true, summary: "Original SDK behavior" }] } } }, new Map([[f.intent.verificationTarget.toolName, "brain_review_probe"]]));
    const proof = f.store.feedback.listEvidence(WORK, f.request.requestId).items.find((e) => e.kind === "sdk")!;
    f.store.feedback.registerPackageWait(WORK, f.request.requestId, { kind: "package-operation", id: "original-receipt", nextPhase: "adopting", verificationGoal: f.intent.verificationGoal,
      deadlineAt: new Date(Date.parse(NOW) + 60000).toISOString() }, NOW);
    f.store.completeRun(f.run.runId, "succeeded", "Waiting", null, NOW);
    f.store.feedback.resume(WORK, f.request.requestId, "original-receipt", NOW);
    f.store.acceptRun({ workId: WORK, sessionId: "session-one", contextIdentity: "context-old", submissionKey: "second-run", promptDigest: "second", requestDigest: "second", now: NOW,
      agentRequest: { requestId: f.request.requestId, phase: "adopting" } });
    assert.throws(() => f.store.feedback.finish(WORK, f.request.requestId, "completed", "Reused proof", null, [proof.evidenceId], NOW), (e: unknown) => e instanceof FeedbackError && e.code === "VERIFICATION_REQUIRED");
  } finally { await f.close(); }
});

test("recovery observes only the original candidate receipt, including a lost wait registration", async () => {
  for (const receipt of ["pending", "prepared", "missing"] as const) {
    const f = await fixture(); try {
      const submission: BrainCandidateSubmission = { ...f.intent, requestId: f.request.requestId, expectedSourceDigest: f.sourceDigest,
        activeDigest: f.activeDigest, desiredDigest: f.activeDigest, activeContextId: f.loaded.contextId };
      f.store.feedback.setPackageSubmission(WORK, f.request.requestId, submission);
      if (receipt !== "missing") await f.control.prepareBrain(submission);
      f.store.interruptActiveRuns(NOW);
      assert.equal(f.store.feedback.needsRecovery(WORK, f.request.requestId), true);
      if (receipt === "prepared") {
        const digest = `sha256:${"b".repeat(64)}`;
        f.state.candidate = { ...f.state.candidate!, state: "succeeded", phase: "succeeded", artifactDigest: digest };
        f.state.desired = { ...f.state.desired!, digest };
      }
      const progress = await f.candidates.poll(f.goal());
      assert.equal(progress.state, receipt === "missing" ? "failed" : receipt === "pending" ? "waiting" : "waiting_apply");
      assert.equal(f.prepares(), receipt === "missing" ? 0 : 1, "observation never prepares a candidate again");
      assert.equal(f.store.getRun(f.run.runId)?.state, "interrupted");
      assert.equal(f.goal().request.autoRunCount, 0, "host reconciliation consumes no automatic Run");
    } finally { await f.close(); }
  }
});

test("failed candidate Apply closes the wait even when desired is retained and prior active is restored", async () => {
  const f = await fixture(); try {
    await f.candidates.prepare(f.context, f.goal(), f.intent);
    f.store.completeRun(f.run.runId, "succeeded", "Waiting", null, NOW);
    const artifactDigest = `sha256:${"b".repeat(64)}`;
    f.state.candidate = { ...f.state.candidate!, state: "succeeded", phase: "succeeded", artifactDigest,
      apply: { operationId: "operation-original-apply", state: "failed" } };
    f.state.desired = { digest: artifactDigest, version: "1.0.0", enabled: true, contextId: "context-new" };
    const progress = await f.candidates.poll(f.goal());
    assert.equal(progress.state, "failed"); assert.match(progress.message!, /prior active rollback/);
    assert.equal(f.state.active?.digest, f.activeDigest); assert.equal(f.state.desired.digest, artifactDigest);
    const native = f.control.brainState;
    f.control.brainState = async () => { throw Object.assign(new Error("Not yet formally active"), { code: 9 }); };
    await assert.rejects(f.candidates.poll(f.goal()), error => error instanceof FeedbackError && error.code === "BINDINGS_UNAVAILABLE");
    f.control.brainState = native;
  } finally { await f.close(); }
});
