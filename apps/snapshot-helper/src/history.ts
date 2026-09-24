import { constants } from "node:fs";
import { open, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { WorkBlobDirectory, WORK_PACKAGE_LIMITS, decodeWorkPath, parseWorkJson, readWorkPackage, validateWorkTree,
  type VerifiedWorkPackage, type WorkTreeEntry } from "@piwork/work-package";
import { WorkHistorySnapshot } from "@piwork/work-store";

function invalid(): never { throw Object.assign(new Error("Invalid snapshot history"), { code: "SNAPSHOT_HISTORY_INVALID" }); }
async function request(spool: string): Promise<{ sourceWorkId: string; contextIds: string[]; targetWorkId?: string; contexts?: Array<{ sourceId: string; targetId: string }> }> {
  const file = await open(join(spool, "history-request.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > WORK_PACKAGE_LIMITS.metadataBytes) invalid();
    const value = parseWorkJson(await file.readFile()) as Record<string, unknown>;
    const identifier = (id: unknown) => typeof id === "string" && /^[a-zA-Z0-9-]{16,128}$/.test(id);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["sourceWorkId", "contextIds", "targetWorkId", "contexts"].includes(key))
      || !identifier(value.sourceWorkId) || !Array.isArray(value.contextIds) || !value.contextIds.every(identifier) || new Set(value.contextIds).size !== value.contextIds.length) invalid();
    if (value.targetWorkId !== undefined && !identifier(value.targetWorkId)) invalid();
    if (value.contexts !== undefined && (!Array.isArray(value.contexts) || !value.contexts.every((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const row = entry as Record<string, unknown>;
      return Object.keys(row).length === 2 && identifier(row.sourceId) && identifier(row.targetId);
    }))) invalid();
    return value as Awaited<ReturnType<typeof request>>;
  } finally { await file.close(); }
}

export async function verifyVolumeHistory(volume: string, spool: string, restore: boolean): Promise<unknown> {
  const input = await request(spool);
  const history = WorkHistorySnapshot.open(volume, { sourceWorkId: input.sourceWorkId, contextIds: new Set(input.contextIds), scratchDirectory: spool });
  try {
    if (restore) {
      if (!input.targetWorkId || !input.contexts) invalid();
      history?.rebuild(volume, input.targetWorkId, new Map(input.contexts.map((entry) => [entry.sourceId, entry.targetId])));
    }
    return { historyPresent: history !== undefined, ...(history?.summary ?? { sessions: 0, runs: 0, events: 0 }) };
  } finally { history?.close(); }
}

/** Materialize only the managed SQLite group for inspection, proving SDK locators against the full tree.
 * All user data remains in the original package; no business DB or SDK JSONL is interpreted. */
export async function verifyPackageHistory(verified: VerifiedWorkPackage, store: WorkBlobDirectory, spool: string): Promise<void> {
  const identity = verified.metadata.get(verified.spec.history.sourceIdentityMap) as { sourceWorkId: string; contexts: Array<{ sourceId: string }> };
  const tree = verified.metadata.get(verified.spec.volumes[0].tree);
  const { paths } = validateWorkTree(tree, new Map(verified.spec.blobs.map((blob) => [blob.digest, blob])));
  const lookup = (path: string): WorkTreeEntry | undefined => paths.get(Buffer.from(path).toString("base64"));
  const regular = (entry: WorkTreeEntry | undefined) => entry?.type === "hardlink" ? paths.get(decodeWorkPath(entry.targetSegmentsBase64).toString("base64")) : entry;
  const main = regular(lookup("work.sqlite"));
  if (main === undefined && (lookup("work.sqlite-wal") !== undefined || lookup("work.sqlite-shm") !== undefined || verified.spec.activeContext !== null)) invalid();
  const temporary = await mkdtemp(join(spool, "verify-history-"));
  try {
    for (const name of ["work.sqlite", "work.sqlite-wal", "work.sqlite-shm"]) {
      const entry = regular(lookup(name)); if (!entry) continue;
      if (entry.type !== "file") invalid();
      const file = await open(join(temporary, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const hash = createHash("sha256"); let size = 0;
        for await (const chunk of store.read(entry.blob)) {
          hash.update(chunk); size += chunk.length; if (size > entry.size) invalid();
          for (let offset = 0; offset < chunk.length;) { const result = await file.write(chunk, offset); if (!result.bytesWritten) invalid(); offset += result.bytesWritten; }
        }
        if (size !== entry.size || hash.digest("hex") !== entry.blob) invalid();
        await file.sync();
      } finally { await file.close(); }
    }
    const history = WorkHistorySnapshot.open(temporary, { sourceWorkId: identity.sourceWorkId, contextIds: new Set(identity.contexts.map((entry) => entry.sourceId)), scratchDirectory: spool,
      sdkPathIsRegular: (path) => {
        if (!path.startsWith("/var/data/sessions/")) return false;
        const relative = path.slice("/var/data/".length), parts = relative.split("/");
        if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return false;
        return regular(lookup(relative))?.type === "file";
      },
    });
    history?.close();
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function verifyUploadedPackage(spool: string, signal?: AbortSignal): Promise<unknown> {
  const blobs = join(spool, "blobs"); await mkdir(blobs, { mode: 0o700 });
  const store = new WorkBlobDirectory(blobs);
  const file = await open(join(spool, "package.work"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) invalid();
    const verified = await readWorkPackage(file.createReadStream({ autoClose: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }), {
      signal, onBlob: async (blob, chunks) => { const stored = await store.put(chunks, blob.size, signal); if (stored.digest !== blob.digest || stored.size !== blob.size) invalid(); },
    });
    await verifyPackageHistory(verified, store, spool);
    return { digest: verified.digest, size: verified.size, bindingRequirements: verified.spec.bindings };
  } finally { await file.close(); }
}
