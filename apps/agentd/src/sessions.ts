import {
  initializePersistentSession,
  loadPersistentSession,
  readPersistentSession,
  type PersistentSession,
} from "@piwork/pi-adapter";
import { unlinkSync } from "node:fs";
import { WorkStore, type SessionRecord } from "@piwork/work-store";

export class AgentSessionService {
  constructor(
    private readonly workId: string,
    private readonly store: WorkStore,
    private readonly workspace: string,
    private readonly sessionRoot: string,
    private readonly contextIdentity?: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  workspaceDirectory(): string { return this.workspace; }

  create(idempotencyKey?: string): SessionRecord {
    const sdk = initializePersistentSession({ cwd: this.workspace, sessionRoot: this.sessionRoot });
    const snapshot = readPersistentSession(sdk);
    const now = this.now().toISOString();
    const record = {
      workId: this.workId,
      sessionId: snapshot.sessionId,
      sdkHistoryPath: snapshot.historyPath,
      createdAt: now,
      updatedAt: now,
      contextIdentity: this.contextIdentity ?? null,
    };
    if (idempotencyKey === undefined) { this.store.createSession(record); return record; }
    const accepted = this.store.createSessionIdempotent(record, idempotencyKey);
    if (accepted.reused) {
      try { unlinkSync(snapshot.historyPath); } catch { /* best effort unused file cleanup */ }
    }
    return accepted.session;
  }

  list(): SessionRecord[] {
    return this.store.listSessions(this.workId);
  }

  read(sessionId: string): PersistentSession {
    this.requireRecord(sessionId, false);
    return readPersistentSession(loadPersistentSession({
      cwd: this.workspace,
      sessionRoot: this.sessionRoot,
      sessionId,
    }));
  }

  continue(sessionId: string) {
    this.requireRecord(sessionId);
    return loadPersistentSession({ cwd: this.workspace, sessionRoot: this.sessionRoot, sessionId });
  }

  private requireRecord(sessionId: string, requireActiveContext = true): SessionRecord {
    const record = this.store.getSession(this.workId, sessionId);
    if (record === undefined) throw new Error(`session ${sessionId} does not exist in Work ${this.workId}`);
    if (requireActiveContext && this.contextIdentity !== undefined && record.contextIdentity !== this.contextIdentity) {
      throw new Error(`session ${sessionId} context is unavailable`);
    }
    return record;
  }
}
