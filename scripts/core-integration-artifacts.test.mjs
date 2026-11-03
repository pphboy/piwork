import test from "node:test";
import assert from "node:assert/strict";
import {
  preparationCache,
  verifyImageRecords,
  sameArtifacts,
} from "./core-integration-artifacts.mjs";

test("same immutable input prepares once; new inputs and failed preparation never reuse execution results", async () => {
  const once = preparationCache();
  let prepared = 0;
  const prepare = async () => ({ build: ++prepared });
  const [first, second] = await Promise.all([
    once("source/image-a", prepare),
    once("source/image-a", prepare),
  ]);
  assert.equal(first, second);
  assert.equal(prepared, 1);
  await once("source/image-b", prepare);
  assert.equal(prepared, 2);
  await assert.rejects(
    once("invalid", () => Promise.reject(new Error("build failed"))),
  );
  await assert.rejects(once("invalid", prepare));
  assert.equal(prepared, 2);
});

test("missing required history identity or mutable tag drift cannot produce same-candidate evidence", () => {
  const ref = "history:fixture";
  const image = {
    Id: "sha256:" + "a".repeat(64),
    Config: {
      Labels: {
        "io.piwork.fixture.web-base-history4": "true",
        "io.piwork.work-history.schema": "4",
      },
    },
  };
  const before = verifyImageRecords([ref], [image], ref);
  assert.throws(() => verifyImageRecords([ref], [], ref));
  assert.throws(() =>
    verifyImageRecords([ref], [{ ...image, Config: { Labels: {} } }], ref),
  );
  assert.throws(() => verifyImageRecords([ref], [{ ...image, Id: ref }], ref));
  const after = verifyImageRecords(
    [ref],
    [{ ...image, Id: "sha256:" + "b".repeat(64) }],
    ref,
  );
  assert.equal(sameArtifacts(before, after), false);
  assert.equal(sameArtifacts(before, before), true);
});

test("prepared binaries and harness outputs must match the current input identity before reuse", async () => {
  const { verifyPrepared } = await import("./core-integration-artifacts.mjs");
  const identity = {
    source: "a",
    images: { fixture: "sha-a" },
    binaries: { core: "sha-b" },
    compiled: { agent: "sha-c" },
    tools: { node: "fixture" },
    configuration: {},
  };
  assert.equal(verifyPrepared(identity, identity), identity);
  for (const key of Object.keys(identity))
    assert.throws(
      () => verifyPrepared(identity, { ...identity, [key]: "drift" }),
      /do not match/,
    );
  assert.throws(() => verifyPrepared(undefined, identity), /do not match/);
});

test("prepared rejects changed build configuration and old records but permits scheduler changes", async () => {
  const { buildConfiguration, verifyPrepared } = await import(
    "./core-integration-artifacts.mjs"
  );
  const identity = {
    source: "a",
    images: {},
    binaries: {},
    compiled: {},
    tools: {},
    configuration: buildConfiguration({
      GOFLAGS: "-tags=fixture",
      CGO_ENABLED: "0",
    }),
  };
  assert.equal(
    verifyPrepared(identity, {
      ...identity,
      configuration: buildConfiguration({
        GOFLAGS: "-tags=fixture",
        CGO_ENABLED: "0",
        TEST_JOBS: "8",
      }),
    }),
    identity,
  );
  for (const environment of [
    { GOFLAGS: "-race", CGO_ENABLED: "0" },
    { GOFLAGS: "-tags=fixture", CGO_ENABLED: "1" },
  ])
    assert.throws(() =>
      verifyPrepared(identity, {
        ...identity,
        configuration: buildConfiguration(environment),
      }),
    );
  const old = { ...identity };
  delete old.configuration;
  assert.throws(() => verifyPrepared(old, identity));
  assert(
    !JSON.stringify(
      buildConfiguration({ GOFLAGS: "private synthetic value" }),
    ).includes("private synthetic"),
  );
});

test("effective Go settings are fingerprinted even when not present in the process environment", async () => {
  const { buildConfiguration } = await import(
    "./core-integration-artifacts.mjs"
  );
  assert.notDeepEqual(
    buildConfiguration({}, { GOFLAGS: "" }),
    buildConfiguration({}, { GOFLAGS: "-race" }),
  );
  assert.deepEqual(
    buildConfiguration({}, { GOFLAGS: "", CGO_ENABLED: "0" }),
    buildConfiguration({}, { CGO_ENABLED: "0", GOFLAGS: "" }),
  );
});

test("derived temporary GCC paths do not invalidate disabled-CGo preparation", async () => {
  const { buildConfiguration } = await import(
    "./core-integration-artifacts.mjs"
  );
  assert.deepEqual(
    buildConfiguration(
      { CGO_ENABLED: "0" },
      { CGO_ENABLED: "0", GOGCCFLAGS: "-map=/tmp/go-build-one" },
    ),
    buildConfiguration(
      { CGO_ENABLED: "0" },
      { CGO_ENABLED: "0", GOGCCFLAGS: "-map=/tmp/go-build-two" },
    ),
  );
});
