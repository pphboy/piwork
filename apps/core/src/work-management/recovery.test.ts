import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import type { WorkRuntimeAdapter, WorkRuntimeState } from "./lifecycle.js";
import { WorkRecoveryPolicy } from "./recovery.js";

test("retry budget survives Core restart, uses 1/5/15 second backoff, exhausts, and resets after stable ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-recovery-"));
  const databasePath = join(root, "core.sqlite");
  let clock = new Date("2026-09-20T00:00:00.000Z");
  let store = CoreStore.open({ databasePath });
  seed(store, clock.toISOString());
  const runtime = new HealthRuntime();
  let policy = new WorkRecoveryPolicy(store, runtime, () => clock);
  try {
    let state = await policy.healthCheck("work-1", 1);
    assert.equal(state.retryCount, 1);
    assert.equal(state.nextRetryAt, "2026-09-20T00:00:01.000Z");
    store.close();

    store = CoreStore.open({ databasePath });
    policy = new WorkRecoveryPolicy(store, runtime, () => clock);
    clock = new Date("2026-09-20T00:00:01.000Z");
    assert.equal(policy.dueRetries().length, 1);
    state = await policy.healthCheck("work-1", 1);
    assert.equal(state.retryCount, 2);
    assert.equal(state.nextRetryAt, "2026-09-20T00:00:06.000Z");
    clock = new Date("2026-09-20T00:00:06.000Z");
    state = await policy.healthCheck("work-1", 1);
    assert.equal(state.retryCount, 3);
    assert.equal(state.nextRetryAt, "2026-09-20T00:00:21.000Z");
    clock = new Date("2026-09-20T00:00:21.000Z");
    state = await policy.healthCheck("work-1", 1);
    assert.equal(state.state, "failed");
    assert.equal(state.nextRetryAt, null);

    state = policy.explicitRetry("work-1", 1);
    assert.equal(state.retryCount, 0);
    runtime.state = { exists: true, running: true, ready: true, instanceId: "healthy", generation: 1 };
    state = await policy.healthCheck("work-1", 1);
    assert.equal(state.readySince, clock.toISOString());
    store.updateRuntimeGeneration("work-1", 1, "ready", "2026-09-20T00:10:21.000Z", {
      instanceId: "healthy",
      readySince: clock.toISOString(),
    });
    clock = new Date("2026-09-20T00:10:21.000Z");
    state = await policy.healthCheck("work-1", 1);
    assert.equal(state.retryCount, 0);
    assert.equal(state.retryWindowStartedAt, null);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

class HealthRuntime implements WorkRuntimeAdapter {
  state: WorkRuntimeState = { exists: false, running: false, ready: false };
  async prepare() {}
  async start(_work: unknown, generation: number) { return { instanceId: "fixture", generation }; }
  async inspect() { return this.state; }
  async drain() {}
  async stop() {}
  async remove() {}
}

function seed(store: CoreStore, now: string): void {
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
    VALUES ('user-1', 'alice', 'digest', 'user', 1, '${now}', '${now}')`);
  store.exec(`INSERT INTO works(
    id, owner_user_id, name, desired_state, observed_state,
    desired_revision, active_revision, control_version, created_at, updated_at
  ) VALUES ('work-1', 'user-1', 'fixture', 'running', 'ready', 1, 1, 1, '${now}', '${now}')`);
  store.ensureRuntimeGeneration("work-1", 1, now);
  store.updateRuntimeGeneration("work-1", 1, "ready", now, { instanceId: "fixture", readySince: now });
}
