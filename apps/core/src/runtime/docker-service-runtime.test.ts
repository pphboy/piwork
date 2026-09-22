import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { normalizeServiceDefinitionInput, type ServiceDefinition } from "@piwork/contracts";
import { DockerServiceRuntimeAdapter, ServiceExitedError, ServiceReadinessTimeoutError } from "./docker-service-runtime.js";

const WORK_ID = "work-0199e6d8abcd";

test("service adapter uses captured image, Work network alias, and only the granted workspace", async () => {
  let captured: any;
  const docker = {
    async prepareImage(reference: string) { return { reference, imageId: `sha256:${"a".repeat(64)}`, repoDigests: [] }; },
    async ensureWorkNetwork() { return { name: "work-network", networkId: "network-1", created: false }; },
    async requireManagedVolume(_workId: string, logicalId: string) {
      assert.equal(logicalId, "work-workspace");
      return { volumeName: "workspace-volume", created: false };
    },
    async ensureContainer(spec: unknown) { captured = spec; return { containerId: "container-1", name: "service", created: true, specHash: "hash" }; },
    async startContainer() { return { exists: true, running: true, containerId: "container-1" }; },
  };
  const adapter = new DockerServiceRuntimeAdapter(docker as never);
  const definition = serviceDefinition();
  const image = await adapter.resolveImage(WORK_ID, definition);
  await adapter.prepare(WORK_ID, definition);
  await adapter.start(WORK_ID, definition, image);
  assert.equal(captured.image, image);
  assert.deepEqual(captured.network, { name: "work-network", workId: WORK_ID, aliases: ["svc-notes"] });
  assert.equal(captured.user, "10001:10001");
  assert.equal(captured.workingDirectory, "/var/data/workspace");
  assert.deepEqual(captured.entrypoint, ["python3"]);
  assert.equal(captured.mounts.some((mount: any) => mount.source === "workspace-volume" && mount.target === "/var/data/workspace"), true);
  assert.equal(captured.mounts.some((mount: any) => mount.target === "/var/data"), false);
  assert.equal("publishedPorts" in captured || "controlHost" in captured, false);
});

test("service readiness distinguishes running, early exit, HTTP health, exec, and bounded timeout", async () => {
  let inspection: any = { exists: true, running: true, containerId: "container-1", networkAddresses: { work: "127.0.0.1" } };
  let execCalls = 0;
  const docker = {
    async inspectContainer() { return inspection; },
    async execContainer() { execCalls += 1; return ""; },
  };
  const adapter = new DockerServiceRuntimeAdapter(docker as never);
  assert.equal(await adapter.waitReady(WORK_ID, serviceDefinition({ readiness: undefined }), 1_000), true);
  inspection = { ...inspection, running: false, exitCode: 23 };
  await assert.rejects(
    adapter.waitReady(WORK_ID, serviceDefinition(), 1_000),
    (error) => error instanceof ServiceExitedError && error.exitCode === 23,
  );
  inspection = { ...inspection, running: true };
  assert.equal(await adapter.waitReady(WORK_ID, serviceDefinition({ readiness: { kind: "exec", command: ["true"], deadlineMs: 1_000, timeoutMs: 100 } }), 1_000), true);
  assert.equal(execCalls, 1);

  const server = createServer((_request, response) => { response.statusCode = 503; response.end("not ready"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const httpDefinition = serviceDefinition({
      ports: [{ name: "http", containerPort: address.port, protocol: "tcp" }],
      readiness: { kind: "http", portName: "http", path: "/ready", deadlineMs: 1_000, timeoutMs: 50 },
    });
    await assert.rejects(adapter.waitReady(WORK_ID, httpDefinition, 1_000), ServiceReadinessTimeoutError);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("service stop and log reads verify the exact bound instance", async () => {
  let stillRunning = true;
  let expectedLogId: string | undefined;
  let graceSeconds: number | undefined;
  const docker = {
    async stopContainer(_workId: string, _kind: string, _logicalId: string, grace: number) {
      graceSeconds = grace;
      return { exists: true, running: stillRunning };
    },
    async inspectContainer() { return { exists: true, running: false, containerId: "container-bound" }; },
    async collectContainerLogs(_workId: string, _kind: string, _logicalId: string, _tail: number, expected: string) {
      expectedLogId = expected;
      return { text: "stdout\nstderr\n", truncated: false };
    },
    async deleteContainer() {},
  };
  const adapter = new DockerServiceRuntimeAdapter(docker as never);
  await assert.rejects(adapter.stop(WORK_ID, serviceDefinition()), /did not stop/);
  stillRunning = false;
  await adapter.stop(WORK_ID, serviceDefinition(), 10_000);
  assert.equal(graceSeconds, 8);
  assert.equal((await adapter.logs(WORK_ID, "service-0199e6d8abcd", 100)).text, "stdout\nstderr\n");
  assert.equal(expectedLogId, "container-bound");
});

function serviceDefinition(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  const normalized = normalizeServiceDefinitionInput({
    name: "notes", image: { reference: "python:3.13-slim" }, command: "python3", args: ["app.py"],
    mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
    ports: [{ name: "http", containerPort: 8080, protocol: "tcp" }],
  });
  return { ...normalized, serviceId: "service-0199e6d8abcd", revision: 1, ...overrides };
}
