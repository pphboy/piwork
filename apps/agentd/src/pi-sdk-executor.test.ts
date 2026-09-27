import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { createPackageResourceLoader, packageNameKey } from "./package-resources.js";
import { initializeChildAgentDirectory, PiSdkRunExecutor, resolveProductionModel, writeChildAgentModelFiles } from "./pi-sdk-executor.js";
import type { AgentSessionService } from "./sessions.js";

test("registers an Anthropic-compatible custom model at the configured endpoint", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  const model = resolveProductionModel(runtime, {
    provider: "anthropic",
    id: "deepseek-flash",
    baseUrl: "https://api.deepseek.com/anthropic",
  });

  assert.equal(model.provider, "anthropic");
  assert.equal(model.id, "deepseek-flash");
  assert.equal(model.api, "anthropic-messages");
  assert.equal(model.baseUrl, "https://api.deepseek.com/anthropic");
});

test("keeps a built-in model while overriding its endpoint", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  const model = resolveProductionModel(runtime, {
    provider: "anthropic",
    id: "claude-sonnet-4-5",
    baseUrl: "https://proxy.example.test/anthropic",
  });

  assert.equal(model.id, "claude-sonnet-4-5");
  assert.equal(model.baseUrl, "https://proxy.example.test/anthropic");
});

test("rejects an unknown model without an Anthropic-compatible endpoint", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  assert.throws(
    () => resolveProductionModel(runtime, { provider: "anthropic", id: "unknown-custom-model" }),
    /configured model is not available/,
  );
});

