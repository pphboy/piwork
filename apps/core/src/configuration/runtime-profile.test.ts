import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureCorePaths } from "../application/paths.js";
import { RuntimeProfileStore } from "./runtime-profile.js";

test("runtime profile revisions are atomic, restricted and secret-free", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-profile-"));
  try {
    const paths = ensureCorePaths(join(root, "state"));
    const profiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory, () => new Date("2026-09-20T00:00:00Z"));
    const first = profiles.configure({
      agentImage: "piwork-agentd:local",
      provider: "openai",
      model: "gpt-test",
      credential: "top-secret-one",
    });
    assert.equal(first.revision, 1);
    assert.equal(first.model.credentialAvailable, true);
    assert.doesNotMatch(JSON.stringify(first), /top-secret/);
    assert.doesNotMatch(readFileSync(paths.runtimeProfilePath, "utf8"), /top-secret/);
    assert.equal(statSync(paths.runtimeProfilePath).mode & 0o777, 0o600);
    assert.equal(statSync(profiles.credentialPath()).mode & 0o777, 0o600);
    assert.equal(profiles.resolveCredential(), "top-secret-one");

    const second = profiles.configure({
      agentImage: "piwork-agentd:local",
      provider: "openai",
      model: "gpt-test-2",
      baseUrl: "https://models.example.test/v1",
      credential: "top-secret-two",
    });
    assert.equal(second.revision, 2);
    assert.equal(profiles.resolveCredential(), "top-secret-two");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime profile refuses symlink targets and unsafe base URLs", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-profile-link-"));
  try {
    const paths = ensureCorePaths(join(root, "state"));
    symlinkSync(join(root, "elsewhere"), paths.runtimeProfilePath);
    const profiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory);
    assert.throws(() => profiles.configure({
      agentImage: "piwork-agentd:local",
      provider: "openai",
      model: "gpt-test",
      credential: "secret",
    }), /safe file target/);
    assert.throws(() => profiles.configure({
      agentImage: "piwork-agentd:local",
      provider: "openai",
      model: "gpt-test",
      baseUrl: "http://models.example.test",
      credential: "secret",
    }), /HTTPS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
