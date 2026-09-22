import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore, type WorkContextSnapshotInput } from "@piwork/core-store";
import { createWorkHttpServer } from "./http-api.js";
import { WorkLifecycleService, WorkResourceQuotaError, type WorkRuntimeAdapter, type WorkRuntimeState } from "./lifecycle.js";
import { WorkConfigurationService } from "../configuration/work-config.js";
import { WorkContextStore } from "../configuration/work-context.js";

const NOW = "2026-09-20T00:00:00.000Z";
const owner = { userId: "user-owner", role: "user" as const };
const IMAGE_A = `sha256:${"a".repeat(64)}`;
const IMAGE_B = `sha256:${"b".repeat(64)}`;
const PROFILE_A = JSON.stringify({ version: 1, revision: 1, agentImage: "image:a", model: { provider: "test", id: "a", credentialRef: "a.secret" }, updatedAt: NOW });

test("HTTP Work lifecycle is authorized, idempotent, asynchronous, and follows the latest persisted target", async () => {
  await withFixture(async ({ store, lifecycle, runtime, create }) => {
    const server = createWorkHttpServer(
      lifecycle,
      { authenticate: (token) => token === "owner" ? owner : { userId: "user-other", role: "user" } },
      undefined,
      (_principal, input) => create(input),
    );
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

test("startup recovery adopts an existing instance and Core shutdown stops it", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const accepted = create({ name: "adopt", configuration: config(), idempotencyKey: "adopt-1" });
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
    await lifecycle.shutdown(true);
    assert.equal(runtime.state.running, false);
    assert.equal(store.getWork(accepted.workId)?.observedState, "stopped");

    const restarted = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, undefined, contexts);
    await restarted.recover();
    assert.equal(runtime.state.running, true);
    assert.equal(store.getWork(accepted.workId)?.observedState, "ready");
    assert.ok(store.listOperations().some((operation) =>
      operation.workId === accepted.workId && operation.kind === "recover-work-after-core-restart" && operation.state === "succeeded"));
  });
});

test("Core shutdown still stops the agent and reports failure when a service cannot confirm shutdown", async () => {
  await withFixture(async ({ store, lifecycle: original, runtime, contexts, create }) => {
    const created = create({ name: "shutdown-failure", configuration: config(), idempotencyKey: "shutdown-failure-1" });
    await original.waitForIdle();
    const lifecycle = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, {
      async prepareEnabledServices() {},
      async stopServices() { throw new Error("service remains running"); },
      async removeServiceInstances() {},
    }, contexts);
    runtime.events.length = 0;
    await assert.rejects(lifecycle.shutdown(true), AggregateError);
    assert.ok(runtime.events.includes("stop"));
    assert.equal(runtime.state.running, false);
    assert.notEqual(store.getWork(created.workId)?.observedState, "stopped");
  });
});

test("Work acceptance reserves agent allocation and rejects host oversubscription transactionally", async () => {
  await withFixture(async ({ store, runtime, contexts, createInput }) => {
    const limited = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, undefined, contexts, undefined, undefined, {
      cpuMillis: 700,
      memoryBytes: 700 * 1_024 * 1_024,
    });
    const first = limited.create(owner, createInput({ name: "quota-a", configuration: config(), idempotencyKey: "quota-a" }));
    assert.equal(store.getQuotaReservation(first.workId, "agent", "agentd")?.desiredCpuMillis, 500);
    assert.throws(
      () => limited.create(owner, createInput({ name: "quota-b", configuration: config(), idempotencyKey: "quota-b" })),
      WorkResourceQuotaError,
    );
    assert.equal(store.listWorks().length, 1);
    await limited.waitForIdle();
  });
});

test("recovery closes an unfinished Operation stage as interrupted before continuing", async () => {
  await withFixture(async ({ store, lifecycle, create }) => {
    const accepted = create({ name: "recover-operation", configuration: config(), idempotencyKey: "recover-operation-1" });
    await lifecycle.waitForIdle();
    store.updateOperation(accepted.operationId, "running", NOW);

    await lifecycle.recover();

    const operation = store.getOperation(accepted.operationId)!;
    assert.equal(operation.state, "succeeded");
    const diagnostics = JSON.parse(operation.resultJson ?? "{}").diagnostics as { stages?: Array<{ outcome?: string }> };
    assert.ok(diagnostics.stages?.some((stage) => stage.outcome === "interrupted"));
  });
});

