import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAgentSession,
  defineTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createDeterministicRuntime } from "./deterministic-model.js";
import { loadIsolatedSkills } from "./isolated-resources.js";

test("deterministic fixture discovers and reads the SDK Skill manifest and its supporting file", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-sdk-smoke-"));
  const skillDir = join(root, "skills", "fixture-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: fixture-skill\ndescription: PIWORK_SKILL_SENTINEL\n---\nSupporting file: support.txt\n",
  );
  await writeFile(join(skillDir, "support.txt"), "SDK_SUPPORT_SENTINEL\n");

  const { skills, loader } = loadIsolatedSkills(join(root, "skills"));
  const { runtime, model } = await createDeterministicRuntime();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: join(root, "agent"),
    modelRuntime: runtime,
    model,
    thinkingLevel: "off",
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    tools: ["read"],
  });

  try {
    assert.deepEqual(skills.map((skill) => skill.name), ["fixture-skill"]);
    assert.match(session.systemPrompt, /fixture-skill/);
    assert.match(session.systemPrompt, /PIWORK_SKILL_SENTINEL/);
    await session.prompt("read the configured Skill");
    const results = session.messages.filter((message) => message.role === "toolResult");
    assert.equal(results.length, 2);
    assert.equal(results.every((message) => message.role === "toolResult" && message.toolName === "read"), true);
    assert.equal(results.some((message) => message.role === "toolResult" && JSON.stringify(message.content).includes("SDK_SUPPORT_SENTINEL")), true);
    assert.ok(session.messages.some((message) =>
      message.role === "assistant" && message.content.some((part) => part.type === "text" && /^skill-read:[a-f0-9]{16}$/.test(part.text))
    ));
  } finally {
    session.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("real SDK abort stops a managed deterministic execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-sdk-abort-"));
  const { runtime, model } = await createDeterministicRuntime();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: join(root, "agent"),
    modelRuntime: runtime,
    model,
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(root),
    noTools: "all",
  });

  try {
    const prompt = session.prompt("wait for abort");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(session.isStreaming, true);
    await session.abort();
    await prompt;
    assert.equal(session.isStreaming, false);
    assert.ok(session.messages.some((message) => message.role === "assistant" && message.stopReason === "aborted"));
  } finally {
    session.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic deployment behavior uses real SDK custom-tool dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-sdk-deploy-"));
  const skillDirectory = join(root, "skills", "deploy-work-service");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), "---\nname: deploy-work-service\ndescription: Deploy a service\n---\nSee [reference](reference.md).\n");
  await writeFile(join(skillDirectory, "reference.md"), "Use the Work service MCP tools.\n");
  const { loader } = loadIsolatedSkills(join(root, "skills"));
  const { runtime, model } = await createDeterministicRuntime();
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const response = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
  const tool = (name: string, value: unknown) => defineTool({
    name, label: name, description: name,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async (_id, parameters) => { calls.push({ name, arguments: parameters as Record<string, unknown> }); return response(value); },
  });
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: join(root, "agent"),
    modelRuntime: runtime,
    model,
    thinkingLevel: "off",
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    tools: ["read", "write", "work-services__deployment_context", "work-services__service_create",
      "work-services__operation_get", "work-services__service_get", "bash"],
    customTools: [
      tool("read", "ThreadingHTTPServer deployment reference and source"),
      tool("write", { ok: true }),
      tool("work-services__deployment_context", { workId: "work-current", workspacePath: "/var/data/workspace" }),
      tool("work-services__service_create", { serviceId: "service-demo", operationId: "operation-demo", reused: false }),
      tool("work-services__operation_get", { operationId: "operation-demo", serviceId: "service-demo", state: "succeeded" }),
      tool("work-services__service_get", { serviceId: "service-demo", observedState: "ready" }),
      tool("bash", [{ count: 1 }, { count: 2 }]),
    ],
  });
  try {
    await session.prompt("deploy deterministic service");
    assert.deepEqual(calls.map((call) => call.name), [
      "read", "read", "work-services__deployment_context", "write", "read", "work-services__service_create",
      "work-services__operation_get", "work-services__service_get", "bash",
    ]);
    assert.match(String(calls[0]!.arguments.path), /SKILL\.md$/);
    assert.match(String(calls[1]!.arguments.path), /reference\.md$/);
    assert.equal(calls[4]!.arguments.path, "apps/demo/server.py");
    assert.equal("workId" in calls[5]!.arguments, false);
    assert.equal((calls[5]!.arguments.definition as Record<string, unknown>).workingDirectory, "/var/data/workspace");
    assert.ok(session.messages.some((message) => message.role === "assistant"
      && message.content.some((part) => part.type === "text" && part.text.includes("service-deployed:service-demo"))));
  } finally {
    session.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
