import assert from "node:assert/strict";
import test from "node:test";
import { isRawFileTarget, parseRawFileTarget } from "./path.js";

const ROOT = "/api/v1/works/work-test-12345678/files";

test("raw Work file path decodes once and preserves a canonical collection URL", () => {
  assert.equal(isRawFileTarget(ROOT), true);
  assert.deepEqual(parseRawFileTarget(ROOT), { workId: "work-test-12345678", segments: [],
    isRootWithoutSlash: true, hasTrailingSlash: false, encodedPath: `${ROOT}/` });
  const target = parseRawFileTarget(`${ROOT}/%E7%AC%94%E8%AE%B0/a%20b/%252e/%23/`);
  assert.deepEqual(target.segments, ["笔记", "a b", "%2e", "#"]);
  assert.equal(target.encodedPath, `${ROOT}/%E7%AC%94%E8%AE%B0/a%20b/%252e/%23/`);
});

test("raw parser rejects URL normalization and encoding tricks", () => {
  for (const suffix of ["/a/../b", "/a/%2E%2e/b", "/a//b", "/a/%2fb", "/a/%5cb",
    "/a/%00", "/a/%ff", "/a/%", "/a?query=1", "/a#fragment", "/a/%01"]) {
    assert.throws(() => parseRawFileTarget(`${ROOT}${suffix}`), /FILE_PATH_INVALID/);
  }
  assert.equal(isRawFileTarget(`/api/v1/works/work-test-12345678/other/../files/a`), false);
  assert.throws(() => parseRawFileTarget(`${ROOT}/${"a".repeat(256)}`), /FILE_PATH_TOO_LONG/);
});