test("Operation persistence failure emits a safe stderr fallback and leaves the Operation incomplete", async () => {
  await withFixture(async ({ store, runtime, contexts, createInput }) => {
    const lines: string[] = [];
    const lifecycle = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, undefined, contexts, {
      write(line) { lines.push(line); },
    });
    const original = store.updateOperation.bind(store);
    const accepted = lifecycle.create(owner, createInput({ name: "persist-failure", configuration: config(), idempotencyKey: "persist-failure-1" }));
    (store as unknown as { updateOperation: CoreStore["updateOperation"] }).updateOperation = () => { throw new Error("token=abc /host/private"); };
    try {
      await lifecycle.waitForIdle();
    } finally {
      (store as unknown as { updateOperation: CoreStore["updateOperation"] }).updateOperation = original;
    }
    assert.equal(store.getOperation(accepted.operationId)?.state, "pending");
    assert.equal(runtime.starts, 0);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /DIAGNOSTIC_PERSIST_FAILED/);
    assert.doesNotMatch(lines[0]!, /token=abc|host\/private/);
  });
});

test("delete drains in order, unknown shutdown never reports stopped, and stopped Works stay stopped on recovery", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const created = create({ name: "ordered-delete", configuration: config(), idempotencyKey: "ordered-1" });
    await lifecycle.waitForIdle();
    runtime.events.length = 0;
    const serviceEvents: string[] = [];
    const ordered = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, {
      async prepareEnabledServices() { serviceEvents.push("services-prepare"); },
      async stopServices() { serviceEvents.push("services-stop"); runtime.events.push("services-stop"); },
      async removeServiceInstances() { serviceEvents.push("services-remove"); runtime.events.push("services-remove"); },
    }, contexts);
    ordered.delete(owner, created.workId, "delete-ordered");
    await ordered.waitForIdle();
    assert.deepEqual(runtime.events, ["drain", "services-stop", "stop", "services-remove", "remove"]);
    assert.equal(store.getWork(created.workId, true)?.observedState, "deleted");

    const stopped = create({ name: "stay-stopped", configuration: config(), idempotencyKey: "stopped-1" });
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
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const profileA = PROFILE_A;
    const profileB = JSON.stringify({ version: 1, revision: 2, agentImage: "image:b", model: { provider: "test", id: "b", credentialRef: "b.secret" }, updatedAt: NOW });
    const created = create({ name: "config-apply", configuration: config(), idempotencyKey: "config-create", runtimeProfileJson: profileA, sourceRuntimeRevision: 1 });
    await lifecycle.waitForIdle();
    assert.equal(store.getWorkConfiguration(created.workId)?.activeRevision, 1);
    runtime.events.length = 0;

    const configurations = new WorkConfigurationService(store, () => new Date(NOW));
    const configurationB = { ...config(), modelRef: "model-0199e6d8next" };
    configurations.update(owner, created.workId, 1, configurationB, {
      runtimeProfileJson: profileB,
      sourceRuntimeRevision: 2,
      snapshot: capture(contexts, created.workId, configurationB, "context-config-b", IMAGE_B),
    });
    assert.equal(store.getWorkConfiguration(created.workId)?.activeRevision, 1);
    assert.equal(store.getWorkConfiguration(created.workId)?.pendingRestart, true);
    assert.deepEqual(runtime.events, []);
    assert.equal(runtime.state.running, true);

    runtime.failPrepare = true;
    const failed = lifecycle.applyConfiguration(owner, created.workId, "config-apply-failed", 2);
    await lifecycle.waitForIdle();
    assert.equal(store.getOperation(failed.operationId)?.state, "failed");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeRevision, 1);
    assert.equal(runtime.state.running, true);
    assert.deepEqual(runtime.events, []);

    runtime.failPrepare = false;
    const succeeded = lifecycle.applyConfiguration(owner, created.workId, "config-apply-success", 2);
    await lifecycle.waitForIdle();
    const applied = store.getWorkConfiguration(created.workId)!;
    assert.equal(applied.activeRevision, 2);
    assert.equal(applied.pendingRestart, false);
    assert.deepEqual(runtime.events, ["prepare-change", "stop", "remove"]);
    assert.equal(runtime.state.ready, true);
    const applyOperations = store.listOperations().filter((operation) => operation.kind === "apply-work-configuration");
    assert.equal(applyOperations.length, 2);
    assert.equal(JSON.parse(store.getOperation(succeeded.operationId)!.requestJson).capturedRevision, 2);
    assert.equal(store.getOperation(succeeded.operationId)!.state, "succeeded");
  });
});

