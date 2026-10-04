import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type ServiceCapabilities, type ServiceInteractionBinding } from "@piwork/contracts";
import { FeedbackError, WorkStore } from "@piwork/work-store";
import { ServiceBindingRegistry, ServiceInteractionClient } from "./service-interaction.js";

const workId = "work-1111111111111111", serviceId = "service-1111111111111111";
const capabilities: ServiceCapabilities = { contractVersion: 1, logicalServiceName: "todo", codeVersion: "code1", stateVersion: "v1",
  queries: { review: { description: "Read actual review", inputSchema: { type: "object", properties: {}, additionalProperties: false } } },
  actions: { update: { description: "Change todo", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
    mutation: true, requiresExpectedStateVersion: true, verificationQuery: "review", mode: "sync", maxWaitMs: 60000 },
    export: { description: "Export asynchronously", inputSchema: { type: "object", properties: {}, additionalProperties: false },
      mutation: true, requiresExpectedStateVersion: false, verificationQuery: "review", mode: "async", maxWaitMs: 60000 } },
  events: { facts: ["page.visited", "todo.updated", "job.finished"], requestReasons: ["review"] }, jobs: true };
export const TEST_SERVICE_CAPABILITIES = capabilities;

test("actual HTTP capabilities, state guards, lost Action replies and async Jobs produce scoped evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-service-client-")); const store = WorkStore.open(join(root, "history.sqlite"));
  let postCount = 0, lost = true, inaccessible = false, badCapabilities = false, jobState = "running", jobActionId = "action-export";
  const actions = new Map<string, unknown>();
  const server = createServer(async (request, response) => {
    if (inaccessible && request.url !== "/pi/v1/capabilities") { response.destroy(); return; }
    assert.equal(request.headers.authorization, `Bearer ${"a".repeat(64)}`);
    response.setHeader("content-type", "application/json");
    if (request.url === "/pi/v1/capabilities") { response.end(JSON.stringify(badCapabilities ? { ...capabilities, endpoint: "http://outside/" } : capabilities)); return; }
    if (request.url?.startsWith("/pi/v1/queries/")) { response.end(JSON.stringify({ stateVersion: "v2", codeVersion: "code1", observedAt: new Date().toISOString(), value: { title: "updated" }, checks: [{ name: "goal", passed: true, summary: "actual title" }] })); return; }
    if (request.method === "POST") {
      postCount++; const input = await body(request);
      if (input.expectedStateVersion === "old") { response.statusCode = 409; response.end('{"code":"ACTION_STATE_CONFLICT"}'); return; }
      const name = request.url?.split("/").at(-1);
      const result = { actionId: input.actionId, actionName: name, input: input.input, expectedStateVersion: input.expectedStateVersion,
        state: name === "export" ? "accepted" : "succeeded", stateVersion: "v2", observedAt: new Date().toISOString(), ...(name === "export" ? { jobId: "job-export" } : { result: { title: "updated" } }) };
      actions.set(String(input.actionId), result);
      if (lost && name === "update") { lost = false; response.destroy(); return; }
      response.end(JSON.stringify(result)); return;
    }
    if (request.url?.startsWith("/pi/v1/actions/")) {
      const result = actions.get(request.url.split("/").at(-1)!); response.statusCode = result ? 200 : 404; response.end(JSON.stringify(result ?? { code: "NOT_FOUND" })); return;
    }
    if (request.url?.startsWith("/pi/v1/jobs/")) { response.end(JSON.stringify({ jobId: "job-export", actionId: jobActionId, state: jobState, observedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 60000).toISOString(), artifacts: jobState === "succeeded" ? ["exports/todo.json"] : [] })); return; }
    response.statusCode = 404; response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address !== "string");
  const binding: ServiceInteractionBinding = { workId, serviceId, serviceName: "todo", containerId: "container-one", address: "127.0.0.1", token: "a".repeat(64), ports: [{ name: "api", port: address.port, protocol: "tcp" }] };
  const registry = new ServiceBindingRegistry(workId, { async bindings() { return { workId, bindings: [binding] }; } });
  try {
    await mkdir(join(root, ".pi", "services"), { recursive: true }); await writeFile(join(root, ".pi", "services", "todo.json"), JSON.stringify({ contractVersion: 1, serviceName: "todo", apiPortName: "api", mode: "pi-managed" }));
    store.createSession({ workId, sessionId: "session-one", sdkHistoryPath: join(root, "history.jsonl"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const run = store.acceptRun({ workId, sessionId: "session-one", promptDigest: "digest", requestDigest: "digest", submissionKey: "run" });
    const goal = store.feedback.ensureChatRequest(workId, run.run.runId, "Update the todo and verify its state");
    const context = { runId: run.run.runId, requestId: goal.requestId, automatic: false };
    const client = new ServiceInteractionClient(root, registry, store.feedback);
    assert.equal((await client.discover("todo")).mode, "pi-managed");
    badCapabilities = true; await assert.rejects(client.discover("todo"), (e: unknown) => e instanceof FeedbackError && e.code === "SERVICE_CAPABILITY_INVALID"); badCapabilities = false;
    const result = await client.action(context, "todo", "update", "action-one", { title: "updated" }, "v1");
    assert.equal(result.result.state, "succeeded"); assert.equal(result.evidence.verified, true); assert.equal(postCount, 1);
    await client.action(context, "todo", "update", "action-one", { title: "updated" }, "v1"); assert.equal(postCount, 1);
    await assert.rejects(client.action(context, "todo", "update", "action-one", { title: "different" }, "v1"), (e: unknown) => e instanceof FeedbackError && e.code === "ACTION_IDEMPOTENCY_CONFLICT");
    await assert.rejects(client.action(context, "todo", "update", "old-state", { title: "updated" }, "old"), (e: unknown) => e instanceof FeedbackError && e.code === "ACTION_STATE_CONFLICT");
    await assert.rejects(client.action(context, "todo", "update", "invalid-input", { title: 3 }, "v1"), (e: unknown) => e instanceof FeedbackError && e.code === "SERVICE_CAPABILITY_INVALID");
    const query = await client.query(context, "todo", "review", {}); assert.equal(query.evidence.verified, true);
    assert.equal(store.feedback.finish(workId, goal.requestId, "completed", "Actual state verified", null, [query.evidence.evidenceId]), true);
    store.completeRun(run.run.runId, "succeeded", "done", null);
    const next = store.acceptRun({ workId, sessionId: "session-one", promptDigest: "next", requestDigest: "next", submissionKey: "next" });
    const exportGoal = store.feedback.ensureChatRequest(workId, next.run.runId, "Export todo and verify output"); const exporting = { ...context, runId: next.run.runId, requestId: exportGoal.requestId };
    const pending = await client.action(exporting, "todo", "export", "action-export", {}, null);
    assert.equal(pending.result.state, "accepted"); assert.equal(pending.evidence.verified, false);
    assert.equal((await client.job(exporting, "todo", "job-export")).evidence.verified, false);
    jobState = "succeeded"; assert.equal((await client.job(exporting, "todo", "job-export")).evidence.verified, true);
    jobActionId = "action-another";
    const beforeMismatch = store.feedback.listEvidence(workId, exportGoal.requestId);
    await assert.rejects(client.job(exporting, "todo", "job-export"), (e: unknown) => e instanceof FeedbackError && e.code === "INVALID_WAIT");
    assert.deepEqual(store.feedback.listEvidence(workId, exportGoal.requestId), beforeMismatch, "incorrectly owned Job is rejected before recording evidence");
    const observation = await client.job({ ...exporting, requestId: null }, "todo", "job-export");
    assert.equal(observation.result.actionId, "action-another"); assert.equal(observation.evidence.requestId, null, "unassociated read-only observation does not require an original Action");
    jobActionId = "action-export";
    assert.doesNotMatch(JSON.stringify(store.feedback.listEvidence(workId, exportGoal.requestId)), new RegExp(binding.token));
    inaccessible = true;
    await assert.rejects(client.action(exporting, "todo", "update", "unknown-action", { title: "changed" }, "v2"), (e: unknown) => e instanceof FeedbackError && e.code === "ACTION_RESULT_UNKNOWN");
    assert.equal(store.feedback.internal(workId, exportGoal.requestId)?.actionRefs.find((r) => r.actionId === "unknown-action")?.status, "unknown");
    inaccessible = false;
    await writeFile(join(root, ".pi", "services", "todo.json"), JSON.stringify({ contractVersion: 1, serviceName: "todo", apiPortName: "api", mode: "external" }));
    assert.deepEqual(await client.discover("todo"), { mode: "external", serviceName: "todo" });
    await assert.rejects(client.query(exporting, "todo", "review", {}), FeedbackError);
    await writeFile(join(root, ".pi", "services", "todo.json"), JSON.stringify({ contractVersion: 1, serviceName: "todo", apiPortName: "api", mode: "pi-managed", url: "http://outside/" }));
    await assert.rejects(client.discover("todo"), FeedbackError);
  } finally { store.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test("current Work binding authority fences rotation, revocation and cross Work; outage retains only validated identities", async () => {
  const first: ServiceInteractionBinding = { workId, serviceId, serviceName: "todo", token: "a".repeat(64), containerId: "c1", address: "127.0.0.1", ports: [] };
  let current = [first], unreachable = false, otherWork = false;
  const registry = new ServiceBindingRegistry(workId, { async bindings() { if (unreachable) throw new Error("Core unavailable"); return { workId: otherWork ? "foreign-work" : workId, bindings: current }; } });
  assert.equal((await registry.authenticate(first.token)).containerId, "c1");
  unreachable = true; assert.equal((await registry.authenticate(first.token)).containerId, "c1");
  await assert.rejects(registry.authenticate("b".repeat(64)));
  unreachable = false; current = [{ ...first, containerId: "c2", token: "b".repeat(64) }];
  await assert.rejects(registry.authenticate(first.token), (e: unknown) => e instanceof FeedbackError && e.code === "SERVICE_UNAUTHENTICATED");
  assert.equal((await registry.authenticate(current[0]!.token)).containerId, "c2");
  otherWork = true; await assert.rejects(registry.refresh(), FeedbackError); otherWork = false; current = [];
  await assert.rejects(registry.get("todo"), (e: unknown) => e instanceof FeedbackError && e.code === "SERVICE_UNAVAILABLE");
});
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
}
