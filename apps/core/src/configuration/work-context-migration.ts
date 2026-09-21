import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Check } from "typebox/value";
import { WorkConfigSchema, type WorkConfig } from "@piwork/contracts";
import { CoreStore, type WorkConfigRevisionRecord, type WorkContextSnapshotInput, type WorkRecord } from "@piwork/core-store";
import { inspectSkillTree } from "./skill-tree.js";
import { SkillArtifactStore } from "./skill-artifact-store.js";
import { WorkContextStore } from "./work-context.js";

const MIGRATION_KEY = "legacy-work-context-v1";

/**
 * Converts v4 Work configuration rows into immutable Work-owned contexts.
 * The operation is deliberately filesystem-aware and resumable: every Work is
 * recorded separately, and a failed Work never receives a replacement default.
 */
export class WorkContextMigration {
  constructor(
    private readonly store: CoreStore,
    private readonly contexts: WorkContextStore,
    private readonly artifacts: SkillArtifactStore,
    private readonly runtimeDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  migrate(runtimeProfileJson?: string): void {
    this.migrateDefault();
    for (const work of this.store.listWorks()) this.migrateWork(work, runtimeProfileJson);
  }

  private migrateDefault(): void {
    const envelope = this.store.getDefaultWorkConfiguration();
    if (envelope?.configuration === null || envelope?.configuration === undefined) return;
    try {
      const normalized = this.normalizeConfiguration(envelope.configuration);
      const now = this.now().toISOString();
      this.store.setControlMetadata("default_work_configuration", { ...envelope, configuration: normalized }, now);
      this.store.setFilesystemMigration({ migrationKey: MIGRATION_KEY, itemKey: "default-work", state: "succeeded", errorCode: null, updatedAt: now });
    } catch {
      this.store.setFilesystemMigration({ migrationKey: MIGRATION_KEY, itemKey: "default-work", state: "failed", errorCode: "DEFAULT_CONFIGURATION_UNRECONSTRUCTABLE", updatedAt: this.now().toISOString() });
    }
  }

  private migrateWork(work: WorkRecord, runtimeProfileJson?: string): void {
    const prior = this.store.getFilesystemMigration(MIGRATION_KEY, work.id);
    const current = this.store.getWorkConfiguration(work.id);
    if (current?.desiredContextId !== null && current?.desiredContextId !== undefined) {
      try {
        this.contexts.load(work.id, current.desiredContextId);
        if (current.activeContextId !== null) this.contexts.load(work.id, current.activeContextId);
        this.store.setFilesystemMigration({
          migrationKey: MIGRATION_KEY,
          itemKey: work.id,
          state: "succeeded",
          errorCode: null,
          updatedAt: this.now().toISOString(),
        });
      } catch {
        this.store.setFilesystemMigration({
          migrationKey: MIGRATION_KEY,
          itemKey: work.id,
          state: "failed",
          errorCode: "WORK_CONTEXT_UNRECONSTRUCTABLE",
          updatedAt: this.now().toISOString(),
        });
      }
      return;
    }
    if (prior?.state === "succeeded") return;
    const now = this.now().toISOString();
    this.store.setFilesystemMigration({ migrationKey: MIGRATION_KEY, itemKey: work.id, state: "running", errorCode: null, updatedAt: now });
    try {
      if (current === undefined) throw new Error("WORK_CONTEXT_UNRECONSTRUCTABLE");
      const desiredRow = this.store.getWorkConfigRevision(work.id, work.desiredRevision);
      if (desiredRow === undefined) throw new Error("WORK_CONTEXT_UNRECONSTRUCTABLE");
      const desired = this.normalizeConfiguration(JSON.parse(desiredRow.configJson));
      const activeRevision = work.activeRevision;
      const activeRow = activeRevision === null ? undefined : this.store.getWorkConfigRevision(work.id, activeRevision);
      const active = activeRow === undefined ? undefined : this.normalizeConfiguration(JSON.parse(activeRow.configJson));
      const materialized = this.findMaterializedContext(work.id);
      let activeSnapshot: WorkContextSnapshotInput | undefined;
      let desiredSnapshot: WorkContextSnapshotInput;
      if (active !== undefined && activeRevision !== null && activeRevision === work.desiredRevision) {
        // A single legacy revision is both active and desired. Prefer its
        // already materialized runtime copy before consulting mutable sources.
        desiredSnapshot = this.buildSnapshot(work, active, activeRow!, materialized, "active", runtimeProfileJson);
        activeSnapshot = desiredSnapshot;
      } else {
        if (active !== undefined && activeRevision !== null) {
          activeSnapshot = this.buildSnapshot(work, active, activeRow!, materialized, "active", runtimeProfileJson);
        }
        try {
          desiredSnapshot = this.buildSnapshot(work, desired, desiredRow, undefined, "desired", runtimeProfileJson);
        } catch (error) {
          // A pending legacy edit may be unreconstructable even though the
          // running context is sound. Persist the recovered active context so
          // operator repair cannot destroy the last usable runtime copy.
          if (activeSnapshot !== undefined && activeRevision !== null) {
            this.store.updateWorkConfigJson(work.id, activeRevision, activeSnapshot.configurationJson);
            this.store.attachMigratedActiveContext({
              workId: work.id,
              activeRevision,
              active: activeSnapshot,
              now,
            });
          }
          throw error;
        }
      }
      this.store.updateWorkConfigJson(work.id, work.desiredRevision, desiredSnapshot.configurationJson);
      if (activeRevision !== null && activeRow !== undefined && activeRevision !== work.desiredRevision && activeSnapshot !== undefined) {
        this.store.updateWorkConfigJson(work.id, activeRevision, activeSnapshot.configurationJson);
      }
      this.store.attachMigratedWorkContexts({
        workId: work.id,
        desiredRevision: work.desiredRevision,
        desired: desiredSnapshot,
        activeRevision,
        ...(activeSnapshot === undefined ? {} : { active: activeSnapshot }),
        now,
      });
      this.store.setFilesystemMigration({ migrationKey: MIGRATION_KEY, itemKey: work.id, state: "succeeded", errorCode: null, updatedAt: this.now().toISOString() });
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "WORK_CONTEXT_UNRECONSTRUCTABLE";
      this.store.setFilesystemMigration({ migrationKey: MIGRATION_KEY, itemKey: work.id, state: "failed", errorCode: code.slice(0, 128), updatedAt: this.now().toISOString() });
    }
  }

  private buildSnapshot(
    work: WorkRecord,
    configuration: WorkConfig,
    row: WorkConfigRevisionRecord,
    materialized: string | undefined,
    role: "active" | "desired",
    runtimeProfileJson?: string,
  ): WorkContextSnapshotInput {
    const snapshotId = `legacy-${role}-${work.id}-${row.revision}`;
    try {
      const existing = this.contexts.load(work.id, snapshotId);
      return snapshotInput(existing, work.ownerUserId);
    } catch { /* build or resume below */ }
    const image = this.store.getCatalogEntry(configuration.agentImage.catalogId);
    const imageReference = image?.resolvedDigest ?? image?.mutableReference;
    if (imageReference === undefined || imageReference === null) throw new Error("WORK_CONTEXT_UNRECONSTRUCTABLE");
    const imageIdentity = /^sha256:[a-f0-9]{64}$/.test(imageReference)
      ? imageReference
      : `sha256:${createHash("sha256").update(imageReference).digest("hex")}`;
    const skills = configuration.skills.map((name) => {
      const fromRuntime = materialized === undefined ? undefined : join(materialized, "skills", name);
      if (role === "active" && fromRuntime !== undefined && existsDirectory(fromRuntime)) {
        const inspection = inspectSkillTree(fromRuntime, { expectedName: name });
        return { name, identity: inspection.identity, directory: fromRuntime };
      }
      const record = this.store.getManagedSkill(name);
      if (record === undefined || !record.enabled) throw new Error("WORK_CONTEXT_UNRECONSTRUCTABLE");
      const artifact = this.artifacts.inspect(name, record.currentIdentity);
      return { name, identity: artifact.identity, directory: artifact.directory };
    });
    const runtimeAgents = materialized === undefined ? undefined : readText(join(materialized, "AGENTS.md"));
    const agentsMd = runtimeAgents ?? configuration.agentsMd;
    const effective = { ...configuration, agentsMd };
    const built = this.contexts.build({ workId: work.id, snapshotId, configuration: effective, imageIdentity, skills, createdAt: this.now().toISOString() });
    // Keep the row's profile available to lifecycle recovery when v4 did not have one.
    if (runtimeProfileJson !== undefined && row.runtimeProfileJson === null) {
      this.store.bindWorkRuntimeProfile(work.id, row.revision, runtimeProfileJson, null);
    }
    return snapshotInput(built, work.ownerUserId);
  }

  private normalizeConfiguration(value: unknown): WorkConfig {
    if (value === null || typeof value !== "object") throw new Error("WORK_CONTEXT_UNRECONSTRUCTABLE");
    const input = { ...(value as Record<string, unknown>) };
    delete input.revision;
    delete input.contextIdentity;
    delete input.agentsMdPath;
    delete input.resolvedTools;
    if (input.agentImage !== null && typeof input.agentImage === "object") {
      input.agentImage = { catalogId: (input.agentImage as { catalogId?: unknown }).catalogId };
    }
    if (typeof input.skills === "undefined") input.skills = [];
    if (Array.isArray(input.skills)) {
      input.skills = input.skills.map((skill) => {
        const id = skill !== null && typeof skill === "object" ? (skill as { catalogId?: unknown }).catalogId : skill;
        if (typeof id !== "string") throw new Error("WORK_CONTEXT_UNRECONSTRUCTABLE");
        return this.store.getCatalogEntry(id)?.name ?? id;
      });
    }
    if (typeof input.agentsMd !== "string") input.agentsMd = "";
    if (!Check(WorkConfigSchema, input)) throw new Error("WORK_CONTEXT_UNRECONSTRUCTABLE");
    return input as WorkConfig;
  }

  private findMaterializedContext(workId: string): string | undefined {
    const candidates = [join(this.runtimeDirectory, workId, "context", "1"), join(this.runtimeDirectory, workId, "run", "piwork"), join(this.runtimeDirectory, workId, "context")];
    return candidates.find((candidate) => existsDirectory(candidate));
  }
}

function snapshotInput(snapshot: { snapshotId: string; configuration: WorkConfig; metadata: { imageIdentity: string; createdAt: string } }, owner: string): WorkContextSnapshotInput {
  return { snapshotId: snapshot.snapshotId, configurationJson: JSON.stringify(snapshot.configuration), imageIdentity: snapshot.metadata.imageIdentity, createdByUserId: owner, createdAt: snapshot.metadata.createdAt };
}

function readText(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

function existsDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}