test("child Pi reads only the selected Work model and credential from private files", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-child-agent-model-"));
  const directory = join(root, "agent");
  try {
    await initializeChildAgentDirectory(directory);
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const model = resolveProductionModel(runtime, { provider: "openai", id: "gpt-4.1-mini", baseUrl: "http://model-fixture:8080/v1" });
    await writeChildAgentModelFiles(directory, model, "fixture-work-key");
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    for (const name of ["models.json", "auth.json"]) assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
    const child = await ModelRuntime.create({ modelsPath: join(directory, "models.json"), authPath: join(directory, "auth.json"),
      refreshOnCreate: false, allowModelNetwork: false });
    assert.equal(child.getModel("openai", "gpt-4.1-mini")?.baseUrl, "http://model-fixture:8080/v1");
    assert.equal((await child.getAuth(child.getModel("openai", "gpt-4.1-mini")!))?.auth.apiKey, "fixture-work-key");
    await initializeChildAgentDirectory(directory);
    await assert.rejects(readFile(join(directory, "auth.json")), { code: "ENOENT" });
    await rm(directory, { recursive: true });
    await symlink(root, directory);
    await assert.rejects(writeChildAgentModelFiles(directory, model, "must-not-persist"), /configuration directory is invalid/);
    await assert.rejects(readFile(join(root, "auth.json")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("each SDK Run binds a fresh package loader and emits quit shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-run-"));
  try {
    const name = "@example/lifecycle", key = packageNameKey(name);
    const packageRoot = join(root, "packages", key), workspace = join(root, "workspace"), agentDirectory = join(root, "agent");
    const events = join(root, "events.log");
    await mkdir(join(packageRoot, "extensions"), { recursive: true });
    await mkdir(workspace); await mkdir(agentDirectory);
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["extensions/tool.js"] } }));
    await writeFile(join(packageRoot, "extensions", "tool.js"), `import { appendFileSync, existsSync } from "node:fs";
export default function (pi) {
  pi.on("session_start", () => { appendFileSync(${JSON.stringify(events)}, "start\\n");
    if (existsSync(${JSON.stringify(join(root, "fail-start"))})) throw new Error("fixture start failed"); });
  pi.on("resources_discover", () => { if (existsSync(${JSON.stringify(join(root, "fail-discover"))})) throw new Error("fixture discovery failed"); });
  pi.on("agent_start", () => { appendFileSync(${JSON.stringify(events)}, "agent-start\\n");
    if (existsSync(${JSON.stringify(join(root, "fail-run"))})) throw new Error("fixture agent event failed"); });
  pi.on("session_shutdown", (event) => { appendFileSync(${JSON.stringify(events)}, "shutdown:" + event.reason + "\\n");
    if (existsSync(${JSON.stringify(join(root, "fail-shutdown"))})) throw new Error("fixture shutdown failed"); });
  pi.registerTool({ name: "hello", label: "Hello", description: "Lifecycle tool", parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "lifecycle-ok" }] }) });
}
`);
    const metadata = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "fixture",
      preparedEnvironment: { os: "linux", architecture: process.arch === "x64" ? "amd64" : process.arch,
        variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } })).metadata;
    const sessions = { workspaceDirectory: () => workspace, continue: () => SessionManager.inMemory(workspace) } as unknown as AgentSessionService;
    let loaders = 0;
    const executor = new PiSdkRunExecutor(sessions, agentDirectory,
      { provider: "piwork-deterministic", id: "fixture-v1", deterministic: true },
      { resourceLoaderFactory: async () => { loaders += 1; return (await createPackageResourceLoader({
        root: join(root, "packages"), bindings: [{ name, nameKey: key, artifact: metadata }],
        selection: [{ name, enabled: true }], standaloneSkills: [], agentsMd: "# Agent\n", workspace, agentDirectory,
      })).loader; }, resolvedTools: ["hello"] });
    for (const sessionId of ["session-one", "session-two"]) {
      const result = await executor.execute({ workId: "work-000000000001", sessionId, runId: `run-${sessionId}`,
        prompt: "invoke package tool hello", signal: new AbortController().signal, emit() {} });
      assert.match(result.finalText, /package-tool-result:hello:lifecycle-ok/);
    }
    assert.equal(loaders, 2);
    assert.deepEqual((await readFile(events, "utf8")).trim().split("\n"),
      ["start", "agent-start", "shutdown:quit", "start", "agent-start", "shutdown:quit"]);
    await writeFile(join(root, "fail-start"), "1");
    const diagnostics: unknown[] = [];
    const execute = (sessionId: string) => executor.execute({ workId: "work-000000000001", sessionId, runId: `run-${sessionId}`,
      prompt: "invoke package tool hello", signal: new AbortController().signal,
      emit(type, payload) { if (type === "diagnostic") diagnostics.push(payload); } });
    await assert.rejects(execute("session-failed-start"), /package extension event failed/);
    assert.equal((await readFile(events, "utf8")).trim().split("\n").at(-1), "shutdown:quit");
    assert.equal((await readFile(events, "utf8")).trim().split("\n").filter((event) => event === "agent-start").length, 2,
      "a failed session_start must not run the prompt");
    await rm(join(root, "fail-start"));
    await writeFile(join(root, "fail-discover"), "1");
    await assert.rejects(execute("session-failed-discover"), /package extension event failed/);
    await rm(join(root, "fail-discover"));
    await writeFile(join(root, "fail-run"), "1");
    await assert.rejects(execute("session-failed-run"), /package extension event failed/);
    await rm(join(root, "fail-run"));
    await writeFile(join(root, "fail-shutdown"), "1");
    assert.match((await execute("session-failed-shutdown")).finalText, /package-tool-result:hello:lifecycle-ok/);
    const phaseDiagnostics = diagnostics
      .filter((item) => (item as { code: string }).code === "PI_SDK_RUN_PHASE")
      .map((item) => (item as { phase: string }).phase);
    assert.ok(phaseDiagnostics.includes("runtime-started"));
    assert.ok(phaseDiagnostics.includes("session-loaded"));
    assert.ok(phaseDiagnostics.includes("extensions-bound"));
    assert.ok(phaseDiagnostics.includes("prompt-started"));
    assert.ok(phaseDiagnostics.includes("shutdown-finished"));
    assert.deepEqual(diagnostics
      .filter((item) => (item as { code: string }).code !== "PI_SDK_RUN_PHASE")
      .map((item) => (item as { code: string }).code), [
      "PI_PACKAGE_EXTENSION_EVENT_FAILED", "PI_PACKAGE_EXTENSION_EVENT_FAILED", "PI_PACKAGE_EXTENSION_EVENT_FAILED",
      "PI_PACKAGE_EXTENSION_CLEANUP_FAILED",
    ]);
    await rm(join(root, "fail-shutdown"));
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(executor.execute({ workId: "work-000000000001", sessionId: "session-aborted", runId: "run-aborted",
      prompt: "invoke package tool hello", signal: aborted.signal, emit() {} }), /aborted/i);
    assert.equal((await readFile(events, "utf8")).trim().split("\n").at(-1), "shutdown:quit");
  } finally { await rm(root, { recursive: true, force: true }); }
});
