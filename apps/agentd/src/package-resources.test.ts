import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createDeterministicRuntime } from "@piwork/pi-adapter";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { createPackageResourceLoader, packageNameKey } from "./package-resources.js";

test("only enabled owned package extensions enter an isolated SDK loader", async () => {
  const home = mkdtempSync(join(tmpdir(), "piwork-agent-package-"));
  try {
    const root = join(home, "packages"), name = "@example/tools", key = packageNameKey(name);
    const packageRoot = join(root, key);
    mkdirSync(join(packageRoot, "extensions"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["extensions/tool.js"] } }));
    writeFileSync(join(packageRoot, "extensions", "tool.js"), `export default function (pi) { pi.registerTool({ name: "hello", label: "Hello", description: "hello", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "hello" }] }) }); }`);
    const metadata = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "fixture",
      preparedEnvironment: { os: "linux", architecture: process.arch === "x64" ? "amd64" : process.arch, variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } })).metadata;
    const input = { root, bindings: [{ name, nameKey: key, artifact: metadata }], standaloneSkills: [], agentsMd: "# Agent\n",
      workspace: join(home, "workspace"), agentDirectory: join(home, "agent") };
    mkdirSync(input.workspace); mkdirSync(input.agentDirectory);
    for (const base of [join(input.workspace, ".pi"), input.agentDirectory, join(home, "other-work")]) {
      mkdirSync(join(base, "extensions"), { recursive: true });
      writeFileSync(join(base, "extensions", "unselected.js"), "export default function (pi) { pi.registerTool({ name: 'unselected', label: 'Unselected', description: 'unselected', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [] }) }); }");
    }
    const pending = join(root, packageNameKey("@example/pending"));
    mkdirSync(join(pending, "extensions"), { recursive: true });
    writeFileSync(join(pending, "package.json"), '{"name":"@example/pending","version":"1.0.0","pi":{"extensions":["extensions/tool.js"]}}');
    writeFileSync(join(pending, "extensions", "tool.js"), "export default function (pi) { pi.registerTool({ name: 'pending', label: 'Pending', description: 'pending', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [] }) }); }");
    const enabled = await createPackageResourceLoader({ ...input, selection: [{ name, enabled: true }] });
    assert.deepEqual([...enabled.toolNames], [["package:@example/tools:hello", "hello"]]);
    assert.equal(enabled.loader.getExtensions().extensions.length, 1);
    const unsafePaths = { skillPaths: [{ path: join(home, "other-work", "skills", "escape") }] } as Parameters<typeof enabled.loader.extendResources>[0];
    assert.throws(() => enabled.loader.extendResources(unsafePaths), /dynamic package resource leaves enabled roots/);
    const { runtime, model } = await createDeterministicRuntime();
    const { session } = await createAgentSession({ cwd: input.workspace, agentDir: input.agentDirectory,
      modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: enabled.loader,
      settingsManager: SettingsManager.inMemory(), sessionManager: SessionManager.inMemory(input.workspace), tools: ["hello"] });
    try {
      await session.bindExtensions({});
      await session.prompt("invoke package tool hello");
      const reply = session.messages.findLast((message) => message.role === "assistant");
      assert.ok(reply?.content.some((part) => part.type === "text" && part.text.includes("package-tool-result:hello:hello")));
    } finally { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
    const disabled = await createPackageResourceLoader({ ...input, selection: [{ name, enabled: false }] });
    assert.equal(disabled.loader.getExtensions().extensions.length, 0);
    assert.deepEqual([...disabled.toolNames], []);
    const duplicateName = "@example/duplicate", duplicateKey = packageNameKey(duplicateName), duplicateRoot = join(root, duplicateKey);
    mkdirSync(join(duplicateRoot, "extensions"), { recursive: true });
    writeFileSync(join(duplicateRoot, "package.json"), JSON.stringify({ name: duplicateName, version: "1.0.0", pi: { extensions: ["extensions/tool.js"] } }));
    writeFileSync(join(duplicateRoot, "extensions", "tool.js"), readFileSync(join(packageRoot, "extensions", "tool.js")));
    const duplicateMetadata = (await validatePiPackageArtifact({ root: duplicateRoot, sourceKind: "local", resolvedSource: "fixture",
      preparedEnvironment: metadata.preparedEnvironment })).metadata;
    await assert.rejects(createPackageResourceLoader({ ...input,
      selection: [{ name, enabled: true }, { name: duplicateName, enabled: true }],
      bindings: [...input.bindings, { name: duplicateName, nameKey: duplicateKey, artifact: duplicateMetadata }] }),
    (error: unknown) => { assert.match((error as Error).message, /required package resource failed to load/);
      assert.equal((error as Error).message.includes(home), false, "SDK filesystem paths must not enter public diagnostics"); return true; });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an offline prepared package loads extension, Skill, prompt, theme, and runtime dependency", async () => {
  const home = mkdtempSync(join(tmpdir(), "piwork-agent-package-all-"));
  try {
    const name = "@piwork/fixture-tools", key = packageNameKey(name);
    const packageRoot = join(home, "packages", key);
    const fixture = fileURLToPath(new URL("../../../fixtures/pi-packages/tools-v1/", import.meta.url));
    cpSync(fixture, packageRoot, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { pi: { skills: string[] } };
    manifest.pi.skills = ["skills"];
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(packageRoot, "skills", "fixture", "support.md"), "Supporting Skill material.\n");
    execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", packageRoot],
      { stdio: "ignore", env: { ...process.env, npm_config_userconfig: "/dev/null" } });
    const metadata = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "fixture",
      preparedEnvironment: { os: "linux", architecture: process.arch === "x64" ? "amd64" : process.arch,
        variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } })).metadata;
    const workspace = join(home, "workspace"), agentDirectory = join(home, "agent");
    mkdirSync(workspace); mkdirSync(agentDirectory);
    const loaded = await createPackageResourceLoader({ root: join(home, "packages"),
      bindings: [{ name, nameKey: key, artifact: metadata }], selection: [{ name, enabled: true }],
      standaloneSkills: [], agentsMd: "# Fixture\n", workspace, agentDirectory });
    assert.deepEqual(metadata.resourceCounts, { extensions: 1, skills: 1, prompts: 1, themes: 1 });
    assert.deepEqual([...loaded.toolNames], [[`package:${name}:fixture_hello`, "fixture_hello"]]);
    assert.deepEqual(loaded.resources.map(({ kind }) => kind).sort(), ["extension", "prompt", "skill", "theme"]);
    assert.equal(readFileSync(join(packageRoot, "prepared.txt"), "utf8"), "prepared-v1\n");
    const standaloneSkill = loaded.loader.getSkills().skills[0]!;
    await assert.rejects(createPackageResourceLoader({ root: join(home, "packages"),
      bindings: [{ name, nameKey: key, artifact: metadata }], selection: [{ name, enabled: true }],
      standaloneSkills: [standaloneSkill], agentsMd: "# Fixture\n", workspace, agentDirectory }), /duplicate package Skill/);
    writeFileSync(join(packageRoot, "extensions", "tool.js"), "export default }\n");
    const brokenPackages = join(home, "broken-packages"), brokenRoot = join(brokenPackages, key);
    cpSync(packageRoot, brokenRoot, { recursive: true, dereference: true });
    rmSync(join(brokenRoot, "node_modules"), { recursive: true, force: true });
    execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", brokenRoot],
      { stdio: "ignore", env: { ...process.env, npm_config_userconfig: "/dev/null" } });
    const broken = (await validatePiPackageArtifact({ root: brokenRoot, sourceKind: "local", resolvedSource: "fixture",
      preparedEnvironment: metadata.preparedEnvironment })).metadata;
    await assert.rejects(createPackageResourceLoader({ root: brokenPackages,
      bindings: [{ name, nameKey: key, artifact: broken }], selection: [{ name, enabled: true }],
      standaloneSkills: [], agentsMd: "# Fixture\n", workspace, agentDirectory }), /required package resource failed to load/);
    rmSync(join(packageRoot, "node_modules", "fixture-dependency"), { recursive: true, force: true });
    await assert.rejects(validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "fixture",
      preparedEnvironment: metadata.preparedEnvironment }), /runtime dependency fixture-dependency is missing/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("duplicate Skill, prompt, and theme names across enabled packages fail readiness", async () => {
  for (const kind of ["skills", "prompts", "themes"] as const) {
    const home = mkdtempSync(join(tmpdir(), `piwork-package-collision-${kind}-`));
    try {
      const root = join(home, "packages"), bindings = [];
      for (const suffix of ["one", "two"]) {
        const name = `@piwork/${suffix}`, key = packageNameKey(name), packageRoot = join(root, key);
        const resource = kind === "skills" ? "skills/shared/SKILL.md" : kind === "prompts" ? "prompts/shared.md" : "themes/shared.json";
        mkdirSync(join(packageRoot, kind, ...(kind === "skills" ? ["shared"] : [])), { recursive: true });
        writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { [kind]: [resource] } }));
        writeFileSync(join(packageRoot, resource), kind === "skills"
          ? "---\nname: shared\ndescription: duplicate Skill\n---\nUse this Skill.\n"
          : kind === "prompts" ? "Shared prompt.\n"
          : readFileSync(fileURLToPath(new URL("../../../fixtures/pi-packages/tools-v1/themes/fixture.json", import.meta.url))));
        const metadata = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "fixture",
          preparedEnvironment: { os: "linux", architecture: process.arch === "x64" ? "amd64" : process.arch,
            variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } })).metadata;
        bindings.push({ name, nameKey: key, artifact: metadata });
      }
      const workspace = join(home, "workspace"), agentDirectory = join(home, "agent");
      mkdirSync(workspace); mkdirSync(agentDirectory);
      await assert.rejects(createPackageResourceLoader({ root, bindings,
        selection: bindings.map(({ name }) => ({ name, enabled: true })), standaloneSkills: [], agentsMd: "",
        workspace, agentDirectory }), /required package resource failed to load|duplicate package/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("duplicate extension command names across packages fail before a Run", async () => {
  const home = mkdtempSync(join(tmpdir(), "piwork-package-command-collision-"));
  try {
    const root = join(home, "packages"), bindings = [];
    for (const suffix of ["one", "two"]) {
      const name = `@piwork/command-${suffix}`, key = packageNameKey(name), packageRoot = join(root, key);
      mkdirSync(join(packageRoot, "extensions"), { recursive: true });
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["extensions/command.js"] } }));
      writeFileSync(join(packageRoot, "extensions", "command.js"),
        "export default function (pi) { pi.registerCommand('shared', { description: 'shared', handler: async () => {} }); }\n");
      const metadata = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "fixture",
        preparedEnvironment: { os: "linux", architecture: process.arch === "x64" ? "amd64" : process.arch,
          variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } })).metadata;
      bindings.push({ name, nameKey: key, artifact: metadata });
    }
    const workspace = join(home, "workspace"), agentDirectory = join(home, "agent");
    mkdirSync(workspace); mkdirSync(agentDirectory);
    await assert.rejects(createPackageResourceLoader({ root, bindings,
      selection: bindings.map(({ name }) => ({ name, enabled: true })), standaloneSkills: [], agentsMd: "",
      workspace, agentDirectory }), /duplicate package command shared/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
