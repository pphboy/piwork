import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { inspectSkillTree } from "./skill-tree.js";
import { WorkContextError, WorkContextStore } from "./work-context.js";

const config: WorkConfig = {
  agentImage: { catalogId: "image-0199e6d8abcd" },
  skills: ["code-review"],
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
