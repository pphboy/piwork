import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENTS_MD_MAX_BYTES, WorkPackageValidationError, validatePortableWorkSpec, validateWorkHistory,
  type PortableWorkSpec, type WorkBlob, type WorkBlobKind,
} from "@piwork/contracts";
import { parseWorkJson, encodeWorkJson } from "./json.js";
import { validateWorkTree, type WorkTree } from "./tree.js";
import { validatePiPackageContentDigests, validatePiPackageWorkTree } from "./package-tree.js";
import { WorkBlobDirectory } from "./blob-directory.js";
import { WORK_PACKAGE_LIMITS, type WorkPackageLimits } from "./limits.js";

export const WORK_PACKAGE_MAGIC = Buffer.from("PIWORK1\n", "ascii");
const metadataKinds = new Set<WorkBlobKind>(["tree", "control-history", "identity-map", "image-config"]);
export interface PackageReadOptions {
  readonly signal?: AbortSignal;
  readonly limits?: WorkPackageLimits;
  /** Called serially; must consume the iterable. Data is provisional until readWorkPackage resolves. */
  readonly onBlob?: (blob: WorkBlob, chunks: AsyncIterable<Uint8Array>) => Promise<void>;
}
export interface VerifiedWorkPackage {
  readonly spec: PortableWorkSpec;
  readonly digest: string;
  readonly size: number;
  readonly restoredBytes: number;
  readonly entryCount: number;
  readonly metadata: ReadonlyMap<string, unknown>;
}
function invalid(field: string): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }
function limit(field: string): never { throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", field); }

class ByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private buffer: Uint8Array = new Uint8Array();
  private offset = 0;
  private ended = false;
  readonly hash = createHash("sha256");
  size = 0;
  constructor(source: AsyncIterable<Uint8Array>, private readonly signal?: AbortSignal) { this.iterator = source[Symbol.asyncIterator](); }
  private async next(): Promise<boolean> {
    this.signal?.throwIfAborted();
    while (this.offset === this.buffer.byteLength && !this.ended) {
      let listener: (() => void) | undefined;
      try {
        const next = this.iterator.next();
        const result = this.signal === undefined ? await next : await Promise.race([
          next, new Promise<never>((_, reject) => {
            listener = () => reject(this.signal!.reason);
            this.signal!.addEventListener("abort", listener, { once: true });
            if (this.signal!.aborted) listener();
          }),
        ]);
        this.ended = result.done === true;
        this.buffer = this.ended ? new Uint8Array() : result.value;
        if (!(this.buffer instanceof Uint8Array)) invalid("stream");
        this.offset = 0;
      } finally { if (listener !== undefined) this.signal!.removeEventListener("abort", listener); }
    }
    return !this.ended;
  }
  async *take(length: number): AsyncGenerator<Uint8Array> {
    while (length > 0) {
      if (!await this.next()) invalid("truncated");
      const count = Math.min(length, this.buffer.byteLength - this.offset, WORK_PACKAGE_LIMITS.streamChunkBytes);
      const chunk = this.buffer.subarray(this.offset, this.offset + count);
      this.offset += count; length -= count; this.size += count; this.hash.update(chunk);
      yield chunk;
    }
  }
  async bytes(length: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.take(length)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks, length);
  }
  async eof(): Promise<void> { if (await this.next()) invalid("trailingBytes"); }
  close(): void {
    // Do not await a malicious or indefinitely pending upstream iterator.
    try { void Promise.resolve(this.iterator.return?.()).catch(() => undefined); } catch { /* preserve primary failure */ }
  }
}

