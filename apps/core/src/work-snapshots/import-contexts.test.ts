import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PortableWorkSpec, WorkControlHistory, WorkSourceIdentityMap } from "@piwork/contracts";
import { WorkContextStore } from "../configuration/work-context.js";
import { packageNameKey } from "../configuration/work-context.js";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { prepareImportedContexts, type VerifiedContextMaterial } from "./import-contexts.js";
import type { ResolvedWorkBindings } from "./bindings.js";
import type { WorkIdentityTargets } from "./metadata.js";

const NOW = "2026-09-23T00:00:00Z", WORK = "work-target-00000001";
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-import-contexts-"));
  const skills = join(root, "verified-skills"); mkdirSync(join(skills, "tool"), { recursive: true });
  const skillContent = "---\nname: tool\ndescription: Package copy\n---\nRetained from source\n";
  writeFileSync(join(skills, "tool", "SKILL.md"), skillContent);
  const agentsA = Buffer.from("Source AGENTS A USER_TOKEN_SENTINEL\n"), agentsB = Buffer.from("Source AGENTS B\n");
  const contexts = ["c-000001", "c-000002"] as const;
  const config = { modelBindingKey: "m-000001", skills: ["tool"], packages: [], tools: { allowed: ["read"], denied: [] }, mcpServers: [],
    resources: { cpuMillis: 1000, memoryBytes: 1073741824, agentCpuMillis: 500, agentMemoryBytes: 536870912, maxServices: 2, maxRetainedVolumes: 4 } };
  const imageDigest = digest("fixed-image"), treeDigest = digest("tree"), controlDigest = digest("history"), identityDigest = digest("identities");
  const blobs: PortableWorkSpec["blobs"] = [
    { digest: treeDigest, size: 4, kinds: ["tree"] },
    { digest: controlDigest, size: 7, kinds: ["control-history"] },
    { digest: identityDigest, size: 10, kinds: ["identity-map"] },
    { digest: imageDigest, size: 11, kinds: ["image-config"] },
    { digest: digest(agentsA), size: agentsA.length, kinds: ["file"] },
    { digest: digest(agentsB), size: agentsB.length, kinds: ["file"] },
  ];
  const spec: PortableWorkSpec = {
    formatVersion: 1, snapshotKind: "cold-full", createdAt: NOW, sourceName: "source",
    compatibility: { os: "linux", architecture: "amd64", variant: null, agentProtocol: "v2", workHistorySchema: 3, storageLayout: 2, piPackageContract: 1 },
    activeContext: "c-000001", desiredContext: "c-000002",
    contexts: contexts.map((key, index) => ({ key, createdAt: NOW, configuration: config, skillsTree: treeDigest, packageBindings: [],
      agentsBlob: digest(index === 0 ? agentsA : agentsB), imageKey: "i-000001" })),
    piPackageArtifacts: [], services: [], quotaReservations: [{ subjectKind: "agent", subjectKey: "agentd", desiredCpuMillis: 500, desiredMemoryBytes: 536870912, serviceSlots: 0, volumeSlots: 2 }],
    volumes: [{ role: "agent-private", tree: treeDigest, serviceRefKeys: [] }, { role: "workspace", tree: treeDigest, serviceRefKeys: [] }],
    images: [{ key: "i-000001", imageId: `sha256:${imageDigest}`, platform: { os: "linux", architecture: "amd64", variant: null }, config: imageDigest, layers: [] }],
    bindings: { models: [{ key: "m-000001", provider: "deterministic", model: "fixture", baseUrl: null }], secrets: [] },
    history: { control: controlDigest, sourceIdentityMap: identityDigest },
    blobs: blobs.sort((a, b) => a.digest.localeCompare(b.digest)),
  };
  const history: WorkControlHistory = { version: 1, work: { name: "source", createdAt: NOW },
    configurationRevisions: [{ revision: 1, contextKey: "c-000001" }, { revision: 2, contextKey: "c-000002" }], operations: [], idempotency: [] };
  const identities: WorkSourceIdentityMap = { version: 1, sourceWorkId: "work-source-00000001",
    contexts: [{ sourceId: "context-source-00000001", key: "c-000001" }, { sourceId: "context-source-00000002", key: "c-000002" }], services: [], operations: [] };
  const targets: WorkIdentityTargets = { workId: WORK, contexts: [{ key: "c-000001", id: "context-target-00000001" }, { key: "c-000002", id: "context-target-00000002" }], services: [], operations: [] };
  const bindings: ResolvedWorkBindings = { bindings: { models: { "m-000001": "runtime-model-00000001" }, secrets: {} },
    models: new Map([["m-000001", { catalogId: "runtime-model-00000001", profile: { version: 1, revision: 7,
      model: { provider: "deterministic", id: "fixture", credentialRef: "recipient-secret-path" }, updatedAt: NOW } }]]), secrets: new Map() };
  const materials = new Map<string, VerifiedContextMaterial>([["c-000001", { skillsDirectory: skills, agentsBytes: agentsA }], ["c-000002", { skillsDirectory: skills, agentsBytes: agentsB }]]);
  const images = new Map([["i-000001", { identity: `sha256:${imageDigest}`, selectionId: "owned-image-00000001" }]]);
  const contextStore = new WorkContextStore(join(root, "owned"));
  return { root, skills, skillContent, agentsA, agentsB, spec, history, identities, targets, bindings, materials, images, contextStore,
    prepare() { return prepareImportedContexts({ contextStore, spec, history, identities, targets, bindings, materials, images, createdAt: NOW }); },
    close() { rmSync(root, { recursive: true, force: true }); } };
}

