import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, cpSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { WorkStore } from "@piwork/work-store";
import { createPackageResourceLoader, packageNameKey } from "./package-resources.js";
import { BRAIN_TOOL_NAMES, initializeBrainSource, readBrainCognition } from "./brain-resources.js";
import { BrainFlow } from "./brain-flow.js";
import { ServiceBindingRegistry, ServiceInteractionClient } from "./service-interaction.js";
import { AgentSessionService } from "./sessions.js";
import { AgentDaemonControl } from "./daemon.js";
import { PiSdkRunExecutor } from "./pi-sdk-executor.js";
import { RunManager } from "./runs.js";
import { selectPackageTools } from "./application.js";

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
    assert.deepEqual(artifact.resourceCounts, { extensions: 1, skills: 1, prompts: 0, themes: 0 });
    assert.deepEqual([...loaded.toolNames.values()], [...BRAIN_TOOL_NAMES]);
    assert.equal(loaded.loader.getSkills().skills[0]?.name, "deploy-work-service");
    assert.match(loaded.loader.getAppendSystemPrompt().join("\n"), /Piwork workstation cognition/);
    assert.doesNotMatch(loaded.loader.getAppendSystemPrompt().join("\n"), /User edit/);
    assert.equal(selectPackageTools(loaded.toolNames, { allowed: [], denied: ["package:piwork-brain:brain_service"] }, new Set()).length, 3);
    const disabled = await createPackageResourceLoader({ ...input, selection: [{ name: "piwork-brain", enabled: false }] });
    assert.deepEqual(disabled.loader.getAppendSystemPrompt(), []);
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
