import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type ServiceEvent, type ServiceInteractionBinding } from "@piwork/contracts";
import { WorkStore } from "@piwork/work-store";
import { ServiceBindingRegistry, ServiceInteractionClient } from "./service-interaction.js";
import { ServiceFeedbackServer } from "./service-feedback-server.js";

test("actual TLS receiver commits scoped receipts, normalizes page facts, fences origins, capacity and unavailable storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-feedback-tls-"));
  const certPath = join(root, "server.crt"), keyPath = join(root, "server.key");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=agentd",
    "-addext", "subjectAltName=DNS:agentd", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
  const workId = "work-1111111111111111", serviceId = "service-1111111111111111", token = "a".repeat(64), otherToken = "b".repeat(64);
  let brainAvailable = true, wakeCount = 0;
  const service = createServer((_request, response) => {
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ contractVersion: 1, logicalServiceName: "todo", codeVersion: "code1", stateVersion: "v1", queries: {}, actions: {}, events: { facts: ["page.visited", "todo.updated"], requestReasons: ["review"] }, jobs: false }));
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve)); const address = service.address(); assert.ok(address && typeof address !== "string");
  let bindings: ServiceInteractionBinding[] = [{ workId, serviceId, serviceName: "todo", containerId: "one", address: "127.0.0.1", token, ports: [{ name: "api", port: address.port, protocol: "tcp" }] },
    { workId, serviceId: "service-2222222222222222", serviceName: "other", containerId: "two", address: "127.0.0.1", token: otherToken, ports: [] }];
  const registry = new ServiceBindingRegistry(workId, { async bindings() { return { workId, bindings }; } });
  const store = WorkStore.open(join(root, "work.sqlite"));
  await mkdir(join(root, ".pi", "services"), { recursive: true }); await writeFile(join(root, ".pi", "services", "todo.json"), '{"contractVersion":1,"serviceName":"todo","apiPortName":"api","mode":"pi-managed"}');
  const server = new ServiceFeedbackServer(workId, { caCertificatePath: certPath, serverCertificatePath: certPath, serverPrivateKeyPath: keyPath, expectedClientCommonName: "core" },
    store, registry, new ServiceInteractionClient(root, registry, store.feedback), () => undefined, () => { wakeCount++; }, () => ({ available: brainAvailable, initializing: false }));
  const port = await server.start("127.0.0.1:0"), ca = await readFile(certPath);
  const send = (method: string, path: string, body?: unknown, bearer = token) => new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
    const request = httpsRequest({ host: "127.0.0.1", port, servername: "agentd", ca, method, path, agent: false,
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" } }, (response) => {
      const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.once("end", () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any> }));
    }); request.once("error", reject); request.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const event = (id: string, type = "agent.requested"): ServiceEvent => ({ contractVersion: 1, eventId: id, origin: { workId, serviceId }, serviceName: "todo", type,
    occurredAt: "2026-10-03T00:00:00Z", stateVersion: "v1", actor: "user", payload: type === "agent.requested" ? { reason: "review", goal: "Fix the review", evidenceRefs: [] } : { pathname: "/review?token=secret#hidden", dom: "never store" } });
  try {
    const visit = await send("POST", "/pi/v1/events", event("visit", "page.visited")); assert.equal(visit.status, 201); assert.equal(visit.body.requestId, null);
    assert.equal(store.feedback.listRequests(workId).items.length, 0); assert.deepEqual(store.feedback.listServiceEvents(workId, "todo").items[0]?.event.payload, { pathname: "/review" });
    const first = await send("POST", "/pi/v1/events", event("feedback")); assert.equal(first.status, 201); assert.ok(first.body.requestId);
    const again = await send("POST", "/pi/v1/events", event("feedback")); assert.equal(again.status, 200); assert.equal(again.body.requestId, first.body.requestId);
    const changed = await send("POST", "/pi/v1/events", { ...event("feedback"), stateVersion: "v2" }); assert.equal(changed.status, 409); assert.equal(changed.body.code, "SERVICE_EVENT_CONFLICT");
    assert.equal((await send("POST", "/pi/v1/events", { ...event("foreign"), origin: { workId: "work-9999999999999999", serviceId } })).status, 409);
    assert.equal((await send("POST", "/pi/v1/events", event("untrusted"), "c".repeat(64))).status, 401);
    assert.equal((await send("GET", `/pi/v1/requests/${first.body.requestId}`, undefined, otherToken)).status, 404);
    const receipt = await send("GET", `/pi/v1/requests/${first.body.requestId}`); assert.equal(receipt.body.request.state, "pending"); assert.equal(receipt.body.evidence[0]?.verified, false);
    assert.doesNotMatch(JSON.stringify(receipt.body), new RegExp(token));
    assert.equal((await send("POST", "/pi/v1/sessions/arbitrary/runs", {})).status, 404);
    assert.equal((await send("POST", "/pi/v1/events", { ...event("undeclared"), payload: { reason: "anything", goal: "Do it", evidenceRefs: [] } })).status, 400);
    assert.equal((await send("POST", "/pi/v1/events", { ...event("large"), payload: { reason: "review", goal: "x".repeat(70000), evidenceRefs: [] } })).status, 413);
    brainAvailable = false;
    assert.equal((await send("POST", "/pi/v1/events", event("feedback"))).status, 200);
    assert.equal((await send("POST", "/pi/v1/events", event("new-feedback"))).body.code, "BRAIN_UNAVAILABLE");
    brainAvailable = true;
    assert.equal((await send("POST", `/pi/v1/requests/${first.body.requestId}/cancel`)).body.request.state, "cancelled");
    assert.equal((await send("POST", `/pi/v1/requests/${first.body.requestId}/cancel`)).body.request.state, "cancelled");
    for (let i = 0; i < 100; i++) store.feedback.receiveEvent(event(`capacity-${i}`), ["review"]);
    assert.equal((await send("POST", "/pi/v1/events", event("feedback"))).status, 200);
    assert.equal((await send("POST", "/pi/v1/events", event("full"))).status, 429);
    assert.equal(wakeCount, 4, "new events and explicit cancellations wake; receipt replay does not");
    bindings = bindings.filter((b) => b.serviceName !== "todo"); assert.equal((await send("GET", `/pi/v1/requests/${first.body.requestId}`)).status, 401);
    bindings = [{ workId, serviceId, serviceName: "todo", containerId: "new", address: "127.0.0.1", token, ports: [{ name: "api", port: address.port, protocol: "tcp" }] }];
    store.close(); const failed = await send("POST", "/pi/v1/events", event("not-committed")); assert.equal(failed.status, 503); assert.equal(failed.body.code, "RECEIPT_STORAGE_UNAVAILABLE");
  } finally { store.close(); await server.close(); await new Promise<void>((resolve) => service.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
