import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import {
  createAgentSession,
  defineTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createDeterministicRuntime } from "./deterministic-model.js";
import { loadIsolatedSkills } from "./isolated-resources.js";

test("real SDK loads an explicit Skill and executes a registered fixture tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-sdk-smoke-"));
  const skillDir = join(root, "skills", "fixture-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: fixture-skill\ndescription: PIWORK_SKILL_SENTINEL\n---\nUse the fixture tool exactly once.\n",
  );

  let calls = 0;
  const fixtureTool = defineTool({
    name: "fixture_echo",
    label: "Fixture Echo",
    description: "Deterministic SDK smoke tool",
    parameters: Type.Object({ text: Type.String() }),
    execute: async (_toolCallId, params) => {
      calls += 1;
      return { content: [{ type: "text", text: `echo:${params.text}` }], details: {} };
    },
  });

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
    tools: ["read", "fixture_echo"],
    customTools: [fixtureTool],
  });

  try {
    assert.deepEqual(skills.map((skill) => skill.name), ["fixture-skill"]);
    assert.match(session.systemPrompt, /fixture-skill/);
    assert.match(session.systemPrompt, /PIWORK_SKILL_SENTINEL/);
    await session.prompt("call the fixture tool");
    assert.equal(calls, 1);
    assert.ok(session.messages.some((message) => message.role === "toolResult"));
    assert.ok(session.messages.some((message) =>
      message.role === "assistant" && message.content.some((part) => part.type === "text" && part.text === "fixture tool completed")
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
