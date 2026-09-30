import { randomBytes, randomUUID, createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, statfs, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PiworkApiError } from "@piwork/client-sdk";
import { WORK_PACKAGE_MIME, WorkPackageValidationError } from "@piwork/contracts";
import { inspectWorkPackage, WORK_PACKAGE_LIMITS } from "@piwork/work-package";
import Busboy from "busboy";
import { PI_PACKAGE_LIMITS, PiPackageInputError, stagePiPackageUpload } from "@piwork/pi-package";
import { DesktopIdentity } from "./identity.js";
import type { LocalSession } from "./session.js";

const transferLifetime = 60 * 60_000;
const storageLimit = 200 * 1024 ** 3;
const reserveBytes = 1024 ** 3;
const transferIdleMs = 60_000;
type Job = { id: string; path: string; kind: "inspect" | "download"; sessionId: string; createdAt: number;
  digest: string; size: number; summary: unknown; generation?: number; userId?: string; workId?: string; snapshotId?: string;
  inspectEpoch?: number;
  dev?: number; ino?: number; mtimeMs?: number;
  phase?: string; importing?: boolean; importAttempted?: boolean; importAccepted?: Record<string, unknown> };
type ActiveTransfer = { sessionId: string; kind: Job["kind"]; phase: string; transferred: number; total?: number;
  generation?: number; userId?: string; inspectEpoch?: number; cancel?: () => void };

function fail(status: number, code: string, message: string): never { throw new PiworkApiError(status, code, message); }
function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  response.end(JSON.stringify(value));
}

export class DesktopTransfers {
  private directory?: string;
  private directoryPromise?: Promise<string>;
  private readonly jobs = new Map<string, Job>();
  private readonly active = new Map<string, ActiveTransfer>();
  private readonly claimed = new Set<string>();
  private busy = 0;
  private pendingBytes = 0;
  private readonly activeReservations = new Map<string, number>();
  private inspectEpoch = 0;
  private readonly sweep: NodeJS.Timeout;

  constructor(private readonly credentialPath: string, private readonly identity: DesktopIdentity) {
    identity.onRevoked(({ reason, hadContent }) => {
      if (reason === "login" && !hadContent) void this.clearDownloads();
      else { this.inspectEpoch++; void this.clearTransfers(); }
    });
    this.sweep = setInterval(() => { void this.expire(); }, 60_000);
    this.sweep.unref();
  }

  private async ensureDirectory(): Promise<string> {
    if (this.directory) return this.directory;
    if (this.directoryPromise) return this.directoryPromise;
    this.directoryPromise = this.createDirectory();
    try { return await this.directoryPromise; }
    finally { this.directoryPromise = undefined; }
  }

