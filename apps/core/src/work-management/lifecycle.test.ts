import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { createWorkHttpServer } from "./http-api.js";
import { WorkLifecycleService, type WorkRuntimeAdapter, type WorkRuntimeState } from "./lifecycle.js";
import { WorkConfigurationService } from "../configuration/work-config.js";
import { WorkContextStore } from "../configuration/work-context.js";

const NOW = "2026-09-20T00:00:00.000Z";
const owner = { userId: "user-owner", role: "user" as const };

test("HTTP Work lifecycle is authorized, idempotent, asynchronous, and follows the latest persisted target", async () => {
  await withFixture(async ({ store, lifecycle, runtime }) => {
    const server = createWorkHttpServer(lifecycle, { authenticate: (token) => token === "owner" ? owner : { userId: "user-other", role: "user" } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    try {
      const createBody = { name: "fixture", configuration: config(), idempotencyKey: "create-1" };
      const created = await request(base, "owner", "POST", "/works", createBody);
      assert.equal(created.status, 202);
      const retried = await request(base, "owner", "POST", "/works", createBody);
      assert.deepEqual(retried.body, { ...created.body, reused: true });
      const workId = String(created.body.workId);
      const operationId = String(created.body.operationId);
      await lifecycle.waitForIdle();
      const operation = await request(base, "owner", "GET", `/operations/${operationId}`);
      assert.equal(operation.body.state, "succeeded");
      assert.equal((await request(base, "owner", "GET", `/works/${workId}`)).body.observedState, "ready");
      assert.equal(runtime.prepares, 1);
      assert.deepEqual(store.listRuntimeGenerations(workId).map((generation) => generation.state), ["ready"]);
      assert.throws(
        () => store.ensureRuntimeGeneration(workId, 2, NOW),
        /already has active runtime generation/,
      );
      assert.equal((await request(base, "other", "GET", `/works/${workId}`)).status, 404);

      runtime.holdStart = true;
      await request(base, "owner", "POST", `/works/${workId}/stop`, { idempotencyKey: "stop-1" });
      await request(base, "owner", "POST", `/works/${workId}/start`, { idempotencyKey: "start-2" });
      await runtime.waitUntilStartIsHeld();
      await request(base, "owner", "POST", `/works/${workId}/stop`, { idempotencyKey: "stop-3" });
      runtime.release();
      await lifecycle.waitForIdle();
      assert.equal(store.getWork(workId)?.desiredState, "stopped");
      assert.equal(store.getWork(workId)?.observedState, "stopped");
      assert.equal(runtime.state.running, false);
      const workOperations = store.listOperations().filter((item) => item.workId === workId);
      assert.ok(workOperations.some((item) => item.state === "superseded"), JSON.stringify(workOperations));
    } finally {
      server.close();
    }
  });
});

test("startup recovery adopts an existing instance and normal Core shutdown leaves it running", async () => {
  await withFixture(async ({ store, lifecycle, runtime }) => {
    const accepted = lifecycle.create(owner, { name: "adopt", configuration: config(), idempotencyKey: "adopt-1" });
    runtime.state = { exists: true, running: true, ready: true, instanceId: "existing", generation: 1 };
    runtime.managedInstances = [
      { workId: accepted.workId, instanceId: "existing" },
      { workId: "work-orphaned-resource", instanceId: "orphan" },
    ];
    const report = await lifecycle.recover();
    assert.equal(store.getOperation(accepted.operationId)?.state, "succeeded");
    assert.equal(runtime.starts, 0);
    assert.deepEqual(report.adoptedWorkIds, [accepted.workId]);
    assert.deepEqual(report.orphanedInstances, [{ workId: "work-orphaned-resource", instanceId: "orphan" }]);
    await lifecycle.shutdown();
    assert.equal(runtime.state.running, true);
  });
});

test("delete drains in order, unknown shutdown never reports stopped, and stopped Works stay stopped on recovery", async () => {
  await withFixture(async ({ store, lifecycle, runtime }) => {
    const created = lifecycle.create(owner, { name: "ordered-delete", configuration: config(), idempotencyKey: "ordered-1" });
    await lifecycle.waitForIdle();
    runtime.events.length = 0;
    const serviceEvents: string[] = [];
    const ordered = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, {
      async prepareEnabledServices() { serviceEvents.push("services-prepare"); },
      async stopServices() { serviceEvents.push("services-stop"); runtime.events.push("services-stop"); },
      async removeServiceInstances() { serviceEvents.push("services-remove"); runtime.events.push("services-remove"); },
    });
    ordered.delete(owner, created.workId, "delete-ordered");
    await ordered.waitForIdle();
    assert.deepEqual(runtime.events, ["drain", "services-stop", "stop", "services-remove", "remove"]);
    assert.equal(store.getWork(created.workId, true)?.observedState, "deleted");

    const stopped = lifecycle.create(owner, { name: "stay-stopped", configuration: config(), idempotencyKey: "stopped-1" });
    await lifecycle.waitForIdle();
    lifecycle.stop(owner, stopped.workId, "stopped-2");
    await lifecycle.waitForIdle();
    const startsBeforeRecovery = runtime.starts;
    await lifecycle.recover();
    assert.equal(runtime.starts, startsBeforeRecovery);
    assert.equal(store.getWork(stopped.workId)?.observedState, "stopped");

    lifecycle.start(owner, stopped.workId, "unknown-start");
    await lifecycle.waitForIdle();
    runtime.failInspect = true;
    const stopUnknown = lifecycle.stop(owner, stopped.workId, "unknown-stop");
    await lifecycle.waitForIdle();
    assert.equal(store.getOperation(stopUnknown.operationId)?.state, "failed");
    assert.notEqual(store.getWork(stopped.workId)?.observedState, "stopped");
  });
});

test("Work config set leaves the runtime untouched and apply activates only after readiness", async () => {
  await withFixture(async ({ store, lifecycle, runtime }) => {
    const profileA = JSON.stringify({ version: 1, revision: 1, agentImage: "image:a", model: { provider: "test", id: "a", credentialRef: "a.secret" }, updatedAt: NOW });
    const profileB = JSON.stringify({ version: 1, revision: 2, agentImage: "image:b", model: { provider: "test", id: "b", credentialRef: "b.secret" }, updatedAt: NOW });
    const created = lifecycle.create(owner, { name: "config-apply", configuration: config(), idempotencyKey: "config-create", runtimeProfileJson: profileA, sourceRuntimeRevision: 1 });
    await lifecycle.waitForIdle();
    assert.equal(store.getWorkConfiguration(created.workId)?.activeRevision, 1);
    runtime.events.length = 0;

    const configurations = new WorkConfigurationService(store, () => new Date(NOW));
    configurations.update(owner, created.workId, 1, { ...config(), modelRef: "model-0199e6d8next" }, { runtimeProfileJson: profileB, sourceRuntimeRevision: 2 });
    assert.equal(store.getWorkConfiguration(created.workId)?.activeRevision, 1);
    assert.equal(store.getWorkConfiguration(created.workId)?.pendingRestart, true);
    assert.deepEqual(runtime.events, []);
    assert.equal(runtime.state.running, true);

    runtime.failPrepare = true;
    await assert.rejects(() => lifecycle.applyConfiguration(owner, created.workId, 2), /prepare failed/);
    assert.equal(store.getWorkConfiguration(created.workId)?.activeRevision, 1);
    assert.equal(runtime.state.running, true);
    assert.deepEqual(runtime.events, []);

    runtime.failPrepare = false;
    const applied = await lifecycle.applyConfiguration(owner, created.workId, 2);
    assert.equal(applied.activeRevision, 2);
    assert.equal(applied.pendingRestart, false);
    assert.deepEqual(runtime.events, ["drain", "stop", "remove"]);
    assert.equal(runtime.state.ready, true);
    const applyOperations = store.listOperations().filter((operation) => operation.kind === "apply-work-configuration");
    assert.equal(applyOperations.length, 1);
    assert.equal(JSON.parse(applyOperations.at(-1)!.requestJson).capturedRevision, 2);
    assert.equal(applyOperations.at(-1)!.state, "succeeded");
  });
});

test("apply activates its captured configuration while a later desired edit remains pending", async () => {
  await withFixture(async ({ store, lifecycle, runtime }) => {
    const profile = JSON.stringify({ version: 1, revision: 1, agentImage: "image:a", model: { provider: "test", id: "a", credentialRef: "a.secret" }, updatedAt: NOW });
    const created = lifecycle.create(owner, { name: "apply-race", configuration: config(), idempotencyKey: "race-create", runtimeProfileJson: profile, sourceRuntimeRevision: 1 });
    await lifecycle.waitForIdle();
    const configurations = new WorkConfigurationService(store, () => new Date(NOW));
    configurations.update(owner, created.workId, { ...config(), agentsMd: "B" }, undefined, { runtimeProfileJson: profile, sourceRuntimeRevision: 1 });

    runtime.holdStart = true;
    const applyingB = lifecycle.applyConfiguration(owner, created.workId);
    await runtime.waitUntilStartIsHeld();
    configurations.update(owner, created.workId, { ...config(), agentsMd: "C" }, undefined, { runtimeProfileJson: profile, sourceRuntimeRevision: 1 });
    runtime.release();

    const applied = await applyingB;
    assert.equal(applied.activeRevision, 2);
    assert.equal(applied.desiredRevision, 3);
    assert.equal(applied.pendingRestart, true);
    assert.equal(JSON.parse(applied.activeConfigJson ?? "{}").agentsMd, "B");
    assert.equal(JSON.parse(applied.desiredConfigJson).agentsMd, "C");

    const before = store.listOperations().filter((operation) => operation.kind === "apply-work-configuration").length;
    const appliedC = await lifecycle.applyConfiguration(owner, created.workId);
    assert.equal(appliedC.pendingRestart, false);
    assert.equal(appliedC.activeRevision, 3);
    const after = store.listOperations().filter((operation) => operation.kind === "apply-work-configuration").length;
    assert.equal(after, before + 1);
  });
});

test("corrupt active context blocks reconciliation without replacing the existing runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-lifecycle-context-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at) VALUES
    ('user-owner', 'owner', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  const contexts = new WorkContextStore(join(root, "works"));
  const runtime = new FakeRuntime();
  const lifecycle = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, undefined, contexts);
  try {
    const workId = "work-0199e6d8-context";
    const configuration = config();
    const snapshot = contexts.build({
      workId,
      snapshotId: "context-active",
      configuration,
      imageIdentity: `sha256:${"a".repeat(64)}`,
      skills: [],
      createdAt: NOW,
    });
    const profile = JSON.stringify({ version: 1, revision: 1, agentImage: "image:a", model: { provider: "test", id: "a", credentialRef: "a.secret" }, updatedAt: NOW });
    lifecycle.create(owner, {
      workId,
      name: "context-corruption",
      configuration,
      idempotencyKey: "context-create",
      runtimeProfileJson: profile,
      sourceRuntimeRevision: 1,
      snapshot: {
        snapshotId: snapshot.snapshotId,
        configurationJson: JSON.stringify(snapshot.configuration),
        imageIdentity: snapshot.metadata.imageIdentity,
        createdByUserId: owner.userId,
        createdAt: snapshot.metadata.createdAt,
      },
    });
    await lifecycle.waitForIdle();
    assert.equal(runtime.state.ready, true);
    const starts = runtime.starts;
    runtime.events.length = 0;
    await chmod(join(snapshot.directory, "AGENTS.md"), 0o600);
    await writeFile(join(snapshot.directory, "AGENTS.md"), "corrupt active context");

    const retry = lifecycle.retry(owner, workId, "context-retry");
    await lifecycle.waitForIdle();

    assert.equal(store.getOperation(retry.operationId)?.state, "failed");
    assert.equal(runtime.starts, starts);
    assert.deepEqual(runtime.events, []);
    assert.equal(runtime.state.running, true);
    assert.equal(store.getWorkConfiguration(workId)?.activeContextId, snapshot.snapshotId);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

class FakeRuntime implements WorkRuntimeAdapter {
  state: WorkRuntimeState = { exists: false, running: false, ready: false };
  starts = 0;
  prepares = 0;
  holdStart = false;
  managedInstances: Array<{ workId: string; instanceId: string }> = [];
  failInspect = false;
  failPrepare = false;
  events: string[] = [];
  private gate: (() => void) | undefined;
  private startHeld: (() => void) | undefined;

  async prepare(): Promise<void> { if (this.failPrepare) throw new Error("prepare failed"); this.prepares += 1; }
  async start(_work: unknown, generation: number): Promise<{ instanceId: string; generation: number }> {
    this.starts += 1;
    if (this.holdStart) await new Promise<void>((resolve) => {
      this.gate = resolve;
      this.startHeld?.();
      this.startHeld = undefined;
    });
    this.state = { exists: true, running: true, ready: true, instanceId: `instance-${generation}`, generation };
    return { instanceId: `instance-${generation}`, generation };
  }
  async inspect(): Promise<WorkRuntimeState> { if (this.failInspect) throw new Error("runtime state unknown"); return this.state; }
  async drain(): Promise<void> { this.events.push("drain"); }
  async stop(): Promise<void> { this.events.push("stop"); this.state = { ...this.state, running: false, ready: false }; }
  async remove(): Promise<void> { this.events.push("remove"); this.state = { exists: false, running: false, ready: false }; }
  async listManagedInstances() { return this.managedInstances; }
  async waitUntilStartIsHeld(): Promise<void> {
    if (this.gate !== undefined) return;
    await new Promise<void>((resolve) => { this.startHeld = resolve; });
  }
  release(): void { this.holdStart = false; this.gate?.(); this.gate = undefined; }
}

async function request(base: string, token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function withFixture(run: (fixture: { store: CoreStore; lifecycle: WorkLifecycleService; runtime: FakeRuntime }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "piwork-lifecycle-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at) VALUES
    ('user-owner', 'owner', 'digest', 'user', 1, '${NOW}', '${NOW}'),
    ('user-other', 'other', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  const runtime = new FakeRuntime();
  const lifecycle = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10);
  try { await run({ store, lifecycle, runtime }); }
  finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

function config(): WorkConfig {
  return {
    agentImage: { catalogId: "image-0199e6d8abcd" },
    skills: [], agentsMd: "", modelRef: "model-0199e6d8abcd", mcpServers: [],
    resources: { cpuMillis: 1000, memoryBytes: 1_073_741_824, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: [], denied: [] },
  };
}
