import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfiguredSkills, RequiredSkillError } from "./skills.js";

test("fixed Skills load into the SDK, invalid artifacts block ready, and restart applies removal without host discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-skills-"));
  const active = join(root, "generation-1");
  const next = join(root, "generation-2");
  const host = join(root, "host-home", ".pi", "skills", "host-only");
  const alpha = skill("alpha", "ALPHA_SENTINEL");
  const beta = skill("beta", "BETA_SENTINEL");
  await Promise.all([
    writeSkill(active, "alpha", alpha),
    writeSkill(active, "beta", beta),
    writeSkill(next, "beta", beta),
    writeSkill(host, "host-only", skill("host-only", "HOST_MUST_NOT_LOAD"), true),
  ]);
  try {
    const first = await loadConfiguredSkills(active, [fixed("alpha", alpha), fixed("beta", beta)]);
    assert.deepEqual(first.skills.map((item) => item.name).sort(), ["alpha", "beta"]);
    const restarted = await loadConfiguredSkills(next, [fixed("beta", beta)]);
    assert.deepEqual(restarted.skills.map((item) => item.name), ["beta"]);
    assert.equal(restarted.skills.some((item) => item.name === "alpha" || item.name === "host-only"), false);

    await assert.rejects(
      loadConfiguredSkills(next, [{ name: "beta", digest: `sha256:${"0".repeat(64)}` }]),
      (error) => error instanceof RequiredSkillError && /digest mismatch/.test(error.statuses[0]?.error ?? ""),
    );
    const wrong = skill("wrong-name", "WRONG");
    await writeSkill(next, "declared-name", wrong);
    const rebound = await loadConfiguredSkills(next, [fixed("declared-name", wrong)]);
    assert.equal(rebound.skills[0]?.name, "declared-name");
    assert.equal(rebound.skills[0]?.description, "WRONG");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function skill(name: string, sentinel: string): string {
  return `---\nname: ${name}\ndescription: ${sentinel}\n---\nFollow ${sentinel}.\n`;
}

function fixed(name: string, source: string) {
  const path = Buffer.from("SKILL.md", "utf8");
  const pathLength = Buffer.allocUnsafe(4); pathLength.writeUInt32BE(path.length);
  const bytes = Buffer.from(source, "utf8");
  const byteLength = Buffer.allocUnsafe(8); byteLength.writeBigUInt64BE(BigInt(bytes.length));
  const digest = createHash("sha256").update(pathLength).update(path).update(byteLength).update(bytes).digest("hex");
  return { name, digest: `sha256:${digest}` };
}

async function writeSkill(root: string, name: string, source: string, rootIsSkill = false): Promise<void> {
  const directory = rootIsSkill ? root : join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), source);
}
