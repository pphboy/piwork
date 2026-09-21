import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
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