test("initial activation remains null until runtime readiness completes", async () => {
  await withFixture(async ({ store, lifecycle, runtime, create }) => {
    runtime.holdStart = true;
    const created = create({ name: "held-create", configuration: config(), idempotencyKey: "held-create-1" });
    await runtime.waitUntilStartIsHeld();
    const during = store.getWorkConfiguration(created.workId)!;
    assert.equal(during.activeContextId, null);
    assert.equal(during.pendingRestart, true);
    assert.equal(store.getOperation(created.operationId)?.state, "running");
    runtime.release();
    await lifecycle.waitForIdle();
    assert.notEqual(store.getWorkConfiguration(created.workId)?.activeContextId, null);
  });
});

test("apply replay is stable after edits and a distinct key retries the retained candidate", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const created = create({ name: "apply-replay", configuration: config(), idempotencyKey: "replay-create" });
    await lifecycle.waitForIdle();
    const configurations = new WorkConfigurationService(store, () => new Date(NOW));
    const candidate = { ...config(), agentsMd: "candidate B" };
    configurations.update(owner, created.workId, candidate, undefined, {
      runtimeProfileJson: PROFILE_A, sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, candidate, "context-replay-b"),
    });
    runtime.failPrepare = true;
    const first = lifecycle.applyConfiguration(owner, created.workId, "apply-stable-key");
    await lifecycle.waitForIdle();
    assert.equal(store.getOperation(first.operationId)?.state, "failed");

    const later = { ...config(), agentsMd: "candidate C" };
    configurations.update(owner, created.workId, later, undefined, {
      runtimeProfileJson: PROFILE_A, sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, later, "context-replay-c"),
    });
    const startsBeforeReplay = runtime.starts;
    const replay = lifecycle.applyConfiguration(owner, created.workId, "apply-stable-key");
    await lifecycle.waitForIdle();
    assert.deepEqual(replay, { ...first, reused: true });
    assert.equal(runtime.starts, startsBeforeReplay);
    assert.equal(store.getOperation(first.operationId)?.state, "failed");

    runtime.failPrepare = false;
    const retry = lifecycle.applyConfiguration(owner, created.workId, "apply-new-key");
    await lifecycle.waitForIdle();
    assert.notEqual(retry.operationId, first.operationId);
    assert.equal(store.getOperation(retry.operationId)?.state, "succeeded");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, "context-replay-c");
  });
});

test("stopped apply validates in initialization-only mode and remains stopped", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const created = create({ name: "stopped-apply", configuration: config(), idempotencyKey: "stopped-create" });
    await lifecycle.waitForIdle();
    lifecycle.stop(owner, created.workId, "stopped-stop");
    await lifecycle.waitForIdle();

    const candidate = { ...config(), agentsMd: "validated while stopped" };
    new WorkConfigurationService(store, () => new Date(NOW)).update(owner, created.workId, candidate, undefined, {
      runtimeProfileJson: PROFILE_A,
      sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, candidate, "context-stopped-candidate"),
    });
    runtime.events.length = 0;
    const applied = lifecycle.applyConfiguration(owner, created.workId, "stopped-apply-operation");
    await lifecycle.waitForIdle();

    assert.equal(store.getOperation(applied.operationId)?.state, "succeeded");
    assert.equal(store.getWork(created.workId)?.desiredState, "stopped");
    assert.equal(store.getWork(created.workId)?.observedState, "stopped");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, "context-stopped-candidate");
    assert.equal(runtime.startConfigurations.at(-1)?.initializationOnly, true);
    assert.deepEqual(runtime.events, ["stop", "remove"]);
    assert.equal(runtime.state.exists, false);
  });
});

