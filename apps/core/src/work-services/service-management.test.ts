import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ServiceDefinition, ServiceDefinitionInput, WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { WorkContextStore } from "../configuration/work-context.js";
import { createWorkHttpServer } from "../work-management/http-api.js";
import { WorkLifecycleService, type WorkRuntimeAdapter, type WorkRuntimeState } from "../work-management/lifecycle.js";
import { ServiceNameConflictError, ServicePreconditionError, ServiceQuotaExceededError, ServiceRevisionConflictError, WorkServiceManagementService, type ServiceRuntimeAdapter } from "./service-management.js";

const NOW = "2026-09-20T00:00:00.000Z";
const WORK_ID = "work-0199e6d8abcd";
const owner = { userId: "user-owner", role: "user" as const };

test("service create persists revision, Operation, and one quota reservation before runtime start", async () => {
  await withFixture(async ({ store, services, runtime, lifecycle }) => {
    const server = createWorkHttpServer(
      lifecycle,
      { authenticate: (token) => token === "owner" ? owner : { userId: "user-other", role: "user" } },
      services,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    try {
      const body = { definition: definition(), idempotencyKey: "create-notes-1" };
      const created = await request(base, "owner", "POST", `/works/${WORK_ID}/services`, body);
      assert.equal(created.status, 202);
      const retried = await request(base, "owner", "POST", `/works/${WORK_ID}/services`, body);
      assert.equal(retried.status, 202);
      assert.deepEqual(retried.body, { ...created.body, reused: true });

      const serviceId = String(created.body.serviceId);
      const operationId = String(created.body.operationId);
      await runtime.started;
      assert.equal(runtime.starts, 1);
      assert.equal(runtime.definition?.serviceId, serviceId);
      assert.equal(runtime.definition?.revision, 1);
      assert.equal(store.getService(WORK_ID, serviceId)?.desiredRevision, 1);
      assert.equal(store.getOperation(operationId)?.state, "running");
      assert.deepEqual(store.getQuotaReservation(WORK_ID, "service", serviceId), {
        workId: WORK_ID,
        subjectKind: "service",
        subjectId: serviceId,
        desiredCpuMillis: 250,
        desiredMemoryBytes: 134_217_728,
        occupiedCpuMillis: 0,
        occupiedMemoryBytes: 0,
        serviceSlots: 1,
        volumeSlots: 0,
        updatedAt: NOW,
      });
      assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM quota_reservations")?.count, 1);

      const conflict = await request(base, "owner", "POST", `/works/${WORK_ID}/services`, {
        definition: definition(),
        idempotencyKey: "different-create-key",
      });
      assert.equal(conflict.status, 409);
      assert.match(String(conflict.body.message), /already in use/);

      assert.equal((await request(base, "other", "GET", `/works/${WORK_ID}/services/${serviceId}`)).status, 404);
      const listed = await request(base, "owner", "GET", `/works/${WORK_ID}/services`);
      assert.equal((listed.body.services as unknown[]).length, 1);

      runtime.release();
      await services.waitForIdle();
      const operation = await request(base, "owner", "GET", `/operations/${operationId}`);
      assert.equal(operation.status, 200);
      assert.equal(operation.body.state, "succeeded");
      const shown = await request(base, "owner", "GET", `/works/${WORK_ID}/services/${serviceId}`);
      assert.equal(shown.body.observedState, "ready");
      assert.equal(shown.body.desiredRevision, 1);
      assert.equal(shown.body.appliedRevision, 1);
      assert.equal(store.getQuotaReservation(WORK_ID, "service", serviceId)?.occupiedCpuMillis, 250);
    } finally {
      runtime.release();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

test("same Work service names are unique while different Works may reuse a name", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "first" });
    assert.throws(
      () => services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "second" }),
      (error) => error instanceof ServiceNameConflictError,
    );

    store.exec(`INSERT INTO works(
      id, owner_user_id, name, desired_state, observed_state,
      desired_revision, active_revision, control_version, created_at, updated_at
    ) VALUES ('work-0199e6d8other', 'user-owner', 'other', 'stopped', 'stopped', 1, 1, 1, '${NOW}', '${NOW}')`);
    const accepted = services.create(owner, "work-0199e6d8other", {
      definition: definition(),
      idempotencyKey: "other-work",
    });
    assert.equal(store.getService("work-0199e6d8other", accepted.serviceId)?.name, "notes");
    await runtime.started;
    runtime.release();
    await services.waitForIdle();
  });
});

