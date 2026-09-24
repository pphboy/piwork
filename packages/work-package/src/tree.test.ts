import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkTree, decodeWorkPath } from "./tree.js";
import { WORK_PACKAGE_LIMITS } from "./limits.js";
import type { WorkBlob } from "@piwork/contracts";

const digest = "a".repeat(64), common = { uid: 1, gid: 1, mode: 493, mtimeNs: "-1" };
const root = { ...common, type: "directory", segmentsBase64: [] };
const path = (name: string) => [Buffer.from(name).toString("base64")];
const blobs = new Map<string, WorkBlob>([[digest, { digest, size: 4, kinds: ["file"] }]]);
test("byte filenames, hard links, absolute/dangling symbolic links preserve their meaning", () => {
  const tree = { version: 1, entries: [root,
    { ...common, type: "file", segmentsBase64: path("a"), blob: digest, size: 4 },
    { ...common, type: "hardlink", segmentsBase64: path("b"), targetSegmentsBase64: path("a") },
    { ...common, type: "symlink", segmentsBase64: path("c"), targetBase64: Buffer.from("/etc/missing").toString("base64") },
    { ...common, type: "directory", segmentsBase64: [Buffer.from([255]).toString("base64")] },
  ] };
  assert.equal(validateWorkTree(tree, blobs).fileBytes, 4);
  assert.deepEqual(decodeWorkPath(["/w=="]), Buffer.from([255]));
});
test("unsafe paths, noncanonical base64 and limits fail", () => {
  for (const name of ["", ".", "..", "a/b", "\0", "/etc"]) assert.throws(() => decodeWorkPath(path(name)));
  assert.throws(() => decodeWorkPath(["YQ"]));
  assert.throws(() => decodeWorkPath(Array(129).fill("YQ==")), { code: "PACKAGE_LIMIT_EXCEEDED" });
  assert.equal(decodeWorkPath(path("a".repeat(4096))).length, 4096);
  assert.throws(() => decodeWorkPath(path("a".repeat(4097))), { code: "PACKAGE_LIMIT_EXCEEDED" });
  assert.equal(decodeWorkPath(Array(128).fill("YQ==")).length, 255);
  assert.throws(() => validateWorkTree({ version: 1, entries: [root] }, blobs, { ...WORK_PACKAGE_LIMITS, entries: 0 }));
});
test("duplicate paths, link parents, hardlink loops and special files fail", () => {
  const link = { ...common, type: "symlink", segmentsBase64: path("a"), targetBase64: Buffer.from("/etc").toString("base64") };
  const hard = { ...common, type: "hardlink", segmentsBase64: path("a"), targetSegmentsBase64: path("b") };
  for (const entries of [
    [root, root], [root, link, { ...root, segmentsBase64: [...path("a"), ...path("b")] }],
    [root, hard, { ...hard, segmentsBase64: path("b"), targetSegmentsBase64: path("a") }],
    [root, { ...root, type: "socket", segmentsBase64: path("a") }],
  ]) assert.throws(() => validateWorkTree({ version: 1, entries }, blobs));
});
