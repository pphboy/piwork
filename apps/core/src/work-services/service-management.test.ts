import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ServiceDefinition, ServiceDefinitionInput, WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { WorkContextStore } from "../configuration/work-context.js";
import { ConversationAccessDeniedError, InvisibleResourceError } from "../work-access/policy.js";
import { createWorkHttpServer } from "../work-management/http-api.js";
import { WorkLifecycleService, type WorkRuntimeAdapter, type WorkRuntimeState } from "../work-management/lifecycle.js";
import { ServiceNameConflictError, ServicePreconditionError, ServiceQuotaExceededError, ServiceRevisionConflictError, WorkServiceManagementService, type ServiceRuntimeAdapter } from "./service-management.js";

const NOW = "2026-09-20T00:00:00.000Z";
const WORK_ID = "work-0199e6d8abcd";
const owner = { userId: "user-owner", role: "user" as const };

test("service create persists revision, Operation, and quota reservation before runtime start", async () => {
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
      assert.equal(store.getServiceDomainLabel(WORK_ID, serviceId), "notes");
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
      assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM quota_reservations")?.count, 2);

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
      assert.equal((shown.body.access as { hostname: string }).hostname, `notes.${store.getWorkNetworkName(WORK_ID)}.work`);
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
    const limitedConfiguration = { ...workConfig(), resources: { cpuMillis: 1_000, memoryBytes: 1_000_000_000, agentCpuMillis: 200, agentMemoryBytes: 200_000_000, maxServices: 1, maxRetainedVolumes: 1 } };
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

test("workspace references attach once per service and detach only after removal", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    store.exec(`INSERT INTO volume_records(id, installation_id, work_id, service_id, volume_role,
      runtime_name, state, reference_count, retained_at, purged_at, created_at)
      VALUES ('volume-workspace', 'installation-test', '${WORK_ID}', NULL, 'workspace',
      'piwork-workspace', 'active', 1, NULL, NULL, '${NOW}')`);
    store.exec(`INSERT INTO volume_references(volume_id, consumer_kind, consumer_id, created_at)
      VALUES ('volume-workspace', 'work', '${WORK_ID}', '${NOW}')`);
    const accepted = services.create(owner, WORK_ID, {
      definition: definition({
        mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
        workingDirectory: "/var/data/workspace",
      }),
      idempotencyKey: "workspace-create",
    });
    assert.equal(store.getVolumeRecord("volume-workspace")?.referenceCount, 2);
    assert.equal(store.get<{ count: number }>(`SELECT COUNT(*) AS count FROM volume_references WHERE volume_id = 'volume-workspace'`)?.count, 2);
    runtime.release();
    await services.waitForIdle();
    services.remove(owner, WORK_ID, accepted.serviceId, "workspace-remove");
    await services.waitForIdle();
    assert.equal(store.getVolumeRecord("volume-workspace")?.referenceCount, 1);
    assert.equal(store.getVolumeRecord("volume-workspace")?.state, "active");
    assert.equal(store.getVolumeRecord("volume-workspace")?.purgedAt, null);
    assert.equal(store.getVolumeRecord("volume-workspace")?.runtimeName, "piwork-workspace");
    assert.equal(store.get<{ count: number }>(`SELECT COUNT(*) AS count FROM volume_references WHERE volume_id = 'volume-workspace'`)?.count, 1);
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
    const updated = services.update(owner, WORK_ID, accepted.serviceId, 1, definition({ cpuMillis: 300 }), "revision-update");
    await services.waitForIdle();
    assert.equal(store.getOperation(updated.operationId)?.state, "succeeded", store.getOperation(updated.operationId)?.errorJson ?? "");
    assert.deepEqual(store.listServiceRevisions(WORK_ID, accepted.serviceId).map((item) => item.revision), [1, 2]);
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.desiredRevision, 2);
    assert.throws(
      () => services.update(owner, WORK_ID, accepted.serviceId, 1, definition(), "revision-stale"),
      (error) => error instanceof ServiceRevisionConflictError,
    );
    const failingRuntime = new FailingServiceRuntime();
    const failing = new WorkServiceManagementService(store, failingRuntime, () => new Date(NOW));
    const failed = failing.update(owner, WORK_ID, accepted.serviceId, 2, definition({ cpuMillis: 350 }), "revision-failed");
    await failing.waitForIdle();
    assert.equal(store.getOperation(failed.operationId)?.state, "failed");
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.desiredRevision, 3);
    assert.equal(store.listServiceRevisions(WORK_ID, accepted.serviceId).length, 3);
    assert.match(store.getService(WORK_ID, accepted.serviceId)?.lastErrorJson ?? "", /SERVICE_START_FAILED/);
  });
});

