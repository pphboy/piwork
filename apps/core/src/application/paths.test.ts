import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureCorePaths, formatHttpUrl, parseListenAddress } from "./paths.js";

test("Core paths resolve one restricted data-directory contract", () => {
  const parent = mkdtempSync(join(tmpdir(), "piwork-paths-"));
  try {
    const paths = ensureCorePaths(join(parent, "state"));
    assert.equal(paths.databasePath, join(paths.dataDirectory, "core.sqlite"));
    assert.equal(paths.runtimeProfilePath, join(paths.dataDirectory, "runtime-profile.json"));
    assert.equal(paths.skillsDirectory, join(paths.dataDirectory, "skills"));
    assert.equal(paths.workContextsDirectory, join(paths.dataDirectory, "works"));
    assert.equal(statSync(paths.dataDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(paths.secretsDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(paths.runtimeDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(paths.skillsDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(paths.workContextsDirectory).mode & 0o777, 0o700);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Core paths reject a data path that is a file", () => {
  const parent = mkdtempSync(join(tmpdir(), "piwork-path-file-"));
  try {
    const path = join(parent, "file");
    writeFileSync(path, "not a directory");
    assert.throws(() => ensureCorePaths(path));
    assert.equal(readFileSync(path, "utf8"), "not a directory");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("listen parsing handles defaults, port zero, IPv6 and remote opt-in", () => {
  assert.deepEqual(parseListenAddress(), { host: "127.0.0.1", port: 7171 });
  assert.deepEqual(parseListenAddress("127.0.0.2:0"), { host: "127.0.0.2", port: 0 });
  assert.deepEqual(parseListenAddress("[::1]:9090"), { host: "::1", port: 9090 });
  assert.equal(formatHttpUrl({ host: "::1", port: 9090 }), "http://[::1]:9090");
  assert.throws(() => parseListenAddress("0.0.0.0:7171"), /allow-insecure-remote/);
  assert.deepEqual(parseListenAddress("0.0.0.0:7171", true), { host: "0.0.0.0", port: 7171 });
  assert.throws(() => parseListenAddress("localhost"), /HOST:PORT/);
  assert.throws(() => parseListenAddress("127.0.0.1:70000"), /0 through 65535/);
});
