import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { SkillArtifactStore } from "./skill-artifact-store.js";
import { WorkContextStore } from "./work-context.js";
import { WorkContextMigration } from "./work-context-migration.js";
import { inspectSkillTree } from "./skill-tree.js";

const NOW = "2026-09-21T00:00:00.000Z";

test("legacy Work migration creates active and desired snapshots without adopting defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-work-migration-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
      VALUES ('user-1', 'alice', 'digest', 'admin', 1, '${NOW}', '${NOW}')`);
    store.createCatalogEntry({ id: "image-0199e6d8abcd", kind: "agent_image", name: "image", mutableReference: "image:old", resolvedDigest: `sha256:${"a".repeat(64)}`, metadataJson: "{}", enabled: true, createdAt: NOW, updatedAt: NOW });
    store.createCatalogEntry({ id: "model-0199e6d8abcd", kind: "model", name: "model", mutableReference: null, resolvedDigest: null, metadataJson: JSON.stringify({ version: 1, provider: "piwork-deterministic", id: "deterministic", credentialRef: "none", sourceRuntimeRevision: 1, updatedAt: NOW }), enabled: true, createdAt: NOW, updatedAt: NOW });
    store.exec(`INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, active_revision, control_version, created_at, updated_at)
      VALUES ('work-1', 'user-1', 'legacy', 'stopped', 'stopped', 2, 1, 1, '${NOW}', '${NOW}')`);
    const config = JSON.stringify({ agentImage: { catalogId: "image-0199e6d8abcd" }, skills: [], agentsMd: "legacy agents", modelRef: "model-0199e6d8abcd", mcpServers: [], resources: { cpuMillis: 1000, memoryBytes: 64 * 1024 * 1024, maxServices: 0, maxRetainedVolumes: 0 }, tools: { allowed: [], denied: [] } });
    store.exec(`INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at)
      VALUES ('work-1', 1, '${config.replace(/'/g, "''")}', 'user-1', '${NOW}'), ('work-1', 2, '${config.replace(/'/g, "''")}', 'user-1', '${NOW}')`);
    store.setControlMetadata("default_work_configuration", { version: 1, revision: 1, configuration: { ...JSON.parse(config), agentsMd: "new defaults" } }, NOW);
    const contexts = new WorkContextStore(join(root, "works"));
    const migration = new WorkContextMigration(store, contexts, new SkillArtifactStore(join(root, "skills")), join(root, "runtime"), () => new Date(NOW));
    migration.migrate();
    const state = store.getWorkConfiguration("work-1")!;
    assert.ok(state.desiredContextId);
    assert.ok(state.activeContextId);
    assert.equal(state.pendingRestart, true);
    assert.equal(JSON.parse(state.desiredConfigJson).agentsMd, "legacy agents");
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "work-1")?.state, "succeeded");
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "default-work")?.state, "succeeded");
    assert.equal((store.getDefaultWorkConfiguration()?.configuration as { agentsMd: string }).agentsMd, "new defaults");
    migration.migrate();
    assert.equal(store.listFilesystemMigrations("legacy-work-context-v1").filter((item) => item.itemKey === "work-1").length, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("running legacy Work prefers its materialized context when the source Skill is gone", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-work-migration-runtime-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
      VALUES ('user-1', 'alice', 'digest', 'admin', 1, '${NOW}', '${NOW}')`);
    store.createCatalogEntry({ id: "image-0199e6d8abcd", kind: "agent_image", name: "image", mutableReference: "image:old", resolvedDigest: `sha256:${"a".repeat(64)}`, metadataJson: "{}", enabled: true, createdAt: NOW, updatedAt: NOW });
    store.exec(`INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, active_revision, control_version, created_at, updated_at)
      VALUES ('work-2', 'user-1', 'running-legacy', 'running', 'ready', 1, 1, 1, '${NOW}', '${NOW}')`);
    const legacy = JSON.stringify({
      revision: 1,
      agentImage: { catalogId: "image-0199e6d8abcd", digest: "legacy-public-value" },
      skills: [{ catalogId: "lost-skill", digest: "legacy-public-value" }],
      agentsMd: "database agents",
      agentsMdPath: "/legacy/AGENTS.md",
      modelRef: "model-0199e6d8abcd",
      mcpServers: [],
      resources: { cpuMillis: 1000, memoryBytes: 64 * 1024 * 1024, maxServices: 0, maxRetainedVolumes: 0 },
      tools: { allowed: [], denied: [] },
    });
    store.exec(`INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at)
      VALUES ('work-2', 1, '${legacy.replace(/'/g, "''")}', 'user-1', '${NOW}')`);
    const runtime = join(root, "runtime", "work-2", "context", "1");
    mkdirSync(join(runtime, "skills", "lost-skill"), { recursive: true });
    writeFileSync(join(runtime, "skills", "lost-skill", "SKILL.md"), "opaque legacy bytes\n");
    writeFileSync(join(runtime, "skills", "lost-skill", "support.txt"), "retained support\n");
    writeFileSync(join(runtime, "AGENTS.md"), "materialized agents");

    const contexts = new WorkContextStore(join(root, "works"));
    new WorkContextMigration(store, contexts, new SkillArtifactStore(join(root, "skills")), join(root, "runtime"), () => new Date(NOW)).migrate();

    const state = store.getWorkConfiguration("work-2")!;
    assert.equal(state.activeContextId, state.desiredContextId);
    assert.equal(state.pendingRestart, false);
    assert.equal(JSON.parse(state.activeConfigJson!).agentsMd, "materialized agents");
    const snapshot = contexts.load("work-2", state.activeContextId!);
    assert.equal(snapshot.configuration.skills[0], "lost-skill");
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "work-2")?.state, "succeeded");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pending legacy failure preserves a reconstructable active snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-work-migration-pending-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
      VALUES ('user-1', 'alice', 'digest', 'admin', 1, '${NOW}', '${NOW}')`);
    store.createCatalogEntry({ id: "image-0199e6d8abcd", kind: "agent_image", name: "image", mutableReference: "image:old", resolvedDigest: `sha256:${"a".repeat(64)}`, metadataJson: "{}", enabled: true, createdAt: NOW, updatedAt: NOW });
    store.exec(`INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, active_revision, control_version, created_at, updated_at)
      VALUES ('work-3', 'user-1', 'pending-legacy', 'running', 'ready', 2, 1, 1, '${NOW}', '${NOW}')`);
    const active = JSON.stringify({ agentImage: { catalogId: "image-0199e6d8abcd" }, skills: [], agentsMd: "active", modelRef: "model-0199e6d8abcd", mcpServers: [], resources: { cpuMillis: 1000, memoryBytes: 64 * 1024 * 1024, maxServices: 0, maxRetainedVolumes: 0 }, tools: { allowed: [], denied: [] } });
    const desired = JSON.stringify({ ...JSON.parse(active), skills: ["missing-skill"], agentsMd: "pending" });
    store.exec(`INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at)
      VALUES ('work-3', 1, '${active.replace(/'/g, "''")}', 'user-1', '${NOW}'),
             ('work-3', 2, '${desired.replace(/'/g, "''")}', 'user-1', '${NOW}')`);

    const contexts = new WorkContextStore(join(root, "works"));
    new WorkContextMigration(store, contexts, new SkillArtifactStore(join(root, "skills")), join(root, "runtime"), () => new Date(NOW)).migrate();

    const state = store.getWorkConfiguration("work-3")!;
    assert.ok(state.activeContextId);
    assert.equal(state.desiredContextId, null);
    assert.equal(contexts.load("work-3", state.activeContextId!).configuration.agentsMd, "active");
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "work-3")?.state, "failed");
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "work-3")?.errorCode, "WORK_CONTEXT_UNRECONSTRUCTABLE");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing v5 snapshots are validated without rereading a removed managed Skill", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-work-migration-current-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
      VALUES ('user-1', 'alice', 'digest', 'admin', 1, '${NOW}', '${NOW}')`);
    store.exec(`INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, active_revision, control_version, created_at, updated_at)
      VALUES ('work-4', 'user-1', 'current', 'running', 'ready', 1, 1, 1, '${NOW}', '${NOW}')`);
    const configuration = { agentImage: { catalogId: "image-0199e6d8abcd" }, skills: ["removed-skill"], agentsMd: "", modelRef: "model-0199e6d8abcd", mcpServers: [], resources: { cpuMillis: 1000, memoryBytes: 64 * 1024 * 1024, maxServices: 0, maxRetainedVolumes: 0 }, tools: { allowed: [], denied: [] } };
    const configJson = JSON.stringify(configuration);
    store.exec(`INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at)
      VALUES ('work-4', 1, '${configJson.replace(/'/g, "''")}', 'user-1', '${NOW}')`);
    const source = join(root, "source", "removed-skill");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "opaque bytes\n");
    const inspected = inspectSkillTree(source, { expectedName: "removed-skill" });
    const contexts = new WorkContextStore(join(root, "works"));
    const snapshot = contexts.build({ workId: "work-4", snapshotId: "context-current", configuration, imageIdentity: `sha256:${"a".repeat(64)}`, skills: [{ name: "removed-skill", identity: inspected.identity, directory: source }], createdAt: NOW });
    store.insertInitialWorkContext("work-4", 1, { snapshotId: snapshot.snapshotId, configurationJson: JSON.stringify(snapshot.configuration), imageIdentity: snapshot.metadata.imageIdentity, createdByUserId: "user-1", createdAt: NOW });
    rmSync(join(root, "source"), { recursive: true, force: true });

    new WorkContextMigration(store, contexts, new SkillArtifactStore(join(root, "skills")), join(root, "runtime"), () => new Date(NOW)).migrate();

    assert.equal(store.getWorkConfiguration("work-4")?.activeContextId, "context-current");
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "work-4")?.state, "succeeded");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("unreconstructable legacy Work is retained and reported without a replacement context", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-work-migration-failed-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
      VALUES ('user-1', 'alice', 'digest', 'admin', 1, '${NOW}', '${NOW}')`);
    store.exec(`INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, active_revision, control_version, created_at, updated_at)
      VALUES ('work-1', 'user-1', 'broken', 'running', 'ready', 1, 1, 1, '${NOW}', '${NOW}')`);
    store.exec(`INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at)
      VALUES ('work-1', 1, '{"skills":["missing"]}', 'user-1', '${NOW}')`);
    const migration = new WorkContextMigration(store, new WorkContextStore(join(root, "works")), new SkillArtifactStore(join(root, "skills")), join(root, "runtime"), () => new Date(NOW));
    migration.migrate();
    assert.equal(store.getWorkConfiguration("work-1")?.desiredContextId, null);
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "work-1")?.state, "failed");
    assert.equal(store.getFilesystemMigration("legacy-work-context-v1", "work-1")?.errorCode, "WORK_CONTEXT_UNRECONSTRUCTABLE");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