test("disable persists across Work stop/start and restart enforces preconditions", async () => {
  await withFixture(async ({ store, services, runtime, contexts }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "disable-create" });
    runtime.release();
    await services.waitForIdle();
    const disabled = services.disable(owner, WORK_ID, accepted.serviceId, "disable-action");
    await services.waitForIdle();
    assert.equal(store.getOperation(disabled.operationId)?.state, "succeeded");
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "disabled");
    assert.equal(store.getQuotaReservation(WORK_ID, "service", accepted.serviceId)?.desiredCpuMillis, 0);
    assert.throws(() => services.restart(owner, WORK_ID, accepted.serviceId, "restart-disabled"), ServicePreconditionError);
    const companion = services.create(owner, WORK_ID, { definition: definition({ name: "companion" }), idempotencyKey: "companion" });
    await services.waitForIdle();
    const lifecycle = new WorkLifecycleService(store, new LifecycleRuntime(), () => new Date(NOW), 10, 10, services, contexts);
    lifecycle.stop(owner, WORK_ID, "stop-with-disabled-service");
    await lifecycle.waitForIdle();
    assert.throws(() => services.restart(owner, WORK_ID, companion.serviceId, "restart-stopped-work"), ServicePreconditionError);
    lifecycle.start(owner, WORK_ID, "start-with-disabled-service");
    await lifecycle.waitForIdle();
    assert.equal(store.getWork(WORK_ID)?.observedState, "ready");
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.enabled, false);
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "disabled");
    assert.equal(store.getService(WORK_ID, companion.serviceId)?.enabled, true);
    assert.equal(store.getService(WORK_ID, companion.serviceId)?.observedState, "ready");
    assert.equal(runtime.starts, 3); // Initial service, companion, restored companion only.
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
    const operation = store.getOperation(accepted.operationId)!;
    assert.equal(operation.state, "failed");
    const diagnostics = JSON.parse(operation.resultJson ?? "{}") as { diagnostics?: { stages?: Array<{ stage: string; serviceId?: string }> } };
    assert.deepEqual(diagnostics.diagnostics?.stages?.map((stage) => stage.stage), ["service-accept", "service-readiness"]);
    assert.equal(diagnostics.diagnostics?.stages?.every((stage) => stage.serviceId === accepted.serviceId), true);
    assert.equal(store.getService(WORK_ID, accepted.serviceId)?.observedState, "failed");

    const requiredStore = store;
    requiredStore.exec(`UPDATE works SET desired_state = 'running', observed_state = 'ready' WHERE id = '${WORK_ID}'`);
    await failing.prepareEnabledServices(requiredStore.getWork(WORK_ID)!);
    assert.equal(requiredStore.getService(WORK_ID, accepted.serviceId)?.observedState, "failed");
    await failing.reconcileAll();
    assert.equal(requiredStore.getWork(WORK_ID)?.observedState, "degraded");
    requiredStore.updateServiceObservedState(WORK_ID, accepted.serviceId, "ready", NOW, { appliedRevision: 1 });
    await failing.reconcileAll();
    assert.equal(requiredStore.getWork(WORK_ID)?.observedState, "ready");
  });
});

