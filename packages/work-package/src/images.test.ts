import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import { WorkPackageValidationError } from "@piwork/contracts";
import { WorkBlobDirectory, type ImageBlobStore } from "./blob-directory.js";
import { normalizeImageArchive, encodeImageLoadArchive } from "./images.js";
import { WORK_PACKAGE_LIMITS } from "./limits.js";

const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const bytes = async (source: AsyncIterable<Uint8Array>): Promise<Buffer> => { const parts: Buffer[] = []; for await (const chunk of source) parts.push(Buffer.from(chunk)); return Buffer.concat(parts); };
async function* chunks(value: Buffer) { for (let i = 0; i < value.length; i += 17) yield value.subarray(i, i + 17); }
class MemoryStore implements ImageBlobStore {
  readonly values = new Map<string, Buffer>();
  async put(source: AsyncIterable<Uint8Array>, limit: number) {
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of source) { size += chunk.byteLength; if (size > limit) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "test"); parts.push(Buffer.from(chunk)); }
    const value = Buffer.concat(parts), digest = sha(value); this.values.set(digest, value); return { digest, size };
  }
  async *read(digest: string) { const value = this.values.get(digest); assert.ok(value); yield* chunks(value); }
}
async function archive(entries: readonly [string, Buffer][]): Promise<Buffer> {
  const pack = tar.pack(); const output = bytes(pack);
  for (const [name, data] of entries) await new Promise<void>((resolve, reject) => pack.entry({ name, size: data.length, mtime: new Date(0) }, data, (error) => error ? reject(error) : resolve()));
  pack.finalize(); return output;
}
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const layer = await archive([["hello.txt", Buffer.from("custom development environment")]]);
const config = json({ architecture: "amd64", os: "linux", rootfs: { type: "layers", diff_ids: [`sha256:${sha(layer)}`] }, config: { Env: ["PRIVATE_IMAGE_ENV=sentinel"] } });
const expected = { imageId: `sha256:${sha(config)}`, platform: { os: "linux" as const, architecture: "amd64", variant: null } };
const dockerEntries = (): [string, Buffer][] => [
  ["manifest.json", json([{ Config: "config.json", RepoTags: ["existing-user-tag:latest"], Layers: ["layer/layer.tar"] }])],
  ["config.json", config], ["layer/layer.tar", layer], ["layer/json", json({ id: "legacy" })], ["layer/VERSION", Buffer.from("1.0")],
];
function ociEntries(overrides: { mediaType?: string; extraImage?: boolean; missing?: boolean; descriptor?: string } = {}): [string, Buffer][] {
  const compressed = gzipSync(layer);
  const manifest = json({ schemaVersion: 2, config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: `sha256:${sha(config)}`, size: config.length }, layers: [{ mediaType: overrides.mediaType ?? "application/vnd.oci.image.layer.v1.tar+gzip", digest: overrides.descriptor ?? `sha256:${sha(compressed)}`, size: compressed.length }] });
  const descriptor = { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: `sha256:${sha(manifest)}`, size: manifest.length, platform: expected.platform };
  return [["oci-layout", json({ imageLayoutVersion: "1.0.0" })], ["index.json", json({ schemaVersion: 2, manifests: overrides.extraImage ? [descriptor, descriptor] : [descriptor] })],
    [`blobs/sha256/${sha(manifest)}`, manifest], [`blobs/sha256/${sha(config)}`, config],
    ...(overrides.missing ? [] : [[`blobs/sha256/${sha(compressed)}`, compressed] as [string, Buffer]])];
}

test("Docker save normalization preserves exact config/layers and emits only tag-free load archive", async () => {
  const store = new MemoryStore();
  const normalized = await normalizeImageArchive(chunks(await archive(dockerEntries())), expected, store);
  assert.equal(normalized.image.config, sha(config)); assert.deepEqual(normalized.image.layers, [sha(layer)]);
  const output = await bytes(encodeImageLoadArchive(normalized.image, normalized.blobs, store));
  const again = await normalizeImageArchive(chunks(output), expected, new MemoryStore());
  assert.deepEqual(again, normalized);
  assert.ok(output.includes(Buffer.from('"RepoTags":[]'))); assert.ok(!output.includes(Buffer.from("existing-user-tag")));
  assert.ok(!output.includes(Buffer.from("repositories"))); assert.equal(normalized.blobs.length, 2);
});

test("OCI gzip and containerd dual-layout archives normalize to original diff_ids", async () => {
  const store = new MemoryStore(); const entries = ociEntries();
  const compressed = gzipSync(layer);
  entries.push(["manifest.json", json([{ Config: `blobs/sha256/${sha(config)}`, Layers: [`blobs/sha256/${sha(compressed)}`], RepoTags: ["private:tag"] }])]);
  const result = await normalizeImageArchive(chunks(await archive(entries)), expected, store);
  assert.deepEqual(result.image.layers, [sha(layer)]); assert.deepEqual(store.values.get(sha(layer)), layer);
  assert.deepEqual(result.blobs.map((blob) => blob.digest).sort(), [sha(config), sha(layer)].sort());
});

