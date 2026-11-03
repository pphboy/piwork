import test from "node:test";
import assert from "node:assert/strict";
import { fixtureServerBuild } from "./native-test-server.mjs";
import { readFileSync } from "node:fs";

test("fixture server binds fixed dependencies at build time and preserves source/UI identity", () => {
  const images = {
    agent: "fixture/agent:v1",
    packageHelper: "fixture/agent:v1",
    fileHelper: "fixture/file:v1",
    snapshotHelper: "fixture/snapshot:v1",
  };
  const metadata = {
    releaseVersion: "0.1.0",
    sourceCommit: "a".repeat(40),
    sourceModified: true,
    desktopUIHash: "b".repeat(64),
    consoleUIHash: "c".repeat(64),
  };
  const args = fixtureServerBuild("/tmp/piwork-fixture", images, metadata);
  assert.equal(args.at(-1), "./scripts/corefixture");
  const flags = args[args.indexOf("-ldflags") + 1];
  assert.deepEqual(
    JSON.parse(Buffer.from(flags.match(/EncodedImages=([^ ]+)/)[1], "base64")),
    images,
  );
  for (const value of [
    metadata.sourceCommit,
    metadata.desktopUIHash,
    metadata.consoleUIHash,
    "Modified=true",
  ])
    assert(flags.includes(value));
  for (const value of ["fixture:latest", "bad image", "a;command"])
    assert.throws(() =>
      fixtureServerBuild(
        "/tmp/piwork-fixture",
        { ...images, agent: value },
        metadata,
      ),
    );
});
test("active initialization drivers use embedded defaults, without the removed operator image flag", () => {
  for (const file of [
    "check-web-base-core.mjs",
    "check-web-base-core-dependencies.mjs",
    "native-host-acceptance.mjs",
    "measure-work-latency.mjs",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert(!source.includes("'--agent-image'"), file);
    assert(
      !/PIWORK_(?:PACKAGE|FILE|SNAPSHOT)_HELPER_IMAGE[=:]/.test(source),
      file,
    );
  }
});

test("prepared native fixture checks binary identity and writes only a private fixture sidecar", async () => {
  const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import(
    "node:fs"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { buildNativeTestServer } = await import("./native-test-server.mjs");
  const root = mkdtempSync(join(tmpdir(), "piwork-fixture-builder-"));
  const prepared = join(root, "prepared");
  writeFileSync(prepared, "synthetic executable", { mode: 0o700 });
  const oldBinary = process.env.PIWORK_TEST_CORE_FIXTURE_BIN,
    oldHash = process.env.PIWORK_TEST_CORE_FIXTURE_SHA256;
  process.env.PIWORK_TEST_CORE_FIXTURE_BIN = prepared;
  process.env.PIWORK_TEST_CORE_FIXTURE_SHA256 = createHash("sha256")
    .update("synthetic executable")
    .digest("hex");
  const images = {
    agent: "fixture/agent:v1",
    packageHelper: "fixture/agent:v1",
    fileHelper: "fixture/file:v1",
    snapshotHelper: "fixture/snapshot:v1",
  };
  const run = (cmd, args) => {
    assert.equal(cmd, "git", "a prepared fixture must not recompile");
    return { status: 0, stdout: args.includes("HEAD") ? "a".repeat(40) : "" };
  };
  try {
    const binary = buildNativeTestServer(join(root, "out"), images, { run });
    assert.equal(readFileSync(binary, "utf8"), "synthetic executable");
    assert.deepEqual(
      JSON.parse(readFileSync(binary + ".fixture.json")).images,
      images,
    );
    process.env.PIWORK_TEST_CORE_FIXTURE_SHA256 = "bad-hash";
    assert.throws(
      () => buildNativeTestServer(join(root, "invalid"), images, { run }),
      /identity changed/,
    );
    assert.equal(existsSync(join(root, "invalid", "piwork-core")), false);
  } finally {
    if (oldBinary === undefined)
      delete process.env.PIWORK_TEST_CORE_FIXTURE_BIN;
    else process.env.PIWORK_TEST_CORE_FIXTURE_BIN = oldBinary;
    if (oldHash === undefined)
      delete process.env.PIWORK_TEST_CORE_FIXTURE_SHA256;
    else process.env.PIWORK_TEST_CORE_FIXTURE_SHA256 = oldHash;
    rmSync(root, { recursive: true, force: true });
  }
});