test("service failures emit safe structured diagnostics with Work, service, and Operation correlation", async () => {
  await withFixture(async ({ store }) => {
    const lines: string[] = [];
    const failing = new WorkServiceManagementService(
      store,
      new ReadinessFailingRuntime(),
      () => new Date(NOW),
      { hostCpuMillis: 128_000, hostMemoryBytes: 256 * 1_024 * 1_024 * 1_024 },
      { write(line) { lines.push(line); } },
    );
    const accepted = failing.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "logged-failure" });
    await failing.waitForIdle();
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.ok(events.some((event) => event.stage === "service-accept" && event.outcome === "succeeded"));
    const failure = events.find((event) => event.outcome === "failed");
    assert.equal(failure?.workId, WORK_ID);
    assert.equal(failure?.serviceId, accepted.serviceId);
    assert.equal(failure?.operationId, accepted.operationId);
    assert.equal(failure?.correlationId, accepted.operationId);
    assert.equal(failure?.code, "SERVICE_READINESS_TIMEOUT");
  });
});

test("readiness failure remains primary when bounded diagnostic log collection also fails", async () => {
  await withFixture(async ({ store }) => {
    const failing = new WorkServiceManagementService(store, new ReadinessAndLogFailingRuntime(), () => new Date(NOW));
    const accepted = failing.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "collection-failure" });
    await failing.waitForIdle();
    const operation = store.getOperation(accepted.operationId)!;
    assert.equal(JSON.parse(operation.errorJson ?? "{}").code, "SERVICE_READINESS_TIMEOUT");
    const envelope = JSON.parse(operation.resultJson ?? "{}") as { diagnostics?: { diagnosticCollection?: { state?: string; code?: string } } };
    assert.deepEqual(envelope.diagnostics?.diagnosticCollection, {
      state: "unavailable",
      code: "DIAGNOSTIC_COLLECTION_FAILED",
    });
  });
});

test("service logs are owner/runtime content, redact credentials, and enforce byte and instance bounds", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, {
      definition: definition({ environment: { API_KEY: "known-value" } }),
      idempotencyKey: "logs-create",
    });
    runtime.release();
    await services.waitForIdle();
    const logRuntime = new LogServiceRuntime(`api_key=plain-value\ncredential known-value\n${"x".repeat(70 * 1_024)}`);
    const reader = new WorkServiceManagementService(store, logRuntime, () => new Date(NOW));
    const logs = await reader.logs(owner, WORK_ID, accepted.serviceId);
    assert.equal(logs.status, "truncated");
    assert.equal(logs.truncated, true);
    assert.equal(Buffer.byteLength(logs.text), 64 * 1_024);
    assert.doesNotMatch(logs.text, /plain-value|known-value/);
    assert.equal(logRuntime.tailLines, 100);
    await assert.rejects(
      reader.logs({ userId: "admin-user", role: "admin" }, WORK_ID, accepted.serviceId),
      ConversationAccessDeniedError,
    );
    await assert.rejects(
      reader.logs({ userId: "user-other", role: "user" }, WORK_ID, accepted.serviceId),
      InvisibleResourceError,
    );
    logRuntime.exists = false;
    const unavailable = await reader.logs(owner, WORK_ID, accepted.serviceId, 1);
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.text, "");
  });
});

test("service mutations are fenced while a Work is stopping", async () => {
  await withFixture(async ({ store, services }) => {
    store.exec(`UPDATE works SET observed_state = 'stopping' WHERE id = '${WORK_ID}'`);
    assert.throws(() => services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "late-create" }), ServicePreconditionError);
  });
});

test("a stop fence cleans up a late service start and supersedes its older Operation", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "race-create" });
    await runtime.started;
    store.exec(`UPDATE works SET desired_state = 'stopped', observed_state = 'stopping' WHERE id = '${WORK_ID}'`);
    runtime.release();
    await services.waitForIdle();
    assert.equal(store.getOperation(accepted.operationId)?.state, "superseded");
    assert.equal(runtime.stops, 1);
    assert.notEqual(store.getService(WORK_ID, accepted.serviceId)?.observedState, "ready");
  });
});

