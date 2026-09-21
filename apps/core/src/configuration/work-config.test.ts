import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { WorkConfigurationService } from "./work-config.js";

const owner = { userId: "user-1", role: "user" as const };
const NOW = "2026-09-20T00:00:00Z";

test("configuration snapshots are immutable and public state is revision-free", async () => {
  await withConfiguration(async ({ store, service }) => {
    const updated = service.update(owner, "work-1", config("skill-two"));
    assert.equal(updated.pendingApply, true);
    assert.equal(updated.desired.skills[0], "skill-two");
    assert.equal(updated.active?.skills[0], "skill-one");
    assert.equal("desiredRevision" in updated, false);
    const revisions = store.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM work_config_revisions WHERE work_id = 'work-1'",
    );
    assert.equal(revisions?.count, 2);
    const original = store.get<{ config_json: string }>(
      "SELECT config_json FROM work_config_revisions WHERE work_id = 'work-1' AND revision = 1",
    );
    assert.equal((JSON.parse(original?.config_json ?? "{}") as WorkConfig).skills[0], "skill-one");
  });
});

test("sequentially committed edits use last-commit-wins without public CAS", async () => {
  await withConfiguration(async ({ service }) => {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.update(owner, "work-1", config("skill-aaa"))),
      Promise.resolve().then(() => service.update(owner, "work-1", config("skill-bbb"))),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(service.get(owner, "work-1").desired.skills[0], "skill-bbb");
  });
});

test("updating a running Work does not change active revision or runtime generation", async () => {
  await withConfiguration(async ({ store, service }) => {
    store.exec(`INSERT INTO runtime_generations(
      work_id, generation, state, retry_count, created_at, updated_at
    ) VALUES ('work-1', 7, 'ready', 0, '${NOW}', '${NOW}')`);
    service.update(owner, "work-1", config("skill-next"));
    const work = store.get<{ desired_revision: number; active_revision: number; observed_state: string }>(
      "SELECT desired_revision, active_revision, observed_state FROM works WHERE id = 'work-1'",
    );
    assert.equal(work?.desired_revision, 2);
    assert.equal(work?.active_revision, 1);
    assert.equal(work?.observed_state, "ready");
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM runtime_generations")?.count, 1);
  });
});

test("field updates retry against the latest desired state and preserve unrelated fields", async () => {
  await withConfiguration(async ({ service }) => {
    let releaseFirst!: () => void;
    let firstPrepared!: () => void;
    const prepared = new Promise<void>((resolve) => { firstPrepared = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstAttempt = true;
    const skills = service.updateMerged(owner, "work-1", (current) => ({ ...current, skills: ["skill-next"] }), async () => {
      if (firstAttempt) { firstAttempt = false; firstPrepared(); await gate; }
      return { runtimeProfileJson: "{}", sourceRuntimeRevision: null };
    });
    await prepared;
    const agents = await service.updateMerged(owner, "work-1", (current) => ({ ...current, agentsMd: "new agents" }), async () => ({
      runtimeProfileJson: "{}", sourceRuntimeRevision: null,
    }));
    releaseFirst();
    await skills;
    const desired = service.get(owner, "work-1").desired;
    assert.equal(agents.desired.agentsMd, "new agents");
    assert.equal(desired.agentsMd, "new agents");
    assert.deepEqual(desired.skills, ["skill-next"]);
  });
});

function config(skillId: string): WorkConfig {
  return {
    agentImage: { catalogId: "image-0199e6d8abcd" },
    skills: [skillId],
    agentsMd: "",
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
  ) VALUES ('work-1', 1, '${JSON.stringify(config("skill-one"))}', 'user-1', '${NOW}')`);
  const service = new WorkConfigurationService(store, () => new Date(NOW));
  try {
    await run({ store, service });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
