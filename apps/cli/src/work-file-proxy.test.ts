import assert from "node:assert/strict";
import test from "node:test";
import { mapDavXml, mapDestination, toCorePath, toLocalPath } from "./work-file-proxy.js";

const work = "work-test-12345678";
const local = `/works/${work}/files/`;
const core = `/api/v1/works/${work}/files/`;

test("local paths and Destination preserve single-decode byte semantics", () => {
  const suffix = "%E4%B8%AD%E6%96%87%20%25%23/%252e";
  assert.deepEqual(toCorePath(`${local}${suffix}`), { workId: work, path: `${core}${suffix}` });
  assert.equal(toLocalPath(`${core}${suffix}`, work), `${local}${suffix}`);
  assert.deepEqual(toCorePath(`${local}.hidden%20file`), { workId: work, path: `${core}.hidden%20file` });
  assert.equal(mapDestination(`http://127.0.0.1:17890${local}${suffix}`, work,
    "http://127.0.0.1:17890"), `${core}${suffix}`);
  for (const invalid of ["https://outside.example/a", `http://localhost:17890${local}a`,
    `/works/other-work-12345678/files/a`, `${local}a?x=1`, local])
    assert.throws(() => mapDestination(invalid, work, "http://127.0.0.1:17890"));
  for (const invalid of [`${local}%2e%2e`, `${local}a%2fb`, `${local}a//b`, `${local}a?x=1`])
    assert.throws(() => toCorePath(invalid));
});

test("DAV href mapper rewrites namespaced href values but no other XML text", () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files"><d:response><d:href>${core}a%20b/</d:href><d:propstat><d:prop><d:displayname>Core /api/v1/works</d:displayname></d:prop></d:propstat></d:response></d:multistatus>`;
  const result = mapDavXml(Buffer.from(xml), work).toString();
  assert.match(result, new RegExp(`${local}a%20b/`));
  assert.match(result, /Core \/api\/v1\/works/);
  assert.doesNotMatch(result, new RegExp(core));
  assert.throws(() => mapDavXml(Buffer.from(xml.replace(`${core}a%20b/`,
    "/api/v1/works/other-work-12345678/files/a")), work));
  assert.throws(() => mapDavXml(Buffer.from('<!DOCTYPE x><d:href xmlns:d="DAV:">/x</d:href>'), work));
});
