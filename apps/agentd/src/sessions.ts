import {
  initializePersistentSession,
  loadPersistentSession,
  readPersistentSession,
  type PersistentSession,
} from "@piwork/pi-adapter";
import { unlinkSync, openSync, fsyncSync, closeSync } from "node:fs";
import { CHAT_IMAGE_PROFILE, ChatImageError, chatInputDigest, validateChatImages, type ChatImageInput } from "@piwork/contracts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { WorkStore, type SessionRecord } from "@piwork/work-store";
import type { RunModelResolver } from "./run-models.js";
import { RunModelError } from "./run-models.js";
import { publicRunModel, type RunModelSnapshot, type SessionChatOptions, type SetSessionChatOptions } from "@piwork/contracts";
import { thinkingApi, validThinkingSelection } from "./thinking-profiles.js";

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
    const saved = record.modelPreferenceJson ? JSON.parse(record.modelPreferenceJson) as RunModelSnapshot : undefined;
    const savedThinking = saved?.thinkingLevel;
    try { return await this.setChatOptions(sessionId, { modelRef, thinkingLevel: savedThinking === undefined ? "off" : savedThinking, ...(saved?.thinkingProfile ? {thinkingProfile:saved.thinkingProfile} : {}) }, models); }
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
    const record = this.requireRecord(sessionId);
    const previous = record.modelPreferenceJson ? JSON.parse(record.modelPreferenceJson) as RunModelSnapshot : undefined;
    const { modelRef, thinkingLevel } = options;
    if (previous?.thinkingProfile && options.thinkingProfile === undefined) throw new RunModelError("THINKING_LEVEL_UNSUPPORTED", "Use updated chat settings to change this compatible Thinking selection.");
    const profile = options.thinkingProfile ?? undefined;
    const model = await models.resolve(modelRef);
    const levels = models.thinking ? (await models.thinking(model)).thinkingLevels : ["off" as const];
    const retain = !!profile && previous?.thinkingProfile === profile && previous.modelRef === modelRef && previous.model === model.model && previous.api === model.api && previous.executionBindingId === model.executionBindingId;
    if (!validThinkingSelection(thinkingApi(model), levels, thinkingLevel, profile, retain)) throw new RunModelError("THINKING_LEVEL_UNSUPPORTED", "Choose a Thinking level supported by this model.");
    this.requireRecord(sessionId);
    return this.store.setSessionModelPreference(this.workId, sessionId, JSON.stringify({ ...model, thinkingLevel, ...(profile ? {thinkingProfile:profile} : {}), availability: "available" }), this.now().toISOString());
  }

  async chatOptions(sessionId: string, models: RunModelResolver): Promise<SessionChatOptions> {
    const record = this.requireRecord(sessionId);
    const saved = record.modelPreferenceJson ? JSON.parse(record.modelPreferenceJson) as RunModelSnapshot & { availability?: string } : undefined;
    const modelRef = saved?.modelRef ?? null; let thinkingLevel = saved?.thinkingLevel === undefined ? "off" as const : saved.thinkingLevel;
    let model: RunModelSnapshot;
    let available = saved?.availability !== "unavailable";
    try {
      model = await models.resolve(modelRef);
      const levels = models.thinking ? (await models.thinking(model)).thinkingLevels : ["off" as const];
      if(!saved && !levels.length) thinkingLevel=null;
      available = available && validThinkingSelection(thinkingApi(model), levels, thinkingLevel, saved?.thinkingProfile, true);
    } catch (error) {
      if (!saved) throw error;
      model = saved; available = false;
    }
    return { sessionId, modelRef, model: publicRunModel(model), thinkingLevel, ...(saved?.thinkingProfile ? {thinkingProfile:saved.thinkingProfile} : {}), availability: available ? "available" : "unavailable", checkedAt: this.now().toISOString() };
  }

  read(sessionId: string): PersistentSession {
    this.requireRecord(sessionId);
    try {const snapshot=readPersistentSession(loadPersistentSession({
      cwd: this.workspace,
      sessionRoot: this.sessionRoot,
      sessionId,
    }));
    for(const entry of snapshot.entries)if(entry.role==='user' && entry.blocks.some(b=>b.type==='image')){
      const run=entry.runId?this.store.getRun(entry.runId):undefined;
      if(!run||run.workId!==this.workId||run.sessionId!==sessionId)throw new ChatImageError('IMAGE_HISTORY_CORRUPT','The saved image belongs to another history object.');
      this.assertInput(entry,run.promptDigest);
    }
    return snapshot;
    }catch(error){if(error instanceof ChatImageError)throw new ChatImageError('IMAGE_HISTORY_CORRUPT','The saved image history could not be verified.');throw error;}
  }

  imageHistory(sessionId: string): PersistentSession {
    const snapshot = this.read(sessionId);
    const entries = [...snapshot.entries];
    for (const run of this.store.listSessionRuns(this.workId, sessionId)) {
      const input = this.store.privateInput(run.runId); if(!input) continue;
      const found = entries.find(entry=>entry.role==="user" && entry.runId===run.runId);
      if(found) { this.assertInput(found,run.promptDigest); continue; }
      entries.push({id:`${run.runId}-user`,runId:run.runId,role:"user",text:input.prompt,blocks:[
        ...(input.prompt ? [{blockId:`${run.runId}-text`,type:"text" as const,text:input.prompt}] : []),
        ...input.images.map((value,imageIndex)=>({blockId:`${run.runId}-image-${imageIndex}`,type:"image" as const,input:value,image:{...validateChatImages([value])[0]!,imageIndex}})),
      ]});
    }
    return {...snapshot,entries};
  }

  image(sessionId: string, runId: string, index: number): ChatImageInput {
    const run=this.store.getRun(runId);
    if(!run || run.workId!==this.workId || run.sessionId!==sessionId || !Number.isInteger(index) || index<0 || index>3) throw Object.assign(new Error("Image not found"),{code:5});
    const entry=this.imageHistory(sessionId).entries.find(e=>e.role==="user" && e.runId===runId);
    const block=entry?.blocks.find(b=>b.type==="image" && b.image.imageIndex===index);
    if(!block || block.type!=="image") throw Object.assign(new Error("Image not found"),{code:5});
    return block.input;
  }

  hasImageContext(sessionId: string): boolean {
    const raw=this.read(sessionId).entries;
    const sdk=this.continue(sessionId);
    if(sdk.buildSessionContext().messages.some(m=>"content" in m && Array.isArray(m.content) && m.content.some(p=>p.type==="image"))) return true;
    return this.store.listSessionRuns(this.workId,sessionId).some(run=>!!this.store.privateInput(run.runId) && !raw.some(e=>e.role==="user" && e.runId===run.runId));
  }

  restoreImageInputs(sessionId: string, currentRun: string, sdk: SessionManager): void {
    const current=this.store.getRun(currentRun);
    if(!current || current.workId!==this.workId || current.sessionId!==sessionId || this.contextIdentity!==undefined && current.contextIdentity!==this.contextIdentity)throw new ChatImageError("IMAGE_HISTORY_CORRUPT","The current Run does not belong to this execution context.");
    const entries=readPersistentSession(sdk).entries;
    const runs=this.store.listSessionRuns(this.workId,sessionId).slice().sort((a,b)=>a.acceptedAt.localeCompare(b.acceptedAt));
    for(const run of runs) {
      if(run.runId===currentRun || ["accepted","running","cancelling"].includes(run.state)) continue;
      const input=this.store.privateInput(run.runId);if(!input)continue;
      const found=entries.find(e=>e.role==="user" && e.runId===run.runId);
      if(found){this.assertInput(found,run.promptDigest);continue;}
      sdk.appendCustomEntry("piwork-run",{runId:run.runId});
      sdk.appendMessage({role:"user",content:[...(input.prompt?[{type:"text" as const,text:input.prompt}]:[]),...input.images.map(i=>({type:"image" as const,mimeType:i.mimeType,data:i.data}))],timestamp:Date.parse(run.acceptedAt)});
    }
  }

  syncImageInputs(sessionId: string): void {
    // Loading the physical file, rather than session.messages, excludes SDK buffering.
    const snapshot=this.read(sessionId);
    for(const run of this.store.listSessionRuns(this.workId,sessionId)) {
      if(!this.store.privateInput(run.runId))continue;
      const entry=snapshot.entries.find(e=>e.role==="user" && e.runId===run.runId);if(!entry)continue;
      this.assertInput(entry,run.promptDigest);
      const fd=openSync(snapshot.historyPath,"r");try{fsyncSync(fd);}finally{closeSync(fd);}
      this.store.releasePrivateInput(run.runId);
    }
  }

  private assertInput(entry: PersistentSession["entries"][number], digest: string): void {
    const images=entry.blocks.flatMap(b=>b.type==="image"?[b.input]:[]);
    if(chatInputDigest(entry.originalText ?? entry.text,images)!==digest)throw new ChatImageError("IMAGE_HISTORY_CORRUPT","The saved image message does not match its accepted Run.");
  }

  continue(sessionId: string) {
    this.requireRecord(sessionId);
    return loadPersistentSession({ cwd: this.workspace, sessionRoot: this.sessionRoot, sessionId });
  }

  private requireRecord(sessionId: string): SessionRecord {
    const record = this.store.getSession(this.workId, sessionId);
    if (record === undefined) throw Object.assign(new Error(`session ${sessionId} does not exist in Work ${this.workId}`), {name: "SessionNotFoundError"});
    return record;
  }
}