test("package-owned Skills and AGENTS create independent active and desired contexts", () => {
  const f = fixture();
  try {
    const prepared = f.prepare();
    assert.equal(prepared.activeContextId, "context-target-00000001");
    assert.equal(prepared.desiredContextId, "context-target-00000002");
    assert.deepEqual(prepared.contexts.map((item) => item.revision), [1, 2]);
    for (const [index, item] of prepared.contexts.entries()) {
      assert.equal(item.configuration.agentsMd, (index === 0 ? f.agentsA : f.agentsB).toString());
      assert.equal(item.configuration.agentImage.catalogId, "owned-image-00000001");
      assert.equal(item.sourceRuntimeRevision, 7);
      assert.equal(JSON.parse(item.runtimeProfileJson).model.credentialRef, "recipient-secret-path");
      assert.equal(item.runtimeProfileJson.includes("source-platform-secret"), false);
      assert.equal(readFileSync(join(item.snapshot.directory, "skills", "tool", "SKILL.md"), "utf8"), f.skillContent);
      assert.equal(f.contextStore.load(WORK, item.snapshot.snapshotId).configuration.agentsMd, item.configuration.agentsMd);
    }
    rmSync(f.skills, { recursive: true });
    assert.equal(readFileSync(join(prepared.contexts[0]!.snapshot.directory, "skills", "tool", "SKILL.md"), "utf8"), f.skillContent);
    assert.ok(prepared.contexts[0]!.configuration.agentsMd.includes("USER_TOKEN_SENTINEL"));
  } finally { f.close(); }
});

test("null active is retained; missing context, changed AGENTS or missing Skill fails before publication", () => {
  const f = fixture();
  try {
    f.spec.activeContext = null;
    const valid = f.prepare(); assert.equal(valid.activeContextId, null);
    for (const item of valid.contexts) f.contextStore.remove(WORK, item.snapshot.snapshotId);
    f.materials.delete("c-000002");
    assert.throws(() => f.prepare(), { code: "PACKAGE_INVALID" });
    f.materials.set("c-000002", { skillsDirectory: f.skills, agentsBytes: f.agentsB });
    f.materials.set("c-000002", { skillsDirectory: f.skills, agentsBytes: Buffer.from("changed") });
    assert.throws(() => f.prepare(), { code: "PACKAGE_INVALID" });
    assert.equal(existsSync(join(f.contextStore.rootDirectory, WORK, "contexts", "context-target-00000001")), false);
    f.materials.set("c-000002", { skillsDirectory: f.skills, agentsBytes: f.agentsB });
    rmSync(join(f.skills, "tool", "SKILL.md"));
    assert.throws(() => f.prepare());
    assert.equal(existsSync(join(f.contextStore.rootDirectory, WORK, "contexts", "context-target-00000001")), false);
  } finally { f.close(); }
});

test("import reconstructs active and desired package versions from staged bytes without Core catalog", async () => {
  const f = fixture();
  try {
    const name = "@example/pi-tools";
    const artifacts = [];
    for (const [index, context] of f.spec.contexts.entries()) {
      const version = `${index + 1}.0.0`, source = join(f.root, `source-${index}`);
      mkdirSync(source);
      writeFileSync(join(source, "package.json"), JSON.stringify({ name, version }));
      writeFileSync(join(source, "version.txt"), version);
      const metadata = (await validatePiPackageArtifact({ root: source, sourceKind: "local", resolvedSource: `fixture:${version}`,
        preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" } })).metadata;
      const packageDirectory = join(f.root, `staged-${index}`);
      mkdirSync(packageDirectory);
      cpSync(source, join(packageDirectory, packageNameKey(name)), { recursive: true });
      rmSync(source, { recursive: true, force: true });
      const material = f.materials.get(context.key)!;
      f.materials.set(context.key, { ...material, packagesDirectory: packageDirectory });
      context.configuration = { ...context.configuration, packages: [{ name, enabled: index === 0 }] };
      context.packageBindings = [{ name, artifactKey: metadata.contentDigest }];
      artifacts.push({ key: metadata.contentDigest, ...metadata,
        resourceCounts: { extensions: metadata.resourceCounts.extensions, prompts: metadata.resourceCounts.prompts,
          skills: metadata.resourceCounts.skills, themes: metadata.resourceCounts.themes }, treeDigest: f.spec.volumes[0].tree,
        resourceInventory: { extensions: [], skills: [], prompts: [], themes: [] } });
    }
    f.spec.piPackageArtifacts = artifacts.sort((a, b) => a.key.localeCompare(b.key));
    const result = f.prepare();
    assert.deepEqual(result.contexts.map((item) => item.snapshot.metadata.packageBindings[0]?.artifact.version), ["1.0.0", "2.0.0"]);
    assert.equal(result.contexts[0]!.configuration.packages[0]?.enabled, true);
    assert.equal(result.contexts[1]!.configuration.packages[0]?.enabled, false);
    for (const material of f.materials.values()) if (material.packagesDirectory) rmSync(material.packagesDirectory, { recursive: true, force: true });
    for (const item of result.contexts) assert.ok(existsSync(join(item.snapshot.directory, "packages", packageNameKey(name), "version.txt")));
  } finally { f.close(); }
});