test("a Work stop-start cycle supersedes an older service worker even when the final desired state is running", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "work-fence-create" });
    await runtime.started;
    store.exec(`UPDATE works SET desired_state = 'running', observed_state = 'ready', control_version = control_version + 2 WHERE id = '${WORK_ID}'`);
    runtime.release();
    await services.waitForIdle();
    assert.equal(store.getOperation(accepted.operationId)?.state, "superseded");
    assert.equal(runtime.stops, 1);
    assert.notEqual(store.getService(WORK_ID, accepted.serviceId)?.observedState, "ready");
  });
});

test("a newer accepted revision supersedes an older queued worker without executing the newer definition under the old Operation", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const created = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "overtake-create" });
    await runtime.started;
    const second = services.update(owner, WORK_ID, created.serviceId, 1, definition({ args: ["second.py"] }), "overtake-second");
    const third = services.update(owner, WORK_ID, created.serviceId, 2, definition({ args: ["third.py"] }), "overtake-third");
    runtime.release();
    await services.waitForIdle();
    assert.equal(store.getOperation(created.operationId)?.state, "superseded");
    assert.equal(store.getOperation(second.operationId)?.state, "superseded");
    assert.equal(store.getOperation(third.operationId)?.state, "succeeded");
    assert.deepEqual(runtime.revisions, [1, 3]);
    assert.equal(runtime.definition?.args[0], "third.py");
    assert.equal(store.getService(WORK_ID, created.serviceId)?.appliedRevision, 3);
  });
});

test("automatic reconciliation persists 1/5/15 recovery budget across manager replacement", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "recovery-create" });
    runtime.release();
    await services.waitForIdle();
    let clock = Date.parse(NOW);
    const recoveryRuntime = new RecoveryFailingRuntime();
    const recovering = new WorkServiceManagementService(store, recoveryRuntime, () => new Date(clock));
    await recovering.reconcileAll();
    assert.equal(store.getServiceRuntimeBinding(WORK_ID, accepted.serviceId)?.nextRetryAt, new Date(clock + 1_000).toISOString());
    for (const delay of [1_000, 5_000, 15_000]) {
      clock += delay;
      await recovering.reconcileAll();
    }
    assert.equal(recoveryRuntime.starts, 3);
    assert.equal(store.getServiceRuntimeBinding(WORK_ID, accepted.serviceId)?.recoveryCount, 3);
    assert.equal(store.getServiceRuntimeBinding(WORK_ID, accepted.serviceId)?.nextRetryAt, null);
    const replacementRuntime = new RecoveryFailingRuntime();
    const replacement = new WorkServiceManagementService(store, replacementRuntime, () => new Date(clock + 60_000));
    await replacement.reconcileAll();
    assert.equal(replacementRuntime.starts, 0);
    const retried = replacement.retry(owner, WORK_ID, accepted.serviceId, "explicit-retry");
    await replacement.waitForIdle();
    assert.equal(store.getOperation(retried.operationId)?.state, "failed");
    assert.equal(store.getServiceRuntimeBinding(WORK_ID, accepted.serviceId)?.recoveryCount, 0);
    const starts = replacementRuntime.starts;
    assert.deepEqual(replacement.retry(owner, WORK_ID, accepted.serviceId, "explicit-retry"), { ...retried, reused: true });
    await replacement.waitForIdle();
    assert.equal(replacementRuntime.starts, starts);
  });
});

