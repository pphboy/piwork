import type { OperatorSkill, PublicSkill } from "@piwork/contracts";
import { dirname, resolve } from "node:path";
import { lstatSync } from "node:fs";
import {
  CoreStore,
  ManagedSkillNotFoundError,
  type ManagedSkillRecord,
} from "@piwork/core-store";
import type { UserPrincipal } from "../work-access/policy.js";
import { SkillArtifactStore } from "./skill-artifact-store.js";

export class SkillAdministrationError extends Error {
  readonly code = "ADMIN_REQUIRED";
  constructor() { super("administrator permission is required"); this.name = "SkillAdministrationError"; }
}

export class SkillUnavailableError extends Error {
  readonly code = "SKILL_UNAVAILABLE";
  constructor(readonly skillName: string) { super(`Skill ${skillName} is unavailable`); this.name = "SkillUnavailableError"; }
}

export class CoreSkillService {
  constructor(
    private readonly store: CoreStore,
    private readonly artifacts: SkillArtifactStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  add(principal: UserPrincipal, sourcePath: string): OperatorSkill {
    assertAdmin(principal); // Do not inspect the operator-supplied path before this point.
    const artifact = this.artifacts.import(sourcePath);
    try {
      return operatorView(this.store.addManagedSkill({
        name: artifact.name,
        identity: artifact.identity,
        fileCount: artifact.fileCount,
        totalBytes: artifact.totalBytes,
        now: this.now().toISOString(),
      }));
    } finally {
      this.cleanupOrphans();
    }
  }

  update(principal: UserPrincipal, name: string, sourcePath: string): OperatorSkill {
    assertAdmin(principal);
    const artifact = this.artifacts.import(sourcePath, name);
    try {
      return operatorView(this.store.updateManagedSkillCurrent({
        name,
        identity: artifact.identity,
        fileCount: artifact.fileCount,
        totalBytes: artifact.totalBytes,
        now: this.now().toISOString(),
      }));
    } finally {
      this.cleanupOrphans();
    }
  }

  listForOperator(principal: UserPrincipal): OperatorSkill[] {
    assertAdmin(principal);
    return this.store.listManagedSkills().map(operatorView);
  }

  showForOperator(principal: UserPrincipal, name: string): OperatorSkill {
    assertAdmin(principal);
    const record = this.store.getManagedSkill(name);
    if (record === undefined) throw new ManagedSkillNotFoundError(name);
    return operatorView(record);
  }

  listForUser(_principal: UserPrincipal): PublicSkill[] {
    return this.store.listManagedSkills(true).map(publicView);
  }

  showForUser(_principal: UserPrincipal, name: string): PublicSkill {
    const record = this.store.getManagedSkill(name);
    if (record === undefined || !record.enabled) throw new SkillUnavailableError(name);
    return publicView(record);
  }

  enable(principal: UserPrincipal, name: string): OperatorSkill {
    assertAdmin(principal);
    return operatorView(this.store.setManagedSkillEnabled(name, true, this.now().toISOString()));
  }

  disable(principal: UserPrincipal, name: string): OperatorSkill {
    assertAdmin(principal);
    return operatorView(this.store.setManagedSkillEnabled(name, false, this.now().toISOString()));
  }

  remove(principal: UserPrincipal, name: string): void {
    assertAdmin(principal);
    this.store.removeManagedSkill(name);
    this.cleanupOrphans();
  }

  cleanupOrphans(): void {
    const referenced = new Set(this.store.listReferencedManagedSkillArtifacts().map(({ name, identity }) => `${name}\0${identity}`));
    this.artifacts.cleanupOrphans(referenced);
  }

  /** Resume import of pre-snapshot catalog Skill references. */
  migrateLegacySkills(): void {
    const migrationKey = "legacy-skill-import-v1";
    for (const entry of this.store.listCatalogEntries(false).filter((item) => item.kind === "skill" && item.mutableReference !== null)) {
      const prior = this.store.getFilesystemMigration(migrationKey, entry.id);
      if (prior?.state === "succeeded") continue;
      const now = this.now().toISOString();
      this.store.setFilesystemMigration({ migrationKey, itemKey: entry.id, state: "running", errorCode: null, updatedAt: now });
      try {
        const reference = resolve(entry.mutableReference!);
        const stat = lstatSync(reference);
        const source = stat.isFile() && reference.endsWith("SKILL.md") ? dirname(reference) : reference;
        const artifact = this.artifacts.import(source);
        if (artifact.name !== entry.id) {
          this.store.rewriteSkillReferences(entry.id, artifact.name, now);
          this.store.retireLegacyCatalogSkill(entry.id, now);
        }
        if (this.store.getCatalogEntry(artifact.name) === undefined) {
          this.store.addManagedSkill({ name: artifact.name, identity: artifact.identity, fileCount: artifact.fileCount, totalBytes: artifact.totalBytes, now });
        } else if (this.store.getManagedSkill(artifact.name) === undefined) {
          this.store.adoptLegacyManagedSkill({ name: artifact.name, identity: artifact.identity, fileCount: artifact.fileCount, totalBytes: artifact.totalBytes, now });
        }
        this.store.setFilesystemMigration({ migrationKey, itemKey: entry.id, state: "succeeded", errorCode: null, updatedAt: this.now().toISOString() });
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "LEGACY_SKILL_UNRECOVERABLE";
        this.store.setFilesystemMigration({ migrationKey, itemKey: entry.id, state: "failed", errorCode: code.slice(0, 128), updatedAt: this.now().toISOString() });
      }
    }
    this.cleanupOrphans();
  }
}

function operatorView(record: ManagedSkillRecord): OperatorSkill {
  return {
    name: record.name,
    enabled: record.enabled,
    fileCount: record.fileCount,
    totalBytes: record.totalBytes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function publicView(record: ManagedSkillRecord): PublicSkill { return { name: record.name }; }

function assertAdmin(principal: UserPrincipal): void {
  if (principal.role !== "admin") throw new SkillAdministrationError();
}
