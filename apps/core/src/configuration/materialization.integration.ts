import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import type { PreparedArtifacts } from "./artifacts.js";
import { RuntimeConfigurationMaterializer } from "./materialization.js";

const execFile = promisify(execFileCallback);

test("test image sees the isolated runtime paths and restricted files", async () => {
  const installationId = process.env.PIWORK_TEST_INSTALLATION_ID;
  const filter = process.env.PIWORK_TEST_DOCKER_FILTER;
  assert.match(installationId ?? "", /^piwork-test-[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assert.equal(filter, `label=piwork.installation_id=${installationId}`);

  const temporary = await mkdtemp(join(tmpdir(), "piwork-materialize-docker-"));
  const hostSkill = join(temporary, "host-home", ".pi", "skills", "host-only");
  await mkdir(hostSkill, { recursive: true });
  await writeFile(join(hostSkill, "SKILL.md"), "HOST SKILL MUST NOT LOAD\n");
  const materializer = new RuntimeConfigurationMaterializer({
    async readSkill() {
      return new TextEncoder().encode("---\nname: selected\n---\nSelected only.\n");
    },
    async readSecret() {
      return new TextEncoder().encode("mcp-credential");
    },
  });

  try {
    const materialized = await materializer.materialize({
      root: join(temporary, "runtime"),
      workId: "work-0199e6d8abcd",
      configuration: configuration(),
      artifacts: artifacts(),
    });
    const mounts = materialized.mounts.flatMap((mount) => [
      "--mount",
      `type=bind,src=${mount.source},dst=${mount.target}${mount.readOnly ? ",readonly" : ""}`,
    ]);
    const script = [
      "set -eu",
      "test -w /var/data && test -w /var/session && test -w /var/cache",
      "touch /var/data/data-ok /var/session/session-ok /var/cache/cache-ok",
      "test \"$(stat -c %a /run/piwork/config.json)\" = 400",
      "test \"$(stat -c %a /run/piwork/skills/skill-0199e6d8abcd/SKILL.md)\" = 400",
      "test \"$(stat -c %a /run/piwork/secrets/local-tools/API_TOKEN)\" = 400",
      "grep -q '\"loadHostSkills\": false' /run/piwork/config.json",
      "grep -q 'Selected only' /run/piwork/skills/skill-0199e6d8abcd/SKILL.md",
      "test ! -e /tmp/isolated-home/.pi/skills/host-only/SKILL.md",
      "if touch /run/piwork/must-fail 2>/dev/null; then exit 41; fi",
    ].join("; ");
    const { stdout, stderr } = await execFile("docker", [
      "run", "--rm",
      "--label", `piwork.installation_id=${installationId}`,
      "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      "--env", "HOME=/tmp/isolated-home",
      ...mounts,
      "ubuntu:22.04", "sh", "-c", script,
    ]);
    assert.equal(stdout, "");
    assert.equal(stderr, "");
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
