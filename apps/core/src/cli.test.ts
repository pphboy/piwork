import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";

const cli = resolve("dist/cli.js");

test("compiled bootstrap uses data directory and repeat bootstrap is safe", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-core-cli-"));
  try {
    const data = join(root, "state");
    const first = run(["bootstrap-admin", "--data-dir", data, "--account", "admin", "--password-stdin"], "correct horse\n");
    assert.equal(first.status, 0, first.stderr);
    assert.doesNotMatch(first.stdout + first.stderr, /correct horse/);
    const second = run(["bootstrap-admin", "--data-dir", data, "--account", "other", "--password-stdin"], "another secret\n");
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already exists/);
    assert.doesNotMatch(second.stdout + second.stderr, /another secret/);
    const store = CoreStore.open({ databasePath: join(data, "core.sqlite") });
    try {
      assert.equal(store.getAuthenticationUserByAccount("admin")?.account, "admin");
      assert.equal(store.getAuthenticationUserByAccount("other"), undefined);
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compiled CLI rejects the legacy database option and keeps secrets out of diagnostics", () => {
  const legacy = run(["bootstrap-admin", "--database", "/tmp/legacy", "--account", "admin", "--password-stdin"], "secret\n");
  assert.equal(legacy.status, 2);
  assert.match(legacy.stderr, /unknown option/);

  const root = mkdtempSync(join(tmpdir(), "piwork-core-secret-file-"));
  try {
    const key = join(root, "key");
    writeFileSync(key, "do-not-print\n", { mode: 0o644 });
    chmodSync(key, 0o644);
    const result = run([
      "configure-runtime", "--data-dir", join(root, "state"), "--agent-image", "missing-image",
      "--model-provider", "openai", "--model", "test", "--api-key-file", key,
    ]);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /do-not-print/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(args: readonly string[], input?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", input });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