test("service acceptance atomically enforces Work and host budgets and counts retained volumes", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const limitedConfiguration = { ...workConfig(), resources: { cpuMillis: 1_000, memoryBytes: 1_000_000_000, maxServices: 1, maxRetainedVolumes: 1 } };
    store.exec(`UPDATE work_config_revisions SET config_json = '${JSON.stringify(limitedConfiguration).replace(/'/g, "''")}'
      WHERE work_id = '${WORK_ID}' AND revision = 1`);
    const first = services.create(owner, WORK_ID, {
      definition: definition({ cpuMillis: 700, memoryBytes: 500_000_000 }),
      idempotencyKey: "budget-first",
    });
    await runtime.started;
    assert.throws(
      () => services.create(owner, WORK_ID, {
        definition: definition({ name: "second", cpuMillis: 400, memoryBytes: 500_000_000 }),
        idempotencyKey: "budget-second",
      }),
      (error) => error instanceof ServiceQuotaExceededError,
    );
    assert.equal(store.get<{ count: number }>(`SELECT COUNT(*) AS count FROM service_heads WHERE work_id = '${WORK_ID}'`)?.count, 1);
    assert.equal(store.getQuotaReservation(WORK_ID, "service", first.serviceId)?.desiredCpuMillis, 700);

    runtime.release();
    await services.waitForIdle();
    const released = services.releaseServiceOccupation(WORK_ID, first.serviceId);
    assert.equal(released.observedState, "ready");
    assert.equal(store.getQuotaReservation(WORK_ID, "service", first.serviceId)?.occupiedCpuMillis, 0);
    store.exec(`UPDATE service_heads SET enabled = 0 WHERE work_id = '${WORK_ID}' AND service_id = '${first.serviceId}'`);
    const budgetReleased = services.releaseServiceBudget(WORK_ID, first.serviceId);
    assert.equal(budgetReleased.enabled, false);
    assert.equal(store.getQuotaReservation(WORK_ID, "service", first.serviceId)?.desiredCpuMillis, 0);
  });
});

test("stopped Work keeps an enabled service reservation for its next start", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    store.exec(`UPDATE works SET desired_state = 'stopped' WHERE id = '${WORK_ID}'`);
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "stopped-enabled" });
    await services.waitForIdle();
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "stopped");
    assert.equal(store.getQuotaReservation(WORK_ID, "service", accepted.serviceId)?.desiredCpuMillis, 250);
    assert.equal(runtime.starts, 0);
  });
});

test("Work lifecycle starts an enabled service once and stops it without losing its definition", async () => {
  await withFixture(async ({ store, services, runtime, contexts }) => {
    store.exec(`UPDATE works SET desired_state = 'stopped', observed_state = 'stopped' WHERE id = '${WORK_ID}'`);
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "lifecycle-service" });
    await services.waitForIdle();
    const workRuntime = new LifecycleRuntime();
    const lifecycle = new WorkLifecycleService(store, workRuntime, () => new Date(NOW), 10, 10, services, contexts);
    lifecycle.start(owner, WORK_ID, "lifecycle-start");
    await runtime.started;
    runtime.release();
    await lifecycle.waitForIdle();
    assert.equal(runtime.starts, 1);
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "ready");
    assert.equal(store.getWork(WORK_ID)?.observedState, "ready");

    lifecycle.stop(owner, WORK_ID, "lifecycle-stop");
    await lifecycle.waitForIdle();
    assert.equal(runtime.stops, 1);
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "stopped");
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.enabled, true);
    assert.equal(store.getQuotaReservation(WORK_ID, "service", accepted.serviceId)?.desiredCpuMillis, 250);
  });
});

