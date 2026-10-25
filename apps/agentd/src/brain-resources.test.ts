import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, cpSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createDeterministicRuntime } from "@piwork/pi-adapter";
import { Type } from "typebox";
import { request } from "node:http";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { WorkStore } from "@piwork/work-store";
import { createPackageResourceLoader, packageNameKey } from "./package-resources.js";
import { BRAIN_TOOL_NAMES, initializeBrainSource, readBrainCognition, brainPrompt } from "./brain-resources.js";
import { BrainFlow } from "./brain-flow.js";
import { ServiceBindingRegistry, ServiceInteractionClient } from "./service-interaction.js";
import { AgentSessionService } from "./sessions.js";
import { AgentDaemonControl } from "./daemon.js";
import { PiSdkRunExecutor } from "./pi-sdk-executor.js";
import { RunManager } from "./runs.js";
import { selectPackageTools } from "./application.js";

async function awarenessFixture(t: { after: (callback: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "piwork-awareness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace"), key = packageNameKey("piwork-brain"), packageRoot = join(root, "packages", key);
  mkdirSync(workspace);
  cpSync(fileURLToPath(new URL("../../../internal/coreassets/piwork-brain/", import.meta.url)), packageRoot, { recursive: true, filter: path => !path.includes("__pycache__") });
  const preparedEnvironment = { os: "linux" as const, architecture: process.arch === "x64" ? "amd64" : process.arch, variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" };
  const artifact = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "piwork-brain", preparedEnvironment })).metadata;
  const binding = { name: artifact.name, nameKey: key, artifact };
  return { root, workspace, packageRoot, binding, preparedEnvironment, input: {
    root: join(root, "packages"), bindings: [binding], selection: [{ name: "piwork-brain", enabled: true }],
    standaloneSkills: [], agentsMd: "# Synthetic application", workspace, agentDirectory: join(root, "agent"),
  } };
}

test("file delivery guidance joins brain cognition without granting package tools", async t => {
  const f = await awarenessFixture(t);
  const { loader, toolNames } = await createPackageResourceLoader(f.input);
  assert.ok(toolNames.size > 0, "brain package must register tools before authorization");
  const { runtime, model } = await createDeterministicRuntime();
  const { session } = await createAgentSession({ cwd: f.workspace, agentDir: f.input.agentDirectory, modelRuntime: runtime, model,
    resourceLoader: loader, sessionManager: SessionManager.inMemory(f.workspace), tools: [], thinkingLevel: "off" });
  try {
    assert.match(session.systemPrompt, /Piwork workstation cognition/);
    assert.match(session.systemPrompt, /piwork-file:\/relative\/path/);
    assert.deepEqual(session.getActiveToolNames(), []);
    await session.prompt("inspect file delivery guidance");
    assert.ok(session.messages.some(message => message.role === "assistant"
      && JSON.stringify(message.content).includes("file-delivery-guidance:true:true:brain")));
  } finally { session.dispose(); }
});

test("NiceGUI Reference is conditionally read from the captured Skill and not injected into every task", async t => {
  const f = await awarenessFixture(t);
  initializeBrainSource({ frozenRoot: f.packageRoot, workspace: f.workspace, privateDirectory: join(f.root, "private"), binding: f.binding });
  const relative = "skills/application-awareness/references/nicegui.md";
  const original = readFileSync(join(f.packageRoot, relative), "utf8");
  writeFileSync(join(f.workspace, ".pi/packages/piwork-brain", relative), "UNAPPLIED_REFERENCE_EDIT");
  const { loader } = await createPackageResourceLoader(f.input);
  const { runtime, model } = await createDeterministicRuntime();
  const { session } = await createAgentSession({ cwd: f.workspace, agentDir: f.input.agentDirectory, modelRuntime: runtime, model,
    resourceLoader: loader, sessionManager: SessionManager.inMemory(f.workspace), tools: ["read"], thinkingLevel: "off" });
  try {
    assert.ok(!session.systemPrompt.includes(original));
    await session.prompt("inspect NiceGUI application awareness");
    const results = session.messages.filter(message => message.role === "toolResult");
    assert.deepEqual(results.map(result => result.toolName), ["read", "read"]);
    assert.equal(results[1]!.content.filter(part => part.type === "text").map(part => part.text).join(""), original);
    assert.doesNotMatch(JSON.stringify(results), /UNAPPLIED_REFERENCE_EDIT/);
    assert.deepEqual(loader.getSkills().skills.map(skill => skill.name).sort(), ["application-awareness", "deploy-work-service"]);
  } finally { session.dispose(); }
});

