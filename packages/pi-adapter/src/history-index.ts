import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { HistoryError } from "@piwork/contracts";
import { projectPersistentEntry, type PersistentSessionEntry } from "./session-persistence.js";

export interface HistoryEntryLocation {
  readonly id: string; readonly parentId: string | null; readonly order: number;
  readonly offset: number; readonly length: number; readonly digest: string;
  readonly type: string; readonly role?: string; readonly runMarker?: string;
  readonly calls: readonly string[];
}
export interface IndexedHistorySnapshot {
  readonly generation: string; readonly end: number;
  readonly entries: readonly HistoryEntryLocation[];
  validate(): void;
  read(location: HistoryEntryLocation): PersistentSessionEntry;
  runFor(location: HistoryEntryLocation): string | undefined;
}
const corrupt = (): never => { throw new HistoryError("HISTORY_CORRUPT", "The saved conversation could not be verified."); };
const expired = (): never => { throw new HistoryError("HISTORY_CURSOR_EXPIRED", "The saved history source changed; reread the Session."); };
const digest = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");

/** Append-only, body-free SDK index. A cold scan parses one JSONL record at a
 * time; subsequent pages do not load the SessionManager or all message bodies. */
export class SessionHistoryIndex {
  private generation = randomUUID();
  private identity = "";
  private end = 0;
  private refs: HistoryEntryLocation[] = [];
  private byId = new Map<string, HistoryEntryLocation>();
  private last?: { ref: HistoryEntryLocation; value: PersistentSessionEntry };
  private header = false;
  scans = 0;
  constructor(private readonly path: string, private readonly sessionId: string) {}

  snapshot(): IndexedHistorySnapshot {
    const fd = this.open();
    try {
      const stat = fstatSync(fd), identity = `${stat.dev}:${stat.ino}`;
      if (identity !== this.identity || stat.size < this.end) {
        this.identity = identity; this.generation = randomUUID(); this.end = 0;
        this.refs = []; this.byId.clear(); this.last = undefined; this.header = false;
      }
      if (stat.size > this.end) {
        this.scans++;
        let position = this.end, start = position, pending: Buffer[] = [];
        const buffer = Buffer.allocUnsafe(64 * 1024);
        while (position < stat.size) {
          const n = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - position), position);
          if (!n) break;
          let from = 0;
          for (let i = 0; i < n; i++) if (buffer[i] === 10) {
            pending.push(Buffer.from(buffer.subarray(from, i)));
            const raw = Buffer.concat(pending), finish = position + i + 1;
            this.index(raw, start); this.end = finish; start = finish; pending = []; from = i + 1;
          }
          if (from < n) pending.push(Buffer.from(buffer.subarray(from, n)));
          position += n;
        }
        // A concurrent writer's unterminated tail is not a committed SDK entry.
      }
      if (!this.header) corrupt();
      const generation = this.generation, end = this.end, entries = this.refs.slice();
      const runFor = (location: HistoryEntryLocation): string | undefined => {
        let parent = location.parentId; const seen = new Set<string>();
        while (parent && !seen.has(parent)) {
          seen.add(parent); const ref = this.byId.get(parent);
          if (!ref || ref.offset >= end) break;
          if (ref.runMarker !== undefined) return ref.runMarker;
          parent = ref.parentId;
        }
        return undefined;
      };
      const validate = () => {
        if(this.generation!==generation)expired();
        const input=this.open();try{const current=fstatSync(input);if(`${current.dev}:${current.ino}`!==identity||current.size<end)expired();}finally{closeSync(input);}
      };
      return { generation, end, validate, entries: entries.filter(e => e.type === "message"), runFor,
        read: location => {
          if (this.generation !== generation) expired();
          const input = this.open();
          try {
            const current = fstatSync(input);
            if (`${current.dev}:${current.ino}` !== identity || current.size < end) expired();
            const raw = Buffer.allocUnsafe(location.length);
            let offset = 0;
            while (offset < raw.length) { const n = readSync(input, raw, offset, raw.length - offset, location.offset + offset); if (!n) expired(); offset += n; }
            if (digest(raw) !== location.digest) expired();
            if (this.last?.ref === location) return this.last.value;
            const entry = this.parse(raw) as SessionEntry;
            const value = projectPersistentEntry(entry, runFor(location))[0] ?? corrupt();
            // At most one reasonably-sized body is cached, never the history.
            if (raw.length <= 8 * 1024 * 1024) this.last = { ref: location, value };
            else this.last = undefined;
            return value;
          } finally { closeSync(input); }
        } };
    } finally { closeSync(fd); }
  }

  private open(): number {
    const fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) { closeSync(fd); corrupt(); }
    return fd;
  }
  private parse(raw: Buffer): Record<string, any> {
    try { const text = raw.toString("utf8"); if (!Buffer.from(text).equals(raw)) corrupt(); const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) corrupt(); return value; }
    catch { return corrupt(); }
  }
  private index(raw: Buffer, offset: number): void {
    if (!raw.toString("utf8").trim()) return;
    const entry = this.parse(raw);
    if (!this.header) {
      if (entry.type !== "session" || entry.id !== this.sessionId || entry.version !== 3) corrupt();
      this.header = true; return;
    }
    if (typeof entry.id !== "string" || !entry.id || this.byId.has(entry.id) || !(entry.parentId === null || typeof entry.parentId === "string")) corrupt();
    if (entry.type === "message" && (!entry.message || typeof entry.message.role !== "string")) corrupt();
    const message = entry.message;
    const calls: string[] = entry.type !== "message" ? [] : message.role === "toolResult" ? [message.toolCallId].filter(v => typeof v === "string") : Array.isArray(message.content) ? message.content.filter((p: any) => p.type === "toolCall" && typeof p.id === "string").map((p: any) => p.id) : [];
    const ref: HistoryEntryLocation = { id: entry.id, parentId: entry.parentId, order: this.refs.length, offset, length: raw.length, digest: digest(raw), type: entry.type, calls,
      ...(entry.type === "message" ? { role: message.role } : {}),
      ...(entry.type === "custom" && entry.customType === "piwork-run" ? { runMarker: typeof entry.data?.runId === "string" ? entry.data.runId : "" } : {}) };
    this.refs.push(ref); this.byId.set(ref.id, ref);
  }
}