test("busy configuration preparation preserves the active runtime and context", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const created = create({ name: "busy-apply", configuration: config(), idempotencyKey: "busy-create" });
    await lifecycle.waitForIdle();
    const activeContextId = store.getWorkConfiguration(created.workId)!.activeContextId;
    const candidate = { ...config(), agentsMd: "pending while busy" };
    new WorkConfigurationService(store, () => new Date(NOW)).update(owner, created.workId, candidate, undefined, {
      runtimeProfileJson: PROFILE_A,
      sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, candidate, "context-busy-candidate"),
    });
    runtime.activeRunCount = 1;
    runtime.events.length = 0;

    const applied = lifecycle.applyConfiguration(owner, created.workId, "busy-apply-operation");
    await lifecycle.waitForIdle();

    assert.equal(store.getOperation(applied.operationId)?.state, "failed");
    assert.equal(JSON.parse(store.getOperation(applied.operationId)?.errorJson ?? "{}").code, "WORK_BUSY");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, activeContextId);
    assert.equal(store.getWorkConfiguration(created.workId)?.desiredContextId, "context-busy-candidate");
    assert.equal(store.getWork(created.workId)?.observedState, "ready");
    assert.equal(runtime.state.running, true);
    assert.deepEqual(runtime.events, ["prepare-change"]);
  });
});

test("apply activates its captured configuration while a later desired edit remains pending", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const profile = PROFILE_A;
    const created = create({ name: "apply-race", configuration: config(), idempotencyKey: "race-create", runtimeProfileJson: profile, sourceRuntimeRevision: 1 });
    await lifecycle.waitForIdle();
    const configurations = new WorkConfigurationService(store, () => new Date(NOW));
    const configurationB = { ...config(), agentsMd: "B" };
    configurations.update(owner, created.workId, configurationB, undefined, {
      runtimeProfileJson: profile,
      sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, configurationB, "context-race-b"),
    });

    runtime.holdStart = true;
    lifecycle.applyConfiguration(owner, created.workId, "apply-b");
    await runtime.waitUntilStartIsHeld();
    const configurationC = { ...config(), agentsMd: "C" };
    configurations.update(owner, created.workId, configurationC, undefined, {
      runtimeProfileJson: profile,
      sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, configurationC, "context-race-c"),
    });
    runtime.release();

    await lifecycle.waitForIdle();
    const applied = store.getWorkConfiguration(created.workId)!;
    assert.equal(applied.activeRevision, 2);
    assert.equal(applied.desiredRevision, 3);
    assert.equal(applied.pendingRestart, true);
    assert.equal(JSON.parse(applied.activeConfigJson ?? "{}").agentsMd, "B");
    assert.equal(JSON.parse(applied.desiredConfigJson).agentsMd, "C");
    assert.equal(runtime.startConfigurations.at(-1)?.contextIdentity, "context-race-b");
    assert.equal(runtime.startConfigurations.at(-1)?.imageIdentity, IMAGE_A);

    const before = store.listOperations().filter((operation) => operation.kind === "apply-work-configuration").length;
    lifecycle.applyConfiguration(owner, created.workId, "apply-c");
    await lifecycle.waitForIdle();
    const appliedC = store.getWorkConfiguration(created.workId)!;
    assert.equal(appliedC.pendingRestart, false);
    assert.equal(appliedC.activeRevision, 3);
    const after = store.listOperations().filter((operation) => operation.kind === "apply-work-configuration").length;
    assert.equal(after, before + 1);
  });
});