for (const observation of [null, { reason: "entry_unreachable" }, { reason: "entry_unauthorized" },
  { reason: "content_hidden", domPresent: true, displayNone: true }, { reason: "resource_failed", resourceStatus: 503 },
  { reason: "insufficient_evidence" }]) test(`NiceGUI fixture reports partial verification using its actual tools and observed facts: ${observation?.reason ?? "browser_unavailable"}`, async t => {
  const f = await awarenessFixture(t);
  const { loader } = await createPackageResourceLoader(f.input);
  const { runtime, model } = await createDeterministicRuntime();
  const calls: Array<{ name: string; args: unknown }> = [];
  const customTools = [{ name: "fixture_business", label: "Synthetic backend", description: "Read synthetic business state",
    parameters: Type.Object({ operation: Type.Literal("query") }),
    execute: async () => ({ content: [{ type: "text" as const, text: JSON.stringify({ value: 2 }) }], details: {} }) },
    ...(observation ? [{ name: "fixture_browser", label: "Controlled browser observation", description: "Return the controlled entry observation",
      parameters: Type.Object({ operation: Type.Literal("inspect"), entry: Type.Literal("desktop-service") }),
      execute: async () => ({ content: [{ type: "text" as const, text: JSON.stringify(observation) }], details: {} }) }] : [])];
  const names = ["read", ...customTools.map(tool => tool.name)];
  const { session } = await createAgentSession({ cwd: f.workspace, agentDir: f.input.agentDirectory, modelRuntime: runtime, model,
    resourceLoader: loader, sessionManager: SessionManager.inMemory(f.workspace), tools: names, customTools, thinkingLevel: "off" });
  session.subscribe(event => { if (event.type === "tool_execution_start") calls.push({ name: event.toolName, args: event.args }); });
  try {
    assert.deepEqual(session.getActiveToolNames().sort(), names.slice().sort());
    await session.prompt("verify NiceGUI fixture page");
    assert.deepEqual(calls.map(call => call.name), ["read", "read", "fixture_business", ...(observation ? ["fixture_browser"] : [])]);
    if (observation) assert.deepEqual(calls[3]!.args, { operation: "inspect", entry: "desktop-service" });
    const last = session.messages.filter(message => message.role === "assistant").at(-1)!;
    const report = JSON.parse(last.content.filter(part => part.type === "text").map(part => part.text).join(""));
    assert.equal(report.backendVerified, true);
    assert.equal(report.pageVerified, false);
    assert.equal(report.reason, observation?.reason ?? "browser_unavailable");
    assert.equal(report.attribution, observation?.reason === "content_hidden" ? "style" : observation?.reason === "resource_failed" ? "resource" : "unknown");
    if (observation) assert.deepEqual(report.facts, observation);
    assert.deepEqual(readdirSync(f.workspace), []);
  } finally { session.dispose(); }
});

