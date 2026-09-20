import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { ConfigurationRevisionConflictError, CoreStore } from "@piwork/core-store";
import { WorkConfigurationService } from "./work-config.js";

const owner = { userId: "user-1", role: "user" as const };
const NOW = "2026-09-20T00:00:00Z";

test("configuration revisions are immutable and desired/active are queried separately", async () => {
  await withConfiguration(async ({ store, service }) => {
    const updated = service.update(owner, "work-1", 1, config(1, "skill-0199e6d8two"));
    assert.equal(updated.desiredRevision, 2);
    assert.equal(updated.activeRevision, 1);
    assert.equal(updated.pendingRestart, true);
    assert.equal(updated.desired.skills[0]?.catalogId, "skill-0199e6d8two");
    assert.equal(updated.active?.skills[0]?.catalogId, "skill-0199e6d8one");
    const revisions = store.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM work_config_revisions WHERE work_id = 'work-1'",
    );
    assert.equal(revisions?.count, 2);
    const original = store.get<{ config_json: string }>(
      "SELECT config_json FROM work_config_revisions WHERE work_id = 'work-1' AND revision = 1",
    );
    assert.equal((JSON.parse(original?.config_json ?? "{}") as WorkConfig).skills[0]?.catalogId, "skill-0199e6d8one");
  });
});

test("concurrent edits from one expected revision accept one and conflict the other", async () => {
  await withConfiguration(async ({ service }) => {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.update(owner, "work-1", 1, config(1, "skill-0199e6d8aaa"))),
      Promise.resolve().then(() => service.update(owner, "work-1", 1, config(1, "skill-0199e6d8bbb"))),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ConfigurationRevisionConflictError);
  });
});

test("updating a running Work does not change active revision or runtime generation", async () => {
  await withConfiguration(async ({ store, service }) => {
    store.exec(`INSERT INTO runtime_generations(
      work_id, generation, state, retry_count, created_at, updated_at
    ) VALUES ('work-1', 7, 'ready', 0, '${NOW}', '${NOW}')`);
    service.update(owner, "work-1", 1, config(1, "skill-0199e6d8next"));
    const work = store.get<{ desired_revision: number; active_revision: number; observed_state: string }>(
      "SELECT desired_revision, active_revision, observed_state FROM works WHERE id = 'work-1'",
    );
    assert.equal(work?.desired_revision, 2);
    assert.equal(work?.active_revision, 1);
    assert.equal(work?.observed_state, "ready");
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM runtime_generations")?.count, 1);
  });
});

function config(revision: number, skillId: string): WorkConfig {
  return {
    revision,
    agentImage: { catalogId: "image-0199e6d8abcd" },
    skills: [{ catalogId: skillId }],
    modelRef: "model-0199e6d8abcd",
    mcpServers: [],
    resources: { cpuMillis: 1_000, memoryBytes: 1_073_741_824, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: ["read"], denied: [] },
  };
}

async function withConfiguration(
  run: (fixture: { store: CoreStore; service: WorkConfigurationService }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-work-config-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
    VALUES ('user-1', 'alice', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  store.exec(`INSERT INTO works(
    id, owner_user_id, name, desired_state, observed_state,
    desired_revision, active_revision, control_version, created_at, updated_at
  ) VALUES ('work-1', 'user-1', 'fixture', 'running', 'ready', 1, 1, 1, '${NOW}', '${NOW}')`);
  store.exec(`INSERT INTO work_config_revisions(
    work_id, revision, config_json, created_by_user_id, created_at
  ) VALUES ('work-1', 1, '${JSON.stringify(config(1, "skill-0199e6d8one"))}', 'user-1', '${NOW}')`);
  const service = new WorkConfigurationService(store, () => new Date(NOW));
  try {
    await run({ store, service });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