  private async createDirectory(): Promise<string> {
    const parent = resolve(dirname(this.credentialPath), "desktop-transfers");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent)
      fail(500, "TRANSFER_STORAGE_INVALID", "Transfer directory is unsafe");
    await chmod(parent, 0o700);
    for (const entry of await readdir(parent)) {
      const match = /^instance-(\d+)-[A-Za-z0-9_-]+$/.exec(entry);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue;
      let exited = false;
      try { process.kill(pid, 0); }
      catch (error) { exited = (error as NodeJS.ErrnoException).code === "ESRCH"; }
      if (!exited) continue;
      const stale = join(parent, entry);
      const state = await lstat(stale).catch(() => undefined);
      if (state?.isDirectory() && !state.isSymbolicLink()) await rm(stale, { recursive: true, force: true });
    }
    this.directory = await mkdtemp(join(parent, `instance-${process.pid}-`));
    await chmod(this.directory, 0o700);
    return this.directory;
  }

  private reservedBytes(): number {
    return [...this.activeReservations.values()].reduce((total, value) => total + value, 0);
  }

  private async begin(expected?: number): Promise<{ path: string; reservation: string; file: Awaited<ReturnType<typeof open>> }> {
    if (this.busy >= 2) fail(429, "TRANSFER_BUSY", "Two transfers are already active");
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1 || expected > WORK_PACKAGE_LIMITS.packageBytes))
      fail(413, "PACKAGE_LIMIT_EXCEEDED", "Package size is outside the allowed range");
    if (this.pendingBytes + this.reservedBytes() + (expected ?? 0) > storageLimit)
      fail(507, "TRANSFER_STORAGE_FULL", "Transfer storage limit reached");
    const reservation = randomUUID();
    this.busy++;
    this.activeReservations.set(reservation, expected ?? 0);
    try {
      const directory = await this.ensureDirectory();
      const space = await statfs(directory);
      const free = Number(space.bavail) * Number(space.bsize);
      if (free < reserveBytes + Math.min(expected ?? 0, WORK_PACKAGE_LIMITS.packageBytes))
        fail(507, "TRANSFER_STORAGE_FULL", "Not enough local free space for the package");
      const path = join(directory, randomBytes(24).toString("hex"));
      return { path, reservation, file: await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600) };
    } catch (error) { this.activeReservations.delete(reservation); this.busy--; throw error; }
  }

  private async write(source: AsyncIterable<Uint8Array>, file: Awaited<ReturnType<typeof open>>,
    reservation: string, expected?: number, onProgress?: (size: number) => void): Promise<{ digest: string; size: number }> {
    const hash = createHash("sha256"); let size = 0;
    for await (const piece of source) {
      const chunk = Buffer.from(piece);
      size += chunk.length;
      const reserved = this.activeReservations.get(reservation) ?? 0;
      const nextReservation = Math.max(reserved, size);
      if (size > WORK_PACKAGE_LIMITS.packageBytes || this.pendingBytes + this.reservedBytes() - reserved + nextReservation > storageLimit
        || expected !== undefined && size > expected)
        fail(413, "PACKAGE_LIMIT_EXCEEDED", "Package exceeded its declared or allowed size");
      this.activeReservations.set(reservation, nextReservation);
      hash.update(chunk);
      for (let offset = 0; offset < chunk.length;) {
        const result = await file.write(chunk, offset, chunk.length - offset);
        if (!result.bytesWritten) fail(507, "TRANSFER_STORAGE_FULL", "Package write failed");
        offset += result.bytesWritten;
      }
      onProgress?.(size);
    }
    if (expected !== undefined && size !== expected) fail(400, "PACKAGE_LENGTH_MISMATCH", "Package length changed during transfer");
    await file.sync();
    return { digest: hash.digest("hex"), size };
  }

  async receive(request: IncomingMessage, response: ServerResponse, session: LocalSession): Promise<void> {
    const inspectEpoch = this.inspectEpoch;
    if (request.headers["content-type"] !== WORK_PACKAGE_MIME) fail(415, "PACKAGE_MIME_REQUIRED", "Select a .work package");
    request.setTimeout(transferIdleMs, () => request.destroy(new Error("Transfer idle timeout")));
    const expected = request.headers["content-length"] === undefined ? undefined : Number(request.headers["content-length"]);
    const proposed = request.headers["x-piwork-transfer-id"];
    if (proposed !== undefined && (typeof proposed !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposed)))
      fail(400, "INVALID_TRANSFER", "Invalid transfer ID");
    const id = proposed ?? randomUUID();
    if (this.claimed.has(id) || this.jobs.has(id)) fail(409, "TRANSFER_EXISTS", "Transfer ID is already in use");
    this.claimed.add(id);
    const { path, file, reservation } = await this.begin(expected).catch((error: unknown) => { this.claimed.delete(id); throw error; });
    const active: ActiveTransfer = { sessionId: session.id, kind: "inspect", phase: "receiving", transferred: 0, total: expected,
      inspectEpoch,
      cancel: () => request.destroy(new Error("Transfer cancelled")) };
    this.active.set(id, active);
    try {
      const written = await this.write(request, file, reservation, expected, (size) => { active.transferred = size; });
      await file.close();
      active.phase = "validating";
      const summary = await inspectWorkPackage(createReadStream(path, { highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }));
      if (summary.digest !== written.digest || summary.size !== written.size) fail(400, "PACKAGE_INVALID", "Package failed verification");
      const privateFile = await lstat(path);
      if (!privateFile.isFile() || privateFile.isSymbolicLink() || privateFile.size !== written.size)
        fail(409, "PACKAGE_CHANGED", "Staged package changed");
      if (inspectEpoch !== this.inspectEpoch) fail(409, "CONNECTION_CHANGED", "Local package review was revoked");
      this.jobs.set(id, { id, path, kind: "inspect", sessionId: session.id, createdAt: Date.now(),
        digest: written.digest, size: written.size, summary, phase: "ready",
        inspectEpoch,
        dev: privateFile.dev, ino: privateFile.ino, mtimeMs: privateFile.mtimeMs });
      this.pendingBytes += written.size;
      this.activeReservations.delete(reservation);
      send(response, 200, { transferId: id, summary });
    } catch (error) {
      await file.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      if (error instanceof WorkPackageValidationError) throw new PiworkApiError(error.code === "PACKAGE_LIMIT_EXCEEDED" ? 413 : 400,
        error.code, `Work package validation failed at ${error.field}`);
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw new PiworkApiError(507, "TRANSFER_STORAGE_FULL", "Local storage is full");
      throw error;
    } finally { this.active.delete(id); this.claimed.delete(id); this.activeReservations.delete(reservation); this.busy--; }
  }

  get(id: string, session: LocalSession): Job {
    const job = this.jobs.get(id);
    if (!job || job.sessionId !== session.id || job.createdAt + transferLifetime < Date.now()
      || job.kind === "inspect" && job.inspectEpoch !== this.inspectEpoch) fail(404, "TRANSFER_NOT_FOUND", "Transfer is unavailable");
    return job;
  }

  status(id: string, session: LocalSession, expectedKind: Job["kind"], owner?: { generation: number; userId: string }): Record<string, unknown> {
    const active = this.active.get(id);
    if (active && active.sessionId === session.id && active.kind === expectedKind) {
      if (active.kind === "inspect" && active.inspectEpoch !== this.inspectEpoch)
        fail(404, "TRANSFER_NOT_FOUND", "Transfer is unavailable");
      if (expectedKind === "download" && (!owner || active.generation !== owner.generation || active.userId !== owner.userId))
        fail(401, "AUTH_REQUIRED", "Sign in to the original account to check download");
      return { transferId: id, kind: active.kind,
      phase: active.phase, transferred: active.transferred, total: active.total ?? null };
    }
    const job = this.get(id, session);
    if (job.kind !== expectedKind) fail(404, "TRANSFER_NOT_FOUND", "Transfer is unavailable");
    if (expectedKind === "download" && (!owner || job.generation !== owner.generation || job.userId !== owner.userId))
      fail(401, "AUTH_REQUIRED", "Sign in to the original account to check download");
    return { transferId: job.id, kind: job.kind, phase: job.phase ?? "ready", transferred: job.size,
      total: job.size, size: job.size, digest: job.digest,
      ...(job.kind === "inspect" ? { summary: job.summary } : { workId: job.workId, snapshotId: job.snapshotId, ready: true }) };
  }

  async remove(id: string, session: LocalSession): Promise<void> {
    const active = this.active.get(id);
    if (active && active.sessionId === session.id) { active.cancel?.(); return; }
    const job = this.get(id, session);
    this.jobs.delete(id); this.pendingBytes -= job.size;
    await unlink(job.path).catch(() => undefined);
  }

  async import(id: string, session: LocalSession, name?: string): Promise<Record<string, unknown>> {
    const job = this.get(id, session);
    if (job.kind !== "inspect") fail(400, "INVALID_TRANSFER", "Select an inspected package");
    if (job.importAccepted) return job.importAccepted;
    if (job.importAttempted) fail(409, "IMPORT_RESULT_UNKNOWN", "Import was already submitted; check the original Operation before retrying");
    if (job.importing) fail(409, "IMPORT_IN_PROGRESS", "Import is already in progress");
    if (name !== undefined && (!name.trim() || name.length > 128 || name.includes("\0"))) fail(400, "INVALID_NAME", "Enter a valid Work name");
    const state = await this.identity.view();
    if (state.state !== "authenticated") fail(401, "AUTH_REQUIRED", "Sign in before importing");
    if (job.inspectEpoch !== this.inspectEpoch) fail(409, "CONNECTION_CHANGED", "Local package review was revoked");
    const before = await lstat(job.path);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== job.size || before.dev !== job.dev
      || before.ino !== job.ino || before.mtimeMs !== job.mtimeMs) fail(409, "PACKAGE_CHANGED", "Staged package changed");
    const verified = createHash("sha256");
    let verifiedSize = 0;
    for await (const chunk of createReadStream(job.path, { highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes })) {
      verified.update(chunk); verifiedSize += chunk.length;
      if (verifiedSize > job.size) fail(409, "PACKAGE_CHANGED", "Staged package changed");
    }
    if (verifiedSize !== job.size || verified.digest("hex") !== job.digest) fail(409, "PACKAGE_CHANGED", "Staged package changed");
    job.importing = true;
    job.phase = "uploading";
    try {
    const client = this.identity.client();
    if (state.generation !== this.identity.currentGeneration || job.inspectEpoch !== this.inspectEpoch)
      fail(409, "CONNECTION_CHANGED", "Core connection changed during import");
    const uploaded = await client.uploadWorkPackage(createReadStream(job.path, { highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }), job.digest, job.size);
    const after = await lstat(job.path);
    if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size) fail(409, "PACKAGE_CHANGED", "Staged package changed during upload");
    if (uploaded.digest !== job.digest || uploaded.size !== job.size || state.generation !== this.identity.currentGeneration)
      fail(409, "PACKAGE_CHANGED", "Uploaded package identity changed");
    let accepted: Awaited<ReturnType<typeof client.importWork>>;
    try {
      job.importAttempted = true;
      job.phase = "submitting";
      accepted = await client.importWork({ packageId: uploaded.packageId,
        ...(name === undefined ? {} : { name }), idempotencyKey: randomUUID() });
    } catch (error) {
      if (error instanceof PiworkApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        job.importAttempted = false; job.phase = "ready";
      }
      else job.phase = "unknown";
      throw error;
    }
    job.importAccepted = accepted as unknown as Record<string, unknown>;
    job.phase = "accepted";
    return job.importAccepted;
    } catch (error) {
      if (!job.importAttempted) job.phase = "ready";
      throw error;
    } finally { job.importing = false; }
  }

  async prepareDownload(snapshotId: string, session: LocalSession, proposedId?: string): Promise<Record<string, unknown>> {
    const state = await this.identity.view();
    if (state.state !== "authenticated" || !state.user) fail(401, "AUTH_REQUIRED", "Sign in before downloading");
    const client = this.identity.client();
    const snapshot = await client.workSnapshot(snapshotId);
    if (snapshot.state !== "succeeded" || snapshot.digest === null || snapshot.size === null)
      fail(409, "SNAPSHOT_NOT_READY", "Snapshot is not ready for download");
    if (proposedId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposedId))
      fail(400, "INVALID_TRANSFER", "Invalid transfer ID");
    const id = proposedId ?? randomUUID();
    if (this.claimed.has(id) || this.jobs.has(id)) fail(409, "TRANSFER_EXISTS", "Transfer ID is already in use");
    this.claimed.add(id);
    const { path, file, reservation } = await this.begin(snapshot.size).catch((error: unknown) => { this.claimed.delete(id); throw error; });
    const abort = new AbortController();
    const active: ActiveTransfer = { sessionId: session.id, kind: "download", phase: "downloading", transferred: 0,
      total: snapshot.size, generation: state.generation, userId: state.user.id,
      cancel: () => abort.abort(new Error("Transfer cancelled")) };
    this.active.set(id, active);
    let idle = setTimeout(() => abort.abort(new Error("Transfer idle timeout")), transferIdleMs);
    idle.unref();
    const progress = (size: number) => { active.transferred = size; clearTimeout(idle); idle = setTimeout(() => abort.abort(new Error("Transfer idle timeout")), transferIdleMs); idle.unref(); };
    try {
      const downloaded = await client.downloadWorkSnapshot(snapshotId, { signal: abort.signal });
      if (downloaded.digest !== snapshot.digest || downloaded.size !== snapshot.size) fail(502, "SNAPSHOT_MISMATCH", "Snapshot metadata changed");
      const written = await this.write(downloaded.stream, file, reservation, downloaded.size, progress);
      await file.close();
      active.phase = "validating";
      if (written.digest !== snapshot.digest || state.generation !== this.identity.currentGeneration) fail(502, "SNAPSHOT_MISMATCH", "Snapshot content changed");
      const summary = await inspectWorkPackage(createReadStream(path, { highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }));
      if (summary.digest !== snapshot.digest || summary.size !== snapshot.size) fail(502, "SNAPSHOT_MISMATCH", "Snapshot package is invalid");
      const privateFile = await lstat(path);
      if (!privateFile.isFile() || privateFile.isSymbolicLink() || privateFile.size !== written.size)
        fail(502, "SNAPSHOT_MISMATCH", "Snapshot package changed");
      this.jobs.set(id, { id, path, kind: "download", sessionId: session.id, createdAt: Date.now(),
        digest: written.digest, size: written.size, summary, phase: "ready", generation: state.generation, userId: state.user.id,
        workId: snapshot.workId, snapshotId, dev: privateFile.dev, ino: privateFile.ino, mtimeMs: privateFile.mtimeMs });
      this.pendingBytes += written.size;
      this.activeReservations.delete(reservation);
      return { transferId: id, workId: snapshot.workId, snapshotId, size: written.size, digest: written.digest, ready: true };
    } catch (error) {
      await file.close().catch(() => undefined); await unlink(path).catch(() => undefined);
      if (error instanceof WorkPackageValidationError) throw new PiworkApiError(502, "SNAPSHOT_MISMATCH", "Snapshot package is invalid");
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw new PiworkApiError(507, "TRANSFER_STORAGE_FULL", "Local storage is full");
      throw error;
    } finally { clearTimeout(idle); this.active.delete(id); this.claimed.delete(id); this.activeReservations.delete(reservation); this.busy--; }
  }

  async serveDownload(id: string, session: LocalSession, response: ServerResponse): Promise<void> {
    const job = this.get(id, session);
    if (job.kind !== "download") fail(404, "TRANSFER_NOT_FOUND", "Download is unavailable");
    const state = await this.identity.view();
    if (state.state !== "authenticated" || state.generation !== job.generation || state.user?.id !== job.userId)
      fail(401, "AUTH_REQUIRED", "Sign in to the original account before downloading");
    const file = await open(job.path, constants.O_RDONLY | constants.O_NOFOLLOW)
      .catch(() => fail(409, "PACKAGE_CHANGED", "Verified package is unavailable"));
    const info = await file.stat().catch(async () => { await file.close(); return fail(409, "PACKAGE_CHANGED", "Verified package is unavailable"); });
    if (!info.isFile() || info.dev !== job.dev || info.ino !== job.ino || info.size !== job.size || info.mtimeMs !== job.mtimeMs) {
      await file.close(); fail(409, "PACKAGE_CHANGED", "Verified package changed before download");
    }
    response.writeHead(200, { "content-type": WORK_PACKAGE_MIME, "content-length": job.size,
      "content-disposition": `attachment; filename="${job.workId}.work"`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
    const readable = file.createReadStream({ highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes });
    readable.once("error", () => response.destroy());
    response.once("close", () => readable.destroy());
    readable.pipe(response);
  }

  async uploadPiPackage(request: IncomingMessage, session: LocalSession, workId: string): Promise<Record<string, unknown>> {
    if (!/^multipart\/form-data;\s*boundary=/i.test(String(request.headers["content-type"] ?? "")))
      fail(415, "MULTIPART_REQUIRED", "Select a ZIP or local package directory");
    if (this.busy >= 2) fail(429, "TRANSFER_BUSY", "Two transfers are already active");
    this.busy++;
    try {
    const view = await this.identity.view();
    if (view.state !== "authenticated") fail(401, "AUTH_REQUIRED", "Sign in before uploading a Pi Package");
    const client = this.identity.client();
    await client.work(workId);
    const root = await mkdtemp(join(await this.ensureDirectory(), "pi-package-"));
    await chmod(root, 0o700);
    try {
      const incoming = join(root, "incoming");
      await mkdir(incoming, { mode: 0o700 });
      const parser = Busboy({ headers: request.headers, preservePath: true, defParamCharset: "utf8",
        limits: { fields: 1, files: PI_PACKAGE_LIMITS.entries, parts: PI_PACKAGE_LIMITS.entries + 1,
          fileSize: PI_PACKAGE_LIMITS.compressedBytes, fieldSize: 16, headerPairs: 32 } });
      let kind = "", total = 0, failure: Error | undefined;
      const names: { field: string; path: string }[] = [];
      const seen = new Set<string>();
      const writes: Promise<void>[] = [];
      parser.on("field", (name, value, info) => {
        if (name !== "kind" || kind || info.valueTruncated) failure = new PiworkApiError(400, "INVALID_PACKAGE_SOURCE", "Invalid package source kind");
        else kind = value;
      });
      parser.on("file", (field, stream, info) => {
        const relative = info.filename;
        const parts = relative.split("/");
        if (!relative || relative.startsWith("/") || relative.includes("\\") || relative.includes("\0")
          || parts.some((part) => !part || part === "." || part === "..") || parts.length > PI_PACKAGE_LIMITS.depth
          || Buffer.byteLength(relative) > PI_PACKAGE_LIMITS.pathBytes || seen.has(relative)) {
          failure = new PiworkApiError(400, "PI_PACKAGE_UNSAFE_ARCHIVE", "Unsafe or duplicate package path"); stream.resume(); return;
        }
        seen.add(relative);
        names.push({ field, path: relative });
        const target = join(incoming, ...parts);
        const task = (async () => {
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          const file = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
          try {
            let fileBytes = 0;
            for await (const piece of stream) {
              fileBytes += (piece as Buffer).length;
              total += (piece as Buffer).length;
              if (total > PI_PACKAGE_LIMITS.restoredBytes || fileBytes > (field === "zip" ? PI_PACKAGE_LIMITS.compressedBytes : PI_PACKAGE_LIMITS.fileBytes))
                fail(413, "PI_PACKAGE_LIMIT_EXCEEDED", "Package upload is too large");
              const chunk = piece as Buffer;
              for (let offset = 0; offset < chunk.length;) {
                const written = await file.write(chunk, offset, chunk.length - offset);
                if (!written.bytesWritten) throw new Error("Package upload write failed");
                offset += written.bytesWritten;
              }
            }
            if (stream.truncated) fail(413, "PI_PACKAGE_LIMIT_EXCEEDED", "Package file exceeded its size limit");
          } finally { await file.close(); }
        })().catch((error: unknown) => { failure = error instanceof Error ? error : new Error("Package upload failed"); stream.resume(); });
        writes.push(task);
      });
      for (const event of ["partsLimit", "filesLimit", "fieldsLimit"] as const)
        parser.on(event, () => { failure = new PiworkApiError(413, "PI_PACKAGE_LIMIT_EXCEEDED", "Package upload exceeded its entry limit"); });
      const parsed = new Promise<void>((done, reject) => {
        parser.once("close", done); parser.once("error", reject);
        request.once("aborted", () => parser.destroy(new Error("Upload interrupted")));
      });
      request.pipe(parser);
      await parsed;
      await Promise.all(writes);
      if (failure) throw failure;
      if (kind !== "zip" && kind !== "local") fail(400, "INVALID_PACKAGE_SOURCE", "Choose ZIP or local directory");
      if (!names.length) fail(400, "INVALID_PACKAGE_SOURCE", "No package files were selected");
      let source: { kind: "zip" | "local"; path: string; displayName: string };
      if (kind === "zip") {
        if (names.length !== 1 || names[0]!.field !== "zip" || names[0]!.path.includes("/"))
          fail(400, "INVALID_PACKAGE_SOURCE", "Choose exactly one ZIP file");
        source = { kind: "zip", path: join(incoming, names[0]!.path), displayName: names[0]!.path };
      } else {
        if (names.some((item) => item.field !== "files" || item.path.split("/").length < 2))
          fail(400, "INVALID_PACKAGE_SOURCE", "Choose one complete local directory");
        const first = names[0]!.path.split("/")[0]!;
        if (names.some((item) => item.path.split("/")[0] !== first)) fail(400, "INVALID_PACKAGE_SOURCE", "Choose one directory at a time");
        source = { kind: "local", path: join(incoming, first), displayName: first };
      }
      const staged = await stagePiPackageUpload(source, root);
      try {
        if (view.generation !== this.identity.currentGeneration) fail(409, "CONNECTION_CHANGED", "Core connection changed during upload");
        const uploaded = await client.uploadPiPackage(createReadStream(staged.path), staged.sha256, staged.bytes,
          staged.displayName, staged.sourceKind, { kind: "work", workId });
        return { ...uploaded, sourceKind: staged.sourceKind, displayName: staged.displayName };
      } finally { await staged.cleanup(); }
    } catch (error) {
      if (error instanceof PiPackageInputError) throw new PiworkApiError(error.code === "PI_PACKAGE_LIMIT_EXCEEDED" ? 413 : 400,
        error.code, error.message);
      if (error instanceof PiworkApiError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw new PiworkApiError(507, "TRANSFER_STORAGE_FULL", "Local storage is full");
      throw new PiworkApiError(400, "INVALID_PACKAGE_UPLOAD", "Package upload could not be read");
    } finally { await rm(root, { recursive: true, force: true }); }
    } finally { this.busy--; }
  }

  private async clearDownloads(): Promise<void> {
    for (const active of this.active.values()) if (active.kind === "download") active.cancel?.();
    for (const job of [...this.jobs.values()]) if (job.kind === "download") {
      this.jobs.delete(job.id); this.pendingBytes -= job.size; await unlink(job.path).catch(() => undefined);
    }
  }

  private async clearTransfers(): Promise<void> {
    for (const active of this.active.values()) active.cancel?.();
    for (const job of [...this.jobs.values()]) {
      this.jobs.delete(job.id); this.pendingBytes -= job.size;
      await unlink(job.path).catch(() => undefined);
    }
  }

  private async expire(): Promise<void> {
    for (const job of [...this.jobs.values()]) if (job.createdAt + transferLifetime < Date.now()) {
      this.jobs.delete(job.id); this.pendingBytes -= job.size;
      await unlink(job.path).catch(() => undefined);
    }
  }

  async clear(): Promise<void> {
    clearInterval(this.sweep);
    for (const active of this.active.values()) active.cancel?.();
    this.active.clear();
    this.claimed.clear();
    this.jobs.clear(); this.pendingBytes = 0;
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }
}
