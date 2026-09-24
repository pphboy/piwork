import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { type WorkConfig } from "@piwork/contracts";
import { DockerDependencyError, managedVolumeName, type ContainerInspection, type DockerRuntime } from "@piwork/runtime-docker";
import { WorkContextStore } from "../configuration/work-context.js";
import { preflightWorkSnapshot } from "./preflight.js";

const NOW = "2026-09-23T00:00:00.000Z", WORK = "work-snapshot-preflight", OWNER = "user-snapshot-owner", INSTALLATION = "install-snapshot-test";
const IMAGE = `sha256:${"a".repeat(64)}`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-preflight-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") }), contexts = new WorkContextStore(join(root, "works"));
  store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "hash", role: "user", enabled: true, createdAt: NOW, updatedAt: NOW });
  const config: WorkConfig = { agentImage: { catalogId: "runtime-image-00000001" }, modelRef: "runtime-model-00000001", agentsMd: "source context", skills: [], mcpServers: [],
    resources: { cpuMillis: 1000, memoryBytes: 1073741824, agentCpuMillis: 500, agentMemoryBytes: 536870912, maxServices: 2, maxRetainedVolumes: 2 },
    tools: { allowed: [], denied: [] } };
  const snapshot = contexts.build({ workId: WORK, snapshotId: "context-snapshot-0001", configuration: config, imageIdentity: IMAGE, skills: [], createdAt: NOW });
  const accepted = store.acceptMutation({ principalId: OWNER, workScope: "new-work", operationKind: "create-work", idempotencyKey: "create", requestDigest: "b".repeat(64), requestJson: "{}", targetVersion: 1, now: NOW }, (tx) => {
    tx.run("INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at) VALUES (?,?,'source','stopped','stopped',1,1,?,?)", WORK, OWNER, NOW, NOW);
    tx.run("INSERT INTO work_config_revisions(work_id,revision,config_json,created_by_user_id,created_at,runtime_profile_json,source_runtime_revision) VALUES (?,1,?,?,?,?,1)", WORK, JSON.stringify(config), OWNER, NOW,
      JSON.stringify({ version: 1, revision: 1, agentImage: IMAGE, model: { provider: "deterministic", id: "fixture", credentialRef: "platform-secret" }, updatedAt: NOW }));
    store.insertInitialWorkContext(WORK, 1, { snapshotId: snapshot.snapshotId, configurationJson: JSON.stringify(config), imageIdentity: IMAGE, createdByUserId: OWNER, createdAt: NOW });
    tx.run("INSERT INTO quota_reservations VALUES (?,'agent','agentd',500,536870912,999,999,0,2,?)", WORK, NOW);
    for (const [role, logicalId, id] of [["agent-private", "work-private", "volume-preflight-private"], ["workspace", "work-workspace", "volume-preflight-workspace"]] as const) {
      tx.run("INSERT INTO volume_records VALUES (?,?,?,NULL,?,?,'active',1,NULL,NULL,?)", id, INSTALLATION, WORK, role, managedVolumeName(INSTALLATION, WORK, logicalId), NOW);
      tx.run("INSERT INTO volume_references VALUES (?,'work',?,?)", id, WORK, NOW);
    }
    return { resourceId: WORK };
  });
  store.updateOperation(accepted.operationId, "succeeded", NOW);
  const runtime = {
    async listManagedContainers(_kind?: "agent" | "service"): Promise<ContainerInspection[]> { return []; },
    async requireManagedVolume(_workId: string, logicalId: string) { return { volumeName: managedVolumeName(INSTALLATION, WORK, logicalId), created: false }; },
    async inspectCapturedImage(imageId: string) { return { imageId, platform: { os: "linux" as const, architecture: "amd64", variant: null } }; },
  };
  const inspect = () => preflightWorkSnapshot({ store, contexts, runtime: runtime as unknown as DockerRuntime, installationId: INSTALLATION, workId: WORK });
  return { root, store, runtime, inspect, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("preflight accepts a stopped Work with nonzero source occupied counters and exact two managed volumes", async () => {
  const f = fixture();
  try { const metadata = await f.inspect(); assert.equal(metadata.quotaReservations[0]?.desiredCpuMillis, 500); assert.equal(metadata.volumes.length, 2); }
  finally { f.close(); }
});

test("preflight refuses stale stopped metadata, running containers, in-flight control and unavailable Docker", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.store.exec(`UPDATE works SET observed_state='ready' WHERE id='${WORK}'`),
    (f: ReturnType<typeof fixture>) => { f.runtime.listManagedContainers = async () => [{ exists: true, running: true, status: "running", labels: { "piwork.work_id": WORK } }]; },
    (f: ReturnType<typeof fixture>) => { f.store.acceptMutation({ principalId: OWNER, workId: WORK, workScope: WORK, operationKind: "apply-work-configuration", idempotencyKey: "pending", requestDigest: "c".repeat(64), requestJson: "{}", targetVersion: 2, now: NOW }, () => ({ resourceId: WORK })); },
    (f: ReturnType<typeof fixture>) => { f.runtime.listManagedContainers = async () => { throw new DockerDependencyError("RUNTIME_UNAVAILABLE", "offline", true); }; },
  ]) {
    const f = fixture();
    try { mutate(f); await assert.rejects(f.inspect()); }
    finally { f.close(); }
  }
});

test("preflight refuses missing fixed image or managed volume without substituting a tag or empty storage", async () => {
  for (const missing of ["image", "volume"] as const) {
    const f = fixture();
    try {
      if (missing === "image") f.runtime.inspectCapturedImage = async () => { throw new DockerDependencyError("RESOURCE_MISSING", "image absent", false); };
      else f.runtime.requireManagedVolume = async () => { throw new DockerDependencyError("RESOURCE_MISSING", "volume absent", false); };
      await assert.rejects(f.inspect(), { code: missing === "image" ? "SNAPSHOT_IMAGE_MISSING" : "SNAPSHOT_STORAGE_UNREADABLE" });
    } finally { f.close(); }
  }
});