test("unknown Docker inspection records a dependency diagnostic without creating a replacement", async () => {
  await withFixture(async ({ store, services, runtime }) => {
    const accepted = services.create(owner, WORK_ID, { definition: definition(), idempotencyKey: "unknown-inspect-create" });
    runtime.release();
    await services.waitForIdle();
    const unknown = new UnknownInspectionRuntime();
    await new WorkServiceManagementService(store, unknown, () => new Date(NOW)).reconcileAll();
    const service = store.getService(WORK_ID, accepted.serviceId)!;
    assert.equal(service.observedState, "unknown");
    assert.equal(JSON.parse(service.lastErrorJson ?? "{}").code, "DOCKER_UNAVAILABLE");
    assert.equal(unknown.starts, 0);
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

class ReadinessAndLogFailingRuntime extends ReadinessFailingRuntime {
  async logs(): Promise<{ text: string; truncated: boolean }> { throw new Error("private container output"); }
}

class RecoveryFailingRuntime implements ServiceRuntimeAdapter {
  starts = 0;
  async start(): Promise<void> { this.starts += 1; throw new Error("runtime unavailable"); }
  async inspect(): Promise<{ exists: boolean; running: boolean }> { return { exists: false, running: false }; }
  async stop(): Promise<void> {}
}

class UnknownInspectionRuntime implements ServiceRuntimeAdapter {
  starts = 0;
  async start(): Promise<void> { this.starts += 1; }
  async inspect(): Promise<{ exists: boolean; running: boolean }> { throw new Error("Docker socket unavailable"); }
}

class LogServiceRuntime implements ServiceRuntimeAdapter {
  exists = true;
  tailLines = 0;
  constructor(private readonly output: string) {}
  async start(): Promise<void> {}
  async inspect(): Promise<{ exists: boolean; running: boolean }> { return { exists: this.exists, running: this.exists }; }
  async logs(_workId: string, _serviceId: string, tailLines: number) {
    this.tailLines = tailLines;
    return { text: this.output, truncated: false };
  }
}

class GatedServiceRuntime implements ServiceRuntimeAdapter {
  starts = 0;
  stops = 0;
  revisions: number[] = [];
  definition: ServiceDefinition | undefined;
  readonly started: Promise<void>;
  private signalStarted!: () => void;
  private gate: (() => void) | undefined;
  private released = false;

  constructor(private readonly store: CoreStore) {
    this.started = new Promise<void>((resolve) => { this.signalStarted = resolve; });
  }

  async start(_workId: string, definition: ServiceDefinition): Promise<void> {
    this.starts += 1;
    this.revisions.push(definition.revision);
    this.definition = definition;
    assert.ok(this.store.getService(WORK_ID, definition.serviceId));
    assert.ok(this.store.listOperations().filter((operation) => operation.serviceId === definition.serviceId).length >= 1);
    assert.ok(this.store.getQuotaReservation(definition.serviceId === undefined ? "" : WORK_ID, "service", definition.serviceId));
    this.signalStarted();
    if (this.released) return;
    await new Promise<void>((resolve) => { this.gate = resolve; });
  }

  async stop(_workId: string, _definition: ServiceDefinition): Promise<void> { this.stops += 1; }

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
  store.assignWorkNetworkName(WORK_ID, NOW);
  const configuration = workConfig();
  store.exec(`INSERT INTO quota_reservations(
    work_id, subject_kind, subject_id, desired_cpu_millis, desired_memory_bytes,
    occupied_cpu_millis, occupied_memory_bytes, service_slots, volume_slots, updated_at
  ) VALUES ('${WORK_ID}', 'agent', 'agentd', ${configuration.resources.agentCpuMillis}, ${configuration.resources.agentMemoryBytes},
    ${configuration.resources.agentCpuMillis}, ${configuration.resources.agentMemoryBytes}, 0, 2, '${NOW}')`);
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
    image: { reference: "python:3.13-slim" },
    command: "python3",
    args: [],
    environment: {},
    secretRefs: [],
    mounts: [],
    workingDirectory: "/",
    ports: [{ name: "http", containerPort: 8080, protocol: "tcp" }],
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
    skills: [], packages: [],
    agentsMd: "",
    modelRef: "model-0199e6d8abcd",
    mcpServers: [],
    resources: { cpuMillis: 1_000, memoryBytes: 1_000_000_000, agentCpuMillis: 200, agentMemoryBytes: 200_000_000, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: [], denied: [] },
  };
}
