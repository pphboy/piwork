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
import { AgentSessionService as RealAgentSessions } from "./sessions.js";
import { AgentDaemonControl } from "./daemon.js";
import { RunManager } from "./runs.js";
import { AgentRunModels } from "./run-models.js";
import { WorkStore } from "@piwork/work-store";
import { createServer } from "node:http";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

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

test("actual SDK continues one Session with independently authenticated Run models and no persisted override credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-run-model-sdk-"));
  const observed: Array<{ model: string; key: string }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as { model: string };
    observed.push({ model: input.model, key: String(request.headers["x-api-key"] ?? "") });
    response.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (type: string, payload: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    emit("message_start", { type: "message_start", message: { id: "fixture-message", type: "message", role: "assistant", model: input.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    emit("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    emit("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `actual-model:${input.model}` } });
    emit("content_block_stop", { type: "content_block_stop", index: 0 });
    emit("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } });
    emit("message_stop", { type: "message_stop" }); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const store = WorkStore.open(join(root, "work.sqlite"));
  try {
    const workspace = join(root, "workspace"), agentDirectory = join(root, "agent"); await mkdir(workspace); await mkdir(agentDirectory);
    const credentialPath = join(root, "default-key"); await writeFile(credentialPath, "default-private-fixture-key\n");
    const selected = { modelRef: "catalog-model-0002", label: "Second", provider: "anthropic", model: "fixture-model-two", baseUrl };
    const modelConfig = { provider: "anthropic", id: "fixture-model-one", baseUrl, credentialPath, deterministic: false };
    const models = new AgentRunModels(modelConfig, {
      async models() { throw new Error("unused"); }, async resolveModel(ref) { return ref === null ? { model: { modelRef: null, label: "Default", provider: modelConfig.provider, model: modelConfig.id, baseUrl }, credential: "default-private-fixture-key" } : { model: selected, credential: "override-private-fixture-key" }; },
    });
    const sessions = new RealAgentSessions("work-model", store, workspace, join(root, "sessions"), "context-model"); const session = sessions.create();
    const executor = new PiSdkRunExecutor(sessions, agentDirectory, modelConfig, { models, resolvedTools: [], resourceLoaderFactory: async () => {
      const loader = new DefaultResourceLoader({ cwd: workspace, agentDir: agentDirectory, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
      await loader.reload(); return loader;
    } });
    const daemon = new AgentDaemonControl({ workId: "work-model", generation: 1, instanceId: "agent-model" });
    daemon.configure({ modelCredentialStatus: "available", contextIdentity: "context-model", loadedSkills: [], resolvedTools: [], initializationComplete: true });
    const manager = new RunManager(store, daemon, executor, undefined, models);
    const first = await manager.submitChat({ workId: "work-model", sessionId: session.sessionId, submissionKey: "first", prompt: "Answer one", modelRef: null });
    assert.equal((await manager.wait(first.run.runId)).finalText, "actual-model:fixture-model-one");
    const second = await manager.submitChat({ workId: "work-model", sessionId: session.sessionId, submissionKey: "second", prompt: "Answer two", modelRef: selected.modelRef });
    assert.equal((await manager.wait(second.run.runId)).finalText, "actual-model:fixture-model-two");
    assert.deepEqual(observed, [{ model: "fixture-model-one", key: "default-private-fixture-key" }, { model: "fixture-model-two", key: "override-private-fixture-key" }]);
    const history = await readFile(session.sdkHistoryPath, "utf8");
    assert.match(history, /fixture-model-one/); assert.match(history, /fixture-model-two/);
    assert.doesNotMatch(history + JSON.stringify(manager.watch(first.run.runId)) + JSON.stringify(manager.watch(second.run.runId)) + JSON.stringify(store.getRun(second.run.runId)), /private-fixture-key/);
    assert.equal(await readFile(credentialPath, "utf8"), "default-private-fixture-key\n");
    const db = await readFile(join(root, "work.sqlite")); assert.equal(db.includes(Buffer.from("override-private-fixture-key")), false);
  } finally { store.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
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
    execute: async () => ({ content: [{ type: "text", text: "lifecycle-ok" }], details: { checks: [{ name: "actual_lifecycle", passed: true, summary: "Actual extension execution" }] } }) });
}
`);
    const metadata = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "fixture",
      preparedEnvironment: { os: "linux", architecture: process.arch === "x64" ? "amd64" : process.arch,
        variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } })).metadata;
    const sessions = { workspaceDirectory: () => workspace, continue: () => SessionManager.inMemory(workspace) } as unknown as AgentSessionService;
    let loaders = 0;
    const actualResults: Array<{ toolName: string; args: unknown; result: unknown }> = [];
    const executor = new PiSdkRunExecutor(sessions, agentDirectory,
      { provider: "piwork-deterministic", id: "fixture-v1", deterministic: true },
      { resourceLoaderFactory: async () => { loaders += 1; return (await createPackageResourceLoader({
        root: join(root, "packages"), bindings: [{ name, nameKey: key, artifact: metadata }],
        selection: [{ name, enabled: true }], standaloneSkills: [], agentsMd: "# Agent\n", workspace, agentDirectory,
      })).loader; }, resolvedTools: ["hello"], onSdkToolResult: (_run, result) => { actualResults.push(result); } });
    for (const sessionId of ["session-one", "session-two"]) {
      const result = await executor.execute({ workId: "work-000000000001", sessionId, runId: `run-${sessionId}`,
        prompt: "invoke package tool hello", signal: new AbortController().signal, emit() {} });
      assert.match(result.finalText, /package-tool-result:hello:lifecycle-ok/);
    }
    assert.equal(loaders, 2);
    assert.equal(actualResults.length, 2);
    for (const result of actualResults) {
      assert.equal(result.toolName, "hello"); assert.deepEqual(result.args, {});
      assert.deepEqual((result.result as { details: unknown }).details, { checks: [{ name: "actual_lifecycle", passed: true, summary: "Actual extension execution" }] });
    }
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
