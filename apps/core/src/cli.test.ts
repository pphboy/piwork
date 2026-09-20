import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("dist/cli.js");

test("piwork-serve publishes only operator commands and rejects legacy or user commands locally", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /admin bootstrap/);
  assert.match(help.stdout, /config set/);
  assert.doesNotMatch(help.stdout, /\bpiwork-core\b/);

  for (const command of ["serve", "status", "admin", "config"]) {
    const result = run([command, "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`piwork-serve ${command}`));
  }

  for (const args of [["chat"], ["login"], ["work", "create"], ["bootstrap-admin"], ["configure-runtime"]]) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(" ")} should be a usage failure`);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED|stack|\n\s+at /);
  }
});

test("workspace package metadata exposes only piwork-serve and piwork-cli", () => {
  const core = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { bin?: Record<string, string> };
  const client = JSON.parse(readFileSync(resolve("../cli/package.json"), "utf8")) as { bin?: Record<string, string> };
  assert.deepEqual(Object.keys(core.bin ?? {}), ["piwork-serve"]);
  assert.deepEqual(Object.keys(client.bin ?? {}), ["piwork-cli"]);
});

test("piwork-serve keeps the explicit local bootstrap entry under the new command tree", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-serve-bootstrap-"));
  try {
    const first = run(["--data-dir", root, "admin", "bootstrap", "--account", "admin", "--password-stdin"], "correct horse battery\n");
    assert.equal(first.status, 0, first.stderr);
    assert.doesNotMatch(first.stdout + first.stderr, /correct horse battery/);
    const repeated = run(["--data-dir", root, "admin", "bootstrap", "--account", "other", "--password-stdin"], "another secret value\n");
    assert.equal(repeated.status, 1);
    assert.doesNotMatch(repeated.stdout + repeated.stderr, /another secret value/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(args: readonly string[], input?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", input, env: { ...process.env, PIWORK_CORE_URL: "http://127.0.0.1:1" } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
