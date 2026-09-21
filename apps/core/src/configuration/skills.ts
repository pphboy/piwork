import type { OperatorSkill, PublicSkill } from "@piwork/contracts";
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
