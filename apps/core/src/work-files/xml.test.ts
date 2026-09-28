import assert from "node:assert/strict";
import test from "node:test";
import { parsePropfind, parseProppatch, renderPropfind, renderProppatch } from "./xml.js";

const WORK = "work-test-12345678";

test("PROPFIND parses namespace-aware properties and emits grouped live/unknown propstat", () => {
  const requested = parsePropfind(`<x:propfind xmlns:x="DAV:" xmlns:y="urn:unknown"><x:prop>
    <x:displayname/><y:missing/><x:getcontentlength/></x:prop></x:propfind>`);
  assert.equal(requested.mode, "prop");
  const xml = renderPropfind(WORK, [{ pathSegments: ["笔记 & #.txt"], kind: "file", size: 8, modifiedMs: 0 }], requested);
  assert.match(xml, /HTTP\/1\.1 200 OK/);
  assert.match(xml, /HTTP\/1\.1 404 Not Found/);
  assert.match(xml, /%E7%AC%94%E8%AE%B0%20%26%20%23\.txt/);
  assert.match(xml, /笔记 &amp; #\.txt/);
  assert.match(renderPropfind(WORK, [{ pathSegments: [], kind: "directory", size: null, modifiedMs: 0 }],
    parsePropfind("")), /<d:collection\/>/);
});

test("root and nested directories expose getlastmodified as a live property", () => {
  for (const pathSegments of [[], ["nested"]]) {
    const entry = { pathSegments, kind: "directory" as const, size: null, modifiedMs: 0 };
    const allprop = renderPropfind(WORK, [entry], parsePropfind(""));
    assert.match(allprop, /<d:getlastmodified>Thu, 01 Jan 1970 00:00:00 GMT<\/d:getlastmodified>/);
    assert.doesNotMatch(allprop, /HTTP\/1\.1 404 Not Found/);
    const explicit = renderPropfind(WORK, [entry], parsePropfind(
      '<d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getetag/></d:prop></d:propfind>'));
    assert.match(explicit, /<d:propstat><d:prop><d:getlastmodified>[^<]+<\/d:getlastmodified><\/d:prop><d:status>HTTP\/1\.1 200 OK/);
    assert.match(explicit, /<d:propstat><d:prop><d:getetag\/><\/d:prop><d:status>HTTP\/1\.1 404 Not Found/);
  }
});

test("finite PROPFIND and PROPPATCH XML reject DTD, entities, invalid structures and deep input", () => {
  assert.deepEqual(parsePropfind('<d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>'),
    { mode: "allprop", properties: [] });
  assert.deepEqual(parseProppatch('<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>no</d:displayname></d:prop></d:set></d:propertyupdate>'),
    [{ uri: "DAV:", local: "displayname" }]);
  assert.match(renderProppatch(WORK, { pathSegments: ["a"], kind: "file", size: 1, modifiedMs: 0 },
    [{ uri: "DAV:", local: "displayname" }]), /HTTP\/1\.1 403 Forbidden/);
  for (const xml of [
    '<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///etc/passwd">]><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>',
    '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname>&secret;</d:displayname></d:prop></d:propfind>',
    '<d:propfind xmlns:d="DAV:"><d:allprop/><d:propname/></d:propfind>',
    '<d:propfind xmlns:d="DAV:"><d:include><d:displayname/></d:include></d:propfind>',
    `<d:propfind xmlns:d="DAV:">${"<d:prop>".repeat(33)}${"</d:prop>".repeat(33)}</d:propfind>`,
    '<?xml version="1.0" encoding="ISO-8859-1"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>',
  ]) assert.throws(() => parsePropfind(xml), /FILE_XML_INVALID/);
});
