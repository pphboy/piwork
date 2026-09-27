import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { inspectSkillTree } from "./skill-tree.js";
import { WorkContextError, WorkContextStore } from "./work-context.js";

const config: WorkConfig = {
  agentImage: { catalogId: "image-0199e6d8abcd" },
  skills: ["code-review"], packages: [],
  agentsMd: "# Work rules\n",
  modelRef: "model-0199e6d8abcd",
  mcpServers: [],
  resources: { cpuMillis: 1_000, memoryBytes: 1_073_741_824, agentCpuMillis: 500, agentMemoryBytes: 536_870_912, maxServices: 8, maxRetainedVolumes: 16 },
  tools: { allowed: ["read"], denied: [] },
};

test("WorkContextStore snapshots complete Skills, AGENTS and non-secret config", () => withFixture(({ store, source }) => {
  const snapshot = store.build({
    workId: "work-0199e6d8abcd",
    snapshotId: "context-1",
    configuration: config,
    imageIdentity: `sha256:${"b".repeat(64)}`,
    skills: [{ name: "code-review", identity: source.identity, directory: source.directory }],
    createdAt: "2026-09-21T00:00:00Z",
  });
  assert.equal(readFileSync(join(snapshot.directory, "skills", "code-review", "references", "guide.txt"), "utf8"), "supporting");
  assert.equal(readFileSync(join(snapshot.directory, "AGENTS.md"), "utf8"), config.agentsMd);
  assert.equal(JSON.parse(readFileSync(join(snapshot.directory, "config.json"), "utf8")).apiKey, undefined);
  assert.equal(snapshot.metadata.imageIdentity, `sha256:${"b".repeat(64)}`);
  assert.deepEqual(store.load("work-0199e6d8abcd", "context-1").configuration.skills, ["code-review"]);
}));

test("WorkContextStore supports an empty isolated Skill set", () => withFixture(({ store }) => {
  const empty: WorkConfig = { ...config, skills: [], agentsMd: "" };
  const snapshot = store.build({
    workId: "work-0199e6d8abcd", configuration: empty, imageIdentity: `sha256:${"a".repeat(64)}`,
    skills: [], createdAt: "2026-09-21T00:00:00Z",
  });
  assert.deepEqual(snapshot.metadata.skills, []);
  assert.deepEqual(store.load("work-0199e6d8abcd", snapshot.snapshotId).configuration.skills, []);
}));