test("repeated layer references preserve order while normalized blobs deduplicate", async () => {
  const repeatedConfig = json({ architecture: "amd64", os: "linux", rootfs: { type: "layers", diff_ids: [`sha256:${sha(layer)}`, `sha256:${sha(layer)}`] } });
  const entries: [string, Buffer][] = [["manifest.json", json([{ Config: "config.json", RepoTags: [], Layers: ["layer.tar", "layer.tar"] }])], ["config.json", repeatedConfig], ["layer.tar", layer]];
  const result = await normalizeImageArchive(chunks(await archive(entries)), { ...expected, imageId: `sha256:${sha(repeatedConfig)}` }, new MemoryStore());
  assert.deepEqual(result.image.layers, [sha(layer), sha(layer)]); assert.equal(result.blobs.length, 2);
});

test("archive rejects multiple platforms, missing layer, bad descriptor and unsupported media", async () => {
  for (const options of [{ extraImage: true }, { missing: true }, { descriptor: `sha256:${"0".repeat(64)}` }, { mediaType: "application/untrusted" }]) {
    await assert.rejects(normalizeImageArchive(chunks(await archive(ociEntries(options))), expected, new MemoryStore()), WorkPackageValidationError);
  }
  await assert.rejects(normalizeImageArchive(chunks(await archive(dockerEntries())), { ...expected, platform: { ...expected.platform, architecture: "arm64" } }, new MemoryStore()), /image.platform/);
  await assert.rejects(normalizeImageArchive(chunks(await archive(dockerEntries())), { ...expected, imageId: `sha256:${"0".repeat(64)}` }, new MemoryStore()), /image.identity/);
});

test("archive refuses traversal, duplicate entries, unknown image, truncation, and corrupt layers", async () => {
  for (const entries of [
    [...dockerEntries(), ["../outside", Buffer.from("no")] as [string, Buffer]],
    [...dockerEntries(), ["/absolute", Buffer.from("no")] as [string, Buffer]],
    [...dockerEntries(), ["config.json", config] as [string, Buffer]],
    [...dockerEntries(), ["extra-image.json", config] as [string, Buffer]],
    dockerEntries().map(([name, data]): [string, Buffer] => [name, name === "layer/layer.tar" ? Buffer.from("corrupted layer") : data]),
  ]) await assert.rejects(normalizeImageArchive(chunks(await archive(entries)), expected, new MemoryStore()), WorkPackageValidationError);
  const valid = await archive(dockerEntries());
  await assert.rejects(normalizeImageArchive(chunks(valid.subarray(0, valid.length - 1025)), expected, new MemoryStore()), WorkPackageValidationError);
});

test("gzip expansion, metadata, entries and raw archive bytes are bounded", async () => {
  for (const overrides of [{ restoredBytes: layer.length - 1 }, { metadataBytes: 8 }, { entries: 2 }, { packageBytes: 512 }]) {
    await assert.rejects(normalizeImageArchive(chunks(await archive(ociEntries())), expected, new MemoryStore(), { limits: { ...WORK_PACKAGE_LIMITS, ...overrides } }), (error: unknown) => error instanceof WorkPackageValidationError && error.code === "PACKAGE_LIMIT_EXCEEDED");
  }
});

test("normalized loader hashes inputs again and rejects changed content", async () => {
  const store = new MemoryStore(); const normalized = await normalizeImageArchive(chunks(await archive(dockerEntries())), expected, store);
  store.values.set(sha(layer), Buffer.alloc(layer.length));
  await assert.rejects(bytes(encodeImageLoadArchive(normalized.image, normalized.blobs, store)), WorkPackageValidationError);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(bytes(encodeImageLoadArchive(normalized.image, normalized.blobs, store, controller.signal)), /abort/i);
});

test("blob directory stores bytes by hash, deduplicates, rejects symlinks and cleans partials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-image-blobs-"));
  try {
    const store = new WorkBlobDirectory(directory), value = Buffer.from("private bytes");
    const blob = await store.put(chunks(value), value.length);
    assert.deepEqual(await store.put(chunks(value), value.length), blob); assert.deepEqual(await bytes(store.read(blob.digest)), value);
    await assert.rejects(store.put(chunks(value), 1), (error: unknown) => error instanceof WorkPackageValidationError && error.code === "PACKAGE_LIMIT_EXCEEDED");
    assert.deepEqual(await readdir(directory), [blob.digest]);
    const external = join(directory, "existing-user-file"); await writeFile(external, "unchanged");
    const other = Buffer.from("other"); await symlink(external, join(directory, sha(other)));
    await assert.rejects(store.put(chunks(other), 100));
    assert.ok(!(await readdir(directory)).some((name) => name.startsWith(".partial")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
