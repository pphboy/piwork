import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

type RecordKind = "accepted" | "hidden" | "terminal";
export interface KnownOperation {
  readonly operationId: string;
  readonly type: string;
  readonly workId?: string;
  readonly serviceId?: string;
  readonly snapshotId?: string;
  readonly recordedAt: string;
}
type Stored = { kind: RecordKind; coreUrl: string; userId: string; operationId: string; recordedAt: string;
  orderedAt: number; type?: string; workId?: string; serviceId?: string; snapshotId?: string };
const id = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const segmentLimit = 8 * 1_048_576;
const terminalLimit = 500;

export class DesktopOperationRecords {
  private readonly instance = `instance-${process.pid}-${randomBytes(12).toString("hex")}`;
  private segment = 0;
  private directory?: string;
  private queue: Promise<void> = Promise.resolve();
  private readonly knownIds = new Map<string, Set<string>>();

  constructor(private readonly credentialPath: string) {}

  private async ensureDirectory(): Promise<string> {
    if (this.directory) return this.directory;
    const directory = resolve(dirname(this.credentialPath), "desktop-operations");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory)
      throw new Error("Operation record directory is unsafe");
    this.directory = directory;
    return directory;
  }

  private async withLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
    const path = join(directory, ".records.lock");
    const deadline = Date.now() + 10_000;
    let lock: Awaited<ReturnType<typeof open>>;
    for (;;) {
      try { lock = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = await lstat(path).catch(() => undefined);
        if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("Operation record lock is unsafe");
        let owner = "";
        try {
          const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const buffer = Buffer.alloc(32);
            const { bytesRead } = await existing.read(buffer, 0, buffer.length, 0);
            owner = buffer.toString("utf8", 0, bytesRead);
          }
          finally { await existing.close(); }
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure;
        }
        const pid = Number(owner.trim());
        let stale = false;
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); }
          catch (failure) { stale = (failure as NodeJS.ErrnoException).code === "ESRCH"; }
        } else stale = !!info && Date.now() - info.mtimeMs > 30_000;
        if (stale) { await unlink(path).catch(() => undefined); continue; }
        if (Date.now() > deadline) throw new Error("Operation record lock timed out");
        await new Promise((done) => setTimeout(done, 20));
      }
    }
    try { await lock.write(String(process.pid)); await lock.sync(); return await action(); }
    finally { await lock.close(); await unlink(path).catch(() => undefined); }
  }

  private append(record: Stored): Promise<void> {
    const next = this.queue.then(async () => {
      const directory = await this.ensureDirectory();
      await this.withLock(directory, async () => {
      const line = `${JSON.stringify(record)}\n`;
      let path = join(directory, `${this.instance}-${this.segment}.jsonl`);
      const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("Operation record file is unsafe");
      if (existing && existing.size + Buffer.byteLength(line) > segmentLimit) {
        this.segment++;
        path = join(directory, `${this.instance}-${this.segment}.jsonl`);
      }
      const file = await open(path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        if (!(await file.stat()).isFile()) throw new Error("Operation record file is unsafe");
        await file.write(line); await file.sync();
      }
      finally { await file.close(); }
      });
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  accept(coreUrl: string, userId: string, type: string, value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return Promise.resolve();
    const item = value as Record<string, unknown>;
    if (typeof item.operationId !== "string" || !id.test(item.operationId)) return Promise.resolve();
    const entry: Stored = { kind: "accepted", coreUrl, userId, operationId: item.operationId,
      type: type.slice(0, 80), recordedAt: new Date().toISOString(), orderedAt: performance.timeOrigin + performance.now(),
      ...(typeof item.workId === "string" && id.test(item.workId) ? { workId: item.workId } : {}),
      ...(typeof item.serviceId === "string" && id.test(item.serviceId) ? { serviceId: item.serviceId } : {}),
      ...(typeof item.snapshotId === "string" && id.test(item.snapshotId) ? { snapshotId: item.snapshotId } : {}) };
    return this.append(entry).then(() => {
      const key = JSON.stringify([coreUrl, userId]);
      const ids = this.knownIds.get(key) ?? new Set<string>();
      ids.add(entry.operationId); this.knownIds.set(key, ids);
    });
  }

  hide(coreUrl: string, userId: string, operationId: string): Promise<void> {
    if (!id.test(operationId)) throw new Error("Invalid Operation ID");
    return this.append({ kind: "hidden", coreUrl, userId, operationId, recordedAt: new Date().toISOString(),
      orderedAt: performance.timeOrigin + performance.now() }).then(() => {
      this.knownIds.get(JSON.stringify([coreUrl, userId]))?.delete(operationId);
    });
  }

  async markTerminal(coreUrl: string, userId: string, operationId: string): Promise<void> {
    if (!id.test(operationId)) return;
    if (!this.knownIds.get(JSON.stringify([coreUrl, userId]))?.has(operationId)
      && !(await this.list(coreUrl, userId)).some((item) => item.operationId === operationId)) return;
    await this.append({ kind: "terminal", coreUrl, userId, operationId, recordedAt: new Date().toISOString(),
      orderedAt: performance.timeOrigin + performance.now() });
  }

  private async readRecords(path: string, coreUrl?: string, userId?: string): Promise<Stored[]> {
    const records: Stored[] = [];
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile()) return records;
      const decoder = new StringDecoder("utf8");
      let line = "", oversized = false;
      const processText = (text: string) => {
        for (const char of text) {
          if (char === "\n") {
            if (!oversized && line) {
              try {
                const record = JSON.parse(line) as Stored;
                if ((coreUrl === undefined || record.coreUrl === coreUrl) && (userId === undefined || record.userId === userId)
                  && typeof record.coreUrl === "string" && typeof record.userId === "string" && typeof record.operationId === "string"
                  && id.test(record.operationId) && ["accepted", "hidden", "terminal"].includes(record.kind)) records.push(record);
              } catch { /* Ignore an incomplete or invalid record. */ }
            }
            line = ""; oversized = false;
          } else if (!oversized) {
            line += char;
            if (line.length > 2048) { line = ""; oversized = true; }
          }
        }
      };
      for await (const chunk of file.createReadStream({ highWaterMark: 64 * 1024, autoClose: false }))
        processText(decoder.write(chunk as Buffer));
      processText(decoder.end());
    } finally { await file.close(); }
    return records;
  }

  private async sources(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const info = await lstat(path).catch(() => undefined);
      if (!info || info.isSymbolicLink()) continue;
      if (/^instance-[0-9]+-[a-f0-9]{24}(?:-[0-9]+)?\.jsonl$/.test(name) && info.isFile()) files.push(path);
      if (/^snapshot-[a-f0-9]{24}$/.test(name) && info.isDirectory()) {
        for (const part of await readdir(path)) {
          if (!/^part-[0-9]+\.jsonl$/.test(part)) continue;
          const file = join(path, part);
          const partInfo = await lstat(file).catch(() => undefined);
          if (partInfo?.isFile() && !partInfo.isSymbolicLink()) files.push(file);
        }
      }
    }
    return files;
  }

  private async collect(directory: string, coreUrl?: string, userId?: string): Promise<Stored[]> {
    const all: Stored[] = [];
    for (const path of await this.sources(directory)) {
      try { for (const record of await this.readRecords(path, coreUrl, userId)) all.push(record); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    all.sort((a, b) => (a.orderedAt ?? Date.parse(a.recordedAt)) - (b.orderedAt ?? Date.parse(b.recordedAt))
      || (a.kind === "hidden" ? 1 : -1));
    return all;
  }

  private merge(all: Stored[]): Map<string, { accepted?: Stored; terminal?: Stored; hidden?: Stored }> {
    const selected = new Map<string, { accepted?: Stored; terminal?: Stored; hidden?: Stored }>();
    for (const record of all) {
      const key = JSON.stringify([record.coreUrl, record.userId, record.operationId]);
      const item = selected.get(key) ?? {};
      if (record.kind === "hidden") { item.accepted = undefined; item.terminal = undefined; item.hidden = record; }
      else if (record.kind === "terminal") { if (item.accepted) item.terminal = record; }
      else { item.accepted = record; item.terminal = undefined; item.hidden = undefined; }
      selected.set(key, item);
    }
    return selected;
  }

  private async snapshot(directory: string, records: Stored[]): Promise<string> {
    const nonce = randomBytes(12).toString("hex");
    const temporary = join(directory, `tmp-snapshot-${nonce}`);
    const published = join(directory, `snapshot-${nonce}`);
    await mkdir(temporary, { mode: 0o700 });
    try {
      let part = 0, bytes = 0;
      let file = await open(join(temporary, `part-${part}.jsonl`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        for (const record of records) {
          const line = `${JSON.stringify({ ...record, orderedAt: performance.timeOrigin + performance.now() })}\n`;
          if (bytes && bytes + Buffer.byteLength(line) > segmentLimit) {
            await file.sync(); await file.close();
            part++; bytes = 0;
            file = await open(join(temporary, `part-${part}.jsonl`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
          }
          await file.write(line); bytes += Buffer.byteLength(line);
        }
        await file.sync();
      } finally { await file.close().catch(() => undefined); }
      await rename(temporary, published);
      return published;
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  }

  private async compact(directory: string): Promise<void> {
    const sourceFiles = await this.sources(directory);
    const sourceRoots = new Set(sourceFiles.map((path) => basename(dirname(path)).startsWith("snapshot-") ? dirname(path) : path));
    const selected = this.merge(await this.collect(directory));
    const byIdentity = new Map<string, { accepted?: Stored; terminal?: Stored; hidden?: Stored }[]>();
    for (const item of selected.values()) {
      const record = item.accepted ?? item.hidden;
      if (!record) continue;
      const key = JSON.stringify([record.coreUrl, record.userId]);
      const entries = byIdentity.get(key) ?? [];
      entries.push(item); byIdentity.set(key, entries);
    }
    const kept: Stored[] = [], protective: Stored[] = [];
    for (const entries of byIdentity.values()) {
      const terminals = entries.filter((item) => item.accepted && item.terminal)
        .sort((a, b) => b.accepted!.recordedAt.localeCompare(a.accepted!.recordedAt));
      const retained = new Set(terminals.slice(0, terminalLimit));
      for (const item of entries) {
        if (item.accepted && (!item.terminal || retained.has(item))) {
          kept.push(item.accepted);
          if (item.terminal) kept.push(item.terminal);
        } else {
          const source = item.accepted ?? item.hidden!;
          protective.push({ kind: "hidden", coreUrl: source.coreUrl, userId: source.userId,
            operationId: source.operationId, recordedAt: new Date().toISOString(),
            orderedAt: performance.timeOrigin + performance.now() });
        }
      }
    }
    const recovery = await this.snapshot(directory, [...kept, ...protective]);
    for (const path of sourceRoots) await rm(path, { recursive: true, force: true });
    const final = await this.snapshot(directory, kept);
    await rm(recovery, { recursive: true, force: true });
    // The committed snapshot remains visible to every instance.
    void final;
  }

  async list(coreUrl: string, userId: string): Promise<KnownOperation[]> {
    await this.queue;
    const directory = await this.ensureDirectory();
    const selected = await this.withLock(directory, async () => this.merge(await this.collect(directory, coreUrl, userId)));
    const visible = [...selected.values()].filter((item) => item.accepted);
    const pending = visible.filter((item) => !item.terminal);
    const terminal = visible.filter((item) => item.terminal)
      .sort((a, b) => b.accepted!.recordedAt.localeCompare(a.accepted!.recordedAt));
    if (terminal.length > terminalLimit)
      await this.withLock(directory, async () => this.compact(directory)).catch(() => undefined);
    const operations = [...pending, ...terminal.slice(0, terminalLimit)].map((item) => {
      const record = item.accepted!;
      return { operationId: record.operationId, type: record.type ?? "operation", recordedAt: record.recordedAt,
        ...(record.workId ? { workId: record.workId } : {}),
        ...(record.serviceId ? { serviceId: record.serviceId } : {}),
        ...(record.snapshotId ? { snapshotId: record.snapshotId } : {}) };
    }).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    this.knownIds.set(JSON.stringify([coreUrl, userId]), new Set(operations.map((item) => item.operationId)));
    return operations;
  }
}
