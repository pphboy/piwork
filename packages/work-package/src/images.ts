import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import { WorkPackageValidationError, type PortableWorkImage } from "@piwork/contracts";
import type { ImageBlob, ImageBlobStore } from "./blob-directory.js";
import { encodeWorkJson, parseWorkJson } from "./json.js";
import { WORK_PACKAGE_LIMITS, type WorkPackageLimits } from "./limits.js";

export type CapturedWorkImage = Omit<PortableWorkImage, "key">;
export interface NormalizedImage { readonly image: CapturedWorkImage; readonly blobs: readonly ImageBlob[] }
type JsonObject = Record<string, unknown>;
function invalid(field = "image.archive"): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }
function limit(): never { throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "image.archive"); }
function object(value: unknown): JsonObject { if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(); return value as JsonObject; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function digest(value: unknown): string { if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) invalid(); return value.slice(7); }
function path(value: unknown, limits: WorkPackageLimits): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > limits.pathBytes || value.includes("\\") || value.includes("\0") || value.split("/").some((part) => !part || part === "." || part === "..")) invalid("image.path");
  return value;
}
async function json(blob: ImageBlob, store: ImageBlobStore, limits: WorkPackageLimits): Promise<unknown> {
  if (blob.size > limits.metadataBytes) limit();
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of store.read(blob.digest)) { size += chunk.byteLength; if (size > blob.size) invalid(); parts.push(Buffer.from(chunk)); }
  if (size !== blob.size) invalid();
  const bytes = Buffer.concat(parts, size);
  if (createHash("sha256").update(bytes).digest("hex") !== blob.digest) invalid();
  return parseWorkJson(bytes);
}

/** Guard parser buffering before tar-stream sees headers. Docker/OCI layout names fit ustar;
 * extended headers and archive links are not needed and are never extracted or expanded. */
async function* boundedTar(source: AsyncIterable<Uint8Array>, limits: WorkPackageLimits, signal?: AbortSignal): AsyncGenerator<Buffer> {
  let header = Buffer.alloc(0), remaining = 0, bytes = 0, entries = 0, ended = false;
  for await (const input of source) {
    signal?.throwIfAborted(); bytes += input.byteLength; if (bytes > limits.packageBytes) limit();
    let offset = 0;
    while (offset < input.byteLength) {
      signal?.throwIfAborted();
      if (remaining > 0) {
        const length = Math.min(remaining, input.byteLength - offset, limits.streamChunkBytes);
        yield Buffer.from(input.subarray(offset, offset + length)); offset += length; remaining -= length;
      } else {
        const length = Math.min(512 - header.length, input.byteLength - offset);
        header = Buffer.concat([header, input.subarray(offset, offset + length)]); offset += length;
        if (header.length !== 512) continue;
        if (header.every((byte) => byte === 0)) { ended = true; yield header; header = Buffer.alloc(0); continue; }
        if (ended) invalid();
        if (++entries > limits.entries) limit();
        const type = header[156];
        if (type !== 0 && type !== 48 && type !== 53) throw new WorkPackageValidationError("PACKAGE_FORMAT_UNSUPPORTED", "image.archiveEntry");
        const field = header.subarray(124, 136);
        let size: number;
        if (field[0] === 128) {
          let wide = 0n; for (const byte of field.subarray(1)) wide = wide * 256n + BigInt(byte);
          if (wide > BigInt(Number.MAX_SAFE_INTEGER)) limit(); size = Number(wide);
        } else {
          const octal = field.toString("ascii").replace(/\0.*$/, "").trim();
          if (!/^[0-7]+$/.test(octal)) invalid(); size = Number.parseInt(octal, 8);
        }
        if (!Number.isSafeInteger(size) || size > limits.packageBytes) limit();
        if (type === 53 && size !== 0) invalid();
        remaining = Math.ceil(size / 512) * 512;
        yield header; header = Buffer.alloc(0);
      }
    }
  }
  if (remaining !== 0 || header.length !== 0 || !ended) invalid();
}

