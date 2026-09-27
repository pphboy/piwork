import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { WORK_BLOB_KINDS, WorkPackageValidationError, type PortableWorkSpec, type WorkBlobKind } from "@piwork/contracts";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { WorkBlobDirectory, encodeWorkJson, encodeWorkPackage, parseWorkJson, readWorkPackage,
  validatePiPackageContentDigests, type NormalizedImage, type VerifiedWorkPackage, WORK_PACKAGE_LIMITS } from "@piwork/work-package";
import type { SnapshotHelperSpec } from "@piwork/runtime-docker";
import type { WorkSnapshotMetadata } from "./metadata.js";
import { captureOwnedPackageTree, captureOwnedSkillTree } from "./owned-tree.js";

export interface SnapshotCaptureRuntime {
  createSnapshotHelper(spec: SnapshotHelperSpec): Promise<string>;
  startSnapshotHelper(name: string, jobId: string, signal?: AbortSignal): Promise<unknown>;
  removeSnapshotHelper(name: string, jobId: string): Promise<void>;
  saveCapturedImage(imageId: string, store: WorkBlobDirectory, signal?: AbortSignal): Promise<NormalizedImage>;
}
export interface CapturedPackage { readonly stagingPath: string; readonly verified: VerifiedWorkPackage }
function invalid(field: string): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }
function helperResult(value: unknown): { tree: string; size: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("helper.result");
  const row = value as Record<string, unknown>;
  if (typeof row.tree !== "string" || !/^[a-f0-9]{64}$/.test(row.tree) || !Number.isSafeInteger(row.size) || (row.size as number) < 0) invalid("helper.result");
  return { tree: row.tree, size: row.size as number };
}
async function readMetadata(blobs: WorkBlobDirectory, digest: string): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of blobs.read(digest)) {
    size += chunk.length; if (size > WORK_PACKAGE_LIMITS.metadataBytes) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "metadata");
    chunks.push(chunk);
  }
  return parseWorkJson(Buffer.concat(chunks, size));
}
function helperName(jobId: string, kind: string): string {
  return `snapshot-${createHash("sha256").update(jobId).digest("hex").slice(0, 16)}-${kind}`;
}

