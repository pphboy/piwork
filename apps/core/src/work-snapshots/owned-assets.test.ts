import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import type { WorkConfig } from "@piwork/contracts";
import { WorkConfigurationValidator } from "../configuration/validation.js";
import { registerRuntimeProfileCatalog, resolveRuntimeProfileFromWorkConfig } from "../configuration/runtime-catalog.js";
import { WorkContextStore } from "../configuration/work-context.js";
import { WorkConfigurationService } from "../configuration/work-config.js";

const NOW = "2026-09-23T00:00:00.000Z", WORK = "work-imported-00000001", OWNER = "owner-recipient-00000001";
test("Work-owned image and retained Skills survive unrelated edits without registration; cross-Work and explicit Skill reselection are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-owned-assets-")), store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.createInitialAdministrator({ id: OWNER, account: "owner", passwordDigest: "password", now: NOW });
    registerRuntimeProfileCatalog(store, { version: 1, revision: 1, agentImage: "recipient:default", model: { provider: "deterministic", id: "fixture", credentialRef: "recipient.secret" }, updatedAt: NOW });
    const config: WorkConfig = { agentImage: { catalogId: "owned-image-00000001" }, modelRef: "runtime-model-00000001", agentsMd: "original rules\n", skills: ["retained-tool"], mcpServers: [],
      resources: { cpuMillis: 1000, memoryBytes: 1024 ** 3, agentCpuMillis: 500, agentMemoryBytes: 512 * 1024 ** 2, maxServices: 8, maxRetainedVolumes: 16 }, tools: { allowed: ["read"], denied: [] } };
    const skills = join(root, "verified-skills"); mkdirSync(join(skills, "retained-tool"), { recursive: true });
    writeFileSync(join(skills, "retained-tool", "SKILL.md"), "---\nname: retained-tool\ndescription: Retained tool\n---\nKeep this content.\n");
    const contexts = new WorkContextStore(join(root, "contexts")), image = `sha256:${"b".repeat(64)}`;
    const imported = contexts.buildImported({ workId: WORK, snapshotId: "context-imported-00000001", configuration: config, imageIdentity: image, verifiedSkillsDirectory: skills, agentsBytes: Buffer.from(config.agentsMd), createdAt: NOW });
    const accepted = store.acceptMutation({ principalId: OWNER, workScope: "new-work", operationKind: "import-work", idempotencyKey: "fixture", requestDigest: "a".repeat(64), requestJson: "{}", targetVersion: 1, now: NOW }, (tx) => {
      tx.run("INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at) VALUES (?,?,'imported','stopped','stopped',1,1,?,?)", WORK, OWNER, NOW, NOW);
      tx.run("INSERT INTO work_config_revisions(work_id,revision,config_json,created_by_user_id,created_at) VALUES (?,1,?,?,?)", WORK, JSON.stringify(config), OWNER, NOW);
      store.insertInitialWorkContext(WORK, 1, { snapshotId: imported.snapshotId, configurationJson: JSON.stringify(config), imageIdentity: image, createdByUserId: OWNER, createdAt: NOW });
      store.snapshots.insertOwnedImage({ workId: WORK, selectionId: config.agentImage.catalogId, imageIdentity: image, sourceReference: "original:image" });
      tx.run("INSERT INTO quota_reservations VALUES (?,'agent','agentd',500,536870912,0,0,0,2,?)", WORK, NOW);
      return { resourceId: WORK };
    });
    store.updateOperation(accepted.operationId, "succeeded", NOW);
    rmSync(skills, { recursive: true });
    const catalogBefore = store.listCatalogEntries(false), validator = new WorkConfigurationValidator(store), edited = { ...config, agentsMd: "changed rules\n" };
    assert.deepEqual(validator.validate({ workOwnerUserId: OWNER, workId: WORK, configuration: edited }), edited);
    const profile = resolveRuntimeProfileFromWorkConfig(store, edited, WORK);
    assert.equal(profile.profile.agentImage, image); assert.equal(profile.profile.model.credentialRef, "recipient.secret");
    const copied = contexts.buildImported({ workId: WORK, snapshotId: "context-edited-00000001", configuration: edited, imageIdentity: image,
      verifiedSkillsDirectory: join(imported.directory, "skills"), agentsBytes: Buffer.from(edited.agentsMd), createdAt: NOW });
    new WorkConfigurationService(store).update({ userId: OWNER, role: "admin" }, WORK, edited, undefined, { runtimeProfileJson: JSON.stringify(profile.profile), sourceRuntimeRevision: 1,
      snapshot: { snapshotId: copied.snapshotId, configurationJson: JSON.stringify(edited), imageIdentity: image, createdByUserId: OWNER, createdAt: NOW } });
    assert.deepEqual(contexts.load(WORK, copied.snapshotId).metadata.skills, imported.metadata.skills);
    assert.deepEqual(store.listCatalogEntries(false), catalogBefore); assert.equal(store.getManagedSkill("retained-tool"), undefined);
    assert.throws(() => validator.validate({ workOwnerUserId: OWNER, workId: WORK, reselectSkills: true, configuration: edited }), /Skill retained-tool is unavailable/);
    assert.throws(() => validator.validate({ workOwnerUserId: OWNER, workId: "work-other-00000001", configuration: edited }), /agent_image/);
    assert.throws(() => validator.validate({ workOwnerUserId: "owner-other-00000001", workId: WORK, configuration: edited }), /agent_image/);
    assert.throws(() => resolveRuntimeProfileFromWorkConfig(store, edited, "work-other-00000001"), /unavailable/);
    const reselected = validator.validate({ workOwnerUserId: OWNER, workId: WORK, configuration: { ...edited, agentImage: { catalogId: "runtime-image-00000001" } } });
    assert.equal(resolveRuntimeProfileFromWorkConfig(store, reselected, WORK).profile.agentImage, "recipient:default");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
