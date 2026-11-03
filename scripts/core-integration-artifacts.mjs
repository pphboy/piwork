import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Only immutable preparation is memoized. Each invocation owns this map;
// execution results and installation state never enter it.
export function preparationCache() {
  const preparations = new Map();
  return (inputIdentity, prepare) => {
    if (!preparations.has(inputIdentity))
      preparations.set(inputIdentity, Promise.resolve().then(prepare));
    return preparations.get(inputIdentity);
  };
}
export function verifyImageRecords(references, records, historyReference) {
  assert.equal(records.length, references.length, "image inventory changed");
  const result = Object.fromEntries(
    references.map((reference, index) => {
      const record = records[index];
      assert(
        /^sha256:[a-f0-9]{64}$/.test(record.Id),
        "immutable image identity missing",
      );
      return [
        reference,
        { id: record.Id, labels: record.Config?.Labels || {} },
      ];
    }),
  );
  assert.equal(
    result[historyReference]?.labels["io.piwork.fixture.web-base-history4"],
    "true",
    "required history-4 bridge identity missing",
  );
  return result;
}
export function sameArtifacts(before, after) {
  return isDeepStrictEqual(before, after);
}

// Scheduling knobs do not change shared builds. Values may contain secrets,
// so persist only sorted digests, including explicitly selected metadata bytes.
export function buildConfiguration(environment, effectiveGoEnvironment) {
  const selected = Object.keys(environment)
    .filter(
      (name) =>
        /^(GO[A-Z0-9_]*|CGO_.*|NODE_OPTIONS|NPM_CONFIG_.*|npm_config_.*|PIWORK_(BUILD_.*|RELEASE_.*|GO_BUILD_DIR))$/.test(
          name,
        ) && !["GOMAXPROCS", "GOGC", "GOMEMLIMIT"].includes(name),
    )
    .sort();
  const configuration = Object.fromEntries(
    selected.map((name) => [
      name,
      createHash("sha256").update(environment[name]).digest("hex"),
    ]),
  );
  if (environment.PIWORK_RELEASE_METADATA)
    configuration.releaseMetadataContents = createHash("sha256")
      .update(readFileSync(environment.PIWORK_RELEASE_METADATA))
      .digest("hex");
  if (effectiveGoEnvironment)
    configuration.goEnvironment = createHash("sha256")
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(effectiveGoEnvironment)
              .filter(([name]) => name !== "GOGCCFLAGS")
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        ),
      )
      .digest("hex");
  return configuration;
}

export function verifyPrepared(
  record,
  { source, images, binaries, compiled, tools, configuration },
) {
  assert(
    record &&
      configuration &&
      record.configuration &&
      sameArtifacts(record, {
        source,
        images,
        binaries,
        compiled,
        tools,
        configuration,
      }),
    "prepared artifacts do not match current source/config/image/binary inputs; run normal preparation",
  );
  return record;
}