/** Capture only persistent Work data. This never starts an agent/service container. */
export async function captureWorkPackage(input: {
  readonly metadata: WorkSnapshotMetadata; readonly runtime: SnapshotCaptureRuntime;
  readonly installationId: string; readonly jobId: string; readonly helperImageId: string;
  readonly spoolDirectory: string; readonly createdAt: string; readonly signal?: AbortSignal;
  readonly beforeHelper?: (spec: SnapshotHelperSpec) => void;
}): Promise<CapturedPackage> {
  const { metadata, runtime, installationId, jobId, helperImageId, spoolDirectory, createdAt, signal } = input;
  await mkdir(spoolDirectory, { recursive: true, mode: 0o700 });
  const blobs = new WorkBlobDirectory(spoolDirectory);
  const descriptors = new Map<string, { size: number; kinds: Set<WorkBlobKind> }>();
  const add = (digest: string, size: number, kind: WorkBlobKind) => {
    if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(size) || size < 0) invalid("blob");
    const previous = descriptors.get(digest);
    if (previous && previous.size !== size) invalid("blob.size");
    const record = previous ?? { size, kinds: new Set<WorkBlobKind>() };
    record.kinds.add(kind); descriptors.set(digest, record);
  };
  const put = async (value: Buffer, kind: WorkBlobKind) => {
    const result = await blobs.put(Readable.from([value]), value.length, signal);
    add(result.digest, result.size, kind);
    return result.digest;
  };
  const tree = async (digest: string, size: number) => {
    add(digest, size, "tree");
    const parsed = await readMetadata(blobs, digest);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { entries?: unknown }).entries)) invalid("tree");
    for (const entry of (parsed as { entries: unknown[] }).entries) {
      if (entry !== null && typeof entry === "object" && (entry as { type?: unknown }).type === "file") {
        const file = entry as { blob?: unknown; size?: unknown };
        if (typeof file.blob !== "string" || typeof file.size !== "number") invalid("tree.file");
        add(file.blob, file.size, "file");
      }
    }
  };
  const runHelper = async (action: SnapshotHelperSpec["action"], volumeName: string, kind: string): Promise<unknown> => {
    const spec: SnapshotHelperSpec = { installationId, jobId, name: helperName(jobId, kind), imageId: helperImageId,
      spoolDirectory, volumeName, action };
    input.beforeHelper?.(spec);
    await runtime.createSnapshotHelper(spec);
    try { return await runtime.startSnapshotHelper(spec.name, jobId, signal); }
    finally { await runtime.removeSnapshotHelper(spec.name, jobId); }
  };
  const privateVolume = metadata.volumes.find((volume) => volume.role === "agent-private");
  const workspaceVolume = metadata.volumes.find((volume) => volume.role === "workspace");
  if (!privateVolume || !workspaceVolume || metadata.volumes.length !== 2) invalid("volumes");
  const historyRequest = join(spoolDirectory, "history-request.json");
  const historyFile = await open(historyRequest, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await historyFile.writeFile(encodeWorkJson({ sourceWorkId: metadata.work.id, contextIds: metadata.identities.contexts.map((context) => context.sourceId) }));
    await historyFile.sync();
  } finally { await historyFile.close(); }
  const history = await runHelper("verify-history", privateVolume.record.runtimeName, "verify-history") as { historyPresent?: unknown } | null;
  if (!history || typeof history.historyPresent !== "boolean" || (metadata.activeContext !== null && !history.historyPresent)) invalid("history.private");
  const volumeTrees = new Map<string, string>();
  for (const volume of [privateVolume, workspaceVolume]) {
    signal?.throwIfAborted();
    const result = helperResult(await runHelper("capture", volume.record.runtimeName, volume.role));
    await tree(result.tree, result.size); volumeTrees.set(volume.role, result.tree);
  }
  const contexts: PortableWorkSpec["contexts"] = [];
  const piPackageArtifacts = new Map<string, PortableWorkSpec["piPackageArtifacts"][number]>();
  for (const source of metadata.contexts) {
    signal?.throwIfAborted();
    const skillRoot = join(source.snapshot.directory, "skills");
    const captured = await captureOwnedSkillTree(skillRoot, blobs, signal);
    await tree(captured.digest, captured.size);
    const agentsBlob = await put(Buffer.from(source.snapshot.configuration.agentsMd, "utf8"), "file");
    const packageBindings: PortableWorkSpec["contexts"][number]["packageBindings"] = [];
    for (const binding of source.snapshot.metadata.packageBindings) {
      const packageRoot = join(source.snapshot.directory, "packages", binding.nameKey);
      const verified = await validatePiPackageArtifact({ root: packageRoot, sourceKind: binding.artifact.sourceKind,
        resolvedSource: binding.artifact.resolvedSource, preparedEnvironment: binding.artifact.preparedEnvironment,
        expectedDigest: binding.artifact.contentDigest });
      if (verified.metadata.name !== binding.name || verified.metadata.version !== binding.artifact.version
        || (["extensions", "skills", "prompts", "themes"] as const).some((kind) =>
          verified.metadata.resourceCounts[kind] !== binding.artifact.resourceCounts[kind])) invalid("context.packageBinding");
      const previous = piPackageArtifacts.get(binding.artifact.contentDigest);
      if (previous !== undefined) {
        if (previous.name !== binding.name || previous.version !== binding.artifact.version
          || (["os", "architecture", "variant", "nodeAbi", "piSdkVersion"] as const).some((field) =>
            previous.preparedEnvironment[field] !== binding.artifact.preparedEnvironment[field])) invalid("piPackageArtifacts.collision");
        packageBindings.push({ name: binding.name, artifactKey: binding.artifact.contentDigest });
        continue;
      }
      const capturedPackage = await captureOwnedPackageTree(packageRoot, blobs, signal);
      await tree(capturedPackage.digest, capturedPackage.size);
      piPackageArtifacts.set(binding.artifact.contentDigest, { key: binding.artifact.contentDigest,
        ...binding.artifact, treeDigest: capturedPackage.digest,
        resourceInventory: { extensions: [...verified.inventory.extensions], skills: [...verified.inventory.skills],
          prompts: [...verified.inventory.prompts], themes: [...verified.inventory.themes] } });
      packageBindings.push({ name: binding.name, artifactKey: binding.artifact.contentDigest });
    }
    contexts.push({ key: source.key, createdAt: source.snapshot.metadata.createdAt, configuration: source.configuration,
      imageKey: source.imageKey, skillsTree: captured.digest, agentsBlob, packageBindings });
  }
  const images: PortableWorkSpec["images"] = [];
  let platform: PortableWorkSpec["compatibility"] | undefined;
  for (const source of metadata.images) {
    signal?.throwIfAborted();
    const normalized = await runtime.saveCapturedImage(source.imageId, blobs, signal);
    if (normalized.image.imageId !== source.imageId) invalid("image.identity");
    const image = { key: source.key, ...normalized.image };
    images.push(image);
    platform ??= { ...image.platform, agentProtocol: "v2", workHistorySchema: 3, storageLayout: 2, piPackageContract: 1 };
    for (const [digest, kind] of [[image.config, "image-config"], ...image.layers.map((layer) => [layer, "image-layer"])] as Array<[string, WorkBlobKind]>) {
      const blob = normalized.blobs.find((item) => item.digest === digest);
      if (!blob) invalid("image.blob");
      add(blob.digest, blob.size, kind);
    }
  }
  if (!platform) invalid("images");
  const control = await put(encodeWorkJson(metadata.history), "control-history");
  const sourceIdentityMap = await put(encodeWorkJson(metadata.identities), "identity-map");
  const spec: PortableWorkSpec = {
    formatVersion: 1, snapshotKind: "cold-full", createdAt, sourceName: metadata.work.name, compatibility: platform,
    activeContext: metadata.activeContext, desiredContext: metadata.desiredContext,
    contexts, piPackageArtifacts: [...piPackageArtifacts.values()].sort((a, b) => a.key.localeCompare(b.key)),
    services: metadata.services, quotaReservations: metadata.quotaReservations,
    volumes: [{ role: "agent-private", tree: volumeTrees.get("agent-private")!, serviceRefKeys: [] },
      { role: "workspace", tree: volumeTrees.get("workspace")!, serviceRefKeys: workspaceVolume.serviceRefKeys }],
    images, bindings: metadata.bindings, history: { control, sourceIdentityMap },
    blobs: [...descriptors].sort(([a], [b]) => a.localeCompare(b)).map(([digest, value]) => ({ digest, size: value.size,
      kinds: WORK_BLOB_KINDS.filter((kind) => value.kinds.has(kind)) })),
  };
  const stagingPath = join(spoolDirectory, "package.work");
  const file = await open(stagingPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    for await (const chunk of encodeWorkPackage(spec, (blob) => blobs.read(blob.digest), signal)) {
      for (let offset = 0; offset < chunk.length;) {
        const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
        if (bytesWritten === 0) invalid("package.write");
        offset += bytesWritten;
      }
    }
    await file.sync();
  } finally { await file.close(); }
  const verified = await readWorkPackage(createReadStream(stagingPath, { highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }), { signal });
  await validatePiPackageContentDigests(verified.spec, verified.metadata, (digest) => blobs.read(digest));
  const onDisk = await stat(stagingPath);
  if (verified.size !== onDisk.size) invalid("package.size");
  return { stagingPath, verified };
}
