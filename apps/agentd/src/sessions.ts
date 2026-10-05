import {
  initializePersistentSession,
  loadPersistentSession,
  readPersistentSession,
  type PersistentSession,
} from "@piwork/pi-adapter";
import { unlinkSync } from "node:fs";
import { WorkStore, type SessionRecord } from "@piwork/work-store";
import type { RunModelResolver } from "./run-models.js";
import { RunModelError } from "./run-models.js";
import { publicRunModel, type RunModelSnapshot, type SessionChatOptions, type SetSessionChatOptions } from "@piwork/contracts";

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

  create(idempotencyKey?: string, sourceJson?: string): SessionRecord {
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
      ...(sourceJson ? { sourceJson } : {}),
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

  async setModelPreference(sessionId: string, modelRef: string | null, models: RunModelResolver): Promise<SessionRecord> {
    const record = this.requireRecord(sessionId);
    const savedThinking = record.modelPreferenceJson ? (JSON.parse(record.modelPreferenceJson) as RunModelSnapshot).thinkingLevel : undefined;
    try { return await this.setChatOptions(sessionId, { modelRef, thinkingLevel: savedThinking ?? "off" }, models); }
    catch (error) {
      if (savedThinking !== undefined || !(error instanceof RunModelError) || error.modelErrorCode !== "MODEL_NOT_SUPPORTED") throw error;
      // The original model-only API can retain legacy custom models without
      // claiming their Thinking capabilities have been confirmed.
      const model = await models.resolve(modelRef);
      this.requireRecord(sessionId);
      return this.store.setSessionModelPreference(this.workId, sessionId, JSON.stringify({ ...model, availability: "available" }), this.now().toISOString());
    }
  }

  async setChatOptions(sessionId: string, options: SetSessionChatOptions, models: RunModelResolver): Promise<SessionRecord> {
    this.requireRecord(sessionId);
    const { modelRef, thinkingLevel } = options;
    const model = await models.resolve(modelRef);
    const levels = models.thinking ? (await models.thinking(model)).thinkingLevels : ["off"];
    if (!levels.includes(thinkingLevel)) throw new RunModelError("THINKING_LEVEL_UNSUPPORTED", "Choose a Thinking level supported by this model.");
    this.requireRecord(sessionId);
    return this.store.setSessionModelPreference(this.workId, sessionId, JSON.stringify({ ...model, thinkingLevel, availability: "available" }), this.now().toISOString());
  }

  async chatOptions(sessionId: string, models: RunModelResolver): Promise<SessionChatOptions> {
    const record = this.requireRecord(sessionId, false);
    const saved = record.modelPreferenceJson ? JSON.parse(record.modelPreferenceJson) as RunModelSnapshot & { availability?: string } : undefined;
    const modelRef = saved?.modelRef ?? null, thinkingLevel = saved?.thinkingLevel ?? "off";
    let model: RunModelSnapshot;
    let available = saved?.availability !== "unavailable" && (!this.contextIdentity || record.contextIdentity === this.contextIdentity);
    try {
      model = await models.resolve(modelRef);
      const levels = models.thinking ? (await models.thinking(model)).thinkingLevels : ["off"];
      available = available && levels.includes(thinkingLevel);
    } catch (error) {
      if (!saved) throw error;
      model = saved; available = false;
    }
    return { sessionId, modelRef, model: publicRunModel(model), thinkingLevel, availability: available ? "available" : "unavailable", checkedAt: this.now().toISOString() };
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
    if (record === undefined) throw Object.assign(new Error(`session ${sessionId} does not exist in Work ${this.workId}`), {name: "SessionNotFoundError"});
    if (requireActiveContext && this.contextIdentity !== undefined && record.contextIdentity !== this.contextIdentity) {
      throw Object.assign(new Error(`session ${sessionId} context is unavailable`), {name: "SessionContextUnavailableError"});
    }
    return record;
  }
}