test("application awareness is read through the real SDK from the frozen package, reused, and leaves business operations direct", async t => {
  const f = await awarenessFixture(t);
  initializeBrainSource({ frozenRoot: f.packageRoot, workspace: f.workspace, privateDirectory: join(f.root, "private"), binding: f.binding });
  const relative = "skills/application-awareness/SKILL.md";
  const original = readFileSync(join(f.packageRoot, relative), "utf8");
  writeFileSync(join(f.workspace, ".pi/packages/piwork-brain", relative), "UNAPPLIED_USER_EDIT");
  const { loader } = await createPackageResourceLoader(f.input);
  const { runtime, model } = await createDeterministicRuntime();
  let business = 1;
  const { session } = await createAgentSession({ cwd: f.workspace, agentDir: f.input.agentDirectory,
    modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: loader,
    sessionManager: SessionManager.inMemory(f.workspace), tools: ["read", "write", "fixture_business"],
    customTools: [{ name: "fixture_business", label: "Synthetic business", description: "Query or increment synthetic state",
      parameters: Type.Object({ operation: Type.Union([Type.Literal("query"), Type.Literal("action")]) }),
      execute: async (_id, input) => { if ((input as { operation: string }).operation === "action") business++; return { content: [{ type: "text", text: JSON.stringify({ value: business }) }], details: {} }; } }],
  });
  const calls: Array<{ name: string; args: any; result?: unknown }> = [];
  session.subscribe(event => {
    if (event.type === "tool_execution_start") calls.push({ name: event.toolName, args: event.args });
    if (event.type === "tool_execution_end") calls.at(-1)!.result = event.result;
  });
  try {
    assert.match(session.systemPrompt, /application-awareness/);
    assert.ok(!session.systemPrompt.includes(original));
    assert.doesNotMatch(session.systemPrompt, /### 1\. Product/);
    await session.prompt("query application awareness fixture");
    await session.prompt("act application awareness fixture");
    assert.equal(business, 2);
    assert.deepEqual(calls.map(call => call.name), ["fixture_business", "fixture_business"]);
    assert.deepEqual(readdirSync(f.workspace).sort(), [".pi"]);
    mkdirSync(join(f.workspace, "apps/example"), { recursive: true });
    writeFileSync(join(f.workspace, "apps/example/SPEC.md"), "# Example\nIntent: round amounts.\n");
    writeFileSync(join(f.workspace, "apps/example/logic.mjs"), "export const roundAmount = value => Math.round(value);\n");
    await session.prompt("adjust application awareness backend");
    assert.deepEqual(calls.slice(2).map(call => call.name), ["read", "write", "write"]);
    assert.equal(calls[2]!.args.path, join(f.packageRoot, relative));
    const readResult = calls[2]!.result as { content: Array<{ type: string; text?: string }> };
    assert.equal(readResult.content.filter(part => part.type === "text").map(part => part.text).join(""), original, "SDK did not return the full frozen Skill body");
    const text = JSON.stringify(calls[2]!.result);
    for (const heading of ["1. Product", "2. UI", "3. UX", "4. Reactivity", "5. Engineering Judgment"]) assert.ok(text.includes(heading));
    assert.doesNotMatch(text, /UNAPPLIED_USER_EDIT/);
    assert.deepEqual(readdirSync(join(f.workspace, "apps/example")).sort(), ["SPEC.md", "logic.mjs"]);
    const module = await import(pathToFileURL(join(f.workspace, "apps/example/logic.mjs")).href);
    assert.equal(module.roundAmount(-1.2), -2);
    assert.match(readFileSync(join(f.workspace, "apps/example/SPEC.md"), "utf8"), /Acceptance: roundAmount\(-1.2\) equals -2/);
    const count = calls.length;
    await session.prompt("reuse application awareness");
    assert.equal(calls.length, count, "same effective context unnecessarily reread the Skill");
    assert.ok(session.messages.some(message => message.role === "assistant" && JSON.stringify(message.content).includes("application-awareness:reused")));
    assert.equal(readFileSync(join(f.workspace, ".pi/packages/piwork-brain", relative), "utf8"), "UNAPPLIED_USER_EDIT");
    const evidence = process.env.PIWORK_TEST_APPLICATION_AWARENESS_EVIDENCE;
    if (evidence) {
      mkdirSync(dirname(evidence), { recursive: true });
      writeFileSync(evidence, JSON.stringify({ fixture: "deterministic-sdk-dispatch-not-general-model-judgment", calls, messages: session.messages }, null, 2).replaceAll(f.root, "<fixture>") + "\n");
    }
    t.diagnostic("Actual SDK tools: query, action, frozen read, affected Spec/source writes; same-context reuse adds no tool call. Synthetic dispatch does not prove arbitrary model judgment.");
  } finally { session.dispose(); }
});

test("application awareness stays within enabled captured packages and duplicate package Skill names are rejected", async t => {
  const f = await awarenessFixture(t);
  for (const input of [{ ...f.input, selection: [{ name: "piwork-brain", enabled: false }] }, { ...f.input, bindings: [], selection: [] }]) {
    const { loader, resources } = await createPackageResourceLoader(input);
    assert.deepEqual(loader.getSkills().skills, []);
    const appended = loader.getAppendSystemPrompt().join("\n");
    assert.doesNotMatch(appended, /Piwork workstation cognition/);
    assert.match(appended, /piwork-file:\/relative\/path/);
    assert.match(appended, /\/var\/data\/workspace\//);
    assert.deepEqual(resources, []);
  }
  const name = "awareness-conflict", key = packageNameKey(name), other = join(f.input.root, key);
  mkdirSync(join(other, "skills/application-awareness"), { recursive: true });
  writeFileSync(join(other, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { skills: ["skills"] } }));
  cpSync(join(f.packageRoot, "skills/application-awareness/SKILL.md"), join(other, "skills/application-awareness/SKILL.md"));
  const artifact = (await validatePiPackageArtifact({ root: other, sourceKind: "local", resolvedSource: name, preparedEnvironment: f.preparedEnvironment })).metadata;
  await assert.rejects(createPackageResourceLoader({ ...f.input,
    bindings: [...f.input.bindings, { name, nameKey: key, artifact }], selection: [...f.input.selection, { name, enabled: true }],
  }), /duplicate|failed to load/i);
});

test("the actual cognition prompt reports provided IDs and truncation without claiming all Memory was read",()=>{
 const prompt=brainPrompt("Stable cognition",{version:3,entries:[]},{entryIds:[],matchedCount:2,truncated:true}).join("\n");
 assert.match(prompt,/version 3/);assert.match(prompt,/"matchedCount":2/);assert.match(prompt,/More matches were not provided/);
 assert.doesNotMatch(brainPrompt("Stable cognition").join("\n"),/Memory selection/);
});

test("frozen brain is a real SDK package, injects cognition each Run, and bridges only active allowed calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-brain-sdk-")); const store = WorkStore.open(join(root, "private", "work.sqlite"));
  let flow: BrainFlow | undefined;
  try {
    const workspace = join(root, "workspace"), agentDirectory = join(root, "agent"), key = packageNameKey("piwork-brain"), packageRoot = join(root, "packages", key);
    mkdirSync(workspace); mkdirSync(agentDirectory); mkdirSync(join(root, "sessions"));
    cpSync(fileURLToPath(new URL("../../../internal/coreassets/piwork-brain/", import.meta.url)), packageRoot, { recursive: true,
      filter: (path) => !path.includes("__pycache__") });
    const artifact = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "piwork-brain",
      preparedEnvironment: { os: "linux", architecture: process.arch === "x64" ? "amd64" : process.arch, variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } })).metadata;
    const binding = { name: artifact.name, nameKey: key, artifact };
    chmodSync(join(packageRoot, "brain.md"), 0o444);
    initializeBrainSource({ frozenRoot: packageRoot, workspace, privateDirectory: join(root, "private"), binding });
    const source = join(workspace, ".pi", "packages", "piwork-brain", "brain.md");
    assert.ok(lstatSync(source).mode & 0o200, "separate brain source must be writable even when captured bytes are read-only");
    writeFileSync(source, "User edit, awaiting Apply");
    initializeBrainSource({ frozenRoot: packageRoot, workspace, privateDirectory: join(root, "private"), binding });
    assert.equal(readFileSync(source, "utf8"), "User edit, awaiting Apply");
    chmodSync(join(packageRoot, "brain.md"), 0o644); // Allow the later intentional corruption fixture.
    const input = { root: join(root, "packages"), bindings: [binding], selection: [{ name: "piwork-brain", enabled: true }],
      standaloneSkills: [], agentsMd: "# Work", workspace, agentDirectory };
    const loaded = await createPackageResourceLoader(input);
    assert.deepEqual(artifact.resourceCounts, { extensions: 1, skills: 2, prompts: 0, themes: 0 });
    assert.deepEqual([...loaded.toolNames.values()], [...BRAIN_TOOL_NAMES]);
    assert.deepEqual(loaded.loader.getSkills().skills.map(skill => skill.name).sort(), ["application-awareness", "deploy-work-service"]);
    assert.match(loaded.loader.getAppendSystemPrompt().join("\n"), /Piwork workstation cognition/);
    assert.doesNotMatch(loaded.loader.getAppendSystemPrompt().join("\n"), /User edit/);
    assert.equal(selectPackageTools(loaded.toolNames, { allowed: [], denied: ["package:piwork-brain:brain_service"] }, new Set()).length, 3);
    const disabled = await createPackageResourceLoader({ ...input, selection: [{ name: "piwork-brain", enabled: false }] });
    const disabledAppend = disabled.loader.getAppendSystemPrompt().join("\n");
    assert.doesNotMatch(disabledAppend, /Piwork workstation cognition/);
    assert.match(disabledAppend, /piwork-file:\/relative\/path/);
    const workId = "work-1111111111111111";
    const sessions = new AgentSessionService(workId, store, workspace, join(root, "sessions"), "context-brain");
    const daemon = new AgentDaemonControl({ workId, generation: 1, instanceId: "instance-brain" });
    const allowed = new Set([...loaded.toolNames.keys()]);
    let runs: RunManager;
    flow = new BrainFlow(store, new ServiceInteractionClient(workspace, new ServiceBindingRegistry(workId), store.feedback), allowed, (id) => { runs.cancel(id); });
    const executor = new PiSdkRunExecutor(sessions, agentDirectory, { provider: "piwork-deterministic", id: "fixture-v1", deterministic: true },
      { resolvedTools: [...BRAIN_TOOL_NAMES], resourceLoaderFactory: async (run) => (await createPackageResourceLoader({ ...input,
        experience: store.feedback.experienceSnapshot(workId, run?.adoptedExperienceVersion ?? 0) })).loader });
    runs = new RunManager(store, daemon, flow.wrap(executor));
    daemon.configure({ modelCredentialStatus: "available", contextIdentity: "context-brain", loadedSkills: [], resolvedTools: [...allowed], initializationComplete: true });
    await flow.start(); assert.equal(lstatSync("/tmp/piwork-brain.sock").mode & 0o777, 0o600);
    await assert.rejects(flow.invoke("brain_experience", { operation: "status" }), /current active Run/);
    const firstSession = sessions.create();
    const cognition = runs.submit({ workId, sessionId: firstSession.sessionId, submissionKey: "cognition", prompt: "inspect piwork brain cognition" });
    assert.equal((await runs.wait(cognition.run.runId)).finalText, "brain-cognition:0:false");
    const tool = runs.submit({ workId, sessionId: firstSession.sessionId, submissionKey: "tool", prompt: 'invoke package tool brain_experience with {"operation":"status"}' });
    const toolRun = await runs.wait(tool.run.runId);
    assert.equal(toolRun.state, "succeeded"); assert.match(toolRun.finalText!, /adoptedExperienceVersion.*0/);
    assert.equal(store.feedback.listRequests(workId).items.length, 0, "read-only calls create no background goal");
    const scripted = new RunManager(store, daemon, flow.wrap({ async execute(context) {
      const goal = store.feedback.ensureChatRequest(workId, context.runId, context.prompt);
      const proof = store.feedback.addEvidence(workId, { requestId: goal.requestId, runId: context.runId, kind: "query", objectRef: "fixture-cognition-check", observedAt: new Date().toISOString(), summary: "Actual fixture cognition inspected", verified: true },
        { checks: [{ name: "cognition_present", passed: readBrainCognition(packageRoot).includes("Piwork workstation cognition") }] });
      store.feedback.stageExperience(workId, goal.requestId, { entryId: "fixture-rule", scope: "work", rule: "confirmed-fixture-rule", evidenceIds: [proof.evidenceId] });
      store.feedback.finish(workId, goal.requestId, "completed", "verified", null, [proof.evidenceId]);
      return { finalText: "verified" };
    } }));
    const learning = scripted.submit({ workId, sessionId: firstSession.sessionId, submissionKey: "learning", prompt: "Confirm observed rule" }); await scripted.wait(learning.run.runId);
    const head = store.feedback.experienceSnapshot(workId).version;
    assert.ok(head > 0);
    for (const sessionId of [firstSession.sessionId, sessions.create().sessionId]) {
      const adopted = runs.submit({ workId, sessionId, submissionKey: `adopt-${sessionId}`, prompt: "inspect piwork brain cognition" });
      assert.equal(adopted.run.adoptedExperienceVersion, head);
      assert.equal((await runs.wait(adopted.run.runId)).finalText, `brain-cognition:${head}:true`);
    }
    writeFileSync(join(packageRoot, "brain.md"), Buffer.alloc(65537, 97));
    assert.throws(() => readBrainCognition(packageRoot), /64 KiB/);
    writeFileSync(join(packageRoot, "brain.md"), Buffer.from([0xff]));
    assert.throws(() => readBrainCognition(packageRoot), /UTF-8/);
    rmSync(join(packageRoot, "brain.md")); assert.throws(() => readBrainCognition(packageRoot));
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
    assert.equal(manifest.dependencies, undefined);
  } finally { await flow?.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("the Unix bridge rejects a caller without a current Run and does not accept Service authorization", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-brain-socket-")), socket = join(root, "brain.sock");
  const store = WorkStore.open(join(root, "work.sqlite"));
  const flow = new BrainFlow(store, new ServiceInteractionClient(root, new ServiceBindingRegistry("work-1"), store.feedback), new Set(), () => {});
  try {
    await flow.start(socket);
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const call = request({ socketPath: socket, path: "/internal/v1/brain/brain_feedback", method: "POST", headers: { authorization: "Bearer service-token" } }, (response) => {
        let body = ""; response.on("data", (chunk) => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode!, body }));
      }); call.on("error", reject); call.end('{"operation":"finish","state":"completed"}');
    });
    assert.equal(result.status, 409); assert.match(result.body, /RUN_NOT_ACTIVE/);
  } finally { await flow.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