test("stop accepted during candidate initialization supersedes apply before activation", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const created = create({ name: "superseded-apply", configuration: config(), idempotencyKey: "superseded-create" });
    await lifecycle.waitForIdle();
    const active = store.getWorkConfiguration(created.workId)!.activeContextId;
    const candidate = { ...config(), agentsMd: "candidate while stopping" };
    new WorkConfigurationService(store, () => new Date(NOW)).update(owner, created.workId, candidate, undefined, {
      runtimeProfileJson: PROFILE_A, sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, candidate, "context-superseded"),
    });
    runtime.holdStart = true;
    const applied = lifecycle.applyConfiguration(owner, created.workId, "superseded-apply-operation");
    await runtime.waitUntilStartIsHeld();
    const stopped = lifecycle.stop(owner, created.workId, "superseding-stop");
    runtime.release();
    await lifecycle.waitForIdle();

    assert.equal(store.getOperation(applied.operationId)?.state, "superseded");
    assert.equal(store.getOperation(stopped.operationId)?.state, "succeeded");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, active);
    assert.equal(store.getWork(created.workId)?.observedState, "stopped");
    assert.equal(runtime.state.running, false);
  });
});

test("stopped apply cannot activate when candidate shutdown is uncertain", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const created = create({ name: "uncertain-shutdown", configuration: config(), idempotencyKey: "uncertain-create" });
    await lifecycle.waitForIdle();
    lifecycle.stop(owner, created.workId, "uncertain-stop");
    await lifecycle.waitForIdle();
    const active = store.getWorkConfiguration(created.workId)!.activeContextId;
    const candidate = { ...config(), agentsMd: "must remain pending" };
    new WorkConfigurationService(store, () => new Date(NOW)).update(owner, created.workId, candidate, undefined, {
      runtimeProfileJson: PROFILE_A, sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, candidate, "context-uncertain"),
    });
    runtime.leaveRunningOnStop = true;
    const applied = lifecycle.applyConfiguration(owner, created.workId, "uncertain-apply");
    await lifecycle.waitForIdle();
    assert.equal(store.getOperation(applied.operationId)?.state, "failed");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, active);
    assert.equal(store.getWork(created.workId)?.observedState, "failed");
    assert.equal(runtime.starts, 2);
  });
});

test("failed replacement restores the active context and records rollback failure separately", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    const created = create({ name: "rollback", configuration: config(), idempotencyKey: "rollback-create", snapshotId: "context-rollback-a" });
    await lifecycle.waitForIdle();
    const candidate = { ...config(), agentsMd: "candidate B" };
    new WorkConfigurationService(store, () => new Date(NOW)).update(owner, created.workId, candidate, undefined, {
      runtimeProfileJson: PROFILE_A, sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, candidate, "context-rollback-b"),
    });
    runtime.failStartContexts.add("context-rollback-b");
    const applied = lifecycle.applyConfiguration(owner, created.workId, "rollback-success");
    await lifecycle.waitForIdle();
    const operation = lifecycle.operation(owner, applied.operationId);
    assert.equal(operation.state, "failed");
    assert.equal(operation.diagnostics.rollback.state, "succeeded");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, "context-rollback-a");
    assert.equal(runtime.startConfigurations.at(-1)?.contextIdentity, "context-rollback-a");
    assert.equal(store.getWork(created.workId)?.observedState, "ready");

    runtime.failStartContexts.add("context-rollback-a");
    const retry = lifecycle.applyConfiguration(owner, created.workId, "rollback-failed");
    await lifecycle.waitForIdle();
    const failed = lifecycle.operation(owner, retry.operationId);
    assert.equal(failed.state, "failed");
    assert.equal(failed.diagnostics.rollback.state, "failed");
    assert.equal(failed.diagnostics.rollback.error?.code, "ROLLBACK_FAILED");
    assert.equal(store.getWork(created.workId)?.observedState, "failed");
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, "context-rollback-a");
  });
});

