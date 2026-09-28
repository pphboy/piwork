import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { encodeWorkPackage, readWorkPackage, inspectWorkPackage, validatePackageContents } from "./codec.js";
import { parseWorkJson, encodeWorkJson } from "./json.js";
import { goldenWorkFixture } from "./fixture.js";
import { WORK_PACKAGE_LIMITS } from "./limits.js";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { normalizeServiceDefinitionInput, type WorkControlHistory, type WorkSourceIdentityMap } from "@piwork/contracts";

async function goldenBytes(): Promise<Buffer> {
  const { spec, data } = goldenWorkFixture();
  return Buffer.from(await new Response(Readable.toWeb(Readable.from(encodeWorkPackage(spec, (blob) => Readable.from([data.get(blob.digest)!])))) as ReadableStream<Uint8Array>).arrayBuffer());
}
test("golden .work round-trips with an empty blob and one-byte streaming reads", async () => {
  const bytes = await goldenBytes();
  assert.equal(bytes.length, 4201);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "da7cde726ef093c5e9721bf0ca24b7e1ed19e59f9ca124fc8582124dacd15969");
  const folder = await mkdtemp(join(tmpdir(), "piwork-package-test-"));
  try {
    const file = join(folder, "golden.work"); await writeFile(file, bytes, { mode: 0o600 });
    const result = await readWorkPackage(createReadStream(file, { highWaterMark: 1 }));
    assert.equal(result.digest, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.size, bytes.length);
    assert.equal(result.entryCount, 7);
    assert.equal(result.spec.activeContext, null);
    assert.deepEqual(result.spec, parseWorkJson(encodeWorkJson(goldenWorkFixture().spec)));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("V1 HTTP service package preserves literal file and history URLs through import and re-export", async () => {
  const sourceUrl = "http://worker.w-source123.work/api?q=1";
  const fixture = goldenWorkFixture(Buffer.from(sourceUrl));
  const spec = fixture.spec;
  const replaceMetadata = (oldDigest: string, value: unknown, kind: "control-history" | "identity-map") => {
    fixture.data.delete(oldDigest);
    fixture.metadata.delete(oldDigest);
    spec.blobs.splice(spec.blobs.findIndex((blob) => blob.digest === oldDigest), 1);
    const bytes = encodeWorkJson(value), digest = createHash("sha256").update(bytes).digest("hex");
    fixture.data.set(digest, bytes);
    fixture.metadata.set(digest, value);
    spec.blobs.push({ digest, size: bytes.length, kinds: [kind] });
    spec.blobs.sort((a, b) => a.digest.localeCompare(b.digest));
    return digest;
  };
  const history = fixture.metadata.get(spec.history.control) as WorkControlHistory;
  history.operations[0]!.serviceId = "service-source-000001";
  history.operations[0]!.requestJson = sourceUrl;
  spec.history.control = replaceMetadata(spec.history.control, history, "control-history");
  const identities = fixture.metadata.get(spec.history.sourceIdentityMap) as WorkSourceIdentityMap;
  identities.services.push({ sourceId: "service-source-000001", key: "s-000001" });
  spec.history.sourceIdentityMap = replaceMetadata(spec.history.sourceIdentityMap, identities, "identity-map");
  const definition = normalizeServiceDefinitionInput({ name: "worker", image: { reference: "worker:fixed" }, command: "node",
    workingDirectory: "/", enabled: true, ports: [{ name: "web", protocol: "tcp", containerPort: 80 }],
    readiness: { kind: "http", portName: "web", path: "/health" } });
  spec.services.push({ key: "s-000001", name: "worker", desiredRevision: 1, appliedRevision: 1, enabled: true, tombstonedAt: null,
    revisions: [{ revision: 1, createdAt: spec.createdAt, definition, imageKey: "i-000001" }],
    recovery: { count: 0, windowStartedAt: null, nextRetryAt: null, readySince: null },
    sourceObservation: { state: "ready", lastError: null } });
  spec.quotaReservations.push({ subjectKind: "service", subjectKey: "s-000001", desiredCpuMillis: 100,
    desiredMemoryBytes: 67108864, serviceSlots: 1, volumeSlots: 0 });
  spec.volumes[1]!.serviceRefKeys.push("s-000001");
  const packageBytes = Buffer.from(await new Response(Readable.toWeb(Readable.from(encodeWorkPackage(spec,
    (blob) => Readable.from([fixture.data.get(blob.digest)!])))) as ReadableStream<Uint8Array>).arrayBuffer());
  const restored = new Map<string, Buffer>();
  const importPackage = async (bytes: Buffer) => readWorkPackage(Readable.from([bytes]), { onBlob: async (blob, chunks) => {
    const parts: Buffer[] = [];
    for await (const chunk of chunks) parts.push(Buffer.from(chunk));
    restored.set(blob.digest, Buffer.concat(parts));
  } });
  const first = await importPackage(packageBytes);
  const second = await importPackage(packageBytes);
  assert.equal(first.spec.services[0]!.enabled, true);
  assert.equal(second.spec.services[0]!.name, "worker");
  const reexport = Buffer.from(await new Response(Readable.toWeb(Readable.from(encodeWorkPackage(first.spec,
    (blob) => Readable.from([restored.get(blob.digest)!])))) as ReadableStream<Uint8Array>).arrayBuffer());
  const repeated = await importPackage(reexport);
  assert.equal(restored.get(createHash("sha256").update(sourceUrl).digest("hex"))?.toString(), sourceUrl);
  assert.equal((repeated.metadata.get(repeated.spec.history.control) as WorkControlHistory).operations[0]!.requestJson, sourceUrl);
  assert.equal(reexport.equals(packageBytes), true);
});
test("strict JSON rejects duplicate/escaped keys, unsafe integers, invalid UTF-8 and excess depth", () => {
  for (const input of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', "9007199254740992", "1e1000", "[1,]", "[01]", "true false", '"unterminated', "[".repeat(130) + "0" + "]".repeat(130)]) assert.throws(() => parseWorkJson(Buffer.from(input)));
  assert.throws(() => parseWorkJson(Buffer.from([0xff])));
  const result = parseWorkJson(Buffer.from('{"__proto__":{"polluted":true},"constructor":"literal","prototype":"literal"}')) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(result.constructor, "literal");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(encodeWorkJson({ z: 1, a: 2 }).toString(), '{"a":2,"z":1}');
});
test("tamper, truncation, trailing data, length and manifest limits fail", async () => {
  const bytes = await goldenBytes();
  const tampered = Buffer.from(bytes); tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
  const length = Buffer.from(bytes); length.writeBigUInt64BE(2n ** 63n, 8);
  for (const invalid of [bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from("!")]), tampered, length, bytes.subarray(0, 8)]) {
    await assert.rejects(readWorkPackage(Readable.from([invalid])));
  }
  await assert.rejects(readWorkPackage(Readable.from([bytes]), { limits: { ...WORK_PACKAGE_LIMITS, packageBytes: bytes.length - 1 } }), { code: "PACKAGE_LIMIT_EXCEEDED" });
  const manifestLength = bytes.readUInt32BE(12);
  await assert.rejects(readWorkPackage(Readable.from([bytes]), { limits: { ...WORK_PACKAGE_LIMITS, metadataBytes: manifestLength - 1 } }), { code: "PACKAGE_LIMIT_EXCEEDED" });
  await assert.rejects(readWorkPackage(Readable.from([bytes]), { limits: { ...WORK_PACKAGE_LIMITS, totalMetadataBytes: manifestLength } }), { code: "PACKAGE_LIMIT_EXCEEDED" });
});
test("writer verifies blob length/hash and propagates cancellation", async () => {
  const { spec, data } = goldenWorkFixture();
  await assert.rejects(async () => { for await (const _ of encodeWorkPackage(spec, () => Readable.from([Buffer.from("wrong")]))) { /* drain */ } });
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(readWorkPackage(Readable.from([]), { signal: controller.signal }), /cancelled/);
  await assert.rejects(async () => { for await (const _ of encodeWorkPackage(spec, (blob) => Readable.from([data.get(blob.digest)!]), controller.signal)) { /* drain */ } }, /cancelled/);
});
test("blob consumers are serialized and must fully consume data", async () => {
  const bytes = await goldenBytes(); let busy = false, count = 0;
  await readWorkPackage(Readable.from([bytes]), { onBlob: async (_, chunks) => {
    assert.equal(busy, false); busy = true;
    for await (const chunk of chunks) { count += chunk.byteLength; await new Promise((resolve) => setImmediate(resolve)); }
    busy = false;
  } });
  assert.ok(count > 0);
  await assert.rejects(readWorkPackage(Readable.from([bytes]), { onBlob: async () => {} }), { field: "unconsumedBlob" });
});
test("inspect verifies all bytes but never exposes private file, agent or history content", async () => {
  const bytes = await goldenBytes(); const summary = await inspectWorkPackage(Readable.from([bytes]));
  assert.equal(summary.integrityVerified, true); assert.equal(summary.installationValidated, false);
  assert.equal(JSON.stringify(summary).includes("SENTINEL"), false);
  assert.equal(JSON.stringify(summary).includes("work-000000000001"), false);
  const corrupt = Buffer.from(bytes); const offset = corrupt.indexOf("PRIVATE_CONTENT_SENTINEL");
  assert.ok(offset > 0); corrupt[offset] = corrupt[offset]! ^ 1;
  await assert.rejects(inspectWorkPackage(Readable.from([corrupt])), { field: "blobHash" });
});
test("duplicate file references count independently towards restore limits", () => {
  const { spec, metadata } = goldenWorkFixture();
  const result = validatePackageContents(spec, metadata);
  assert.ok(result.restoredBytes > 2 * "PRIVATE_CONTENT_SENTINEL".length);
  assert.throws(() => validatePackageContents(spec, metadata, { ...WORK_PACKAGE_LIMITS, restoredBytes: result.restoredBytes - 1 }), { code: "PACKAGE_LIMIT_EXCEEDED" });
  assert.throws(() => validatePackageContents(spec, metadata, { ...WORK_PACKAGE_LIMITS, entries: 6 }), { code: "PACKAGE_LIMIT_EXCEEDED" });
  assert.equal(validatePackageContents(spec, metadata, { ...WORK_PACKAGE_LIMITS, restoredBytes: result.restoredBytes, entries: 7 }).entryCount, 7);
  // No allocation of a 50-GiB fixture is needed to prove logical-size accounting.
  const tree = metadata.get(spec.volumes[0].tree) as { entries: Array<{ type: string; blob?: string; size?: number }> };
  const file = tree.entries.find((entry) => entry.type === "file" && entry.size !== 0)!;
  file.size = 50 * 1024 ** 3 + 1;
  spec.blobs.find((blob) => blob.digest === file.blob)!.size = file.size;
  assert.throws(() => validatePackageContents(spec, metadata), { code: "PACKAGE_LIMIT_EXCEEDED" });
});
test("Pi package tree bindings count logical bytes, inspect offline, and reject links outside the artifact", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "piwork-package-inspect-"));
  try {
  const fixture = goldenWorkFixture();
  const file = Buffer.from('{"name":"@example/tools","version":"1.0.0"}');
  await writeFile(join(packageRoot, "package.json"), file);
  await symlink("package.json", join(packageRoot, "shortcut"));
  const preparedEnvironment = { os: "linux" as const, architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" };
  const artifactMetadata = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "local:fixture", preparedEnvironment })).metadata;
  const fileDigest = createHash("sha256").update(file).digest("hex");
  const common = { uid: 10001, gid: 10001, mode: 420, mtimeNs: "1727049600123456789" };
  const path = (name: string) => [Buffer.from(name).toString("base64")];
  const packageTree = { version: 1, entries: [
    { ...common, type: "directory", mode: 493, segmentsBase64: [] },
    { ...common, type: "file", segmentsBase64: path("package.json"), blob: fileDigest, size: file.length },
    { ...common, type: "symlink", segmentsBase64: path("shortcut"), targetBase64: Buffer.from("package.json").toString("base64") },
  ] };
  const treeBytes = encodeWorkJson(packageTree), treeDigest = createHash("sha256").update(treeBytes).digest("hex");
  fixture.spec.blobs.push({ digest: fileDigest, size: file.length, kinds: ["file"] }, { digest: treeDigest, size: treeBytes.length, kinds: ["tree"] });
  fixture.spec.blobs.sort((a, b) => a.digest.localeCompare(b.digest));
  fixture.data.set(fileDigest, file);
  fixture.data.set(treeDigest, treeBytes);
  fixture.metadata.set(treeDigest, packageTree);
  const artifactKey = artifactMetadata.contentDigest;
  fixture.spec.piPackageArtifacts.push({ key: artifactKey, name: "@example/tools", version: "1.0.0", sourceKind: "local", resolvedSource: "local:fixture",
    preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" },
    resourceCounts: { extensions: 0, skills: 0, prompts: 0, themes: 0 }, contentDigest: artifactKey,
    treeDigest, resourceInventory: { extensions: [], skills: [], prompts: [], themes: [] } });
  fixture.spec.contexts[0]!.configuration.packages.push({ name: "@example/tools", enabled: false });
  fixture.spec.contexts[0]!.packageBindings.push({ name: "@example/tools", artifactKey });
  const before = validatePackageContents(goldenWorkFixture().spec, goldenWorkFixture().metadata).restoredBytes;
  const after = validatePackageContents(fixture.spec, fixture.metadata).restoredBytes;
  assert.equal(after - before, file.length);
  const summary = await inspectWorkPackage(Readable.from(encodeWorkPackage(fixture.spec,
    (blob) => Readable.from([fixture.data.get(blob.digest)!]))));
  assert.deepEqual(summary.packages, [{ name: "@example/tools", version: "1.0.0" }]);
  assert.equal(summary.counts.packages, 1);
  assert.equal(summary.integrityVerified, true);
  assert.equal(summary.installationValidated, false);
  assert.throws(() => validatePackageContents(fixture.spec, fixture.metadata, { ...WORK_PACKAGE_LIMITS, restoredBytes: after - 1 }), { code: "PACKAGE_LIMIT_EXCEEDED" });
  (packageTree.entries[2]! as { targetBase64: string }).targetBase64 = Buffer.from("../escape").toString("base64");
  assert.throws(() => validatePackageContents(fixture.spec, fixture.metadata), /piPackageArtifacts.symlinkEscape/);
  } finally { await rm(packageRoot, { recursive: true, force: true }); }
});
test("large file content streams in bounded chunks and cross-kind content deduplicates", async () => {
  const fixture = goldenWorkFixture(Buffer.alloc(2 * 1024 * 1024 + 1, 7));
  const context = fixture.spec.contexts[0]!;
  const oldAgents = context.agentsBlob;
  context.agentsBlob = context.skillsTree;
  fixture.spec.blobs = fixture.spec.blobs.filter((blob) => blob.digest !== oldAgents);
  fixture.spec.blobs.find((blob) => blob.digest === context.skillsTree)!.kinds.unshift("file");
  const source = encodeWorkPackage(fixture.spec, (blob) => Readable.from([fixture.data.get(blob.digest)!]));
  let largest = 0;
  const verified = await readWorkPackage(source, { onBlob: async (_, chunks) => { for await (const chunk of chunks) largest = Math.max(largest, chunk.byteLength); } });
  assert.ok(verified.size > 2 * 1024 * 1024);
  assert.ok(largest <= 1024 * 1024);
  assert.deepEqual(verified.spec.blobs.find((blob) => blob.digest === context.skillsTree)!.kinds, ["file", "tree"]);
});
test("duplicate manifest keys cannot be hidden by JSON.parse last-key-wins", async () => {
  const bytes = await goldenBytes();
  const oldLength = Number(bytes.readBigUInt64BE(8));
  const manifest = Buffer.concat([Buffer.from('{"formatVersion":1,'), bytes.subarray(17, 16 + oldLength)]);
  const header = Buffer.from(bytes.subarray(0, 16)); header.writeBigUInt64BE(BigInt(manifest.length), 8);
  await assert.rejects(readWorkPackage(Readable.from([header, manifest, bytes.subarray(16 + oldLength)])), { field: "json" });
});
test("old prototype packages missing reservation or volume reference metadata are rejected", async () => {
  const { spec, data } = goldenWorkFixture();
  const packageWith = (value: unknown) => {
    const manifest = encodeWorkJson(value);
    const header = Buffer.alloc(16); header.write("PIWORK1\n", 0, "ascii"); header.writeBigUInt64BE(BigInt(manifest.length), 8);
    return Buffer.concat([header, manifest, ...spec.blobs.map((blob) => data.get(blob.digest)!)]);
  };
  const oldQuota = structuredClone(spec) as unknown as Record<string, unknown>;
  delete oldQuota.quotaReservations;
  await assert.rejects(readWorkPackage(Readable.from([packageWith(oldQuota)])), { code: "PACKAGE_INVALID" });
  const oldReferences = structuredClone(spec) as unknown as { volumes: Array<Record<string, unknown>> };
  for (const volume of oldReferences.volumes) delete volume.serviceRefKeys;
  await assert.rejects(readWorkPackage(Readable.from([packageWith(oldReferences)])), { code: "PACKAGE_INVALID" });
});