test("WorkContextStore captures a disabled package with dependency bytes and safe symlinks", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-context-package-"));
  try {
    const source = join(root, "package-source");
    mkdirSync(join(source, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@example/tools", version: "1.0.0", dependencies: { "left-pad": "1.0.0" }, pi: { extensions: ["extension.js"] } }));
    writeFileSync(join(source, "extension.js"), "export default function () {};");
    writeFileSync(join(source, "node_modules", "left-pad", "package.json"), JSON.stringify({ name: "left-pad", version: "1.0.0" }));
    writeFileSync(join(source, "node_modules", "left-pad", "index.js"), "export default () => 1;");
    symlinkSync("index.js", join(source, "node_modules", "left-pad", "main.js"));
    const preparedEnvironment = { os: "linux" as const, architecture: "x64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" };
    const verified = await validatePiPackageArtifact({ root: source, sourceKind: "local", resolvedSource: "local:fixture", preparedEnvironment });
    const store = new WorkContextStore(join(root, "works"));
    assert.throws(() => store.build({ workId: "work-0199e6d8abcd", snapshotId: "context-invalid-package", configuration: { ...config, skills: [], packages: [{ name: "@example/tools", enabled: false }] },
      imageIdentity: `sha256:${"a".repeat(64)}`, skills: [], packages: [{ name: "@example/tools", directory: source, metadata: { ...verified.metadata, contentDigest: `sha256:${"0".repeat(64)}` } }], createdAt: "2026-09-21T00:00:00Z" }),
    (error) => error instanceof WorkContextError && error.code === "PACKAGE_LOAD_FAILED");
    assert.throws(() => store.load("work-0199e6d8abcd", "context-invalid-package"));
    const snapshot = store.build({ workId: "work-0199e6d8abcd", configuration: { ...config, skills: [], packages: [{ name: "@example/tools", enabled: false }] },
      imageIdentity: `sha256:${"a".repeat(64)}`, skills: [], packages: [{ name: "@example/tools", directory: source, metadata: verified.metadata }], createdAt: "2026-09-21T00:00:00Z" });
    const binding = snapshot.metadata.packageBindings[0]!;
    assert.equal(binding.artifact.contentDigest, verified.metadata.contentDigest);
    assert.equal(readFileSync(join(snapshot.directory, "packages", binding.nameKey, "node_modules", "left-pad", "main.js"), "utf8"), "export default () => 1;");
    rmSync(source, { recursive: true, force: true });
    assert.equal(store.load(snapshot.workId, snapshot.snapshotId).configuration.packages[0]?.enabled, false);
    const edited = store.build({ workId: snapshot.workId, configuration: { ...snapshot.configuration, agentsMd: "edited" },
      imageIdentity: snapshot.metadata.imageIdentity, skills: [], packages: [{ name: binding.name,
        directory: join(snapshot.directory, "packages", binding.nameKey), metadata: binding.artifact }], createdAt: "2026-09-21T00:00:01Z" });
    assert.equal(edited.metadata.packageBindings[0]?.artifact.contentDigest, binding.artifact.contentDigest);
    const imported = store.buildImported({ workId: "work-target-00000001", snapshotId: "context-target-00000001",
      configuration: snapshot.configuration, imageIdentity: snapshot.metadata.imageIdentity,
      verifiedSkillsDirectory: join(snapshot.directory, "skills"), verifiedPackagesDirectory: join(snapshot.directory, "packages"),
      packages: [{ name: binding.name, directory: join(snapshot.directory, "packages", binding.nameKey), metadata: binding.artifact }],
      agentsBytes: Buffer.from(snapshot.configuration.agentsMd), createdAt: snapshot.metadata.createdAt });
    assert.equal(imported.metadata.packageBindings[0]?.artifact.contentDigest, binding.artifact.contentDigest);
    chmodSync(join(snapshot.directory, "packages", binding.nameKey, "extension.js"), 0o600);
    writeFileSync(join(snapshot.directory, "packages", binding.nameKey, "extension.js"), "tampered");
    assert.throws(() => store.load(snapshot.workId, snapshot.snapshotId), (error) => error instanceof WorkContextError && error.code === "PACKAGE_LOAD_FAILED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("imported contexts use only verified owned Skills and retain complete files without a global catalog", () => withFixture(({ store, source }) => {
  mkdirSync(join(source.directory, "empty"));
  const original = store.build({ workId: "work-source-00000001", snapshotId: "context-source-00000001", configuration: config,
    imageIdentity: `sha256:${"a".repeat(64)}`, skills: [{ name: "code-review", identity: source.identity, directory: source.directory }], createdAt: "2026-09-23T00:00:00.000Z" });
  rmSync(source.directory, { recursive: true }); // The global/source Skill no longer exists.
  const restored = store.buildImported({ workId: "work-target-00000001", snapshotId: "context-target-00000001", configuration: { ...config, agentImage: { catalogId: "owned-image-00000001" } },
    imageIdentity: original.metadata.imageIdentity, verifiedSkillsDirectory: join(original.directory, "skills"), agentsBytes: Buffer.from(config.agentsMd), createdAt: original.metadata.createdAt });
  assert.equal(readFileSync(join(restored.directory, "AGENTS.md"), "utf8"), config.agentsMd);
  assert.equal(readFileSync(join(restored.directory, "skills", "code-review", "references", "guide.txt"), "utf8"), "supporting");
  assert.ok(existsSync(join(restored.directory, "skills", "code-review", "empty")));
  assert.equal(restored.metadata.skills[0]?.identity, original.metadata.skills[0]?.identity);
  assert.equal(restored.metadata.workId, "work-target-00000001");
  assert.throws(() => store.buildImported({ workId: "work-target-00000002", snapshotId: "context-target-00000002", configuration: config,
    imageIdentity: original.metadata.imageIdentity, verifiedSkillsDirectory: join(original.directory, "skills"), agentsBytes: Buffer.from("wrong bytes"), createdAt: original.metadata.createdAt }), WorkContextError);
  assert.throws(() => store.buildImported({ workId: "work-target-00000003", snapshotId: "context-target-00000003", configuration: { ...config, skills: ["missing"] },
    imageIdentity: original.metadata.imageIdentity, verifiedSkillsDirectory: join(original.directory, "skills"), agentsBytes: Buffer.from(config.agentsMd), createdAt: original.metadata.createdAt }), WorkContextError);
}));

test("WorkContextStore rejects mismatched content atomically and preserves no partial snapshot", () => withFixture(({ store, source }) => {
  const bad = { ...source, identity: `sha256:${"0".repeat(64)}` };
  assert.throws(() => store.build({
    workId: "work-0199e6d8abcd", snapshotId: "context-failed", configuration: config,
    imageIdentity: `sha256:${"b".repeat(64)}`, skills: [{ name: "code-review", identity: bad.identity, directory: bad.directory }],
    createdAt: "2026-09-21T00:00:00Z",
  }), (error) => error instanceof WorkContextError && error.code === "SKILL_LOAD_FAILED");
  assert.throws(() => store.load("work-0199e6d8abcd", "context-failed"), /unavailable/);
  assert.equal(readdirSync(join(store.rootDirectory, "work-0199e6d8abcd", "contexts")).some((name) => name.startsWith(".staging-")), false);
}));

test("WorkContextStore reports corruption with safe identifiers", () => withFixture(({ store, source }) => {
  const snapshot = store.build({
    workId: "work-0199e6d8abcd", snapshotId: "context-corrupt", configuration: config,
    imageIdentity: `sha256:${"b".repeat(64)}`, skills: [{ name: "code-review", identity: source.identity, directory: source.directory }],
    createdAt: "2026-09-21T00:00:00Z",
  });
  chmodSync(join(snapshot.directory, "skills", "code-review", "SKILL.md"), 0o600);
  writeFileSync(join(snapshot.directory, "skills", "code-review", "SKILL.md"), "corrupt");
  assert.throws(() => store.load("work-0199e6d8abcd", "context-corrupt"), (error) => {
    assert.ok(error instanceof WorkContextError); assert.equal(error.code, "SKILL_LOAD_FAILED"); assert.equal(error.message.includes(snapshot.directory), false); return true;
  });
}));

test("WorkContextStore rejects unsupported pre-release context shapes without rewriting them", () => withFixture(({ store, source }) => {
  const snapshot = store.build({
    workId: "work-0199e6d8abcd", snapshotId: "context-old-shape", configuration: config,
    imageIdentity: `sha256:${"b".repeat(64)}`, skills: [{ name: "code-review", identity: source.identity, directory: source.directory }],
    createdAt: "2026-09-21T00:00:00Z",
  });
  const configPath = join(snapshot.directory, "config.json");
  chmodSync(configPath, 0o600);
  writeFileSync(configPath, JSON.stringify({ ...config, skills: [{ name: "code-review", path: "/old/host/path" }] }));
  assert.throws(() => store.load("work-0199e6d8abcd", "context-old-shape"),
    (error) => error instanceof WorkContextError && error.code === "CONTEXT_FORMAT_UNSUPPORTED");
  assert.equal(existsSync(configPath), true);
}));

test("WorkContextStore startup cleanup removes staging and database-unreferenced snapshots", () => withFixture(({ store }) => {
  const retained = store.build({
    workId: "work-0199e6d8abcd", snapshotId: "context-retained", configuration: { ...config, skills: [] },
    imageIdentity: `sha256:${"b".repeat(64)}`, skills: [], createdAt: "2026-09-21T00:00:00.000Z",
  });
  const orphan = store.build({
    workId: "work-0199e6d8abcd", snapshotId: "context-orphan", configuration: { ...config, skills: [] },
    imageIdentity: `sha256:${"c".repeat(64)}`, skills: [], createdAt: "2026-09-21T00:00:01.000Z",
  });
  const staging = join(store.rootDirectory, "work-0199e6d8abcd", "contexts", ".staging-abandoned");
  mkdirSync(staging, { recursive: true });

  store.cleanupOrphans(new Set([`work-0199e6d8abcd\0${retained.snapshotId}`]));

  assert.equal(store.load("work-0199e6d8abcd", retained.snapshotId).snapshotId, retained.snapshotId);
  assert.throws(() => store.load("work-0199e6d8abcd", orphan.snapshotId), /unavailable/);
  assert.equal(existsSync(staging), false);
}));

function withFixture(run: (fixture: { store: WorkContextStore; source: { directory: string; identity: string } }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "piwork-context-"));
  const source = join(root, "code-review");
  mkdirSync(join(source, "references"), { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "---\nname: reviewer\ndescription: opaque\n---\nInstructions");
  writeFileSync(join(source, "references", "guide.txt"), "supporting");
  const skillTree = inspectSkillTree(source);
  const store = new WorkContextStore(join(root, "works"));
  try { run({ store, source: { directory: source, identity: skillTree.identity } }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