test("initial retry retains the create Operation context after desired advances", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, create }) => {
    runtime.failPrepare = true;
    const created = create({
      name: "initial-retry",
      configuration: config(),
      idempotencyKey: "initial-retry-create",
      snapshotId: "context-initial",
    });
    await lifecycle.waitForIdle();
    assert.equal(store.getWorkConfiguration(created.workId)?.activeContextId, null);

    const desired = { ...config(), agentsMd: "later desired" };
    new WorkConfigurationService(store, () => new Date(NOW)).update(owner, created.workId, desired, undefined, {
      runtimeProfileJson: PROFILE_A,
      sourceRuntimeRevision: 1,
      snapshot: capture(contexts, created.workId, desired, "context-later"),
    });

    runtime.failPrepare = false;
    const retry = lifecycle.retry(owner, created.workId, "initial-retry-operation");
    await lifecycle.waitForIdle();

    assert.equal(store.getOperation(retry.operationId)?.state, "succeeded");
    assert.equal(runtime.startConfigurations.at(-1)?.contextIdentity, "context-initial");
    const state = store.getWorkConfiguration(created.workId)!;
    assert.equal(state.activeContextId, "context-initial");
    assert.equal(state.desiredContextId, "context-later");
    assert.equal(state.pendingRestart, true);
  });
});