/** Parse save output by immutable config identity; no archive paths reach the filesystem. */
export async function normalizeImageArchive(source: AsyncIterable<Uint8Array>, expected: Pick<CapturedWorkImage, "imageId" | "platform">,
  store: ImageBlobStore, options: { readonly limits?: WorkPackageLimits; readonly signal?: AbortSignal } = {}): Promise<NormalizedImage> {
  const limits = options.limits ?? WORK_PACKAGE_LIMITS;
  digest(expected.imageId);
  const files = new Map<string, ImageBlob>(), directories = new Set<string>();
  const extract = tar.extract({ highWaterMark: limits.streamChunkBytes });
  const pumping = pipeline(Readable.from(boundedTar(source, limits, options.signal), { objectMode: false, highWaterMark: limits.streamChunkBytes }), extract, { signal: options.signal });
  void pumping.catch(() => undefined);
  try {
    for await (const entry of extract) {
      const name = path(entry.header.type === "directory" ? entry.header.name.replace(/\/$/, "") : entry.header.name, limits);
      if (files.has(name) || directories.has(name)) invalid("image.duplicateEntry");
      if (entry.header.type === "directory") { directories.add(name); for await (const _chunk of entry) { invalid(); } }
      else {
        const blob = await store.put(entry, limits.packageBytes, options.signal);
        if (blob.size !== entry.header.size) invalid(); files.set(name, blob);
      }
    }
    await pumping;
    const used = new Set<string>(); let metadataBytes = 0;
    const lookup = (name: unknown): ImageBlob => { const key = path(name, limits); const value = files.get(key); if (!value) invalid(); used.add(key); return value; };
    const metadata = async (name: unknown): Promise<unknown> => {
      const blob = lookup(name); metadataBytes += blob.size; if (metadataBytes > limits.totalMetadataBytes) limit(); return json(blob, store, limits);
    };
    let config: ImageBlob, layers: ImageBlob[];
    if (files.has("oci-layout")) {
      if (object(await metadata("oci-layout")).imageLayoutVersion !== "1.0.0") invalid();
      const index = object(await metadata("index.json")); if (index.schemaVersion !== 2) invalid();
      const manifests = array(index.manifests); if (manifests.length !== 1) invalid("image.multipleImages");
      const descriptor = (value: unknown, types: readonly string[]) => {
        const item = object(value);
        if (typeof item.mediaType !== "string" || !types.includes(item.mediaType)) throw new WorkPackageValidationError("PACKAGE_FORMAT_UNSUPPORTED", "image.mediaType");
        const name = `blobs/sha256/${digest(item.digest)}`; const blob = lookup(name);
        if (!Number.isSafeInteger(item.size) || item.size !== blob.size || `sha256:${blob.digest}` !== item.digest) invalid();
        if (item.urls !== undefined) invalid();
        return { item, name, blob };
      };
      const selected = descriptor(manifests[0], ["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"]);
      if (selected.item.platform !== undefined) {
        const platform = object(selected.item.platform);
        if (platform.os !== expected.platform.os || platform.architecture !== expected.platform.architecture || (platform.variant ?? null) !== expected.platform.variant) invalid("image.platform");
      }
      const manifest = object(await metadata(selected.name)); if (manifest.schemaVersion !== 2) invalid();
      const configDescriptor = descriptor(manifest.config, ["application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"]);
      config = configDescriptor.blob;
      const layerDescriptors = array(manifest.layers);
      if (layerDescriptors.length > limits.entries) limit();
      layers = []; let expanded = 0;
      for (const value of layerDescriptors) {
        const layer = descriptor(value, ["application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.docker.image.rootfs.diff.tar", "application/vnd.docker.image.rootfs.diff.tar.gzip"]);
        let blob = layer.blob;
        if ((layer.item.mediaType as string).endsWith("gzip")) {
          const gunzip = createGunzip({ chunkSize: limits.streamChunkBytes });
          const decompressing = pipeline(Readable.from(store.read(blob.digest), { objectMode: false, highWaterMark: limits.streamChunkBytes }), gunzip, { signal: options.signal });
          void decompressing.catch(() => undefined);
          try { blob = await store.put(gunzip, limits.restoredBytes - expanded, options.signal); await decompressing; }
          finally { gunzip.destroy(); await decompressing.catch(() => undefined); }
        }
        expanded += blob.size; if (expanded > limits.restoredBytes) limit(); layers.push(blob);
      }
      // Some containerd save archives include a second Docker compatibility manifest.
      if (files.has("manifest.json")) {
        const compatibility = array(await metadata("manifest.json")); if (compatibility.length !== 1) invalid();
        const item = object(compatibility[0]);
        if (lookup(item.Config).digest !== config.digest) invalid();
        const names = array(item.Layers);
        if (names.length !== layerDescriptors.length) invalid();
        for (let i = 0; i < names.length; i++) if (`sha256:${lookup(names[i]).digest}` !== object(layerDescriptors[i]).digest) invalid();
      }
    } else {
      const manifest = array(await metadata("manifest.json")); if (manifest.length !== 1) invalid("image.multipleImages");
      const item = object(manifest[0]); config = lookup(item.Config);
      const names = array(item.Layers); if (names.length > limits.entries) limit();
      layers = names.map(lookup);
      // Legacy Docker save adds per-layer v1 metadata. It cannot add another image.
      for (const name of names) {
        const prefix = path(name, limits).replace(/\/layer\.tar$/, "");
        if (prefix === name) continue;
        for (const suffix of ["json", "VERSION"]) {
          const ancillary = `${prefix}/${suffix}`;
          if (files.has(ancillary)) { const blob = lookup(ancillary); metadataBytes += blob.size; if (blob.size > limits.metadataBytes || metadataBytes > limits.totalMetadataBytes) limit(); if (suffix === "json") await json(blob, store, limits); }
        }
      }
    }
    if (files.has("repositories")) await metadata("repositories");
    const parents = new Set<string>();
    for (const name of files.keys()) { const parts = name.split("/"); while (parts.length > 1) { parts.pop(); parents.add(parts.join("/")); } }
    for (const name of directories) if (!parents.has(name)) invalid("image.unreferencedEntry");
    metadataBytes += config.size; if (metadataBytes > limits.totalMetadataBytes) limit();
    const configJson = object(await json(config, store, limits));
    const roots = object(configJson.rootfs); const diffIds = array(roots.diff_ids);
    if (`sha256:${config.digest}` !== expected.imageId || roots.type !== "layers" || diffIds.length !== layers.length) invalid("image.identity");
    if (configJson.os !== expected.platform.os || configJson.architecture !== expected.platform.architecture || (configJson.variant ?? null) !== expected.platform.variant) invalid("image.platform");
    // Moby 26 emits unreferenced pre-1.9 compatibility configs alongside OCI data.
    // Accept only the exact legacy chain for our layers, never an arbitrary extra image.
    // See moby/image/tarexport/save.go and image/v1/imagev1.go (CreateID).
    const legacyFiles = [...files.keys()].filter((name) => !used.has(name));
    if (legacyFiles.length && files.has("oci-layout") && files.has("manifest.json")) {
      if (legacyFiles.length !== layers.length) invalid("image.unreferencedEntry");
      const byParent = new Map<string, JsonObject>();
      for (const name of legacyFiles) {
        const blob = files.get(name)!;
        if (name !== `blobs/sha256/${blob.digest}`) invalid("image.unreferencedEntry");
        const record = object(await metadata(name));
        if (record.rootfs !== undefined || record.history !== undefined || typeof record.id !== "string" || !/^[a-f0-9]{64}$/.test(record.id) || record.os !== expected.platform.os) invalid("image.legacyConfig");
        const parent = record.parent ?? "";
        if (typeof parent !== "string" || (parent !== "" && !/^[a-f0-9]{64}$/.test(parent)) || byParent.has(parent)) invalid("image.legacyConfig");
        byParent.set(parent, record);
      }
      let parent = "", chain = "";
      for (let i = 0; i < layers.length; i++) {
        const record = byParent.get(parent); if (!record) invalid("image.legacyConfig");
        const layerId = `sha256:${layers[i]!.digest}`;
        chain = chain === "" ? layerId : `sha256:${createHash("sha256").update(`${chain} ${layerId}`).digest("hex")}`;
        const input: JsonObject = { ...record, layer_id: chain }; delete input.id; delete input.parent;
        if (i < layers.length - 1) delete input.os;
        if (parent) input.parent = `sha256:${parent}`;
        // Go marshals the outer map in key order and preserves nested RawMessage order.
        const serialized = `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(input[key])}`).join(",")}}`
          .replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
        if (createHash("sha256").update(serialized).digest("hex") !== record.id) invalid("image.legacyConfig");
        if (i === layers.length - 1) {
          const original = object(configJson.config ?? {}), legacy = object(record.config ?? {});
          for (const [key, value] of Object.entries(legacy)) {
            if (Object.hasOwn(original, key)) {
              if (!encodeWorkJson(value).equals(encodeWorkJson(original[key]))) invalid("image.legacyConfig");
            } else if (value !== null && value !== false && value !== "" && value !== 0) invalid("image.legacyConfig");
          }
        }
        parent = record.id as string;
      }
    }
    for (const name of files.keys()) if (!used.has(name)) invalid("image.unreferencedEntry");
    let restored = 0; const unique = new Map<string, ImageBlob>([[config.digest, config]]);
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!; if (diffIds[i] !== `sha256:${layer.digest}`) invalid("image.diffId");
      if (!unique.has(layer.digest)) restored += layer.size;
      unique.set(layer.digest, layer);
    }
    if (restored > limits.restoredBytes) limit();
    return { image: { ...expected, config: config.digest, layers: layers.map((layer) => layer.digest) }, blobs: [...unique.values()].sort((a, b) => a.digest.localeCompare(b.digest)) };
  } catch (error) {
    extract.destroy(); await pumping.catch(() => undefined);
    if (error instanceof WorkPackageValidationError || options.signal?.aborted) throw error;
    throw new WorkPackageValidationError("PACKAGE_INVALID", "image.archive");
  }
}

/** Generate only canonical, tag-free entries. Rehash blobs while streaming into Docker. */
export async function* encodeImageLoadArchive(image: CapturedWorkImage, blobs: readonly ImageBlob[], store: ImageBlobStore, signal?: AbortSignal): AsyncGenerator<Buffer> {
  const declared = new Map(blobs.map((blob) => [blob.digest, blob]));
  const config = declared.get(image.config); if (!config || image.imageId !== `sha256:${image.config}`) invalid();
  const value = object(await json(config, store, WORK_PACKAGE_LIMITS));
  const roots = object(value.rootfs), diffIds = array(roots.diff_ids);
  if (roots.type !== "layers" || diffIds.length !== image.layers.length || image.layers.some((layer, i) => `sha256:${layer}` !== diffIds[i])) invalid();
  if (value.os !== image.platform.os || value.architecture !== image.platform.architecture || (value.variant ?? null) !== image.platform.variant) invalid();
  const pack = tar.pack({ highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes });
  const abort = () => pack.destroy(new Error("IMAGE_LOAD_ABORTED")); signal?.throwIfAborted(); signal?.addEventListener("abort", abort, { once: true });
  const writing = (async () => {
    const entries = new Map<string, string>([[`${image.config}.json`, image.config], ...image.layers.map((layer): [string, string] => [`layers/${layer}/layer.tar`, layer])]);
    for (const [name, id] of entries) {
      signal?.throwIfAborted(); const blob = declared.get(id); if (!blob || !/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > WORK_PACKAGE_LIMITS.packageBytes) invalid();
      const hash = createHash("sha256"); let size = 0;
      async function* checked() {
        for await (const chunk of store.read(id)) { signal?.throwIfAborted(); size += chunk.byteLength; if (size > blob!.size) invalid(); hash.update(chunk); yield chunk; }
        if (size !== blob!.size || hash.digest("hex") !== id) invalid();
      }
      await pipeline(Readable.from(checked(), { objectMode: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }), pack.entry({ name, size: blob.size, mode: 0o600, mtime: new Date(0) }), { signal });
    }
    const manifest = encodeWorkJson([{ Config: `${image.config}.json`, RepoTags: [], Layers: image.layers.map((id) => `layers/${id}/layer.tar`) }]);
    await new Promise<void>((resolve, reject) => pack.entry({ name: "manifest.json", size: manifest.length, mode: 0o600, mtime: new Date(0) }, manifest, (error) => error ? reject(error) : resolve()));
    pack.finalize();
  })();
  void writing.catch((error: Error) => pack.destroy(error));
  try { for await (const chunk of pack) { signal?.throwIfAborted(); yield chunk; } await writing; }
  finally { signal?.removeEventListener("abort", abort); pack.destroy(); await writing.catch(() => undefined); }
}
