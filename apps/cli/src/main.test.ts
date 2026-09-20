import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { exitCodeFor } from "./main.js";
import { PiworkApiError } from "@piwork/client-sdk";

const executable = resolve("dist/main.js");

test("compiled CLI help and usage failures do not contact Core", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /work create/);
  for (const command of ["status", "login", "whoami", "logout", "work", "operation", "session", "run", "chat"]) {
    const commandHelp = run([command, "--help"]);
    assert.equal(commandHelp.status, 0, `${command} help should succeed`);
    assert.match(commandHelp.stdout, new RegExp(`usage: piwork-cli ${command}`));
    assert.doesNotMatch(commandHelp.stderr, /ECONNREFUSED|not logged in|stack| at /);
  }
  const unknown = run(["unknown"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown command/);
  assert.doesNotMatch(unknown.stderr, /ECONNREFUSED|stack| at /);
  for (const args of [["admin", "users", "list"], ["config", "show"]]) {
    const wrongSurface = run(args);
    assert.equal(wrongSurface.status, 2);
    assert.doesNotMatch(wrongSurface.stderr, /ECONNREFUSED|stack|\n\s+at /);
  }
  const missing = run(["--core"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /requires a value/);
});

test("documented safe error classes map to stable exit statuses", () => {
  assert.equal(exitCodeFor(Object.assign(new Error("usage"), { exitCode: 2 })), 2);
  assert.equal(exitCodeFor(new PiworkApiError(401, "AUTH", "auth")), 3);
  assert.equal(exitCodeFor(new PiworkApiError(404, "NOT_FOUND", "missing")), 4);
  assert.equal(exitCodeFor(new PiworkApiError(503, "UNAVAILABLE", "down")), 5);
  assert.equal(exitCodeFor(new PiworkApiError(409, "CONFLICT", "stale")), 6);
  assert.equal(exitCodeFor(new Error("unexpected")), 1);
});

function run(args: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-test-"));
  try {
    const result = spawnSync(process.execPath, [executable, ...args], {
      encoding: "utf8",
      env: { ...process.env, PIWORK_CONFIG_PATH: join(root, "client.json"), PIWORK_CORE_URL: "http://127.0.0.1:1" },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