export async function readWorkPackage(source: AsyncIterable<Uint8Array>, options: PackageReadOptions = {}): Promise<VerifiedWorkPackage> {
  const limits = options.limits ?? WORK_PACKAGE_LIMITS;
  const reader = new ByteReader(source, options.signal);
  try {
    if (!(await reader.bytes(8)).equals(WORK_PACKAGE_MAGIC)) invalid("magic");
    const manifestLength = (await reader.bytes(8)).readBigUInt64BE();
    if (manifestLength > BigInt(limits.metadataBytes)) limit("manifest");
    const spec = validatePortableWorkSpec(parseWorkJson(await reader.bytes(Number(manifestLength))));
    let expectedSize = 16 + Number(manifestLength), metadataBytes = Number(manifestLength);
    const agents = new Set(spec.contexts.map((context) => context.agentsBlob));
    for (const blob of spec.blobs) {
      expectedSize += blob.size;
      if (!Number.isSafeInteger(expectedSize) || expectedSize > limits.packageBytes) limit("packageBytes");
      if (blob.kinds.some((kind) => metadataKinds.has(kind)) || agents.has(blob.digest)) {
        if (blob.size > limits.metadataBytes) limit("metadata");
        metadataBytes += blob.size;
        if (metadataBytes > limits.totalMetadataBytes) limit("totalMetadataBytes");
      }
      if (agents.has(blob.digest) && blob.size > AGENTS_MD_MAX_BYTES) limit("agentsMd");
    }
    if (expectedSize > limits.packageBytes) limit("packageBytes");
    const metadata = new Map<string, unknown>();
    for (const blob of spec.blobs) {
      const hash = createHash("sha256");
      const collect = blob.kinds.some((kind) => metadataKinds.has(kind)) || agents.has(blob.digest);
      const buffers: Buffer[] = [];
      let consumed = 0;
      const chunks = (async function* () {
        for await (const chunk of reader.take(blob.size)) {
          hash.update(chunk); consumed += chunk.byteLength;
          if (collect) buffers.push(Buffer.from(chunk));
          yield chunk;
        }
      })();
      if (options.onBlob) await options.onBlob(blob, chunks);
      else for await (const _ of chunks) { /* fully hash without buffering content */ }
      if (consumed !== blob.size) invalid("unconsumedBlob");
      if (hash.digest("hex") !== blob.digest) invalid("blobHash");
      if (collect) {
        const bytes = Buffer.concat(buffers, blob.size);
        if (agents.has(blob.digest)) {
          try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { invalid("agentsUtf8"); }
        }
        if (blob.kinds.some((kind) => metadataKinds.has(kind))) metadata.set(blob.digest, parseWorkJson(bytes));
      }
    }
    await reader.eof();
    const { restoredBytes, entryCount } = validatePackageContents(spec, metadata, limits);
    return { spec, digest: reader.hash.digest("hex"), size: reader.size, restoredBytes, entryCount, metadata };
  } finally { reader.close(); }
}

export function validatePackageContents(spec: PortableWorkSpec, metadata: ReadonlyMap<string, unknown>, limits: WorkPackageLimits = WORK_PACKAGE_LIMITS): { restoredBytes: number; entryCount: number } {
  const blobs = new Map(spec.blobs.map((blob) => [blob.digest, blob]));
  const referenced = new Map<string, Set<WorkBlobKind>>();
  const use = (digest: string, kind: WorkBlobKind) => {
    const kinds = referenced.get(digest) ?? new Set<WorkBlobKind>(); kinds.add(kind); referenced.set(digest, kinds);
  };
  let restoredBytes = 0, entryCount = 0;
  const trees = new Map<string, { tree: WorkTree; fileBytes: number }>();
  const useTree = (digest: string) => {
    use(digest, "tree");
    let tree = trees.get(digest);
    if (tree === undefined) { tree = validateWorkTree(metadata.get(digest), blobs, limits); trees.set(digest, tree); }
    restoredBytes += tree.fileBytes; entryCount += tree.tree.entries.length;
    if (entryCount > limits.entries) limit("entries");
    if (!Number.isSafeInteger(restoredBytes) || restoredBytes > limits.restoredBytes) limit("restoredBytes");
    for (const entry of tree.tree.entries) if (entry.type === "file") use(entry.blob, "file");
  };
  for (const volume of spec.volumes) useTree(volume.tree);
  for (const context of spec.contexts) {
    useTree(context.skillsTree); use(context.agentsBlob, "file");
    restoredBytes += blobs.get(context.agentsBlob)!.size;
    for (const binding of context.packageBindings) {
      const artifact = spec.piPackageArtifacts.find((item) => item.key === binding.artifactKey);
      if (!artifact) invalid("piPackageArtifacts.binding");
      useTree(artifact.treeDigest);
      validatePiPackageWorkTree(trees.get(artifact.treeDigest)!.tree, artifact.resourceInventory);
    }
  }
  use(spec.history.control, "control-history"); use(spec.history.sourceIdentityMap, "identity-map");
  validateWorkHistory(spec, metadata.get(spec.history.control), metadata.get(spec.history.sourceIdentityMap));
  const usedImages = new Set(spec.contexts.map((context) => context.imageKey));
  for (const service of spec.services) for (const entry of service.revisions) if (entry.imageKey !== null) usedImages.add(entry.imageKey);
  const layers = new Set<string>();
  for (const image of spec.images) {
    if (!usedImages.has(image.key)) invalid("unusedImage");
    use(image.config, "image-config");
    const config = metadata.get(image.config) as { os?: unknown; architecture?: unknown; variant?: unknown; rootfs?: { type?: unknown; diff_ids?: unknown } } | null | undefined;
    if (!config || typeof config !== "object" || Array.isArray(config) || config.os !== image.platform.os || config.architecture !== image.platform.architecture
      || (config.variant ?? null) !== image.platform.variant || config.rootfs?.type !== "layers" || !Array.isArray(config.rootfs.diff_ids)
      || config.rootfs.diff_ids.length !== image.layers.length || config.rootfs.diff_ids.some((value, i) => value !== `sha256:${image.layers[i]}`)) invalid("image.config");
    for (const layer of image.layers) { use(layer, "image-layer"); layers.add(layer); }
  }
  for (const layer of layers) restoredBytes += blobs.get(layer)!.size;
  if (!Number.isSafeInteger(restoredBytes) || restoredBytes > limits.restoredBytes) limit("restoredBytes");
  for (const blob of spec.blobs) {
    const kinds = referenced.get(blob.digest);
    if (!kinds || blob.kinds.length !== kinds.size || blob.kinds.some((kind) => !kinds.has(kind))) invalid("blobClosure");
  }
  return { restoredBytes, entryCount };
}

