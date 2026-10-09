import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { BRAIN_LIMITS, type ServiceEvent, type ServiceInteractionBinding } from "@piwork/contracts";
import { FeedbackError, WorkStore } from "@piwork/work-store";
import { BrainFlow } from "./brain-flow.js";
import { BrainLoop } from "./brain-loop.js";
import { BRAIN_TOOL_NAMES } from "./brain-resources.js";
import { RunManager, type RunExecutionContext } from "./runs.js";
import { AgentDaemonControl } from "./daemon.js";
import { AgentSessionService } from "./sessions.js";
import { ServiceBindingRegistry, ServiceInteractionClient } from "./service-interaction.js";

const WORK = "work-1111111111111111", SERVICE = "service-1111111111111111";
const tools = BRAIN_TOOL_NAMES.map((name) => `package:piwork-brain:${name}`);
const objectSchema = { type: "object", properties: {}, additionalProperties: false };
class Controlled {
  contexts: RunExecutionContext[] = [];
  private gates = new Map<string, (value: { finalText: string }) => void>();
  execute = (context: RunExecutionContext) => { this.contexts.push(context); return new Promise<{ finalText: string }>((resolve) => this.gates.set(context.runId, resolve)); };
  release(id: string) { this.gates.get(id)!({ finalText: "phase returned" }); }
}
async function fixture(allowed = tools) {
  const root = await mkdtemp(join(tmpdir(), "piwork-flow-")), store = WorkStore.open(join(root, "work.sqlite"));
  let time = Date.parse("2026-10-03T00:00:00.000Z"), jobState = "running", jobActionId = "export-original", posts = 0, jobReads = 0, bound = true;
  const now = () => new Date(time), advance = (ms: number) => { time += ms; };
  const actions = new Map<string, unknown>();
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${"a".repeat(64)}`); res.setHeader("content-type", "application/json");
    if (req.url === "/pi/v1/capabilities") { res.end(JSON.stringify({ contractVersion: 1, logicalServiceName: "todo", codeVersion: "c1", stateVersion: "v1",
      queries: { review: { inputSchema: objectSchema, description: "Actual review" } }, actions: { export: { inputSchema: objectSchema, description: "Export", mutation: true,
        requiresExpectedStateVersion: false, verificationQuery: "review", mode: "async", maxWaitMs: 60000 } }, events: { facts: ["job.finished", "page.visited"], requestReasons: ["review"] }, jobs: true })); return; }
    if (req.url?.startsWith("/pi/v1/queries/")) { res.end(JSON.stringify({ stateVersion: "v1", codeVersion: "c1", observedAt: now().toISOString(), value: { overdue: 1 }, checks: [{ name: "original-goal", passed: true, summary: "Export exists" }] })); return; }
    if (req.method === "POST") {
      posts++; let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); const value = { actionId: input.actionId, actionName: "export", input: input.input, expectedStateVersion: null,
        state: "accepted", stateVersion: "v1", observedAt: now().toISOString(), jobId: "job-original" };
      actions.set(input.actionId, value); res.end(JSON.stringify(value)); return;
    }
    if (req.url?.startsWith("/pi/v1/actions/")) { const value = actions.get(req.url.split("/").at(-1)!); res.statusCode = value ? 200 : 404; res.end(JSON.stringify(value ?? {})); return; }
    if (req.url === "/pi/v1/jobs/job-original") { jobReads++; res.end(JSON.stringify({ jobId: "job-original", actionId: jobActionId, state: jobState,
      observedAt: now().toISOString(), deadlineAt: new Date(time + 60000).toISOString(), artifacts: jobState === "succeeded" ? ["exports/todo.json"] : [] })); return; }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address !== "string");
  const binding: ServiceInteractionBinding = { workId: WORK, serviceId: SERVICE, serviceName: "todo", containerId: "container-one", address: "127.0.0.1", token: "a".repeat(64), ports: [{ name: "api", port: address.port, protocol: "tcp" }] };
  const registry = new ServiceBindingRegistry(WORK, { async bindings() { return { workId: WORK, bindings: bound ? [binding] : [] }; } });
  await mkdir(join(root, ".pi", "services"), { recursive: true }); await mkdir(join(root, "sessions"));
  await writeFile(join(root, ".pi", "services", "todo.json"), JSON.stringify({ contractVersion: 1, serviceName: "todo", mode: "pi-managed", apiPortName: "api" }));
  const client = new ServiceInteractionClient(root, registry, store.feedback), controlled = new Controlled();
  const daemon = new AgentDaemonControl({ workId: WORK, generation: 1, instanceId: "agent-test" });
  daemon.configure({ modelCredentialStatus: "available", contextIdentity: "context-current", loadedSkills: [], resolvedTools: allowed, initializationComplete: true });
  const sessions = new AgentSessionService(WORK, store, root, join(root, "sessions"), "context-current", now);
  let runs!: RunManager;
  const flow = new BrainFlow(store, client, new Set(allowed), (id) => { runs.cancel(id); }, undefined, now);
  runs = new RunManager(store, daemon, flow.wrap(controlled), now, { async resolve(ref) { return { modelRef: ref, label: ref ?? "Work default", provider: "fixture", model: ref ?? "default" }; }, async list() { throw new Error("unused"); }, async credential() { return "private"; } });
  const loop = new BrainLoop(WORK, store, daemon, runs, sessions, registry, client, undefined, now);
  const event = (id: string, type = "agent.requested"): ServiceEvent => ({ contractVersion: 1, eventId: id, origin: { workId: WORK, serviceId: SERVICE }, serviceName: "todo", type, occurredAt: now().toISOString(), stateVersion: "v1", actor: "user",
    payload: type === "agent.requested" ? { reason: "review", goal: "Export and verify the original todo", evidenceRefs: [] } : {} });
  const receive = (id: string) => store.feedback.receiveEvent(event(id), ["review"], now().toISOString()).requestId!;
  return { root, store, sessions, daemon, controlled, flow, runs, loop, registry, client, actions, now, advance, event, receive, job: (state: string) => { jobState = state; }, jobAction: (id: string) => { jobActionId = id; }, revoke: () => { bound = false; }, counts: () => ({ posts, jobReads }),
    async close() { await loop.close(); for (const c of controlled.contexts) controlled.release(c.runId); await runs.drain(50); await flow.close(); store.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); } };
}
async function ready(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }

function onObservationReturn(f: Awaited<ReturnType<typeof fixture>>, kind: "action" | "job", after: () => void | Promise<void>) {
  if (kind === "job") {
    const native = f.client.job.bind(f.client);
    f.client.job = async (...args) => { const result = await native(...args); await after(); return result; };
  } else {
    const native = f.client.readAction.bind(f.client);
    f.client.readAction = async (...args) => { const result = await native(...args); await after(); return result; };
  }
}

async function originalWait(f: Awaited<ReturnType<typeof fixture>>, kind: "action" | "job", cutoff: "wait" | "request" | "equal" = "wait") {
  const id = f.receive(`original-${kind}-${cutoff}`);
  if (cutoff !== "wait") f.advance(BRAIN_LIMITS.requestTimeoutMs - (cutoff === "request" ? 30000 : 60000));
  f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
  const run = f.store.activeRun(WORK)!;
  await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
  await f.flow.invoke("brain_feedback", { operation: "wait", waitRef: { kind, serviceName: "todo", id: kind === "job" ? "job-original" : "export-original",
    deadlineAt: new Date(f.now().getTime() + 60000).toISOString(), nextPhase: "verifying", verificationGoal: "Verify original export" } });
  f.controlled.release(run.runId); await f.runs.wait(run.runId);
  return { id, run, before: f.store.feedback.getRequest(WORK, id)! };
}

test("Action and Job query returns must satisfy the current wait and request deadlines before resuming", async () => {
  for (const kind of ["action", "job"] as const) for (const cutoff of ["wait", "request", "equal"] as const) for (const offset of [-1, 0, 1]) {
    const f = await fixture(); try {
      const { id, run, before } = await originalWait(f, kind, cutoff);
      const deadline = Date.parse(before.waitRef!.deadlineAt);
      assert.equal(before.waitRef!.deadlineAt === before.expiresAt, cutoff !== "wait");
      f.advance(deadline - 1000 - f.now().getTime());
      f.job("succeeded"); f.actions.set("export-original", { ...f.actions.get("export-original") as object, state: "succeeded" });
      onObservationReturn(f, kind, () => { f.advance(deadline + offset - f.now().getTime()); });
      await f.loop.tick(); await ready();
      const after = f.store.feedback.getRequest(WORK, id)!;
      assert.equal(after.state, offset < 0 ? "running" : "needs_attention", `${kind}/${cutoff}/${offset}`);
      assert.equal(after.error?.code, offset < 0 ? undefined : "REQUEST_EXPIRED");
      assert.equal(after.autoRunCount, offset < 0 ? 2 : 1);
      assert.equal(f.controlled.contexts.length, offset < 0 ? 2 : 1);
      assert.equal(f.store.activeRun(WORK) !== undefined, offset < 0);
      assert.deepEqual(after.waitRef, before.waitRef); assert.equal(after.expiresAt, before.expiresAt);
      assert.equal(f.store.getRun(run.runId)?.state, "succeeded"); assert.equal(f.counts().posts, 1);
    } finally { await f.close(); }
  }
});

test("Action and Job observations cannot replace cancellation, prior terminal or historical state, or reopen admission", async () => {
  for (const kind of ["action", "job"] as const) for (const outcome of ["cancelled", "terminal", "historical", "draining"] as const) {
    const f = await fixture(); try {
      const { id, run, before } = await originalWait(f, kind);
      f.advance(5000); f.job("succeeded"); f.actions.set("export-original", { ...f.actions.get("export-original") as object, state: "succeeded" });
      onObservationReturn(f, kind, async () => {
        if (outcome === "cancelled") f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
        if (outcome === "terminal") f.store.feedback.finish(WORK, id, "needs_attention", null, { code: "PRIOR_TERMINAL", message: "Already settled" }, [], f.now().toISOString());
        if (outcome === "historical") { const db = new DatabaseSync(join(f.root, "work.sqlite")); try { db.prepare("UPDATE agent_requests SET disposition='historical' WHERE request_id=?").run(id); } finally { db.close(); } }
        if (outcome === "draining") await f.daemon.drain();
      });
      await f.loop.tick(); await ready();
      const after = f.store.feedback.getRequest(WORK, id)!;
      assert.equal(after.state, outcome === "cancelled" ? "cancelled" : outcome === "terminal" ? "needs_attention" : "waiting_result");
      assert.equal(after.error?.code, outcome === "terminal" ? "PRIOR_TERMINAL" : undefined);
      assert.deepEqual(after.waitRef, before.waitRef); assert.equal(after.expiresAt, before.expiresAt);
      assert.equal(after.autoRunCount, 1); assert.equal(f.controlled.contexts.length, 1); assert.equal(f.store.activeRun(WORK), undefined);
      assert.equal(f.store.getRun(run.runId)?.state, "succeeded"); assert.equal(f.counts().posts, 1);
    } finally { await f.close(); }
  }
});

test("a timely resumed wait is historical during later verification and explicit Retry uses its new request deadline", async () => {
  for (const retry of [false, true]) {
    const f = await fixture(); try {
      const { id, before } = await originalWait(f, "job");
      f.job("succeeded"); f.advance(5000);
      if (retry) {
        f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
        f.advance(Date.parse(before.waitRef!.deadlineAt) + 1 - f.now().getTime());
        const fresh = f.store.feedback.retry(WORK, id, "retry-after-original-wait", f.now().toISOString());
        await f.loop.tick(); await ready();
        assert.equal(f.store.feedback.getRequest(WORK, fresh.requestId)?.state, "running");
        assert.equal(f.store.feedback.getRequest(WORK, fresh.requestId)?.autoRunCount, 1);
        assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "cancelled");
      } else {
        const unrelated = f.runs.submit({ workId: WORK, sessionId: f.sessions.create().sessionId, submissionKey: "user-slot", prompt: "Keep the slot" }); await ready();
        await f.loop.tick();
        assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "pending", "timely resume may wait for the shared Run slot");
        f.advance(Date.parse(before.waitRef!.deadlineAt) + 1 - f.now().getTime());
        f.controlled.release(unrelated.run.runId); await f.runs.wait(unrelated.run.runId); f.advance(1000);
        await f.loop.tick(); await ready();
        assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "running", "completed wait deadline does not expire verification");
      }
      assert.equal(f.counts().posts, 1);
      assert.equal(f.store.activeRun(WORK)?.sourceJson && JSON.parse(f.store.activeRun(WORK)!.sourceJson!).phase, "verifying");
    } finally { await f.close(); }
  }
});

test("a replacement daemon waits for Core's current authority before accepting recovered automatic work", async () => {
  const f = await fixture(); try {
    const request = f.receive("formal-ready"); const refresh = f.registry.refresh.bind(f.registry);
    f.registry.refresh = async () => { throw Object.assign(new Error("Core activation pending"), { code: 9 }); };
    f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
    assert.equal(f.controlled.contexts.length, 0); assert.equal(f.store.feedback.getRequest(WORK, request)?.state, "pending");
    f.registry.refresh = refresh; await f.loop.tick(); await ready();
    assert.equal(f.controlled.contexts.length, 1); assert.equal(f.store.feedback.getRequest(WORK, request)?.state, "running");
  } finally { await f.close(); }
});

test("event wakes and periodic ticks share the original Action and Job five-second query bound", async () => {
  for (const kind of ["action", "job"] as const) for (const type of ["page.visited", "job.finished"]) {
    const f = await fixture(); try {
      const { id } = await originalWait(f, kind);
      let reads = 0;
      onObservationReturn(f, kind, () => { reads++; });
      f.advance(1000); await f.loop.tick(); assert.equal(reads, 1);
      const deliver = async (event: ServiceEvent) => {
        const receipt = f.store.feedback.receiveEvent(event, ["review"], f.now().toISOString());
        if (!receipt.reused) f.loop.notify(event);
        await ready(); await ready(); await f.loop.tick();
        return receipt;
      };
      for (let i = 0; i < 3; i++) {
        const event = { ...f.event(`bounded-${i}`, type), payload: type === "page.visited" ? { pathname: "/exports" } : {},
          actionId: "export-original", jobId: "job-original", causationRequestId: id };
        assert.equal((await deliver(event)).reused, false);
        assert.equal((await deliver(event)).reused, true);
        assert.equal(reads, 1, `${kind}/${type}: distinct facts and replays cannot bypass the shared query bound`);
      }
      f.advance(BRAIN_LIMITS.pollMs - 1); await f.loop.tick(); assert.equal(reads, 1);
      f.job("succeeded"); f.actions.set("export-original", { ...f.actions.get("export-original") as object, state: "succeeded" });
      f.advance(1); await deliver({ ...f.event("bounded-terminal", "job.finished"), actionId: "export-original", jobId: "job-original", causationRequestId: id });
      for (let i = 0; i < 50 && !f.store.activeRun(WORK); i++) await new Promise((done) => setTimeout(done, 10));
      assert.equal(reads, 2, "the original object is queried once when the five-second window opens");
      assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "running");
      assert.equal(f.store.feedback.getRequest(WORK, id)?.source.phase, "verifying");
      assert.equal(f.store.feedback.getRequest(WORK, id)?.autoRunCount, 2);
      assert.equal(f.counts().posts, 1); assert.equal(f.store.feedback.listRequests(WORK).items.length, 1);
    } finally { await f.close(); }
  }
});

test("cancellation and wait expiry settle immediately inside an event query throttle window", async () => {
  for (const kind of ["action", "job"] as const) for (const ending of ["cancel", "deadline"] as const) {
    const f = await fixture(); try {
      const { id, before } = await originalWait(f, kind);
      let reads = 0;
      onObservationReturn(f, kind, () => { reads++; });
      f.advance(Date.parse(before.waitRef!.deadlineAt) - 1000 - f.now().getTime());
      await f.loop.tick(); assert.equal(reads, 1);
      f.advance(1000);
      if (ending === "cancel") f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
      const event = { ...f.event("bounded-late", "job.finished"), actionId: "export-original", jobId: "job-original", causationRequestId: id };
      f.store.feedback.receiveEvent(event, ["review"], f.now().toISOString()); f.loop.notify(event);
      await ready(); await ready(); await f.loop.tick();
      const after = f.store.feedback.getRequest(WORK, id)!;
      assert.equal(after.state, ending === "cancel" ? "cancelled" : "needs_attention");
      assert.equal(after.error?.code, ending === "cancel" ? undefined : "REQUEST_EXPIRED");
      assert.equal(reads, 1); assert.deepEqual(after.waitRef, before.waitRef);
      assert.equal(after.autoRunCount, 1); assert.equal(f.controlled.contexts.length, 1);
      assert.equal(f.store.activeRun(WORK), undefined); assert.equal(f.counts().posts, 1);
    } finally { await f.close(); }
  }
});

test("matching result facts reconcile only the registered Job; cancel and deadline prevent late revival", async () => {
  for (const ending of ["fact", "cancel", "deadline"] as const) {
    const f = await fixture(); try {
      const id = f.receive(`wait-${ending}`); f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
      const run = f.store.activeRun(WORK)!;
      await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
      await f.flow.invoke("brain_feedback", { operation: "wait", waitRef: { kind: "job", serviceName: "todo", id: "job-original", deadlineAt: new Date(f.now().getTime() + 60000).toISOString(), nextPhase: "verifying", verificationGoal: "Read original export" } });
      f.controlled.release(run.runId); await f.runs.wait(run.runId);
      f.advance(1000); await f.loop.tick(); const before = f.counts().jobReads;
      if (ending === "cancel") f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
      if (ending === "deadline") f.advance(61000);
      f.job("succeeded");
      const event = { ...f.event(`result-${ending}`, "job.finished"), actionId: "export-original", jobId: "job-original", causationRequestId: id };
      f.store.feedback.receiveEvent(event, ["review"], f.now().toISOString()); f.loop.notify(event); await ready(); await ready(); await f.loop.tick();
      if (ending === "fact") {
        assert.equal(f.counts().jobReads, before, "matching fact shares the recent query's throttle window");
        f.advance(BRAIN_LIMITS.pollMs); await f.loop.tick();
        for (let i = 0; i < 50 && f.counts().jobReads <= before; i++) await new Promise((done) => setTimeout(done, 10));
        for (let i = 0; i < 50 && !f.store.activeRun(WORK); i++) await new Promise((done) => setTimeout(done, 10));
        assert.ok(f.counts().jobReads > before, "matching fact still GETs the original Job when eligible");
        assert.equal(f.store.activeRun(WORK)?.sourceJson && JSON.parse(f.store.activeRun(WORK)!.sourceJson!).phase, "verifying");
      } else { assert.equal(f.store.activeRun(WORK), undefined); assert.ok(["cancelled", "needs_attention", "failed"].includes(f.store.feedback.getRequest(WORK, id)!.state)); }
      assert.equal(f.counts().posts, 1); assert.equal(f.store.feedback.listRequests(WORK).items.length, 1, "result facts do not spawn recursive requests");
    } finally { await f.close(); }
  }
});

function onRetryObservationReturn(f: Awaited<ReturnType<typeof fixture>>, kind: "action" | "job" | "capabilities" | "query", after: () => void | Promise<void>) {
  if (kind === "action" || kind === "job") { onObservationReturn(f, kind, after); return; }
  if (kind === "capabilities") {
    const native = f.client.discover.bind(f.client);
    f.client.discover = async (...args) => { const result = await native(...args); await after(); return result; };
  } else {
    const native = f.client.query.bind(f.client);
    f.client.query = async (...args) => { const result = await native(...args); await after(); return result; };
  }
}

test("Retry rejects a Job owned by another Action or a replaced Job before admission and verified evidence", async () => {
  for (const state of ["running", "succeeded"]) for (const mismatch of ["action", "job"]) {
    const f = await fixture(); try {
      const { id } = await originalWait(f, "job");
      f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
      const retry = f.store.feedback.retry(WORK, id, `retry-${state}-${mismatch}`, f.now().toISOString());
      const original = f.store.feedback.internal(WORK, retry.requestId)!.actionRefs;
      const head = f.store.feedback.experienceSnapshot(WORK);
      f.job(state);
      if (mismatch === "action") f.jobAction("export-another");
      else f.actions.set("export-original", { ...f.actions.get("export-original") as object, jobId: "job-replaced" });
      f.advance(1000); await f.loop.tick(); await ready();
      const after = f.store.feedback.internal(WORK, retry.requestId)!;
      assert.equal(after.request.state, "needs_attention"); assert.equal(after.request.error?.code, "INVALID_WAIT");
      assert.equal(after.request.autoRunCount, 0); assert.equal(f.store.activeRun(WORK), undefined);
      assert.deepEqual(after.actionRefs, original); assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "cancelled");
      assert.equal(f.store.feedback.listEvidence(WORK, retry.requestId).items.some((e) => e.kind === "job" && e.verified), false);
      assert.deepEqual(f.store.feedback.experienceSnapshot(WORK), head);
      assert.equal(f.controlled.contexts.length, 1); assert.equal(f.counts().posts, 1);
    } finally { await f.close(); }
  }
});

test("Retry keeps the registered Job when its Action omits it, then verifies completion and experience without mutation replay", async () => {
  for (const omitted of [false, true]) {
    const f = await fixture(); try {
      const { id } = await originalWait(f, "job");
      f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
      const retry = f.store.feedback.retry(WORK, id, `retry-job-${omitted}`, f.now().toISOString());
      if (omitted) f.actions.set("export-original", { ...f.actions.get("export-original") as object, jobId: null });
      f.advance(1000); await f.loop.tick(); await ready();
      const waiting = f.store.feedback.getRequest(WORK, retry.requestId)!;
      assert.equal(waiting.state, "waiting_result"); assert.equal(waiting.waitRef?.kind, "job"); assert.equal(waiting.waitRef?.id, "job-original");
      assert.equal(waiting.autoRunCount, 0); assert.equal(f.store.activeRun(WORK), undefined);
      f.job("succeeded"); f.advance(BRAIN_LIMITS.pollMs); await f.loop.tick(); await ready();
      const run = f.store.activeRun(WORK)!;
      assert.equal(f.store.feedback.getRequest(WORK, retry.requestId)?.source.phase, "verifying");
      const proof = await f.flow.invoke("brain_service", { operation: "verify", serviceName: "todo", name: "review" }) as { evidence: { evidenceId: string } };
      await f.flow.invoke("brain_experience", { operation: "stage", entry: { entryId: "retry-original-export", scope: "service:todo", rule: "Verify the original export Job", evidenceIds: [proof.evidence.evidenceId] } });
      await f.flow.invoke("brain_feedback", { operation: "finish", state: "completed", evidenceIds: [proof.evidence.evidenceId] });
      f.controlled.release(run.runId); await f.runs.wait(run.runId);
      assert.equal(f.store.feedback.getRequest(WORK, retry.requestId)?.state, "completed");
      assert.equal(f.store.feedback.getRequest(WORK, retry.requestId)?.autoRunCount, 1);
      assert.equal(f.store.feedback.internal(WORK, retry.requestId)?.actionRefs[0]?.jobId, "job-original");
      assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "cancelled"); assert.equal(f.counts().posts, 1);
      assert.equal(f.store.feedback.experienceSnapshot(WORK).entries[0]?.rule, "Verify the original export Job");
    } finally { await f.close(); }
  }
});

test("Retry rechecks its fresh deadline after every original-effect observation, including ongoing effects", async () => {
  for (const kind of ["action", "job", "capabilities", "query"] as const) for (const offset of [-1, 0, 1]) {
    const f = await fixture(); try {
      const { id } = await originalWait(f, "job");
      f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
      const retry = f.store.feedback.retry(WORK, id, `retry-${kind}-${offset}`, f.now().toISOString());
      const deadline = Date.parse(retry.expiresAt);
      f.advance(deadline - 1000 - f.now().getTime());
      if (kind === "query") f.job("succeeded");
      onRetryObservationReturn(f, kind, () => { f.advance(deadline + offset - f.now().getTime()); });
      await f.loop.tick(); await ready();
      const current = f.store.feedback.getRequest(WORK, retry.requestId)!;
      assert.equal(current.state, offset < 0 ? kind === "query" ? "running" : "waiting_result" : "needs_attention", `${kind}/${offset}`);
      assert.equal(current.error?.code, offset < 0 ? undefined : "REQUEST_EXPIRED");
      assert.equal(current.autoRunCount, offset < 0 && kind === "query" ? 1 : 0);
      assert.equal(f.controlled.contexts.length, offset < 0 && kind === "query" ? 2 : 1);
      assert.equal(current.expiresAt, retry.expiresAt);
      if (offset >= 0) assert.deepEqual(current.waitRef, retry.waitRef, "the prior wait stays historical; no new wait is registered");
      else if (kind !== "query") assert.equal(current.waitRef?.deadlineAt, retry.expiresAt);
      assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "cancelled");
      assert.equal(f.counts().posts, 1, "Retry only observes the original Action");
    } finally { await f.close(); }
  }
});

test("Retry observation returns preserve cancellation, terminal and historical state, and lifecycle admission", async () => {
  for (const kind of ["action", "job", "capabilities", "query"] as const) for (const outcome of ["cancelled", "terminal", "historical", "draining"] as const) {
    const f = await fixture(); try {
      const { id } = await originalWait(f, "job");
      f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
      const retry = f.store.feedback.retry(WORK, id, `retry-${kind}-${outcome}`, f.now().toISOString());
      f.advance(1000); if (kind === "query") f.job("succeeded");
      onRetryObservationReturn(f, kind, async () => {
        if (outcome === "cancelled") f.store.feedback.cancel(WORK, retry.requestId, undefined, f.now().toISOString());
        if (outcome === "terminal") f.store.feedback.finish(WORK, retry.requestId, "needs_attention", null, { code: "PRIOR_TERMINAL", message: "Already settled" }, [], f.now().toISOString());
        if (outcome === "historical") { const db = new DatabaseSync(join(f.root, "work.sqlite")); try { db.prepare("UPDATE agent_requests SET disposition='historical' WHERE request_id=?").run(retry.requestId); } finally { db.close(); } }
        if (outcome === "draining") await f.daemon.drain();
      });
      await f.loop.tick(); await ready();
      const current = f.store.feedback.getRequest(WORK, retry.requestId)!;
      assert.equal(current.state, outcome === "cancelled" ? "cancelled" : outcome === "terminal" ? "needs_attention" : "pending", `${kind}/${outcome}`);
      assert.equal(current.error?.code, outcome === "terminal" ? "PRIOR_TERMINAL" : undefined);
      assert.equal(current.disposition, outcome === "historical" ? "historical" : "live");
      assert.deepEqual(current.waitRef, retry.waitRef); assert.equal(current.expiresAt, retry.expiresAt);
      assert.equal(current.autoRunCount, 0); assert.equal(f.controlled.contexts.length, 1); assert.equal(f.store.activeRun(WORK), undefined);
      assert.equal(f.counts().posts, 1);
    } finally { await f.close(); }
  }
});

test("owner Retry waits for an ongoing original Job without accepting a new model Run or reposting", async () => {
  const f = await fixture(); try {
    const id = f.receive("original-retry"); f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
    const run = f.store.activeRun(WORK)!;
    await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
    await f.flow.invoke("brain_feedback", { operation: "wait", waitRef: { kind: "job", serviceName: "todo", id: "job-original", deadlineAt: new Date(f.now().getTime() + 60000).toISOString(), nextPhase: "verifying", verificationGoal: "Original export" } });
    f.controlled.release(run.runId); await f.runs.wait(run.runId); f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
    const retry = f.store.feedback.retry(WORK, id, "retry-running-job", f.now().toISOString());
    f.advance(1000); await f.loop.tick();
    assert.equal(f.store.feedback.getRequest(WORK, retry.requestId)?.state, "waiting_result");
    assert.equal(f.store.feedback.getRequest(WORK, retry.requestId)?.autoRunCount, 0); assert.equal(f.store.activeRun(WORK), undefined);
    f.job("succeeded"); f.advance(5000); await f.loop.tick(); await ready();
    assert.equal(JSON.parse(f.store.activeRun(WORK)!.sourceJson!).phase, "verifying"); assert.equal(f.counts().posts, 1);
  } finally { await f.close(); }
});

test("initialization and drain admit no model; recovery preserves waits and never replays an interrupted prompt", async () => {
  const f = await fixture(); try {
    const id = f.receive("pending-init");
    f.daemon.configure({ modelCredentialStatus: "available", contextIdentity: "context-current", loadedSkills: [], resolvedTools: tools, initializationComplete: true, initializationOnly: true });
    f.loop.start(); f.advance(1000); await f.loop.tick(); assert.equal(f.controlled.contexts.length, 0);
    f.daemon.configure({ modelCredentialStatus: "available", contextIdentity: "context-current", loadedSkills: [], resolvedTools: tools, initializationComplete: true });
    await f.loop.tick(); await ready(); const run = f.store.activeRun(WORK)!;
    await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
    assert.equal(f.runs.recover()[0]?.state, "interrupted"); assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "pending");
    f.controlled.release(run.runId); await f.runs.wait(run.runId); f.advance(1000); await f.loop.tick();
    assert.equal(f.controlled.contexts.length, 1, "interrupted original prompt is not replayed"); assert.equal(f.counts().posts, 1);
    assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "waiting_result");
    const pending = f.receive("pending-drain"); await f.runs.drain(50); await f.loop.tick();
    assert.equal(f.store.feedback.getRequest(WORK, pending)?.state, "pending"); assert.equal(f.controlled.contexts.length, 1);
  } finally { await f.close(); }
});

test("interruption before wait reconciles terminal, ongoing and unprovable original effects without replay", async () => {
  for (const result of ["terminal", "running", "missing", "mismatch", "cancel", "expiry", "drain"] as const) {
    const f = await fixture(); try {
      const id = f.receive(`recover-${result}`); f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
      const old = f.store.activeRun(WORK)!;
      await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
      f.runs.recover(); f.controlled.release(old.runId); await f.runs.wait(old.runId);
      assert.equal(f.store.getRun(old.runId)?.state, "interrupted");
      assert.equal(f.store.feedback.getRequest(WORK, id)?.waitRef, null);
      if (result === "terminal") f.job("succeeded");
      if (result === "missing") f.actions.clear();
      if (result === "mismatch") f.actions.set("export-original", { ...(f.actions.get("export-original") as object), input: { forged: true } });
      if (result === "cancel" || result === "expiry" || result === "drain") {
        const read = f.client.readAction.bind(f.client);
        f.client.readAction = async (...args) => {
          const actual = await read(...args);
          if (result === "cancel") f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString());
          else if (result === "expiry") f.advance(BRAIN_LIMITS.requestTimeoutMs);
          else void f.daemon.drain();
          return actual;
        };
      }
      f.advance(1000); await f.loop.tick(); await ready();
      const recovered = f.store.feedback.getRequest(WORK, id)!;
      assert.equal(f.counts().posts, 1); assert.equal(f.store.getRun(old.runId)?.state, "interrupted");
      if (result === "terminal") {
        assert.equal(recovered.state, "running"); assert.equal(recovered.source.phase, "verifying"); assert.equal(recovered.autoRunCount, 2);
        const run = f.store.activeRun(WORK)!;
        assert.notEqual(f.controlled.contexts.at(-1)?.prompt, f.controlled.contexts[0]?.prompt);
        const proof = await f.flow.invoke("brain_service", { operation: "verify", serviceName: "todo", name: "review" }) as { evidence: { evidenceId: string } };
        await f.flow.invoke("brain_feedback", { operation: "finish", state: "completed", evidenceIds: [proof.evidence.evidenceId] });
        f.controlled.release(run.runId); await f.runs.wait(run.runId);
        assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "completed");
      } else {
        assert.equal(recovered.autoRunCount, 1); assert.equal(f.controlled.contexts.length, 1);
        assert.equal(recovered.state, result === "running" ? "waiting_result" : result === "cancel" ? "cancelled" : result === "drain" ? "pending" : "needs_attention");
        if (result === "running") assert.equal(recovered.waitRef?.id, "job-original");
        if (result === "expiry") assert.equal(recovered.error?.code, "REQUEST_EXPIRED");
      }
    } finally { await f.close(); }
  }
});

test("unavailable fixed targets need a new explicit goal without admitting a Run", async () => {
  for (const unavailable of [true]) {
    const f = await fixture();
    let polls = 0;
    const loop = new BrainLoop(WORK, f.store, f.daemon, f.runs, f.sessions, f.registry, f.client,
      { async poll() { polls++; return { state: "ready" as const, id: "operation-original" }; } }, f.now);
    try {
      const session = f.sessions.create("candidate-source");
      const run = f.store.acceptRun({ workId: WORK, sessionId: session.sessionId, submissionKey: "candidate", requestDigest: "candidate", promptDigest: "candidate", contextIdentity: "context-current", now: f.now().toISOString() }).run;
      const request = f.store.feedback.ensureChatRequest(WORK, run.runId, "Verify new review format", f.now().toISOString());
      f.store.feedback.setPackageSubmission(WORK, request.requestId, { submissionKey: "original-key", requestId: request.requestId, verificationGoal: request.goal,
        expectedSourceDigest: `sha256:${"b".repeat(64)}`, activeDigest: `sha256:${"a".repeat(64)}`, desiredDigest: `sha256:${"a".repeat(64)}`, activeContextId: "context-current",
        ...({ verificationTarget: { contractVersion: 1, toolName: "package:piwork-brain:new_unavailable_tool", input: {}, checkNames: ["actual_behavior"] } }) });
      f.store.feedback.registerPackageWait(WORK, request.requestId, { kind: "apply", id: "operation-original", deadlineAt: new Date(f.now().getTime() + BRAIN_LIMITS.applyTimeoutMs).toISOString(), nextPhase: "adopting", verificationGoal: request.goal }, f.now().toISOString());
      f.store.completeRun(run.runId, "succeeded", "waiting", null, f.now().toISOString());
      loop.start(); f.advance(1000); await loop.tick();
      assert.equal(f.store.feedback.getRequest(WORK, request.requestId)?.state, "needs_attention");
      assert.equal(f.store.feedback.getRequest(WORK, request.requestId)?.error?.code, "VERIFICATION_REQUIRED");
      assert.equal(f.store.feedback.getRequest(WORK, request.requestId)?.autoRunCount, 0);
      assert.equal(f.controlled.contexts.length, 0); assert.equal(polls, 2);
      const retry = f.store.feedback.retry(WORK, request.requestId, "explicit-retry", f.now().toISOString());
      f.advance(5000); await loop.tick();
      assert.equal(f.store.feedback.getRequest(WORK, retry.requestId)?.state, "needs_attention", "Retry cannot invent a target or bypass current tool policy");
      assert.equal(f.controlled.contexts.length, 0);
    } finally { await loop.close(); await f.close(); }
  }
});

test("CoreFlow binds mutations only, scopes automatic Service access, and completion requires actual proof", async () => {
  const f = await fixture(); try {
    const session = f.sessions.create(), accepted = await f.runs.submitChat({ workId: WORK, sessionId: session.sessionId, submissionKey: "read", prompt: "Inspect current review" }); await ready();
    const observed = await f.flow.invoke("brain_service", { operation: "query", serviceName: "todo", name: "review" }) as { evidence: { evidenceId: string } };
    assert.equal(f.store.feedback.listRequests(WORK).items.length, 0);
    await assert.rejects(f.flow.invoke("brain_feedback", { operation: "finish", state: "completed", evidenceIds: [] }), FeedbackError);
    const goal = f.store.feedback.requestForRun(WORK, accepted.run.runId)!;
    assert.equal(f.store.feedback.getEvidence(WORK, observed.evidence.evidenceId)?.requestId, goal.request.requestId);
    await f.flow.invoke("brain_feedback", { operation: "finish", state: "completed", evidenceIds: [observed.evidence.evidenceId], result: "Actual review proved" });
    f.controlled.release(accepted.run.runId); await f.runs.wait(accepted.run.runId);
    assert.equal(f.store.feedback.getRequest(WORK, goal.request.requestId)?.state, "completed");
    const auto = f.receive("auto"); f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
    await assert.rejects(f.flow.invoke("brain_service", { operation: "query", serviceName: "other", name: "review" }), (e: unknown) => e instanceof FeedbackError && e.code === "MUTATION_NOT_ALLOWED");
    f.controlled.release(f.store.activeRun(WORK)!.runId); await f.runs.wait(f.controlled.contexts.at(-1)!.runId);
    assert.equal(f.store.feedback.getRequest(WORK, auto)?.state, "needs_attention", "Run succeeded without finish is not goal completion");
  } finally { await f.close(); }
});

test("one CoreLoop keeps busy goals pending, yields to Chat, and resumes an async Job by original ID without mutation replay", async () => {
  const f = await fixture(); try {
    const session = f.sessions.create(), manual = await f.runs.submitChat({ workId: WORK, sessionId: session.sessionId, submissionKey: "manual", prompt: "Continue chatting" }); await ready();
    const id = f.receive("export"); f.loop.start(); f.advance(2000); await f.loop.tick();
    assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "pending"); assert.equal(f.store.feedback.getRequest(WORK, id)?.autoRunCount, 0);
    f.store.feedback.receiveEvent(f.event("page", "page.visited"), ["review"], f.now().toISOString()); f.loop.notify(f.event("page", "page.visited"));
    assert.equal(f.store.feedback.listRequests(WORK).items.length, 1);
    f.controlled.release(manual.run.runId); await f.runs.wait(manual.run.runId); await f.loop.tick(); assert.equal(f.store.activeRun(WORK), undefined);
    f.advance(1000); await f.loop.tick(); await ready(); const first = f.store.activeRun(WORK)!;
    assert.equal(JSON.parse(first.actualModelJson!).modelRef, null);
    await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
    await f.flow.invoke("brain_feedback", { operation: "wait", waitRef: { kind: "job", serviceName: "todo", id: "job-original", deadlineAt: new Date(f.now().getTime() + 60000).toISOString(), nextPhase: "verifying", verificationGoal: "Verify original output" } });
    f.controlled.release(first.runId); await f.runs.wait(first.runId);
    assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "waiting_result"); assert.equal(f.store.activeRun(WORK), undefined);
    const autoSession = first.sessionId; f.store.setSessionModelPreference(WORK, autoSession, '{"modelRef":"different-next-model"}');
    const chat = await f.runs.submitChat({ workId: WORK, sessionId: session.sessionId, submissionKey: "while-job", prompt: "Chat while export runs" }); await ready();
    await f.loop.tick(); const reads = f.counts().jobReads; await f.loop.tick(); assert.equal(f.counts().jobReads, reads, "polls are bounded by the five-second tick");
    f.job("succeeded"); f.advance(5000); await f.loop.tick(); assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "pending");
    f.controlled.release(chat.run.runId); await f.runs.wait(chat.run.runId); f.advance(1000); await f.loop.tick(); await ready();
    const verify = f.store.activeRun(WORK)!; assert.equal(verify.sessionId, autoSession); assert.equal(JSON.parse(verify.actualModelJson!).modelRef, null, "automatic continuations ignore Session preference");
    assert.equal(f.store.feedback.getRequest(WORK, id)?.source.phase, "verifying");
    await assert.rejects(f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "replay-forbidden", input: {} }), FeedbackError);
    const proof = await f.flow.invoke("brain_service", { operation: "verify", serviceName: "todo", name: "review" }) as { evidence: { evidenceId: string } };
    await f.flow.invoke("brain_experience", { operation: "stage", entry: { entryId: "export-proof", scope: "service:todo", rule: "Always verify exported files", evidenceIds: [proof.evidence.evidenceId] } });
    await f.flow.invoke("brain_feedback", { operation: "finish", state: "completed", evidenceIds: [proof.evidence.evidenceId] });
    f.controlled.release(verify.runId); await f.runs.wait(verify.runId); f.advance(5000); await f.loop.tick();
    assert.equal(f.counts().posts, 1); assert.equal(f.store.feedback.getRequest(WORK, id)?.autoRunCount, 2); assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "completed");
    assert.equal(f.store.feedback.experienceSnapshot(WORK).entries[0]?.rule, "Always verify exported files");
  } finally { await f.close(); }
});

test("cancel waits for the active executor cleanup; Retry reconciles unknown original effects and historical cannot resume", async () => {
  const f = await fixture(); try {
    const id = f.receive("cancel"); f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
    const run = f.store.activeRun(WORK)!; const current = f.controlled.contexts.at(-1)!;
    f.store.feedback.cancel(WORK, id, undefined, f.now().toISOString()); f.runs.cancel(run.runId);
    assert.equal(current.signal.aborted, true); assert.equal(f.store.activeRun(WORK)?.state, "cancelling"); await f.loop.tick();
    assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "cancelling");
    f.controlled.release(run.runId); await f.runs.wait(run.runId); assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "cancelled");
    const retried = f.store.feedback.retry(WORK, id, "retry-original", f.now().toISOString());
    assert.deepEqual(f.store.feedback.retry(WORK, id, "retry-original", f.now().toISOString()), retried);
    f.advance(1000); await f.loop.tick(); await ready(); const retryRun = f.store.activeRun(WORK)!;
    assert.equal(f.store.feedback.getRequest(WORK, retried.requestId)?.source.phase, "handling");
    f.revoke(); f.controlled.release(retryRun.runId); await f.runs.wait(retryRun.runId);
    const deleted = f.receive("deleted"); f.advance(1000); await f.loop.tick(); assert.equal(f.store.feedback.getRequest(WORK, deleted)?.state, "needs_attention");
    assert.equal(f.counts().posts, 0);
  } finally { await f.close(); }
});

test("host checks canonical deny and confirmed Chat preferences carry the original instruction as evidence", async () => {
  const f = await fixture(tools.filter((name) => !name.endsWith(":brain_service"))); try {
    const session = f.sessions.create(), run = await f.runs.submitChat({ workId: WORK, sessionId: session.sessionId, submissionKey: "preference", prompt: "For future reviews, show overdue tasks first" }); await ready();
    await assert.rejects(f.flow.invoke("brain_service", { operation: "query", serviceName: "todo", name: "review" }), FeedbackError);
    const staged = await f.flow.invoke("brain_experience", { operation: "stage", userPreference: true,
      entry: { entryId: "overdue-first", scope: "work", rule: "Show overdue tasks first", evidenceIds: [] } }) as { evidenceIds: string[] };
    assert.equal(f.store.feedback.experienceSnapshot(WORK).version, 0);
    await f.flow.invoke("brain_experience", { operation: "commit", evidenceIds: staged.evidenceIds });
    assert.match(f.store.feedback.getEvidence(WORK, staged.evidenceIds[0]!)!.summary, /Original user instruction/);
    f.controlled.release(run.run.runId); await f.runs.wait(run.run.runId); assert.equal(f.store.feedback.experienceSnapshot(WORK).entries[0]?.rule, "Show overdue tasks first");
    const unavailable = f.receive("no-tools"); f.loop.start(); f.advance(1000); await f.loop.tick(); assert.equal(f.store.feedback.getRequest(WORK, unavailable)?.error?.code, "BRAIN_UNAVAILABLE");
  } finally { await f.close(); }
});

test("Memory receipts distinguish a pinned Run from commit, and read-only calls do not create goals", async () => {
  const f=await fixture();try {
    const session=f.sessions.create();
    const first=await f.runs.submitChat({workId:WORK,sessionId:session.sessionId,submissionKey:"remember",prompt:"Use dark theme for future reviews"});await ready();
    assert.deepEqual((await f.flow.invoke("brain_experience",{operation:"recall",query:"theme"}) as {items:unknown[]}).items,[]);
    assert.equal(f.store.feedback.listRequests(WORK).items.length,0);
    const staged=await f.flow.invoke("brain_experience",{operation:"stage",userPreference:true,entry:{entryId:"theme",scope:"work",rule:"Use dark theme",evidenceIds:[]}}) as {evidenceIds:string[]};
    const committed=await f.flow.invoke("brain_experience",{operation:"commit",evidenceIds:staged.evidenceIds}) as {memoryCommit:{version:number}};
    assert.ok(committed.memoryCommit.version>0);
    assert.deepEqual((await f.flow.invoke("brain_experience",{operation:"recall",query:"theme"}) as {items:unknown[]}).items,[],"the accepted Run keeps version zero after its own commit");
    f.controlled.release(first.run.runId);await f.runs.wait(first.run.runId);
    const next=await f.runs.submitChat({workId:WORK,sessionId:session.sessionId,submissionKey:"next",prompt:"Read theme preference"});await ready();
    const read=await f.flow.invoke("brain_experience",{operation:"read",entryId:"theme"}) as {status:string,entry:{rule:string}};
    assert.equal(read.status,"effective");assert.equal(read.entry.rule,"Use dark theme");
    await assert.rejects(f.flow.invoke("brain_experience",{operation:"revise",entry:{entryId:"theme",scope:"work",rule:"Use light theme",evidenceIds:[]}}),/expected Memory version/);
    await assert.rejects(f.flow.invoke("brain_experience",{operation:"revise",expectedVersion:null,entry:{entryId:"theme",scope:"work",rule:"Use light theme",evidenceIds:[]}}),/expected Memory version/);
    await assert.rejects(f.flow.invoke("brain_experience",{operation:"recall",query:"theme",limit:"10"}),/limit must be an integer/);
    const invalid=await f.flow.invoke("brain_experience",{operation:"invalidate",entryId:"theme",expectedVersion:committed.memoryCommit.version,reason:"User withdraws the preference",evidenceIds:[],userPreference:true}) as {evidenceIds:string[]};
    await f.flow.invoke("brain_experience",{operation:"commit",evidenceIds:invalid.evidenceIds});
    assert.equal((await f.flow.invoke("brain_experience",{operation:"read",entryId:"theme"}) as {status:string}).status,"effective");
    f.controlled.release(next.run.runId);await f.runs.wait(next.run.runId);
    const after=await f.runs.submitChat({workId:WORK,sessionId:f.sessions.create().sessionId,submissionKey:"after",prompt:"Read theme preference"});await ready();
    assert.equal((await f.flow.invoke("brain_experience",{operation:"read",entryId:"theme"}) as {status:string}).status,"invalidated");
    const count=f.store.feedback.listRequests(WORK).items.length;
    await f.flow.invoke("brain_experience",{operation:"read",entryId:"missing"});
    await assert.rejects(f.flow.invoke("brain_experience",{operation:"recall",query:"theme",limit:0}));
    assert.equal(f.store.feedback.listRequests(WORK).items.length,count);
    f.controlled.release(after.run.runId);await f.runs.wait(after.run.runId);
  }finally {await f.close();}
});

test("automatic Memory recall/read and writes stay within the original Service scope",async()=>{
 const f=await fixture();try{
  const first=await f.runs.submitChat({workId:WORK,sessionId:f.sessions.create().sessionId,submissionKey:"foreign-scope",prompt:"Remember other Service preference"});await ready();
  const staged=await f.flow.invoke("brain_experience",{operation:"stage",userPreference:true,entry:{entryId:"other-rule",scope:"service:other",rule:"Use the other review",evidenceIds:[]}}) as {evidenceIds:string[]};
  await f.flow.invoke("brain_experience",{operation:"commit",evidenceIds:staged.evidenceIds});f.controlled.release(first.run.runId);await f.runs.wait(first.run.runId);
  f.receive("scope");f.loop.start();f.advance(1000);await f.loop.tick();await ready();const run=f.store.activeRun(WORK)!;
  assert.deepEqual((await f.flow.invoke("brain_experience",{operation:"recall",query:"review"}) as {items:unknown[]}).items,[]);
  await assert.rejects(f.flow.invoke("brain_experience",{operation:"read",entryId:"other-rule"}),/scope/);
  await assert.rejects(f.flow.invoke("brain_experience",{operation:"recall",query:"review",serviceName:"other"}),/scope/);
  await assert.rejects(f.flow.invoke("brain_experience",{operation:"revise",expectedVersion:run.adoptedExperienceVersion,entry:{entryId:"other-rule",scope:"service:other",rule:"Changed",evidenceIds:[]}}),/scope/);
  f.controlled.release(run.runId);await f.runs.wait(run.runId);
 }finally{await f.close();}
});

test("automatic Run budget aborts execution but retains the slot until cleanup and cannot add an accepted queue", async (t) => {
  const f = await fixture(); try {
    const id = f.receive("budget"); f.loop.start(); f.advance(1000); await f.loop.tick(); await ready();
    const run = f.store.activeRun(WORK)!; const context = f.controlled.contexts.at(-1)!;
    // The execution timer was created before fake timers; replace only this test's Run with one admitted under the timer clock.
    f.runs.cancel(run.runId); f.controlled.release(run.runId); await f.runs.wait(run.runId); await f.loop.close();
    const retry = f.store.feedback.retry(WORK, id, "budget-retry", f.now().toISOString());
    const session = f.sessions.create(); t.mock.timers.enable({ apis: ["setTimeout"] });
    const timed = await f.runs.submitAutomatic({ workId: WORK, sessionId: session.sessionId, submissionKey: "budget-run", prompt: "Budget bounded handling", requestId: retry.requestId, phase: "verifying" }); await ready();
    f.advance(BRAIN_LIMITS.runTimeoutMs); t.mock.timers.tick(BRAIN_LIMITS.runTimeoutMs);
    assert.equal(f.controlled.contexts.at(-1)!.signal.aborted, true); assert.equal(f.store.activeRun(WORK)?.runId, timed.run.runId);
    f.controlled.release(timed.run.runId); const failed = await f.runs.wait(timed.run.runId); assert.equal(failed.state, "failed");
    assert.match(failed.errorJson!, /REQUEST_BUDGET_EXCEEDED/); assert.equal(f.store.feedback.getRequest(WORK, retry.requestId)?.error?.code, "REQUEST_BUDGET_EXCEEDED");
    assert.equal(context.signal.aborted, true); t.mock.timers.reset();
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("equal Job/request deadlines and stopped time consistently need attention without late revival", async () => {
  for (const stopped of [false, true]) {
    const f = await fixture(); try {
      const id = f.receive(`equal-expiry-${stopped}`);
      f.advance(BRAIN_LIMITS.requestTimeoutMs - 60000); f.loop.start(); await f.loop.tick(); await ready();
      const run = f.store.activeRun(WORK)!;
      await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
      await f.flow.invoke("brain_feedback", { operation: "wait", waitRef: { kind: "job", serviceName: "todo", id: "job-original", deadlineAt: new Date(f.now().getTime() + 60000).toISOString(), nextPhase: "verifying", verificationGoal: "Original export" } });
      f.controlled.release(run.runId); await f.runs.wait(run.runId);
      const goal = f.store.feedback.getRequest(WORK, id)!;
      assert.equal(goal.waitRef?.deadlineAt, goal.expiresAt);
      if (stopped) await f.loop.close();
      f.advance(60000); if (stopped) f.loop.start();
      await f.loop.tick();
      assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "needs_attention");
      assert.equal(f.store.feedback.getRequest(WORK, id)?.error?.code, "REQUEST_EXPIRED");
      f.job("succeeded"); f.advance(5000); await f.loop.tick();
      assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "needs_attention");
      assert.equal(f.controlled.contexts.length, 1); assert.equal(f.counts().posts, 1);
    } finally { await f.close(); }
  }
});

test("request expiry aborts the SDK and waits for cleanup before effect-aware goal settlement", async (t) => {
  for (const effect of [false, true]) {
    const f = await fixture(); try {
      const id = f.receive(`active-expiry-${effect}`); f.advance(BRAIN_LIMITS.requestTimeoutMs - 1000);
      t.mock.timers.enable({ apis: ["setTimeout"] }); f.loop.start(); await f.loop.tick(); await ready();
      const run = f.store.activeRun(WORK)!;
      await f.loop.close();
      if (effect) await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {} });
      f.advance(1000); t.mock.timers.tick(1000);
      assert.equal(f.controlled.contexts.at(-1)?.signal.aborted, true);
      assert.equal(f.store.activeRun(WORK)?.runId, run.runId);
      assert.equal(f.store.feedback.getRequest(WORK, id)?.state, "running");
      f.controlled.release(run.runId); await f.runs.wait(run.runId);
      assert.equal(f.store.activeRun(WORK), undefined);
      assert.equal(f.store.feedback.getRequest(WORK, id)?.state, effect ? "needs_attention" : "failed");
      assert.equal(f.store.feedback.getRequest(WORK, id)?.error?.code, "REQUEST_EXPIRED");
      assert.equal(f.counts().posts, effect ? 1 : 0);
    } finally { t.mock.timers.reset(); await f.close(); }
  }
});

test("Chat-origin Job continuation uses a compatible automatic Session and retains the original user Run", async () => {
  const f = await fixture();
  try {
    const manualSession = f.sessions.create("user-chat");
    const manual = await f.runs.submitChat({ workId: WORK, sessionId: manualSession.sessionId, submissionKey: "user-export", prompt: "Export my review" });
    await ready();
    const accepted = await f.flow.invoke("brain_service", { operation: "action", serviceName: "todo", name: "export", id: "export-original", input: {}, expectedStateVersion: null }) as { result: { jobId: string } };
    const goal = f.store.feedback.requestForRun(WORK, manual.run.runId)!;
    await f.flow.invoke("brain_feedback", { operation: "wait", waitRef: { kind: "job", serviceName: "todo", id: accepted.result.jobId,
      deadlineAt: new Date(f.now().getTime()+60000).toISOString(), nextPhase: "verifying", verificationGoal: "Confirm original export" } });
    f.controlled.release(manual.run.runId);await f.runs.wait(manual.run.runId);
    f.job("succeeded");f.loop.start();f.advance(5000);await f.loop.tick();await ready();
    const continuation=f.store.activeRun(WORK)!;
    assert.ok(continuation);assert.notEqual(continuation.sessionId,manualSession.sessionId);
    assert.equal(f.store.getSession(WORK,continuation.sessionId)?.contextIdentity,"context-current");
    assert.deepEqual(JSON.parse(f.store.getSession(WORK,continuation.sessionId)!.sourceJson!),{kind:"service"});
    assert.equal(JSON.parse(continuation.sourceJson!).kind,"chat");
    const current=f.store.feedback.internal(WORK,goal.request.requestId)!;
    assert.equal(current.sourceRunId,manual.run.runId);
    assert.ok(current.request.runIds.includes(manual.run.runId));assert.ok(current.request.runIds.includes(continuation.runId));
    assert.equal(f.store.getRun(manual.run.runId)?.sessionId,manualSession.sessionId);
    assert.equal(JSON.parse(continuation.actualModelJson!).modelRef,null);
    f.controlled.release(continuation.runId);await f.runs.wait(continuation.runId);
  } finally {await f.close();}
});