test("host budget is checked in the same acceptance transaction", async () => {
  await withFixture(async ({ store, runtime }) => {
    const limited = new WorkServiceManagementService(store, runtime, () => new Date(NOW), {
      hostCpuMillis: 700,
      hostMemoryBytes: 1_000_000_000,
    });
    limited.create(owner, WORK_ID, {
      definition: definition({ cpuMillis: 500, memoryBytes: 300_000_000 }),
      idempotencyKey: "host-first",
    });
    await runtime.started;
    assert.throws(
      () => limited.create(owner, WORK_ID, {
        definition: definition({ name: "host-second", cpuMillis: 300, memoryBytes: 300_000_000 }),
        idempotencyKey: "host-second",
      }),
      (error) => error instanceof ServiceQuotaExceededError,
    );
    runtime.release();
    await limited.waitForIdle();
  });
});

test("service updates retain revision history and failed replacement keeps persistent definition data", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "revision-create" });
    runtime.release();
    await services.waitForIdle();
    const updated = services.update(owner, WORK_ID, accepted.serviceId, 1, definition({ cpuMillis: 300, name: "notes-v2" }), "revision-update");
    await services.waitForIdle();
    assert.equal(store.getOperation(updated.operationId)?.state, "succeeded", store.getOperation(updated.operationId)?.errorJson ?? "");
    assert.deepEqual(store.listServiceRevisions(WORK_ID, accepted.serviceId).map((item) => item.revision), [1, 2]);
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.desiredRevision, 2);
    assert.throws(
      () => services.update(owner, WORK_ID, accepted.serviceId, 1, definition({ name: "stale" }), "revision-stale"),
      (error) => error instanceof ServiceRevisionConflictError,
    );
    const failingRuntime = new FailingServiceRuntime();
    const failing = new WorkServiceManagementService(store, failingRuntime, () => new Date(NOW));
    const failed = failing.update(owner, WORK_ID, accepted.serviceId, 2, definition({ name: "broken" }), "revision-failed");
    await failing.waitForIdle();
    assert.equal(store.getOperation(failed.operationId)?.state, "failed");
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.desiredRevision, 3);
    assert.equal(store.listServiceRevisions(WORK_ID, accepted.serviceId).length, 3);
    assert.match(store.getService(WORK_ID, accepted.serviceId)?.lastErrorJson ?? "", /cannot start/);
  });
});

test("disable persists across Work stop/start and restart enforces preconditions", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "disable-create" });
    runtime.release();
    await services.waitForIdle();
    const disabled = services.disable(owner, WORK_ID, accepted.serviceId, "disable-action");
    await services.waitForIdle();
    assert.equal(store.getOperation(disabled.operationId)?.state, "succeeded");
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "disabled");
    assert.equal(store.getQuotaReservation(WORK_ID, "service", accepted.serviceId)?.desiredCpuMillis, 0);
    store.exec(`UPDATE works SET desired_state = 'stopped', observed_state = 'stopped' WHERE id = '${WORK_ID}'`);
    await services.prepareEnabledServices(store.getWork(WORK_ID)!);
    assert.equal(runtime.starts, 1);
    assert.throws(() => services.restart(owner, WORK_ID, accepted.serviceId, "restart-disabled"), ServicePreconditionError);
  });
});