/** Hashes the source again while writing; it never trusts a spool filename alone. */
export async function* encodeWorkPackage(spec: PortableWorkSpec, openBlob: (blob: WorkBlob) => AsyncIterable<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  validatePortableWorkSpec(spec);
  const manifest = encodeWorkJson(spec), header = Buffer.alloc(16);
  WORK_PACKAGE_MAGIC.copy(header); header.writeBigUInt64BE(BigInt(manifest.length), 8);
  if (spec.blobs.reduce((size, blob) => size + blob.size, header.length + manifest.length) > WORK_PACKAGE_LIMITS.packageBytes) limit("packageBytes");
  signal?.throwIfAborted(); yield header;
  for (let offset = 0; offset < manifest.length; offset += WORK_PACKAGE_LIMITS.streamChunkBytes) yield manifest.subarray(offset, offset + WORK_PACKAGE_LIMITS.streamChunkBytes);
  for (const blob of spec.blobs) {
    const hash = createHash("sha256"); let size = 0;
    for await (const input of openBlob(blob)) {
      signal?.throwIfAborted();
      size += input.byteLength;
      if (size > blob.size) invalid("blobLength");
      hash.update(input);
      for (let offset = 0; offset < input.byteLength; offset += WORK_PACKAGE_LIMITS.streamChunkBytes) yield input.subarray(offset, offset + WORK_PACKAGE_LIMITS.streamChunkBytes);
    }
    if (size !== blob.size || hash.digest("hex") !== blob.digest) invalid("blobHash");
  }
}

/** Only explicitly selected metadata is public; no file paths, names, env or history. */
export async function inspectWorkPackage(source: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
  const directory = await mkdtemp(join(tmpdir(), "piwork-work-inspect-"));
  try {
  const blobs = new WorkBlobDirectory(directory);
  const result = await readWorkPackage(source, { signal, onBlob: async (blob, chunks) => {
    const staged = await blobs.put(chunks, blob.size, signal);
    if (staged.digest !== blob.digest || staged.size !== blob.size) invalid("blobHash");
  } });
  await validatePiPackageContentDigests(result.spec, result.metadata, (digest) => blobs.read(digest));
  return {
    formatVersion: result.spec.formatVersion, snapshotKind: result.spec.snapshotKind,
    platform: result.spec.compatibility, digest: result.digest, size: result.size,
    restoredBytes: result.restoredBytes,
    counts: { contexts: result.spec.contexts.length, services: result.spec.services.length, images: result.spec.images.length,
      packages: result.spec.piPackageArtifacts.length, entries: result.entryCount, blobs: result.spec.blobs.length },
    packages: result.spec.piPackageArtifacts.map((item) => ({ name: item.name, version: item.version }))
      .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)) || Buffer.compare(Buffer.from(a.version ?? ""), Buffer.from(b.version ?? ""))),
    bindingRequirements: { models: result.spec.bindings.models.map((model) => ({ ...model })), secrets: result.spec.bindings.secrets.map((secret) => ({ key: secret.key })) },
    integrityVerified: true as const, installationValidated: false as const,
    warning: "This package contains complete private Work content and may include credentials. Import does not execute it.",
  };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
