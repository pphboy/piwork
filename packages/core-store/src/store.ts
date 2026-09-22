import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CORE_SCHEMA_VERSION, migrateCoreDatabase } from "./migrations.js";
import {
  acceptMutation,
  type AcceptedMutation,
  type MutationContext,
  type MutationEffect,
  type MutationRequest,
} from "./mutation.js";
import { StoreLock } from "./store-lock.js";

export { CORE_SCHEMA_VERSION };

export interface CoreStoreOptions {
  readonly databasePath: string;
  readonly lockPath?: string;
}

export interface InitialAdministratorRecord {
  readonly id: string;
  readonly account: string;
  readonly passwordDigest: string;
  readonly now: string;
}

export class InitialAdministratorExistsError extends Error {
  constructor() {
    super("initial administrator bootstrap is only allowed when the user database is empty");
    this.name = "InitialAdministratorExistsError";
  }
}

export interface AuthenticationUserRecord {
  readonly id: string;
  readonly account: string;
  readonly passwordDigest: string;
  readonly role: "admin" | "user";
  readonly enabled: boolean;
}

export interface LoginSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenDigest: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface StoredLoginSession {
  readonly id: string;
  readonly userId: string;
  readonly account: string;
  readonly role: "admin" | "user";
  readonly userEnabled: boolean;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface ManagedUserRecord {
  readonly id: string;
  readonly account: string;
  readonly role: "admin" | "user";
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewManagedUserRecord extends ManagedUserRecord {
  readonly passwordDigest: string;
}

export class LastEnabledAdministratorError extends Error {
  constructor() {
    super("cannot disable the last enabled administrator");
    this.name = "LastEnabledAdministratorError";
  }
}

export type CatalogKind = "agent_image" | "skill" | "model";

export interface CatalogEntryRecord {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly name: string;
  readonly mutableReference: string | null;
  readonly resolvedDigest: string | null;
  readonly metadataJson: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type NewCatalogEntryRecord = CatalogEntryRecord;

export interface ManagedSkillRecord {
  readonly name: string;
  readonly currentIdentity: string;
  readonly enabled: boolean;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ManagedSkillArtifactInput {
  readonly name: string;
  readonly identity: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly now: string;
}

export class SkillAlreadyExistsError extends Error {
  readonly code = "SKILL_ALREADY_EXISTS";
  constructor(readonly skillName: string) { super(`Skill ${skillName} already exists`); this.name = "SkillAlreadyExistsError"; }
}

export class ManagedSkillNotFoundError extends Error {
  readonly code = "SKILL_NOT_FOUND";
  constructor(readonly skillName: string) { super(`Skill ${skillName} is unavailable`); this.name = "ManagedSkillNotFoundError"; }
}

export class DefaultSkillReferenceError extends Error {
  readonly code = "SKILL_DEFAULT_REFERENCE";
  constructor(readonly skillName: string) { super(`Skill ${skillName} is selected by default Work configuration`); this.name = "DefaultSkillReferenceError"; }
}

export interface NewSecretReferenceRecord {
  readonly id: string;
  readonly ownerUserId: string | null;
  readonly name: string;
  readonly storagePath: string;
  readonly now: string;
}

export interface SecretReferenceRecord {
  readonly id: string;
  readonly ownerUserId: string | null;
  readonly name: string;
  readonly storagePath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ConfigurationRevisionConflictError extends Error {
  constructor(
    readonly workId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Work ${workId} configuration revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = "ConfigurationRevisionConflictError";
  }
}

export class DefaultWorkConfigurationConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`default Work configuration revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = "DefaultWorkConfigurationConflictError";
  }
}

export interface DefaultWorkConfigurationEnvelope {
  readonly version: 1;
  readonly revision: number;
  readonly configuration: unknown | null;
  readonly updatedAt?: string;
}

export interface WorkConfigurationUpdate {
  readonly workId: string;
  readonly expectedRevision: number;
  readonly allowLastCommitWins?: boolean;
  readonly configJson: string;
  readonly createdByUserId: string;
  readonly now: string;
  readonly runtimeProfileJson?: string;
  readonly sourceRuntimeRevision?: number | null;
  readonly snapshot?: WorkContextSnapshotInput;
  readonly hostCpuMillis?: number;
  readonly hostMemoryBytes?: number;
}

export class WorkConfigurationAllocationError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  constructor(message: string) { super(message); this.name = "WorkConfigurationAllocationError"; }
}

export interface WorkContextSnapshotInput {
  readonly snapshotId: string;
  readonly configurationJson: string;
  readonly imageIdentity: string;
  readonly createdByUserId: string;
  readonly createdAt: string;
}

export interface WorkContextSnapshotRecord extends WorkContextSnapshotInput {
  readonly workId: string;
  readonly internalRevision: number | null;
}

export interface WorkConfigurationState {
  readonly workId: string;
  readonly ownerUserId: string;
  readonly desiredRevision: number;
  readonly activeRevision: number | null;
  readonly desiredConfigJson: string;
  readonly activeConfigJson: string | null;
  readonly pendingRestart: boolean;
  readonly desiredContextId: string | null;
  readonly activeContextId: string | null;
}

export interface WorkConfigRevisionRecord {
  readonly workId: string;
  readonly revision: number;
  readonly configJson: string;
  readonly resolvedImageDigest: string | null;
  readonly runtimeProfileJson: string | null;
  readonly sourceRuntimeRevision: number | null;
}

export interface WorkRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly desiredState: "running" | "stopped" | "deleted";
  readonly observedState: string;
  readonly desiredRevision: number;
  readonly activeRevision: number | null;
  readonly controlVersion: number;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperationRecord {
  readonly id: string;
  readonly workId: string | null;
  readonly serviceId: string | null;
  readonly kind: string;
  readonly state: "pending" | "running" | "succeeded" | "failed" | "superseded";
  readonly targetVersion: number;
  readonly requestJson: string;
  readonly resultJson: string | null;
  readonly errorJson: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ServiceRecord {
  readonly workId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly desiredRevision: number;
  readonly appliedRevision: number | null;
  readonly enabled: boolean;
  readonly observedState: string;
  readonly tombstonedAt: string | null;
  readonly lastErrorJson: string | null;
  readonly definitionJson: string;
  readonly resolvedImageDigest: string | null;
  readonly createdAt: string;
}

export interface ServiceRevisionRecord {
  readonly workId: string;
  readonly serviceId: string;
  readonly revision: number;
  readonly definitionJson: string;
  readonly resolvedImageDigest: string | null;
  readonly createdAt: string;
}

export interface QuotaReservationRecord {
  readonly workId: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly desiredCpuMillis: number;
  readonly desiredMemoryBytes: number;
  readonly occupiedCpuMillis: number;
  readonly occupiedMemoryBytes: number;
  readonly serviceSlots: number;
  readonly volumeSlots: number;
  readonly updatedAt: string;
}

export interface RuntimeGenerationRecord {
  readonly workId: string;
  readonly generation: number;
  readonly instanceId: string | null;
  readonly state: string;
  readonly retryCount: number;
  readonly retryWindowStartedAt: string | null;
  readonly nextRetryAt: string | null;
  readonly readySince: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ArtifactBindingRecord {
  readonly kind: "agent_image" | "skill";
  readonly ordinal: number;
  readonly catalogId: string;
  readonly digest: string;
}

export type VolumeRecordState = "active" | "retained" | "purge_pending" | "purged";

export interface VolumeRecord {
  readonly id: string;
  readonly installationId: string;
  readonly workId: string;
  readonly serviceId: string | null;
  readonly volumeRole: "agent-private" | "workspace" | "service-data";
  readonly runtimeName: string;
  readonly state: VolumeRecordState;
  readonly referenceCount: number;
  readonly retainedAt: string | null;
  readonly purgedAt: string | null;
  readonly createdAt: string;
}

export interface NewVolumeRecord {
  readonly id: string;
  readonly installationId: string;
  readonly workId: string;
  readonly serviceId?: string | null;
  readonly volumeRole?: VolumeRecord["volumeRole"];
  readonly runtimeName: string;
  readonly referenceCount: number;
  readonly createdAt: string;
}

export interface ServiceRuntimeBindingRecord {
  readonly workId: string;
  readonly serviceId: string;
  readonly revision: number;
  readonly containerId: string | null;
  readonly imageIdentity: string | null;
  readonly recoveryCount: number;
  readonly recoveryWindowStartedAt: string | null;
  readonly nextRetryAt: string | null;
  readonly readySince: string | null;
  readonly updatedAt: string;
}

export class ReferencedVolumeError extends Error {
  constructor(readonly volumeId: string, readonly referenceCount: number) {
    super(`volume ${volumeId} still has ${referenceCount} reference(s)`);
    this.name = "ReferencedVolumeError";
  }
}

export class CoreStore {
  private closed = false;

  private constructor(
    private readonly database: DatabaseSync,
    private readonly lock: StoreLock,
  ) {}

  static open(options: CoreStoreOptions): CoreStore {
    mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    const lock = StoreLock.acquire(options.lockPath ?? `${options.databasePath}.lock`);
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(options.databasePath);
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA busy_timeout = 5000");
      migrateCoreDatabase(database);
      return new CoreStore(database, lock);
    } catch (error) {
      database?.close();
      lock.release();
      throw error;
    }
  }

  get schemaVersion(): number {
    this.assertOpen();
    const row = this.database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
      version: number;
    };
    return row.version;
  }

  hasEnabledAdministrator(): boolean {
    this.assertOpen();
    const row = this.database.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1",
    ).get() as { count: number };
    return row.count > 0;
  }

  getControlMetadata<T>(key: string): T | undefined {
    this.assertOpen();
    const row = this.database.prepare("SELECT value_json FROM control_metadata WHERE key = ?").get(key) as
      | { value_json: string }
      | undefined;
    return row === undefined ? undefined : JSON.parse(row.value_json) as T;
  }

  putControlMetadataIfAbsent(key: string, value: unknown, now: string): boolean {
    this.assertOpen();
    const result = this.database.prepare(`INSERT INTO control_metadata(key, value_json, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`).run(key, JSON.stringify(value), now);
    return result.changes === 1;
  }

  setControlMetadata(key: string, value: unknown, now: string): void {
    this.assertOpen();
    this.database.prepare(`INSERT INTO control_metadata(key, value_json, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
      updated_at = excluded.updated_at`).run(key, JSON.stringify(value), now);
  }

  getDefaultWorkConfiguration(): DefaultWorkConfigurationEnvelope | undefined {
    return this.getControlMetadata<DefaultWorkConfigurationEnvelope>("default_work_configuration");
  }

  compareAndSwapDefaultWorkConfiguration(
    expectedRevision: number,
    configuration: unknown,
    now: string,
  ): DefaultWorkConfigurationEnvelope {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getDefaultWorkConfiguration() ?? { version: 1 as const, revision: 0, configuration: null };
      if (current.revision !== expectedRevision) throw new DefaultWorkConfigurationConflictError(expectedRevision, current.revision);
      const next: DefaultWorkConfigurationEnvelope = { version: 1, revision: expectedRevision + 1, configuration, updatedAt: now };
      this.database.prepare(`INSERT INTO control_metadata(key, value_json, updated_at)
        VALUES ('default_work_configuration', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
        .run(JSON.stringify(next), now);
      this.database.exec("COMMIT");
      return next;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateDefaultWorkConfiguration(
    patch: Readonly<Record<string, unknown>>,
    now: string,
  ): DefaultWorkConfigurationEnvelope {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getDefaultWorkConfiguration() ?? { version: 1 as const, revision: 0, configuration: null };
      const base = current.configuration !== null && typeof current.configuration === "object"
        ? current.configuration as Record<string, unknown>
        : {};
      const next: DefaultWorkConfigurationEnvelope = {
        version: 1,
        revision: current.revision + 1,
        configuration: { ...base, ...patch },
        updatedAt: now,
      };
      this.database.prepare(`INSERT INTO control_metadata(key, value_json, updated_at)
        VALUES ('default_work_configuration', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
        .run(JSON.stringify(next), now);
      this.database.exec("COMMIT");
      return next;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql: string): void {
    this.assertOpen();
    this.database.exec(sql);
  }

  get<T>(sql: string): T | undefined {
    this.assertOpen();
    return this.database.prepare(sql).get() as T | undefined;
  }

  acceptMutation(
    request: MutationRequest,
    effect: (context: MutationContext) => MutationEffect,
  ): AcceptedMutation {
    this.assertOpen();
    return acceptMutation(this.database, request, effect);
  }

  createInitialAdministrator(record: InitialAdministratorRecord): void {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const count = this.database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
      if (count.count !== 0) throw new InitialAdministratorExistsError();
      this.database.prepare(`INSERT INTO users(
        id, account, password_digest, role, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, 'admin', 1, ?, ?)`).run(
        record.id,
        record.account,
        record.passwordDigest,
        record.now,
        record.now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getAuthenticationUserByAccount(account: string): AuthenticationUserRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT id, account, password_digest, role, enabled
      FROM users WHERE account = ?`).get(account) as
      | { id: string; account: string; password_digest: string; role: "admin" | "user"; enabled: number }
      | undefined;
    return row === undefined ? undefined : {
      id: row.id,
      account: row.account,
      passwordDigest: row.password_digest,
      role: row.role,
      enabled: row.enabled === 1,
    };
  }

  createLoginSession(record: LoginSessionRecord): void {
    this.assertOpen();
    this.database.prepare(`INSERT INTO login_sessions(
      id, user_id, token_digest, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?)`).run(
      record.id,
      record.userId,
      record.tokenDigest,
      record.expiresAt,
      record.createdAt,
    );
  }

  getLoginSessionByTokenDigest(tokenDigest: string): StoredLoginSession | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      login_sessions.id,
      users.id AS user_id,
      users.account,
      users.role,
      users.enabled AS user_enabled,
      login_sessions.expires_at,
      login_sessions.revoked_at
      FROM login_sessions
      JOIN users ON users.id = login_sessions.user_id
      WHERE login_sessions.token_digest = ?`).get(tokenDigest) as
      | {
        id: string;
        user_id: string;
        account: string;
        role: "admin" | "user";
        user_enabled: number;
        expires_at: string;
        revoked_at: string | null;
      }
      | undefined;
    return row === undefined ? undefined : {
      id: row.id,
      userId: row.user_id,
      account: row.account,
      role: row.role,
      userEnabled: row.user_enabled === 1,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  revokeLoginSession(sessionId: string, revokedAt: string): boolean {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE login_sessions
      SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(revokedAt, sessionId);
    return result.changes === 1;
  }

  createManagedUser(record: NewManagedUserRecord): void {
    this.assertOpen();
    this.database.prepare(`INSERT INTO users(
      id, account, password_digest, role, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      record.id,
      record.account,
      record.passwordDigest,
      record.role,
      record.enabled ? 1 : 0,
      record.createdAt,
      record.updatedAt,
    );
  }

  listManagedUsers(): ManagedUserRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT id, account, role, enabled, created_at, updated_at
      FROM users ORDER BY account, id`).all() as Array<{
      id: string;
      account: string;
      role: "admin" | "user";
      enabled: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      account: row.account,
      role: row.role,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  setUserEnabled(userId: string, enabled: boolean, now: string): boolean {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const target = this.database.prepare("SELECT role, enabled FROM users WHERE id = ?").get(userId) as
        | { role: "admin" | "user"; enabled: number }
        | undefined;
      if (target === undefined) {
        this.database.exec("ROLLBACK");
        return false;
      }
      if (!enabled && target.role === "admin" && target.enabled === 1) {
        const admins = this.database.prepare(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1",
        ).get() as { count: number };
        if (admins.count <= 1) throw new LastEnabledAdministratorError();
      }
      this.database.prepare("UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, now, userId);
      if (!enabled) {
        this.database.prepare(`UPDATE login_sessions SET revoked_at = ?
          WHERE user_id = ? AND revoked_at IS NULL`).run(now, userId);
      }
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  resetUserPassword(userId: string, passwordDigest: string, now: string): boolean {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(
        "UPDATE users SET password_digest = ?, updated_at = ? WHERE id = ?",
      ).run(passwordDigest, now, userId);
      if (result.changes !== 1) {
        this.database.exec("ROLLBACK");
        return false;
      }
      this.database.prepare(`UPDATE login_sessions SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL`).run(now, userId);
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createCatalogEntry(record: NewCatalogEntryRecord): void {
    this.assertOpen();
    this.database.prepare(`INSERT INTO catalog_entries(
      id, kind, name, mutable_reference, resolved_digest, metadata_json,
      enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.id,
      record.kind,
      record.name,
      record.mutableReference,
      record.resolvedDigest,
      record.metadataJson,
      record.enabled ? 1 : 0,
      record.createdAt,
      record.updatedAt,
    );
  }

  listCatalogEntries(enabledOnly: boolean): CatalogEntryRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      id, kind, name, mutable_reference, resolved_digest, metadata_json,
      enabled, created_at, updated_at
      FROM catalog_entries
      ${enabledOnly ? "WHERE enabled = 1" : ""}
      ORDER BY kind, name, id`).all() as Array<Record<string, string | number | null>>;
    return rows.map(mapCatalogEntry);
  }

  getCatalogEntry(id: string): CatalogEntryRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      id, kind, name, mutable_reference, resolved_digest, metadata_json,
      enabled, created_at, updated_at
      FROM catalog_entries WHERE id = ?`).get(id) as Record<string, string | number | null> | undefined;
    return row === undefined ? undefined : mapCatalogEntry(row);
  }

  addManagedSkill(input: ManagedSkillArtifactInput): ManagedSkillRecord {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.getCatalogEntry(input.name) !== undefined) throw new SkillAlreadyExistsError(input.name);
      this.database.prepare(`INSERT INTO catalog_entries(
        id, kind, name, mutable_reference, resolved_digest, metadata_json,
        enabled, created_at, updated_at
      ) VALUES (?, 'skill', ?, NULL, ?, '{}', 1, ?, ?)`).run(
        input.name, input.name, input.identity, input.now, input.now,
      );
      this.insertManagedSkillArtifact(input);
      this.database.exec("COMMIT");
      return this.getManagedSkill(input.name)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof SkillAlreadyExistsError) throw error;
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new SkillAlreadyExistsError(input.name);
      throw error;
    }
  }