test("remove tombstones the definition and recovery does not recreate its instance", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "remove-create" });
    runtime.release();
    await services.waitForIdle();
    const removed = services.remove(owner, WORK_ID, accepted.serviceId, "remove-action");
    await services.waitForIdle();
    assert.equal(store.getOperation(removed.operationId)?.state, "succeeded");
    assert.equal(store.getService(WORK_ID, accepted.serviceId), undefined);
    assert.equal(store.getService(WORK_ID, accepted.serviceId, true)?.tombstonedAt, NOW);
    const starts = runtime.starts;
    const recovered = new WorkServiceManagementService(store, runtime, () => new Date(NOW));
    await recovered.prepareEnabledServices(store.getWork(WORK_ID)!);
    assert.equal(runtime.starts, starts);
  });
});

test("readiness timeout marks a service failed while optional service failure does not block Work", async () => {
  await withFixture(async ({ store, services }) => {
    const failing = new WorkServiceManagementService(store, new ReadinessFailingRuntime(), () => new Date(NOW));
    const accepted = failing.create(owner, WORK_ID, { definition: definition({ required: false }), idempotencyKey: "readiness-fail" });
    await failing.waitForIdle();
    assert.equal(store.getOperation(accepted.operationId)?.state, "failed");
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "failed");

    const requiredStore = store;
    requiredStore.exec(`UPDATE works SET desired_state = 'running', observed_state = 'ready' WHERE id = '${WORK_ID}'`);
    await failing.prepareEnabledServices(requiredStore.getWork(WORK_ID)!);
    assert.equal(requiredStore.getService(WORK_ID, accepted.serviceId)?.observedState, "failed");
  });
});

test("service mutations are fenced while a Work is stopping", async () => {
  await withFixture(async ({ store, services }) => {
    store.exec(`UPDATE works SET observed_state = 'stopping' WHERE id = '${WORK_ID}'`);
    assert.throws(() => services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "late-create" }), ServicePreconditionError);
  });
});

class FailingServiceRuntime implements ServiceRuntimeAdapter {
  async start(): Promise<void> { throw new Error("cannot start replacement image"); }
  async stop(): Promise<void> {}
}

class ReadinessFailingRuntime implements ServiceRuntimeAdapter {
  async start(): Promise<void> {}
  async waitReady(): Promise<boolean> { return false; }
  async stop(): Promise<void> {}
}

class GatedServiceRuntime implements ServiceRuntimeAdapter {
  starts = 0;
  stops = 0;
  definition: ServiceDefinition | undefined;
  readonly started: Promise<void>;
  private signalStarted!: () => void;
  private gate: (() => void) | undefined;
  private released = false;

  constructor(private readonly store: CoreStore) {
    this.started = new Promise<void>((resolve) => { this.signalStarted = resolve; });
  }

  async start(definition: ServiceDefinition): Promise<void> {
    this.starts += 1;
    this.definition = definition;
    assert.ok(this.store.getService(WORK_ID, definition.serviceId));
    assert.ok(this.store.listOperations().filter((operation) => operation.serviceId === definition.serviceId).length >= 1);
    assert.ok(this.store.getQuotaReservation(definition.serviceId === undefined ? "" : WORK_ID, "service", definition.serviceId));
    this.signalStarted();
    if (this.released) return;
    await new Promise<void>((resolve) => { this.gate = resolve; });
  }

  async stop(_definition: ServiceDefinition): Promise<void> { this.stops += 1; }

  release(): void {
    this.released = true;
    this.gate?.();
    this.gate = undefined;
  }
}

class NoopWorkRuntime implements WorkRuntimeAdapter {
  async prepare(): Promise<void> {}
  async start(_work: unknown, generation: number): Promise<{ instanceId: string; generation: number }> {
    return { instanceId: "unused", generation };
  }
  async inspect(): Promise<WorkRuntimeState> { return { exists: false, running: false, ready: false }; }
  async drain(): Promise<void> {}
  async stop(): Promise<void> {}
  async remove(): Promise<void> {}
}

