import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import type { PreparedArtifacts } from "./artifacts.js";
import { RuntimeConfigurationMaterializer } from "./materialization.js";

test("materializes isolated paths, selected Skills, and only referenced secrets", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "piwork-materialize-"));
  const reads: string[] = [];
  const materializer = new RuntimeConfigurationMaterializer({
    async readSkill(catalogId, digest) {
      reads.push(`skill:${catalogId}:${digest}`);
      return new TextEncoder().encode("---\nname: selected\n---\nOnly this Skill is active.\n");
    },
    async readSecret(secretId) {
      reads.push(`secret:${secretId}`);
      if (secretId !== "secret-0199e6d8abcd") throw new Error("unexpected secret read");
      return new TextEncoder().encode("mcp-credential");
    },
  });

  try {
    const result = await materializer.materialize({
      root: join(temporary, "work-0199e6d8abcd", "generation-1"),
      workId: "work-0199e6d8abcd",
      configuration: configuration(),
      artifacts: artifacts(),
    });
    assert.deepEqual(result.mounts.map((mount) => [mount.target, mount.readOnly]), [
      ["/var/data", false],
      ["/var/session", false],
      ["/var/cache", false],
      ["/run/piwork", true],
    ]);
    assert.deepEqual(reads, [
      `skill:skill-0199e6d8abcd:sha256:${"a".repeat(64)}`,
      "secret:secret-0199e6d8abcd",
    ]);

    const runtime = JSON.parse(await readFile(result.configPath, "utf8")) as Record<string, any>;
    assert.deepEqual(runtime.skillDiscovery, {
      directories: ["/run/piwork/skills"],
      loadHostSkills: false,
    });
    assert.equal(runtime.skills[0].path, "/run/piwork/skills/skill-0199e6d8abcd/SKILL.md");
    assert.equal(runtime.mcpServers[0].secretRefs, undefined);
    assert.deepEqual(runtime.mcpServers[0].secretFiles, [{
      secretId: "secret-0199e6d8abcd",
      key: "API_TOKEN",
      path: "/run/piwork/secrets/local-tools/API_TOKEN",
    }]);
    assert.doesNotMatch(JSON.stringify(runtime), /mcp-credential/);
    assert.equal((await stat(result.configPath)).mode & 0o777, 0o400);
    assert.equal((await stat(join(result.root, "run", "piwork", "secrets", "local-tools", "API_TOKEN"))).mode & 0o777, 0o400);
    assert.equal((await stat(join(result.root, "run", "piwork", "skills", "skill-0199e6d8abcd", "SKILL.md"))).mode & 0o777, 0o400);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function configuration(): WorkConfig {
  return {
    revision: 1,
    agentImage: { catalogId: "image-0199e6d8abcd" },
    skills: [{ catalogId: "skill-0199e6d8abcd", digest: `sha256:${"a".repeat(64)}` }],
    modelRef: "model-0199e6d8abcd",
    mcpServers: [{
      serverId: "local-tools",
      transport: "stdio",
      required: true,
      command: "node",
      args: ["server.js"],
      secretRefs: [{ secretId: "secret-0199e6d8abcd", key: "API_TOKEN" }],
    }],
    resources: { cpuMillis: 1_000, memoryBytes: 1_073_741_824, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: ["read"], denied: [] },
  };
}

function artifacts(): PreparedArtifacts {
  return {
    workId: "work-0199e6d8abcd",
    revision: 1,
    image: { kind: "agent_image", ordinal: 0, catalogId: "image-0199e6d8abcd", digest: `sha256:${"b".repeat(64)}` },
    skills: [{ kind: "skill", ordinal: 0, catalogId: "skill-0199e6d8abcd", digest: `sha256:${"a".repeat(64)}` }],
  };
}
