import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTestInstallationId,
  installationLabel,
  installationLabelFilter,
} from "./testing.js";

const installationId = "piwork-test-0199e6d8-3abc-7def-8123-456789abcdef";

test("Docker test resources are scoped by installation_id", () => {
  assert.equal(assertTestInstallationId(installationId), installationId);
  assert.deepEqual(installationLabel(installationId), { "piwork.installation_id": installationId });
  assert.equal(
    installationLabelFilter(installationId),
    `label=piwork.installation_id=${installationId}`,
  );
});

test("cleanup helpers reject broad or production-looking scopes", () => {
  for (const invalid of ["", "piwork", "production", "piwork-test-*", "piwork-test-local"]) {
    assert.throws(() => installationLabelFilter(invalid), /refusing Docker test operation/);
  }
});