test("missing, mismatched, and wrongly owned captured contexts fail before runtime start", async () => {
  await withFixture(async ({ store, lifecycle, runtime, contexts, createInput }) => {
    const missing = lifecycle.create(owner, {
      workId: "work-context-missing",
      name: "missing",
      configuration: config(),
      idempotencyKey: "missing-context",
      runtimeProfileJson: PROFILE_A,
      sourceRuntimeRevision: 1,
    });
    await lifecycle.waitForIdle();
    assert.equal(JSON.parse(store.getOperation(missing.operationId)?.errorJson ?? "{}").code, "CONTEXT_NOT_FOUND");

    const metadataInput = createInput({
      workId: "work-context-metadata",
      name: "metadata",
      configuration: config(),
      idempotencyKey: "mismatched-metadata",
      snapshotId: "context-metadata",
    });
    const metadata = lifecycle.create(owner, {
      ...metadataInput,
      snapshot: { ...metadataInput.snapshot!, imageIdentity: IMAGE_B },
    });
    await lifecycle.waitForIdle();
    assert.equal(JSON.parse(store.getOperation(metadata.operationId)?.errorJson ?? "{}").code, "SKILL_VALIDATION_FAILED");

    const ownershipInput = createInput({
      workId: "work-context-ownership",
      name: "ownership",
      configuration: config(),
      idempotencyKey: "mismatched-ownership",
      snapshotId: "context-ownership",
    });
    const metadataPath = join(contexts.rootDirectory, "work-context-ownership", "contexts", "context-ownership", "metadata.json");
    await chmod(metadataPath, 0o600);
    await writeFile(metadataPath, `${JSON.stringify({
      version: 1,
      snapshotId: "context-ownership",
      workId: "work-another-owner",
      imageIdentity: IMAGE_A,
      skills: [],
      createdAt: NOW,
    })}\n`);
    const ownership = lifecycle.create(owner, ownershipInput);
    await lifecycle.waitForIdle();
    assert.equal(JSON.parse(store.getOperation(ownership.operationId)?.errorJson ?? "{}").code, "SKILL_VALIDATION_FAILED");
    assert.equal(runtime.starts, 0);
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
  activeRunCount = 0;
  leaveRunningOnStop = false;
  failStartContexts = new Set<string>();
  events: string[] = [];
  startConfigurations: Array<Parameters<WorkRuntimeAdapter["start"]>[2]> = [];
  private gate: (() => void) | undefined;
  private startHeld: (() => void) | undefined;

  async prepare(): Promise<void> { if (this.failPrepare) throw new Error("prepare failed"); this.prepares += 1; }
  async prepareConfigurationChange(): Promise<{ prepared: boolean; busy: boolean; activeRunCount: number }> {
    this.events.push("prepare-change");
    return { prepared: this.activeRunCount === 0, busy: this.activeRunCount > 0, activeRunCount: this.activeRunCount };
  }
  async start(_work: unknown, generation: number, configuration?: Parameters<WorkRuntimeAdapter["start"]>[2]): Promise<{ instanceId: string; generation: number }> {
    this.starts += 1;
    this.startConfigurations.push(configuration);
    if (this.holdStart) await new Promise<void>((resolve) => {
      this.gate = resolve;
      this.startHeld?.();
      this.startHeld = undefined;
    });
    if (configuration !== undefined && this.failStartContexts.has(configuration.contextIdentity)) {
      throw new Error("runtime candidate failed");
    }
    this.state = { exists: true, running: true, ready: true, instanceId: `instance-${generation}`, generation };
    return { instanceId: `instance-${generation}`, generation };
  }
  async inspect(): Promise<WorkRuntimeState> { if (this.failInspect) throw new Error("runtime state unknown"); return this.state; }
  async drain(): Promise<void> { this.events.push("drain"); }
  async stop(): Promise<void> {
    this.events.push("stop");
    if (!this.leaveRunningOnStop) this.state = { ...this.state, running: false, ready: false };
  }
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

interface FixtureCreateInput {
  readonly name: string;
  readonly configuration: WorkConfig;
  readonly idempotencyKey: string;
  readonly runtimeProfileJson?: string;
  readonly sourceRuntimeRevision?: number;
  readonly workId?: string;
  readonly snapshotId?: string;
  readonly imageIdentity?: string;
}

async function withFixture(run: (fixture: {
  store: CoreStore;
  lifecycle: WorkLifecycleService;
  runtime: FakeRuntime;
  contexts: WorkContextStore;
  create: (input: FixtureCreateInput) => ReturnType<WorkLifecycleService["create"]>;
  createInput: (input: FixtureCreateInput) => Parameters<WorkLifecycleService["create"]>[1];
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "piwork-lifecycle-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at) VALUES
    ('user-owner', 'owner', 'digest', 'user', 1, '${NOW}', '${NOW}'),
    ('user-other', 'other', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  const runtime = new FakeRuntime();
  const contexts = new WorkContextStore(join(root, "works"));
  const lifecycle = new WorkLifecycleService(store, runtime, () => new Date(NOW), 10, 10, undefined, contexts);
  let sequence = 0;
  const createInput = (input: FixtureCreateInput): Parameters<WorkLifecycleService["create"]>[1] => {
    const workId = input.workId ?? `work-fixture-${++sequence}`;
    return {
      name: input.name,
      configuration: input.configuration,
      idempotencyKey: input.idempotencyKey,
      runtimeProfileJson: input.runtimeProfileJson ?? PROFILE_A,
      sourceRuntimeRevision: input.sourceRuntimeRevision ?? 1,
      workId,
      snapshot: capture(contexts, workId, input.configuration, input.snapshotId ?? `context-${sequence}`, input.imageIdentity ?? IMAGE_A),
    };
  };
  const create = (input: FixtureCreateInput) => lifecycle.create(owner, createInput(input));
  try { await run({ store, lifecycle, runtime, contexts, create, createInput }); }
  finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

function capture(
  contexts: WorkContextStore,
  workId: string,
  configuration: WorkConfig,
  snapshotId: string,
  imageIdentity = IMAGE_A,
): WorkContextSnapshotInput {
  const snapshot = contexts.build({
    workId,
    snapshotId,
    configuration,
    imageIdentity,
    skills: [],
    createdAt: NOW,
  });
  return {
    snapshotId: snapshot.snapshotId,
    configurationJson: JSON.stringify(snapshot.configuration),
    imageIdentity: snapshot.metadata.imageIdentity,
    createdByUserId: owner.userId,
    createdAt: snapshot.metadata.createdAt,
  };
}

function config(): WorkConfig {
  return {
    agentImage: { catalogId: "image-0199e6d8abcd" },
    skills: [], agentsMd: "", modelRef: "model-0199e6d8abcd", mcpServers: [],
    resources: { cpuMillis: 1000, memoryBytes: 1_073_741_824, agentCpuMillis: 500, agentMemoryBytes: 536_870_912, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: [], denied: [] },
  };
}