class LifecycleRuntime implements WorkRuntimeAdapter {
  private state: WorkRuntimeState = { exists: false, running: false, ready: false };
  async prepare(): Promise<void> {}
  async start(_work: unknown, generation: number): Promise<{ instanceId: string; generation: number }> {
    this.state = { exists: true, running: true, ready: true, instanceId: `instance-${generation}`, generation };
    return { instanceId: `instance-${generation}`, generation };
  }
  async inspect(): Promise<WorkRuntimeState> { return this.state; }
  async drain(): Promise<void> {}
  async stop(): Promise<void> { this.stops += 1; this.state = { ...this.state, running: false, ready: false }; }
  async remove(): Promise<void> { this.state = { exists: false, running: false, ready: false }; }
  stops = 0;
}

async function withFixture(
  run: (fixture: {
    store: CoreStore;
    services: WorkServiceManagementService;
    runtime: GatedServiceRuntime;
    lifecycle: WorkLifecycleService;
    contexts: WorkContextStore;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-services-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at) VALUES
    ('user-owner', 'owner', 'digest', 'user', 1, '${NOW}', '${NOW}'),
    ('user-other', 'other', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  store.exec(`INSERT INTO works(
    id, owner_user_id, name, desired_state, observed_state,
    desired_revision, active_revision, control_version, created_at, updated_at
  ) VALUES ('${WORK_ID}', 'user-owner', 'fixture', 'running', 'ready', 1, 1, 1, '${NOW}', '${NOW}')`);
  const configuration = workConfig();
  const profile = JSON.stringify({ version: 1, revision: 1, agentImage: "image:a", model: { provider: "test", id: "a", credentialRef: "a.secret" }, updatedAt: NOW });
  store.exec(`INSERT INTO work_config_revisions(
    work_id, revision, config_json, created_by_user_id, created_at, runtime_profile_json, source_runtime_revision
  ) VALUES ('${WORK_ID}', 1, '${JSON.stringify(configuration).replace(/'/g, "''")}', 'user-owner', '${NOW}', '${profile.replace(/'/g, "''")}', 1)`);
  const contexts = new WorkContextStore(join(root, "works"));
  const snapshot = contexts.build({
    workId: WORK_ID,
    snapshotId: "context-active",
    configuration,
    imageIdentity: `sha256:${"a".repeat(64)}`,
    skills: [],
    createdAt: NOW,
  });
  store.insertInitialWorkContext(WORK_ID, 1, {
    snapshotId: snapshot.snapshotId,
    configurationJson: JSON.stringify(snapshot.configuration),
    imageIdentity: snapshot.metadata.imageIdentity,
    createdByUserId: owner.userId,
    createdAt: snapshot.metadata.createdAt,
  });
  store.activateWorkContext(WORK_ID, snapshot.snapshotId, NOW);
  const runtime = new GatedServiceRuntime(store);
  const services = new WorkServiceManagementService(store, runtime, () => new Date(NOW));
  const lifecycle = new WorkLifecycleService(store, new NoopWorkRuntime(), () => new Date(NOW), 30_000, 10_000, undefined, contexts);
  try {
    await run({ store, services, runtime, lifecycle, contexts });
  } finally {
    runtime.release();
    await services.waitForIdle();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function request(base: string, token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

function definition(overrides: Partial<ServiceDefinitionInput> = {}): ServiceDefinitionInput {
  return {
    name: "notes",
    image: { catalogId: "image-0199e6d8abcd" },
    args: [],
    environment: {},
    secretRefs: [],
    mounts: [],
    ports: [{ name: "http", containerPort: 8080, protocol: "tcp", alias: "notes" }],
    cpuMillis: 250,
    memoryBytes: 134_217_728,
    enabled: true,
    required: false,
    restartPolicy: "bounded",
    ...overrides,
  };
}

function workConfig(): WorkConfig {
  return {
    agentImage: { catalogId: "image-0199e6d8abcd" },
    skills: [],
    agentsMd: "",
    modelRef: "model-0199e6d8abcd",
    mcpServers: [],
    resources: { cpuMillis: 1_000, memoryBytes: 1_000_000_000, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: [], denied: [] },
  };
}