  updateManagedSkillCurrent(input: ManagedSkillArtifactInput): ManagedSkillRecord {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.getManagedSkill(input.name) === undefined) throw new ManagedSkillNotFoundError(input.name);
      this.insertManagedSkillArtifact(input);
      this.database.prepare(`UPDATE catalog_entries SET resolved_digest = ?, mutable_reference = NULL,
        updated_at = ? WHERE id = ? AND kind = 'skill'`).run(input.identity, input.now, input.name);
      this.database.exec("COMMIT");
      return this.getManagedSkill(input.name)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getManagedSkill(name: string): ManagedSkillRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT c.id, c.resolved_digest, c.enabled, c.created_at,
      c.updated_at, a.file_count, a.total_bytes
      FROM catalog_entries c JOIN managed_skill_artifacts a
        ON a.skill_name = c.id AND a.content_identity = c.resolved_digest
      WHERE c.id = ? AND c.kind = 'skill'`).get(name) as Record<string, string | number> | undefined;
    return row === undefined ? undefined : mapManagedSkill(row);
  }

  listManagedSkills(enabledOnly = false): ManagedSkillRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT c.id, c.resolved_digest, c.enabled, c.created_at,
      c.updated_at, a.file_count, a.total_bytes
      FROM catalog_entries c JOIN managed_skill_artifacts a
        ON a.skill_name = c.id AND a.content_identity = c.resolved_digest
      WHERE c.kind = 'skill' ${enabledOnly ? "AND c.enabled = 1" : ""}
      ORDER BY c.id`).all() as Array<Record<string, string | number>>;
    return rows.map(mapManagedSkill);
  }

  setManagedSkillEnabled(name: string, enabled: boolean, now: string): ManagedSkillRecord {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.getManagedSkill(name) === undefined) throw new ManagedSkillNotFoundError(name);
      if (!enabled && this.defaultWorkSelectsSkill(name)) throw new DefaultSkillReferenceError(name);
      this.database.prepare("UPDATE catalog_entries SET enabled = ?, updated_at = ? WHERE id = ? AND kind = 'skill'")
        .run(enabled ? 1 : 0, now, name);
      this.database.exec("COMMIT");
      return this.getManagedSkill(name)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  removeManagedSkill(name: string): readonly string[] {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.getManagedSkill(name) === undefined) throw new ManagedSkillNotFoundError(name);
      if (this.defaultWorkSelectsSkill(name)) throw new DefaultSkillReferenceError(name);
      const artifacts = this.database.prepare("SELECT content_identity FROM managed_skill_artifacts WHERE skill_name = ?")
        .all(name) as Array<{ content_identity: string }>;
      this.database.prepare("DELETE FROM catalog_entries WHERE id = ? AND kind = 'skill'").run(name);
      this.database.exec("COMMIT");
      return artifacts.map((item) => item.content_identity);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listReferencedManagedSkillArtifacts(): Array<{ name: string; identity: string }> {
    this.assertOpen();
    return (this.database.prepare("SELECT skill_name, content_identity FROM managed_skill_artifacts ORDER BY skill_name, content_identity")
      .all() as Array<{ skill_name: string; content_identity: string }>).map((row) => ({ name: row.skill_name, identity: row.content_identity }));
  }

  private insertManagedSkillArtifact(input: ManagedSkillArtifactInput): void {
    this.database.prepare(`INSERT INTO managed_skill_artifacts(
      skill_name, content_identity, file_count, total_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?) ON CONFLICT(skill_name, content_identity) DO UPDATE SET
      file_count = excluded.file_count, total_bytes = excluded.total_bytes`).run(
      input.name, input.identity, input.fileCount, input.totalBytes, input.now,
    );
  }

  private defaultWorkSelectsSkill(name: string): boolean {
    const envelope = this.getDefaultWorkConfiguration();
    if (envelope?.configuration === null || typeof envelope?.configuration !== "object") return false;
    const skills = (envelope.configuration as { skills?: unknown }).skills;
    return Array.isArray(skills) && skills.some((skill) => skill === name || (
      skill !== null && typeof skill === "object" && (skill as { catalogId?: unknown }).catalogId === name
    ));
  }

  createSecretReference(record: NewSecretReferenceRecord): void {
    this.assertOpen();
    this.database.prepare(`INSERT INTO secret_refs(
      id, owner_user_id, name, storage_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      record.id,
      record.ownerUserId,
      record.name,
      record.storagePath,
      record.now,
      record.now,
    );
  }

  listSecretReferences(): SecretReferenceRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      id, owner_user_id, name, storage_path, created_at, updated_at
      FROM secret_refs ORDER BY name, id`).all() as Array<Record<string, string | null>>;
    return rows.map(mapSecretReference);
  }

  getSecretReference(id: string): SecretReferenceRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      id, owner_user_id, name, storage_path, created_at, updated_at
      FROM secret_refs WHERE id = ?`).get(id) as Record<string, string | null> | undefined;
    return row === undefined ? undefined : mapSecretReference(row);
  }

  updateWorkConfiguration(update: WorkConfigurationUpdate): WorkConfigurationState {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const work = this.database.prepare(`SELECT owner_user_id, desired_revision, active_revision
        FROM works WHERE id = ? AND deleted_at IS NULL`).get(update.workId) as
        | { owner_user_id: string; desired_revision: number; active_revision: number | null }
        | undefined;
      if (work === undefined) throw new Error(`Work ${update.workId} was not found`);
      if (!update.allowLastCommitWins && work.desired_revision !== update.expectedRevision) {
        throw new ConfigurationRevisionConflictError(update.workId, update.expectedRevision, work.desired_revision);
      }
      const resources = (JSON.parse(update.configJson) as { resources?: {
        cpuMillis?: unknown; memoryBytes?: unknown; agentCpuMillis?: unknown; agentMemoryBytes?: unknown;
        maxServices?: unknown; maxRetainedVolumes?: unknown;
      } }).resources;
      if (typeof resources?.cpuMillis !== "number" || typeof resources.memoryBytes !== "number"
        || typeof resources.agentCpuMillis !== "number" || typeof resources.agentMemoryBytes !== "number"
        || typeof resources.maxServices !== "number" || typeof resources.maxRetainedVolumes !== "number") {
        throw new WorkConfigurationAllocationError("Work configuration has no complete resource policy");
      }
      const serviceUsage = this.database.prepare(`SELECT
        COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS cpu,
        COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS memory
        FROM quota_reservations WHERE work_id = ? AND subject_kind = 'service'`).get(update.workId) as { cpu: number; memory: number };
      const serviceCount = (this.database.prepare("SELECT COUNT(*) AS count FROM service_heads WHERE work_id = ? AND tombstoned_at IS NULL").get(update.workId) as { count: number }).count;
      const volumeCount = (this.database.prepare("SELECT COUNT(*) AS count FROM volume_records WHERE work_id = ? AND state != 'purged'").get(update.workId) as { count: number }).count;
      if (resources.agentCpuMillis + serviceUsage.cpu > resources.cpuMillis
        || resources.agentMemoryBytes + serviceUsage.memory > resources.memoryBytes
        || serviceCount > resources.maxServices || volumeCount > resources.maxRetainedVolumes) {
        throw new WorkConfigurationAllocationError("Work resource reduction is below retained reservations or occupation");
      }
      const currentAgent = this.database.prepare(`SELECT desired_cpu_millis, desired_memory_bytes,
        occupied_cpu_millis, occupied_memory_bytes FROM quota_reservations
        WHERE work_id = ? AND subject_kind = 'agent' AND subject_id = 'agentd'`).get(update.workId) as
        | { desired_cpu_millis: number; desired_memory_bytes: number; occupied_cpu_millis: number; occupied_memory_bytes: number }
        | undefined;
      const host = this.database.prepare(`SELECT
        COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS cpu,
        COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS memory FROM quota_reservations`).get() as { cpu: number; memory: number };
      const currentAgentCpu = currentAgent === undefined ? 0 : Math.max(currentAgent.desired_cpu_millis, currentAgent.occupied_cpu_millis);
      const currentAgentMemory = currentAgent === undefined ? 0 : Math.max(currentAgent.desired_memory_bytes, currentAgent.occupied_memory_bytes);
      const candidateAgentCpu = Math.max(resources.agentCpuMillis, currentAgent?.occupied_cpu_millis ?? 0);
      const candidateAgentMemory = Math.max(resources.agentMemoryBytes, currentAgent?.occupied_memory_bytes ?? 0);
      if (update.hostCpuMillis !== undefined && host.cpu - currentAgentCpu + candidateAgentCpu > update.hostCpuMillis) throw new WorkConfigurationAllocationError("host CPU budget would be exceeded");
      if (update.hostMemoryBytes !== undefined && host.memory - currentAgentMemory + candidateAgentMemory > update.hostMemoryBytes) throw new WorkConfigurationAllocationError("host memory budget would be exceeded");
      const nextRevision = work.desired_revision + 1;
      this.database.prepare(`INSERT INTO work_config_revisions(
        work_id, revision, config_json, created_by_user_id, created_at,
        runtime_profile_json, source_runtime_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        update.workId,
        nextRevision,
        update.configJson,
        update.createdByUserId,
        update.now,
        update.runtimeProfileJson ?? null,
        update.sourceRuntimeRevision ?? null,
      );
      if (update.snapshot !== undefined) {
        if (update.snapshot.configurationJson !== update.configJson) throw new Error("Work context configuration does not match desired configuration");
        this.insertWorkContextSnapshot(update.workId, nextRevision, update.snapshot);
      }
      this.database.prepare(`UPDATE works SET
        desired_revision = ?, desired_context_id = COALESCE(?, desired_context_id),
        updated_at = ?
        WHERE id = ?`).run(nextRevision, update.snapshot?.snapshotId ?? null, update.now, update.workId);
      this.database.prepare(`UPDATE quota_reservations SET desired_cpu_millis = ?, desired_memory_bytes = ?,
        updated_at = ? WHERE work_id = ? AND subject_kind = 'agent' AND subject_id = 'agentd'`)
        .run(resources.agentCpuMillis, resources.agentMemoryBytes, update.now, update.workId);
      this.database.exec("COMMIT");
      return this.getWorkConfiguration(update.workId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  insertInitialWorkContext(workId: string, revision: number, snapshot: WorkContextSnapshotInput): void {
    this.insertWorkContextSnapshot(workId, revision, snapshot);
    const result = this.database.prepare(`UPDATE works SET desired_context_id = ? WHERE id = ?`).run(snapshot.snapshotId, workId);
    if (result.changes !== 1) throw new Error(`Work ${workId} was not found`);
  }

  private insertWorkContextSnapshot(workId: string, internalRevision: number, snapshot: WorkContextSnapshotInput): void {
    this.database.prepare(`INSERT INTO work_context_snapshots(
      snapshot_id, work_id, internal_revision, configuration_json, image_identity,
      created_by_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      snapshot.snapshotId, workId, internalRevision, snapshot.configurationJson,
      snapshot.imageIdentity, snapshot.createdByUserId, snapshot.createdAt,
    );
  }

  getWorkContextSnapshot(workId: string, snapshotId: string): WorkContextSnapshotRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT snapshot_id, work_id, internal_revision,
      configuration_json, image_identity, created_by_user_id, created_at
      FROM work_context_snapshots WHERE work_id = ? AND snapshot_id = ?`).get(workId, snapshotId) as
      | Record<string, string | number | null>
      | undefined;
    return row === undefined ? undefined : {
      snapshotId: String(row.snapshot_id),
      workId: String(row.work_id),
      internalRevision: row.internal_revision === null ? null : Number(row.internal_revision),
      configurationJson: String(row.configuration_json),
      imageIdentity: String(row.image_identity),
      createdByUserId: String(row.created_by_user_id),
      createdAt: String(row.created_at),
    };
  }

  listWorkContextSnapshots(): WorkContextSnapshotRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT snapshot_id, work_id, internal_revision,
      configuration_json, image_identity, created_by_user_id, created_at
      FROM work_context_snapshots ORDER BY work_id, created_at, snapshot_id`).all() as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      snapshotId: String(row.snapshot_id),
      workId: String(row.work_id),
      internalRevision: row.internal_revision === null ? null : Number(row.internal_revision),
      configurationJson: String(row.configuration_json),
      imageIdentity: String(row.image_identity),
      createdByUserId: String(row.created_by_user_id),
      createdAt: String(row.created_at),
    }));
  }

  activateWorkContext(workId: string, snapshotId: string, now: string): WorkConfigurationState {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const snapshot = this.getWorkContextSnapshot(workId, snapshotId);
      if (snapshot === undefined || snapshot.internalRevision === null) throw new Error("Work context is unavailable");
      const result = this.database.prepare(`UPDATE works SET active_context_id = ?, active_revision = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`).run(snapshotId, snapshot.internalRevision, now, workId);
      if (result.changes !== 1) throw new Error(`Work ${workId} was not found`);
      this.database.exec("COMMIT");
      return this.getWorkConfiguration(workId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  completeWorkContextActivation(input: {
    readonly workId: string;
    readonly snapshotId: string;
    readonly operationId: string;
    readonly targetVersion: number;
    readonly observedState: "ready" | "stopped";
    readonly resultJson: string;
    readonly now: string;
  }): WorkConfigurationState {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const work = this.database.prepare(`SELECT control_version FROM works
        WHERE id = ? AND deleted_at IS NULL`).get(input.workId) as { control_version: number } | undefined;
      const operation = this.database.prepare(`SELECT state, target_version, work_id FROM operations
        WHERE id = ?`).get(input.operationId) as { state: string; target_version: number; work_id: string | null } | undefined;
      const snapshot = this.database.prepare(`SELECT internal_revision FROM work_context_snapshots
        WHERE work_id = ? AND snapshot_id = ?`).get(input.workId, input.snapshotId) as { internal_revision: number | null } | undefined;
      if (work?.control_version !== input.targetVersion
        || operation?.state !== "running"
        || operation.target_version !== input.targetVersion
        || operation.work_id !== input.workId) {
        const error = new Error("Work operation was superseded before activation");
        error.name = "OperationSupersededError";
        throw error;
      }
      if (snapshot?.internal_revision === null || snapshot?.internal_revision === undefined) throw new Error("Work context is unavailable");
      this.database.prepare(`UPDATE works SET active_context_id = ?, active_revision = ?,
        observed_state = ?, updated_at = ? WHERE id = ?`).run(
        input.snapshotId, snapshot.internal_revision, input.observedState, input.now, input.workId,
      );
      this.database.prepare(`UPDATE operations SET state = 'succeeded', result_json = ?, error_json = NULL,
        updated_at = ? WHERE id = ?`).run(input.resultJson, input.now, input.operationId);
      this.database.exec("COMMIT");
      return this.getWorkConfiguration(input.workId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  activateWorkConfiguration(workId: string, expectedRevision: number, now: string, allowDesiredDrift = false): WorkConfigurationState {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const work = this.database.prepare(`SELECT desired_revision, active_revision FROM works
        WHERE id = ? AND deleted_at IS NULL`).get(workId) as
        | { desired_revision: number; active_revision: number | null }
        | undefined;
      if (work === undefined) throw new Error(`Work ${workId} was not found`);
      if (!allowDesiredDrift && work.desired_revision !== expectedRevision) {
        throw new ConfigurationRevisionConflictError(workId, expectedRevision, work.desired_revision);
      }
      if (work.active_revision !== expectedRevision) {
        this.database.prepare(`UPDATE works SET active_revision = ?, updated_at = ? WHERE id = ?`)
          .run(expectedRevision, now, workId);
      }
      this.database.exec("COMMIT");
      return this.getWorkConfiguration(workId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  bindWorkRuntimeProfile(
    workId: string,
    revision: number,
    runtimeProfileJson: string,
    sourceRuntimeRevision: number | null,
  ): void {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE work_config_revisions SET
      runtime_profile_json = ?, source_runtime_revision = ?
      WHERE work_id = ? AND revision = ?`).run(runtimeProfileJson, sourceRuntimeRevision, workId, revision);
    if (result.changes !== 1) throw new Error(`Work configuration ${workId}@${revision} was not found`);
  }

  getWorkConfiguration(workId: string): WorkConfigurationState | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      works.id AS work_id,
      works.owner_user_id,
      works.desired_revision,
      works.active_revision,
      works.desired_context_id,
      works.active_context_id,
      desired.config_json AS desired_config_json,
      active.config_json AS active_config_json
      FROM works
      JOIN work_config_revisions AS desired
        ON desired.work_id = works.id AND desired.revision = works.desired_revision
      LEFT JOIN work_config_revisions AS active
        ON active.work_id = works.id AND active.revision = works.active_revision
      WHERE works.id = ? AND works.deleted_at IS NULL`).get(workId) as
      | Record<string, string | number | null>
      | undefined;
    if (row === undefined) return undefined;
    const desiredRevision = Number(row.desired_revision);
    const activeRevision = row.active_revision === null ? null : Number(row.active_revision);
    return {
      workId: String(row.work_id),
      ownerUserId: String(row.owner_user_id),
      desiredRevision,
      activeRevision,
      desiredConfigJson: String(row.desired_config_json),
      activeConfigJson: row.active_config_json === null ? null : String(row.active_config_json),
      pendingRestart: row.desired_context_id !== null || row.active_context_id !== null
        ? row.desired_context_id !== row.active_context_id
        : desiredRevision !== activeRevision,
      desiredContextId: row.desired_context_id === null ? null : String(row.desired_context_id),
      activeContextId: row.active_context_id === null ? null : String(row.active_context_id),
    };
  }

  getWorkConfigRevision(workId: string, revision: number): WorkConfigRevisionRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      work_id, revision, config_json, resolved_image_digest, runtime_profile_json, source_runtime_revision
      FROM work_config_revisions WHERE work_id = ? AND revision = ?`).get(workId, revision) as
      | { work_id: string; revision: number; config_json: string; resolved_image_digest: string | null; runtime_profile_json: string | null; source_runtime_revision: number | null }
      | undefined;
    return row === undefined ? undefined : {
      workId: row.work_id,
      revision: row.revision,
      configJson: row.config_json,
      resolvedImageDigest: row.resolved_image_digest,
      runtimeProfileJson: row.runtime_profile_json,
      sourceRuntimeRevision: row.source_runtime_revision,
    };
  }

  updateWorkConfigJson(workId: string, revision: number, configJson: string): void {
    this.assertOpen();
    const result = this.database.prepare("UPDATE work_config_revisions SET config_json = ? WHERE work_id = ? AND revision = ?")
      .run(configJson, workId, revision);
    if (result.changes !== 1) throw new Error(`Work configuration ${workId}@${revision} was not found`);
  }

  nextRuntimeGeneration(workId: string): number {
    this.assertOpen();
    const row = this.database.prepare("SELECT MAX(generation) AS generation FROM runtime_generations WHERE work_id = ?")
      .get(workId) as { generation: number | null };
    return (row.generation ?? 0) + 1;
  }

  listWorkConfigArtifactBindings(workId: string, revision: number): ArtifactBindingRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT artifact_kind, ordinal, catalog_id, digest
      FROM work_config_artifacts
      WHERE work_id = ? AND revision = ?
      ORDER BY artifact_kind, ordinal`).all(workId, revision) as Array<{
      artifact_kind: "agent_image" | "skill";
      ordinal: number;
      catalog_id: string;
      digest: string;
    }>;
    return rows.map((row) => ({
      kind: row.artifact_kind,
      ordinal: row.ordinal,
      catalogId: row.catalog_id,
      digest: row.digest,
    }));
  }

  bindWorkConfigArtifacts(
    workId: string,
    revision: number,
    image: { readonly catalogId: string; readonly digest: string },
    skills: ReadonlyArray<{ readonly catalogId: string; readonly digest: string }>,
  ): ArtifactBindingRecord[] {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.listWorkConfigArtifactBindings(workId, revision);
      if (existing.length > 0) {
        this.database.exec("COMMIT");
        return existing;
      }
      const update = this.database.prepare(`UPDATE work_config_revisions
        SET resolved_image_digest = ?
        WHERE work_id = ? AND revision = ? AND resolved_image_digest IS NULL`).run(image.digest, workId, revision);
      if (update.changes !== 1) throw new Error(`Work configuration ${workId}@${revision} cannot be bound`);
      const insert = this.database.prepare(`INSERT INTO work_config_artifacts(
        work_id, revision, artifact_kind, ordinal, catalog_id, digest
      ) VALUES (?, ?, ?, ?, ?, ?)`);
      insert.run(workId, revision, "agent_image", 0, image.catalogId, image.digest);
      skills.forEach((skill, ordinal) => insert.run(workId, revision, "skill", ordinal, skill.catalogId, skill.digest));
      this.database.exec("COMMIT");
      return this.listWorkConfigArtifactBindings(workId, revision);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getWork(id: string, includeDeleted = false): WorkRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      id, owner_user_id, name, desired_state, observed_state, desired_revision,
      active_revision, control_version, deleted_at, created_at, updated_at
      FROM works WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`).get(id) as
      | Record<string, string | number | null>
      | undefined;
    return row === undefined ? undefined : mapWorkRecord(row);
  }

  listWorks(includeDeleted = false): WorkRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      id, owner_user_id, name, desired_state, observed_state, desired_revision,
      active_revision, control_version, deleted_at, created_at, updated_at
      FROM works ${includeDeleted ? "" : "WHERE deleted_at IS NULL"}
      ORDER BY created_at, id`).all() as Array<Record<string, string | number | null>>;
    return rows.map(mapWorkRecord);
  }

  getService(workId: string, serviceId: string, includeDeleted = false): ServiceRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      service_heads.work_id, service_heads.service_id, service_heads.name,
      service_heads.desired_revision, service_heads.applied_revision,
      service_heads.enabled, service_heads.observed_state, service_heads.tombstoned_at,
      service_heads.last_error_json, service_revisions.definition_json,
      service_revisions.resolved_image_digest, service_revisions.created_at
      FROM service_heads
      JOIN service_revisions
        ON service_revisions.work_id = service_heads.work_id
        AND service_revisions.service_id = service_heads.service_id
        AND service_revisions.revision = service_heads.desired_revision
      WHERE service_heads.work_id = ? AND service_heads.service_id = ?
      ${includeDeleted ? "" : "AND service_heads.tombstoned_at IS NULL"}`).get(workId, serviceId) as
      | Record<string, string | number | null>
      | undefined;
    return row === undefined ? undefined : mapServiceRecord(row);
  }

  listServices(workId: string, includeDeleted = false): ServiceRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      service_heads.work_id, service_heads.service_id, service_heads.name,
      service_heads.desired_revision, service_heads.applied_revision,
      service_heads.enabled, service_heads.observed_state, service_heads.tombstoned_at,
      service_heads.last_error_json, service_revisions.definition_json,
      service_revisions.resolved_image_digest, service_revisions.created_at
      FROM service_heads
      JOIN service_revisions
        ON service_revisions.work_id = service_heads.work_id
        AND service_revisions.service_id = service_heads.service_id
        AND service_revisions.revision = service_heads.desired_revision
      WHERE service_heads.work_id = ?
      ${includeDeleted ? "" : "AND service_heads.tombstoned_at IS NULL"}
      ORDER BY service_heads.name, service_heads.service_id`).all(workId) as Array<Record<string, string | number | null>>;
    return rows.map(mapServiceRecord);
  }

  listServiceRevisions(workId: string, serviceId: string): ServiceRevisionRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      work_id, service_id, revision, definition_json, resolved_image_digest, created_at
      FROM service_revisions WHERE work_id = ? AND service_id = ? ORDER BY revision`).all(workId, serviceId) as
      Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      workId: String(row.work_id),
      serviceId: String(row.service_id),
      revision: Number(row.revision),
      definitionJson: String(row.definition_json),
      resolvedImageDigest: row.resolved_image_digest === null ? null : String(row.resolved_image_digest),
      createdAt: String(row.created_at),
    }));
  }

  bindServiceImage(workId: string, serviceId: string, revision: number, imageIdentity: string): ServiceRevisionRecord {
    this.assertOpen();
    const row = this.database.prepare(`SELECT resolved_image_digest FROM service_revisions
      WHERE work_id = ? AND service_id = ? AND revision = ?`).get(workId, serviceId, revision) as
      { resolved_image_digest: string | null } | undefined;
    if (row === undefined) throw new Error(`service revision ${serviceId}:${revision} was not found`);
    if (row.resolved_image_digest !== null && row.resolved_image_digest !== imageIdentity) {
      throw new Error(`service revision ${serviceId}:${revision} already captured a different image`);
    }
    this.database.prepare(`UPDATE service_revisions SET resolved_image_digest = ?
      WHERE work_id = ? AND service_id = ? AND revision = ? AND resolved_image_digest IS NULL`)
      .run(imageIdentity, workId, serviceId, revision);
    return this.listServiceRevisions(workId, serviceId).find((candidate) => candidate.revision === revision)!;
  }

  updateServiceObservedState(
    workId: string,
    serviceId: string,
    observedState: string,
    now: string,
    values: { readonly appliedRevision?: number | null; readonly lastErrorJson?: string | null } = {},
  ): ServiceRecord {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE service_heads SET
      observed_state = ?,
      applied_revision = CASE WHEN ? IS NULL THEN applied_revision ELSE ? END,
      last_error_json = ?,
      desired_revision = desired_revision
      WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`).run(
      observedState,
      values.appliedRevision ?? null,
      values.appliedRevision ?? null,
      values.lastErrorJson ?? null,
      workId,
      serviceId,
    );
    if (result.changes !== 1) throw new Error(`service ${serviceId} was not found`);
    return this.getService(workId, serviceId)!;
  }

  getQuotaReservation(workId: string, subjectKind: string, subjectId: string): QuotaReservationRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      work_id, subject_kind, subject_id, desired_cpu_millis, desired_memory_bytes,
      occupied_cpu_millis, occupied_memory_bytes, service_slots, volume_slots, updated_at
      FROM quota_reservations
      WHERE work_id = ? AND subject_kind = ? AND subject_id = ?`).get(workId, subjectKind, subjectId) as
      | Record<string, string | number | null>
      | undefined;
    return row === undefined ? undefined : mapQuotaReservation(row);
  }

  listQuotaReservations(workId: string): QuotaReservationRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT work_id, subject_kind, subject_id,
      desired_cpu_millis, desired_memory_bytes, occupied_cpu_millis, occupied_memory_bytes,
      service_slots, volume_slots, updated_at FROM quota_reservations WHERE work_id = ?
      ORDER BY subject_kind, subject_id`).all(workId) as Array<Record<string, string | number>>;
    return rows.map(mapQuotaReservation);
  }

  getServiceRuntimeBinding(workId: string, serviceId: string): ServiceRuntimeBindingRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT work_id, service_id, revision, container_id, image_identity,
      recovery_count, recovery_window_started_at, next_retry_at, ready_since, updated_at
      FROM service_runtime_bindings WHERE work_id = ? AND service_id = ?`).get(workId, serviceId) as
      | Record<string, string | number | null>
      | undefined;
    return row === undefined ? undefined : mapServiceRuntimeBinding(row);
  }

  putServiceRuntimeBinding(input: ServiceRuntimeBindingRecord): ServiceRuntimeBindingRecord {
    this.assertOpen();
    this.database.prepare(`INSERT INTO service_runtime_bindings(
      work_id, service_id, revision, container_id, image_identity, recovery_count,
      recovery_window_started_at, next_retry_at, ready_since, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_id, service_id) DO UPDATE SET
      revision = excluded.revision, container_id = excluded.container_id,
      image_identity = excluded.image_identity, recovery_count = excluded.recovery_count,
      recovery_window_started_at = excluded.recovery_window_started_at,
      next_retry_at = excluded.next_retry_at, ready_since = excluded.ready_since,
      updated_at = excluded.updated_at`).run(
      input.workId, input.serviceId, input.revision, input.containerId, input.imageIdentity,
      input.recoveryCount, input.recoveryWindowStartedAt, input.nextRetryAt, input.readySince, input.updatedAt,
    );
    return this.getServiceRuntimeBinding(input.workId, input.serviceId)!;
  }

  deleteServiceRuntimeBinding(workId: string, serviceId: string): void {
    this.assertOpen();
    this.database.prepare("DELETE FROM service_runtime_bindings WHERE work_id = ? AND service_id = ?").run(workId, serviceId);
  }

  updateQuotaOccupation(
    workId: string,
    subjectKind: string,
    subjectId: string,
    occupiedCpuMillis: number,
    occupiedMemoryBytes: number,
    now: string,
  ): QuotaReservationRecord {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE quota_reservations SET
      occupied_cpu_millis = ?, occupied_memory_bytes = ?, updated_at = ?
      WHERE work_id = ? AND subject_kind = ? AND subject_id = ?`).run(
      occupiedCpuMillis,
      occupiedMemoryBytes,
      now,
      workId,
      subjectKind,
      subjectId,
    );
    if (result.changes !== 1) throw new Error(`quota reservation ${subjectKind}/${subjectId} was not found`);
    return this.getQuotaReservation(workId, subjectKind, subjectId)!;
  }

  updateQuotaDesired(workId: string, subjectKind: string, subjectId: string, cpuMillis: number, memoryBytes: number, now: string): QuotaReservationRecord {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE quota_reservations SET desired_cpu_millis = ?,
      desired_memory_bytes = ?, updated_at = ? WHERE work_id = ? AND subject_kind = ? AND subject_id = ?`)
      .run(cpuMillis, memoryBytes, now, workId, subjectKind, subjectId);
    if (result.changes !== 1) throw new Error(`quota reservation ${subjectKind}/${subjectId} was not found`);
    return this.getQuotaReservation(workId, subjectKind, subjectId)!;
  }

  releaseQuotaReservation(workId: string, subjectKind: string, subjectId: string, now: string): QuotaReservationRecord {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE quota_reservations SET
      desired_cpu_millis = 0, desired_memory_bytes = 0,
      occupied_cpu_millis = 0, occupied_memory_bytes = 0, updated_at = ?
      WHERE work_id = ? AND subject_kind = ? AND subject_id = ?`).run(
      now,
      workId,
      subjectKind,
      subjectId,
    );
    if (result.changes !== 1) throw new Error(`quota reservation ${subjectKind}/${subjectId} was not found`);
    return this.getQuotaReservation(workId, subjectKind, subjectId)!;
  }

  getOperation(id: string): OperationRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      id, work_id, service_id, kind, state, target_version, request_json,
      result_json, error_json, created_at, updated_at
      FROM operations WHERE id = ?`).get(id) as Record<string, string | number | null> | undefined;
    return row === undefined ? undefined : mapOperationRecord(row);
  }

  listOperations(states?: readonly OperationRecord["state"][]): OperationRecord[] {
    this.assertOpen();
    const where = states === undefined || states.length === 0
      ? ""
      : `WHERE state IN (${states.map(() => "?").join(",")})`;
    const rows = this.database.prepare(`SELECT
      id, work_id, service_id, kind, state, target_version, request_json,
      result_json, error_json, created_at, updated_at
      FROM operations ${where} ORDER BY created_at, id`).all(...(states ?? [])) as Array<Record<string, string | number | null>>;
    return rows.map(mapOperationRecord);
  }

  attachOperationToWork(operationId: string, workId: string): void {
    this.assertOpen();
    this.database.prepare("UPDATE operations SET work_id = ? WHERE id = ? AND work_id IS NULL").run(workId, operationId);
  }

  updateOperation(
    operationId: string,
    state: OperationRecord["state"],
    now: string,
    output: { readonly resultJson?: string | null; readonly errorJson?: string | null } = {},
  ): void {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE operations SET
      state = ?,
      result_json = COALESCE(?, result_json),
      error_json = COALESCE(?, error_json),
      updated_at = ?
      WHERE id = ?`).run(state, output.resultJson ?? null, output.errorJson ?? null, now, operationId);
    if (result.changes !== 1) throw new Error(`Operation ${operationId} was not found`);
  }

  updateWorkObservedState(workId: string, observedState: string, now: string, activeRevision?: number): void {
    this.assertOpen();
    this.database.prepare(`UPDATE works SET
      observed_state = ?,
      active_revision = COALESCE(?, active_revision),
      updated_at = ?
      WHERE id = ?`).run(observedState, activeRevision ?? null, now, workId);
  }

  ensureRuntimeGeneration(workId: string, generation: number, now: string): RuntimeGenerationRecord {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const active = this.database.prepare(`SELECT generation FROM runtime_generations
        WHERE work_id = ? AND state IN ('preparing', 'starting', 'ready', 'draining', 'stopping')
        AND generation != ?`).get(workId, generation) as { generation: number } | undefined;
      if (active !== undefined) throw new Error(`Work ${workId} already has active runtime generation ${active.generation}`);
      this.database.prepare(`INSERT INTO runtime_generations(
        work_id, generation, state, retry_count, created_at, updated_at
      ) VALUES (?, ?, 'preparing', 0, ?, ?)
      ON CONFLICT(work_id, generation) DO NOTHING`).run(workId, generation, now, now);
      this.database.exec("COMMIT");
      return this.getRuntimeGeneration(workId, generation)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateRuntimeGeneration(
    workId: string,
    generation: number,
    state: string,
    now: string,
    values: { readonly instanceId?: string | null; readonly readySince?: string | null } = {},
  ): RuntimeGenerationRecord {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE runtime_generations SET
      state = ?,
      instance_id = COALESCE(?, instance_id),
      ready_since = CASE WHEN ? = 'ready' THEN COALESCE(ready_since, ?) ELSE ready_since END,
      updated_at = ?
      WHERE work_id = ? AND generation = ?`).run(
      state,
      values.instanceId ?? null,
      state,
      values.readySince ?? null,
      now,
      workId,
      generation,
    );
    if (result.changes !== 1) throw new Error(`runtime generation ${workId}@${generation} was not found`);
    return this.getRuntimeGeneration(workId, generation)!;
  }

  getRuntimeGeneration(workId: string, generation: number): RuntimeGenerationRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      work_id, generation, instance_id, state, retry_count, retry_window_started_at,
      next_retry_at, ready_since, created_at, updated_at
      FROM runtime_generations WHERE work_id = ? AND generation = ?`).get(workId, generation) as
      | Record<string, string | number | null>
      | undefined;
    return row === undefined ? undefined : mapRuntimeGeneration(row);
  }

  listRuntimeGenerations(workId: string): RuntimeGenerationRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      work_id, generation, instance_id, state, retry_count, retry_window_started_at,
      next_retry_at, ready_since, created_at, updated_at
      FROM runtime_generations WHERE work_id = ? ORDER BY generation`).all(workId) as Array<Record<string, string | number | null>>;
    return rows.map(mapRuntimeGeneration);
  }

  recordRuntimeFailure(
    workId: string,
    generation: number,
    now: string,
    retryWindowMs = 10 * 60_000,
    backoffMs: readonly number[] = [1_000, 5_000, 15_000],
  ): RuntimeGenerationRecord {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getRuntimeGeneration(workId, generation);
      if (current === undefined) throw new Error(`runtime generation ${workId}@${generation} was not found`);
      const nowMs = new Date(now).getTime();
      const windowStartMs = current.retryWindowStartedAt === null ? undefined : new Date(current.retryWindowStartedAt).getTime();
      const resetWindow = windowStartMs === undefined || nowMs - windowStartMs >= retryWindowMs;
      const retryCount = resetWindow ? 0 : current.retryCount;
      const retryWindowStartedAt = resetWindow ? now : current.retryWindowStartedAt!;
      if (retryCount >= backoffMs.length) {
        this.database.prepare(`UPDATE runtime_generations SET
          state = 'failed', next_retry_at = NULL, retry_window_started_at = ?, updated_at = ?
          WHERE work_id = ? AND generation = ?`).run(retryWindowStartedAt, now, workId, generation);
      } else {
        const nextCount = retryCount + 1;
        const nextRetryAt = new Date(nowMs + backoffMs[retryCount]!).toISOString();
        this.database.prepare(`UPDATE runtime_generations SET
          state = 'recovering', retry_count = ?, retry_window_started_at = ?,
          next_retry_at = ?, ready_since = NULL, updated_at = ?
          WHERE work_id = ? AND generation = ?`).run(
          nextCount, retryWindowStartedAt, nextRetryAt, now, workId, generation,
        );
      }
      this.database.exec("COMMIT");
      return this.getRuntimeGeneration(workId, generation)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  resetRuntimeRetryBudget(workId: string, generation: number, now: string): RuntimeGenerationRecord {
    this.assertOpen();
    this.database.prepare(`UPDATE runtime_generations SET
      state = 'preparing', retry_count = 0, retry_window_started_at = NULL,
      next_retry_at = NULL, ready_since = NULL, updated_at = ?
      WHERE work_id = ? AND generation = ?`).run(now, workId, generation);
    return this.getRuntimeGeneration(workId, generation)!;
  }

  resetStableRuntimeRetryBudget(workId: string, generation: number, now: string, stableMs = 10 * 60_000): RuntimeGenerationRecord {
    this.assertOpen();
    const current = this.getRuntimeGeneration(workId, generation);
    if (current === undefined) throw new Error(`runtime generation ${workId}@${generation} was not found`);
    if (current.readySince !== null && new Date(now).getTime() - new Date(current.readySince).getTime() >= stableMs) {
      this.database.prepare(`UPDATE runtime_generations SET
        retry_count = 0, retry_window_started_at = NULL, next_retry_at = NULL, updated_at = ?
        WHERE work_id = ? AND generation = ?`).run(now, workId, generation);
    }
    return this.getRuntimeGeneration(workId, generation)!;
  }

  listDueRuntimeRetries(now: string): RuntimeGenerationRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      work_id, generation, instance_id, state, retry_count, retry_window_started_at,
      next_retry_at, ready_since, created_at, updated_at
      FROM runtime_generations
      WHERE state = 'recovering' AND next_retry_at <= ?
      ORDER BY next_retry_at, work_id, generation`).all(now) as Array<Record<string, string | number | null>>;
    return rows.map(mapRuntimeGeneration);
  }

  createVolumeRecord(record: NewVolumeRecord): VolumeRecord {
    this.assertOpen();
    if (!Number.isInteger(record.referenceCount) || record.referenceCount < 0) throw new Error("invalid volume reference count");
    try {
      this.database.prepare(`INSERT INTO volume_records(
        id, installation_id, work_id, service_id, volume_role, runtime_name, state,
        reference_count, retained_at, purged_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?)`).run(
        record.id,
        record.installationId,
        record.workId,
        record.serviceId ?? null,
        record.volumeRole ?? "service-data",
        record.runtimeName,
        record.referenceCount,
        record.createdAt,
      );
    } catch (error) {
      const existing = this.getVolumeRecord(record.id);
      if (
        existing === undefined
        || existing.installationId !== record.installationId
        || existing.workId !== record.workId
        || existing.serviceId !== (record.serviceId ?? null)
        || existing.runtimeName !== record.runtimeName
      ) throw error;
      return existing;
    }
    return this.getVolumeRecord(record.id)!;
  }

  getVolumeRecord(id: string): VolumeRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      id, installation_id, work_id, service_id, volume_role, runtime_name, state,
      reference_count, retained_at, purged_at, created_at
      FROM volume_records WHERE id = ?`).get(id) as Record<string, string | number | null> | undefined;
    return row === undefined ? undefined : mapVolumeRecord(row);
  }

  listVolumeRecords(workId?: string, includePurged = false): VolumeRecord[] {
    this.assertOpen();
    const conditions: string[] = [];
    const values: string[] = [];
    if (workId !== undefined) {
      conditions.push("work_id = ?");
      values.push(workId);
    }
    if (!includePurged) conditions.push("state != 'purged'");
    const rows = this.database.prepare(`SELECT
      id, installation_id, work_id, service_id, volume_role, runtime_name, state,
      reference_count, retained_at, purged_at, created_at
      FROM volume_records
      ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`}
      ORDER BY created_at, id`).all(...values) as Array<Record<string, string | number | null>>;
    return rows.map(mapVolumeRecord);
  }

  countVolumePolicySlots(workId: string): number {
    this.assertOpen();
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM volume_records
      WHERE work_id = ? AND state != 'purged'`).get(workId) as { count: number };
    return row.count;
  }

  retainWorkVolumes(workId: string, now: string): void {
    this.assertOpen();
    this.database.prepare(`DELETE FROM volume_references
      WHERE volume_id IN (SELECT id FROM volume_records WHERE work_id = ?)`).run(workId);
    this.database.prepare(`UPDATE volume_records SET reference_count = 0, state = 'retained', retained_at = ?
      WHERE work_id = ? AND state = 'active'`).run(now, workId);
  }

  detachServiceVolumeReferences(workId: string, serviceId: string, now: string): void {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`DELETE FROM volume_references WHERE consumer_kind = 'service' AND consumer_id = ?
        AND volume_id IN (SELECT id FROM volume_records WHERE work_id = ?)`).run(serviceId, workId);
      this.database.prepare(`UPDATE volume_records SET
        reference_count = (SELECT COUNT(*) FROM volume_references WHERE volume_id = volume_records.id),
        state = CASE WHEN (SELECT COUNT(*) FROM volume_references WHERE volume_id = volume_records.id) = 0 THEN 'retained' ELSE 'active' END,
        retained_at = CASE WHEN (SELECT COUNT(*) FROM volume_references WHERE volume_id = volume_records.id) = 0 THEN COALESCE(retained_at, ?) ELSE NULL END
        WHERE work_id = ? AND state IN ('active', 'retained')`).run(now, workId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  setVolumeReferenceCount(id: string, referenceCount: number, now: string): VolumeRecord {
    this.assertOpen();
    if (!Number.isInteger(referenceCount) || referenceCount < 0) throw new Error("invalid volume reference count");
    const result = this.database.prepare(`UPDATE volume_records SET
      reference_count = ?,
      state = CASE WHEN ? = 0 THEN 'retained' ELSE 'active' END,
      retained_at = CASE WHEN ? = 0 THEN COALESCE(retained_at, ?) ELSE NULL END
      WHERE id = ? AND state IN ('active', 'retained')`).run(referenceCount, referenceCount, referenceCount, now, id);
    if (result.changes !== 1) throw new Error(`volume ${id} cannot change references in its current state`);
    return this.getVolumeRecord(id)!;
  }

  requestVolumePurge(id: string): VolumeRecord {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getVolumeRecord(id);
      if (current === undefined) throw new Error(`volume ${id} was not found`);
      if (current.state === "purged" || current.state === "purge_pending") {
        this.database.exec("COMMIT");
        return current;
      }
      if (current.referenceCount !== 0) throw new ReferencedVolumeError(id, current.referenceCount);
      this.database.prepare("UPDATE volume_records SET state = 'purge_pending' WHERE id = ?").run(id);
      this.database.exec("COMMIT");
      return this.getVolumeRecord(id)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  completeVolumePurge(id: string, now: string): VolumeRecord {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE volume_records
      SET state = 'purged', purged_at = ?
      WHERE id = ? AND state = 'purge_pending'`).run(now, id);
    if (result.changes !== 1) {
      const existing = this.getVolumeRecord(id);
      if (existing?.state === "purged") return existing;
      throw new Error(`volume ${id} is not pending purge`);
    }
    return this.getVolumeRecord(id)!;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.database.close();
    } finally {
      this.lock.release();
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("CoreStore is closed");
  }
}

function mapCatalogEntry(row: Record<string, string | number | null>): CatalogEntryRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as CatalogKind,
    name: String(row.name),
    mutableReference: row.mutable_reference === null ? null : String(row.mutable_reference),
    resolvedDigest: row.resolved_digest === null ? null : String(row.resolved_digest),
    metadataJson: String(row.metadata_json),
    enabled: row.enabled === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapManagedSkill(row: Record<string, string | number>): ManagedSkillRecord {
  return {
    name: String(row.id),
    currentIdentity: String(row.resolved_digest),
    enabled: row.enabled === 1,
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSecretReference(row: Record<string, string | null>): SecretReferenceRecord {
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id === null ? null : String(row.owner_user_id),
    name: String(row.name),
    storagePath: String(row.storage_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapVolumeRecord(row: Record<string, string | number | null>): VolumeRecord {
  return {
    id: String(row.id),
    installationId: String(row.installation_id),
    workId: String(row.work_id),
    serviceId: row.service_id === null ? null : String(row.service_id),
    volumeRole: String(row.volume_role) as VolumeRecord["volumeRole"],
    runtimeName: String(row.runtime_name),
    state: String(row.state) as VolumeRecordState,
    referenceCount: Number(row.reference_count),
    retainedAt: row.retained_at === null ? null : String(row.retained_at),
    purgedAt: row.purged_at === null ? null : String(row.purged_at),
    createdAt: String(row.created_at),
  };
}

function mapWorkRecord(row: Record<string, string | number | null>): WorkRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    name: String(row.name),
    desiredState: String(row.desired_state) as WorkRecord["desiredState"],
    observedState: String(row.observed_state),
    desiredRevision: Number(row.desired_revision),
    activeRevision: row.active_revision === null ? null : Number(row.active_revision),
    controlVersion: Number(row.control_version),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapOperationRecord(row: Record<string, string | number | null>): OperationRecord {
  return {
    id: String(row.id),
    workId: row.work_id === null ? null : String(row.work_id),
    serviceId: row.service_id === null ? null : String(row.service_id),
    kind: String(row.kind),
    state: String(row.state) as OperationRecord["state"],
    targetVersion: Number(row.target_version),
    requestJson: String(row.request_json),
    resultJson: row.result_json === null ? null : String(row.result_json),
    errorJson: row.error_json === null ? null : String(row.error_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapServiceRecord(row: Record<string, string | number | null>): ServiceRecord {
  return {
    workId: String(row.work_id),
    serviceId: String(row.service_id),
    name: String(row.name),
    desiredRevision: Number(row.desired_revision),
    appliedRevision: row.applied_revision === null ? null : Number(row.applied_revision),
    enabled: row.enabled === 1,
    observedState: String(row.observed_state),
    tombstonedAt: row.tombstoned_at === null ? null : String(row.tombstoned_at),
    lastErrorJson: row.last_error_json === null ? null : String(row.last_error_json),
    definitionJson: String(row.definition_json),
    resolvedImageDigest: row.resolved_image_digest === null ? null : String(row.resolved_image_digest),
    createdAt: String(row.created_at),
  };
}

function mapQuotaReservation(row: Record<string, string | number | null>): QuotaReservationRecord {
  return {
    workId: String(row.work_id),
    subjectKind: String(row.subject_kind),
    subjectId: String(row.subject_id),
    desiredCpuMillis: Number(row.desired_cpu_millis),
    desiredMemoryBytes: Number(row.desired_memory_bytes),
    occupiedCpuMillis: Number(row.occupied_cpu_millis),
    occupiedMemoryBytes: Number(row.occupied_memory_bytes),
    serviceSlots: Number(row.service_slots),
    volumeSlots: Number(row.volume_slots),
    updatedAt: String(row.updated_at),
  };
}

function mapServiceRuntimeBinding(row: Record<string, string | number | null>): ServiceRuntimeBindingRecord {
  return {
    workId: String(row.work_id), serviceId: String(row.service_id), revision: Number(row.revision),
    containerId: row.container_id === null ? null : String(row.container_id),
    imageIdentity: row.image_identity === null ? null : String(row.image_identity),
    recoveryCount: Number(row.recovery_count),
    recoveryWindowStartedAt: row.recovery_window_started_at === null ? null : String(row.recovery_window_started_at),
    nextRetryAt: row.next_retry_at === null ? null : String(row.next_retry_at),
    readySince: row.ready_since === null ? null : String(row.ready_since),
    updatedAt: String(row.updated_at),
  };
}

function mapRuntimeGeneration(row: Record<string, string | number | null>): RuntimeGenerationRecord {
  return {
    workId: String(row.work_id),
    generation: Number(row.generation),
    instanceId: row.instance_id === null ? null : String(row.instance_id),
    state: String(row.state),
    retryCount: Number(row.retry_count),
    retryWindowStartedAt: row.retry_window_started_at === null ? null : String(row.retry_window_started_at),
    nextRetryAt: row.next_retry_at === null ? null : String(row.next_retry_at),
    readySince: row.ready_since === null ? null : String(row.ready_since),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
