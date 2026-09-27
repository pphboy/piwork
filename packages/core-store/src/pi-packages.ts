import type { DatabaseSync } from "node:sqlite";
import { acceptMutation, createMutationContext, IdempotencyConflictError, type AcceptedMutation, type MutationContext } from "./mutation.js";
import type { WorkContextSnapshotInput } from "./store.js";

export type PiPackageScope = { readonly kind: "core" } | { readonly kind: "work"; readonly workId: string };
export type PiPackageJobPhase = "queued" | "source" | "prepare" | "validate" | "publish" | "succeeded" | "failed" | "superseded" | "cleanup-pending";

export class PiPackageStoreError extends Error {
  constructor(readonly code: "PI_PACKAGE_BUSY" | "PI_PACKAGE_NOT_FOUND" | "PI_PACKAGE_ALREADY_INSTALLED" | "PI_PACKAGE_IN_DEFAULTS" | "PI_PACKAGE_STALE_JOB" | "PI_PACKAGE_REVISION_CONFLICT" | "PI_PACKAGE_HELPER_INCOMPATIBLE", message: string) {
    super(message);
    this.name = "PiPackageStoreError";
  }
}

export interface PiPackageCatalogRecord {
  readonly name: string;
  readonly enabled: boolean;
  readonly headArtifactId: string;
  readonly generation: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PiPackageArtifactRecord {
  readonly id: string;
  readonly scopeKind: "core" | "work";
  readonly workId: string | null;
  readonly name: string;
  readonly contentDigest: string;
  readonly metadataJson: string;
  readonly storagePath: string;
  readonly createdAt: string;
}

export interface PiPackageUploadRecord {
  readonly id: string;
  readonly actorId: string;
  readonly scopeKind: "core" | "work";
  readonly workId: string | null;
  readonly sourceKind: "local" | "zip";
  readonly displayName: string;
  readonly digest: string | null;
  readonly size: number;
  readonly state: "staging" | "ready" | "expired";
  readonly expiresAt: string | null;
  readonly leaseCount: number;
  readonly createdAt: string;
}

export interface PiPackageJobRecord {
  readonly operationId: string;
  readonly scopeKind: "core" | "work";
  readonly workId: string | null;
  readonly actorId: string;
  readonly kind: "install" | "update";
  readonly prepareImageId: string;
  readonly trustedHelperImageId: string;
  readonly preparedEnvironmentJson: string;
  readonly addToDefaults: boolean;
  readonly sourceJson: string;
  readonly sourceUploadId: string | null;
  readonly requestDigest: string;
  readonly packageName: string | null;
  readonly phase: PiPackageJobPhase;
  readonly workerEpoch: number;
  readonly helperId: string | null;
  readonly deadlineAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cleanupError: string | null;
}

export interface AcceptPiPackageJob {
  readonly actorId: string;
  readonly scope: PiPackageScope;
  readonly kind: "install" | "update";
  readonly prepareImageId: string;
  readonly trustedHelperImageId: string;
  readonly preparedEnvironmentJson: string;
  readonly addToDefaults: boolean;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly requestJson: string;
  readonly sourceJson: string;
  readonly sourceUploadId?: string;
  readonly packageName?: string;
  readonly deadlineAt: string;
  readonly now: string;
}

const CATALOG = "name, enabled, head_artifact_id AS headArtifactId, generation, created_at AS createdAt, updated_at AS updatedAt";
const ARTIFACT = "id, scope_kind AS scopeKind, work_id AS workId, name, content_digest AS contentDigest, metadata_json AS metadataJson, storage_path AS storagePath, created_at AS createdAt";
const UPLOAD = "id, actor_id AS actorId, scope_kind AS scopeKind, work_id AS workId, source_kind AS sourceKind, display_name AS displayName, digest, size, state, expires_at AS expiresAt, lease_count AS leaseCount, created_at AS createdAt";
const JOB = "operation_id AS operationId, scope_kind AS scopeKind, work_id AS workId, actor_id AS actorId, kind, prepare_image_id AS prepareImageId, trusted_helper_image_id AS trustedHelperImageId, prepared_environment_json AS preparedEnvironmentJson, add_to_defaults AS addToDefaults, source_json AS sourceJson, source_upload_id AS sourceUploadId, request_digest AS requestDigest, package_name AS packageName, phase, worker_epoch AS workerEpoch, helper_id AS helperId, deadline_at AS deadlineAt, created_at AS createdAt, updated_at AS updatedAt, cleanup_error AS cleanupError";
const LIVE = "('queued','source','prepare','validate','publish','cleanup-pending')";

/** Package state shares CoreStore's SQLite connection and mutation gate. */
export class PiPackageStore {
  constructor(private readonly database: DatabaseSync) {}

  private transaction<T>(effect: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = effect(); this.database.exec("COMMIT"); return result; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  listCatalog(includeDisabled = true): PiPackageCatalogRecord[] {
    const sql = `SELECT ${CATALOG} FROM pi_package_catalog ${includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY name COLLATE BINARY`;
    return (this.database.prepare(sql).all() as unknown as Array<Omit<PiPackageCatalogRecord, "enabled"> & { enabled: number }>).map((item) => ({ ...item, enabled: item.enabled === 1 }));
  }

  getCatalog(name: string): PiPackageCatalogRecord | undefined {
    const row = this.database.prepare(`SELECT ${CATALOG} FROM pi_package_catalog WHERE name = ?`).get(name) as unknown as (Omit<PiPackageCatalogRecord, "enabled"> & { enabled: number }) | undefined;
    return row === undefined ? undefined : { ...row, enabled: row.enabled === 1 };
  }

  getArtifact(id: string): PiPackageArtifactRecord | undefined {
    return this.database.prepare(`SELECT ${ARTIFACT} FROM pi_package_artifacts WHERE id = ?`).get(id) as unknown as PiPackageArtifactRecord | undefined;
  }

  /** Select all heads in one SQLite snapshot and hold their immutable bytes through context capture. */
  leaseCatalogHeads(names: readonly string[]): PiPackageArtifactRecord[] {
    return this.transaction(() => names.map((name) => {
      const catalog = this.getCatalog(name);
      if (!catalog?.enabled) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${name} is unavailable`);
      const artifact = this.getArtifact(catalog.headArtifactId);
      if (!artifact || artifact.scopeKind !== "core" || artifact.name !== name) {
        throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${name} artifact is unavailable`);
      }
      this.database.prepare("UPDATE pi_package_artifacts SET lease_count = lease_count + 1 WHERE id = ?").run(artifact.id);
      return artifact;
    }));
  }

  releaseArtifactLeases(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.transaction(() => {
      for (const id of ids) this.database.prepare("UPDATE pi_package_artifacts SET lease_count = lease_count - 1 WHERE id = ? AND lease_count > 0").run(id);
    });
  }

  getUpload(id: string): PiPackageUploadRecord | undefined {
    return this.database.prepare(`SELECT ${UPLOAD} FROM pi_package_uploads WHERE id = ?`).get(id) as unknown as PiPackageUploadRecord | undefined;
  }

  getJob(operationId: string): PiPackageJobRecord | undefined {
    const row = this.database.prepare(`SELECT ${JOB} FROM pi_package_jobs WHERE operation_id = ?`).get(operationId) as unknown as (Omit<PiPackageJobRecord, "addToDefaults"> & { addToDefaults: number }) | undefined;
    return row === undefined ? undefined : { ...row, addToDefaults: row.addToDefaults === 1 };
  }

  listJobs(nonterminalOnly = false): PiPackageJobRecord[] {
    return (this.database.prepare(`SELECT ${JOB} FROM pi_package_jobs ${nonterminalOnly ? `WHERE phase IN ${LIVE}` : ""} ORDER BY created_at, operation_id`).all() as unknown as Array<Omit<PiPackageJobRecord, "addToDefaults"> & { addToDefaults: number }>).map((row) => ({ ...row, addToDefaults: row.addToDefaults === 1 }));
  }

  findReplay(actorId: string, scope: PiPackageScope, kind: "install" | "update", idempotencyKey: string, requestDigest: string): AcceptedMutation | undefined {
    const row = this.database.prepare(`SELECT request_digest AS requestDigest, resource_id AS resourceId, operation_id AS operationId
      FROM idempotency_records WHERE principal_id = ? AND work_scope = ? AND operation_kind = ? AND idempotency_key = ?`).get(
      actorId, scope.kind === "core" ? "core-pi-packages" : scope.workId, `pi-package-${kind}`, idempotencyKey,
    ) as { requestDigest: string; resourceId: string; operationId: string } | undefined;
    if (!row) return undefined;
    if (row.requestDigest !== requestDigest) throw new IdempotencyConflictError(idempotencyKey);
    return { operationId: row.operationId, resourceId: row.resourceId, reused: true };
  }

  accept(input: AcceptPiPackageJob): AcceptedMutation {
    if (input.addToDefaults && (input.scope.kind !== "core" || input.kind !== "install")) throw new TypeError("only Core install can add a default package");
    const workId = input.scope.kind === "work" ? input.scope.workId : null;
    const workScope = workId ?? "core-pi-packages";
    return acceptMutation(this.database, {
      principalId: input.actorId, workScope, operationKind: `pi-package-${input.kind}`,
      idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest,
      requestJson: input.requestJson, targetVersion: 1, now: input.now,
      ...(workId === null ? {} : { workId }),
    }, (tx) => {
      const active = tx.get<{ operation_id: string }>(`SELECT operation_id FROM pi_package_jobs WHERE scope_kind = ? AND work_id IS ? AND phase IN ${LIVE}`, input.scope.kind, workId);
      if (active !== undefined) throw new PiPackageStoreError("PI_PACKAGE_BUSY", "package operation is already active for this scope");
      const source = JSON.parse(input.sourceJson) as { kind?: unknown; name?: unknown };
      let capturedSourceJson = input.sourceJson;
      let capturedArtifactId: string | undefined;
      let capturedArtifactName: string | undefined;
      if (input.scope.kind === "work" && source.kind === "core") {
        if (typeof source.name !== "string") throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "Core package is unavailable");
        const catalog = this.getCatalog(source.name);
        if (!catalog?.enabled) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "Core package is unavailable");
        const artifact = this.getArtifact(catalog.headArtifactId);
        if (!artifact || artifact.scopeKind !== "core" || artifact.name !== source.name) {
          throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "Core package artifact is unavailable");
        }
        const metadata = JSON.parse(artifact.metadataJson) as { preparedEnvironment?: Record<string, unknown> };
        const target = JSON.parse(input.preparedEnvironmentJson) as Record<string, unknown>;
        const prepared = metadata.preparedEnvironment;
        if (!prepared || ["os", "architecture", "variant", "nodeAbi", "piSdkVersion"].some((field) => prepared[field] !== target[field])) {
          throw Object.assign(new Error("Core package environment is incompatible"), { code: "PI_PACKAGE_ENVIRONMENT_MISMATCH" });
        }
        capturedArtifactId = artifact.id;
        capturedArtifactName = source.name;
        capturedSourceJson = JSON.stringify({ kind: "core", name: source.name, artifactId: artifact.id });
      }
      tx.run(`INSERT INTO pi_package_jobs(operation_id, scope_kind, work_id, actor_id, kind, prepare_image_id, trusted_helper_image_id, prepared_environment_json, add_to_defaults, source_json, source_upload_id,
        request_digest, package_name, phase, worker_epoch, deadline_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, ?)`,
        tx.operationId, input.scope.kind, workId, input.actorId, input.kind,
        input.prepareImageId, input.trustedHelperImageId, input.preparedEnvironmentJson, input.addToDefaults ? 1 : 0,
        capturedSourceJson, input.sourceUploadId ?? null, input.requestDigest, input.packageName ?? null,
        input.deadlineAt, input.now, input.now);
      if (input.sourceUploadId !== undefined) {
        const leased = this.database.prepare(`UPDATE pi_package_uploads SET lease_count = lease_count + 1
          WHERE id = ? AND actor_id = ? AND scope_kind = ? AND work_id IS ? AND state = 'ready'
            AND expires_at > ?`).run(input.sourceUploadId, input.actorId, input.scope.kind, workId, input.now);
        if (leased.changes !== 1) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "package upload is unavailable");
      }
      if (capturedArtifactId !== undefined) {
        const leased = this.database.prepare(`UPDATE pi_package_artifacts SET lease_count = lease_count + 1
            WHERE id = ? AND scope_kind = 'core' AND name = ?`).run(capturedArtifactId, capturedArtifactName!);
        if (leased.changes !== 1) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "captured Core package is unavailable");
      }
      return { resourceId: workId ?? "core-pi-packages" };
    });
  }

  advanceJob(operationId: string, workerEpoch: number, phase: PiPackageJobPhase, now: string, fields: { name?: string; helperId?: string | null } = {}): PiPackageJobRecord {
    if (!["source", "prepare", "validate", "publish"].includes(phase)) throw new Error("advanceJob requires a live processing phase");
    return this.transaction(() => {
      const current = this.getJob(operationId);
      if (current === undefined || current.workerEpoch !== workerEpoch || !["queued", "source", "prepare", "validate", "publish"].includes(current.phase)) {
        throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "package operation is no longer current");
      }
      this.database.prepare(`UPDATE pi_package_jobs SET phase = ?, package_name = COALESCE(?, package_name),
        helper_id = ?, updated_at = ? WHERE operation_id = ?`).run(phase, fields.name ?? null, fields.helperId === undefined ? current.helperId : fields.helperId, now, operationId);
      this.database.prepare("UPDATE operations SET state = 'running', updated_at = ? WHERE id = ? AND state IN ('pending','running')").run(now, operationId);
      return this.getJob(operationId)!;
    });
  }

  /** Atomic publication hook also covers a context-pointer or catalog-head write. */
  commitJob(operationId: string, workerEpoch: number, now: string, resultJson: string, publish: (tx: MutationContext, job: PiPackageJobRecord) => void): void {
    this.transaction(() => {
      const job = this.getJob(operationId);
      if (job === undefined || job.workerEpoch !== workerEpoch || job.phase !== "publish") {
        throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "package operation cannot publish");
      }
      if (job.workId !== null && this.database.prepare("SELECT 1 FROM work_snapshot_locks WHERE work_id = ?").get(job.workId)) {
        throw Object.assign(new Error("WORK_SNAPSHOT_BUSY"), { code: "WORK_SNAPSHOT_BUSY" });
      }
      const tx = createMutationContext(this.database, operationId);
      publish(tx, job);
      const completed = this.database.prepare("UPDATE operations SET state = 'succeeded', result_json = ?, updated_at = ? WHERE id = ? AND state IN ('pending','running')").run(resultJson, now, operationId);
      if (completed.changes !== 1) throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "package operation has already finished");
      tx.run("UPDATE pi_package_jobs SET phase = 'succeeded', updated_at = ? WHERE operation_id = ?", now, operationId);
      this.releaseJobLeasesLocked(job);
    });
  }

  /** Commit a Core catalog head and optional default selection with the Operation result. */
  publishCore(operationId: string, workerEpoch: number, artifact: PiPackageArtifactRecord, now: string, resultJson: string): PiPackageCatalogRecord {
    let published: PiPackageCatalogRecord | undefined;
    this.commitJob(operationId, workerEpoch, now, resultJson, (tx, job) => {
      if (job.scopeKind !== "core" || artifact.scopeKind !== "core" || artifact.workId !== null || (job.packageName !== null && job.packageName !== artifact.name)) {
        throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "package artifact does not match Core job");
      }
      const previous = this.getCatalog(artifact.name);
      if (job.kind === "install" && previous !== undefined) throw new PiPackageStoreError("PI_PACKAGE_ALREADY_INSTALLED", `package ${artifact.name} is already installed`);
      if (job.kind === "update" && previous === undefined) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${artifact.name} is not installed`);
      if (job.addToDefaults && job.kind !== "install") throw new Error("only Core install can append a default package");
      this.insertArtifact(tx, artifact);
      if (previous === undefined) {
        tx.run("INSERT INTO pi_package_catalog(name, enabled, head_artifact_id, generation, created_at, updated_at) VALUES (?, 1, ?, 1, ?, ?)", artifact.name, artifact.id, now, now);
      } else {
        tx.run("UPDATE pi_package_catalog SET head_artifact_id = ?, generation = generation + 1, updated_at = ? WHERE name = ?", artifact.id, now, artifact.name);
      }
      if (job.addToDefaults) this.appendDefaultSelection(tx, artifact.name, now);
      published = this.getCatalog(artifact.name);
    });
    return published!;
  }

  /** Publish an owned context and its desired configuration in the same transaction as job success. */
  publishWork(input: { operationId: string; workerEpoch: number; expectedRevision: number;
    configJson: string; runtimeProfileJson: string; sourceRuntimeRevision: number | null;
    snapshot: WorkContextSnapshotInput; artifact: PiPackageArtifactRecord; now: string; resultJson: string }): void {
    this.commitJob(input.operationId, input.workerEpoch, input.now, input.resultJson, (tx, job) => {
      if (job.scopeKind !== "work" || job.workId === null || input.artifact.workId !== job.workId
        || input.artifact.scopeKind !== "work" || (input.artifact.name !== job.packageName && job.kind === "update")
        || input.snapshot.configurationJson !== input.configJson) {
        throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "Work package publication does not match its job");
      }
      const work = tx.get<{ desired_revision: number; owner_user_id: string }>(
        "SELECT desired_revision, owner_user_id FROM works WHERE id = ? AND deleted_at IS NULL", job.workId);
      if (!work) throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "Work no longer exists");
      if (work.desired_revision !== input.expectedRevision) throw new PiPackageStoreError("PI_PACKAGE_REVISION_CONFLICT", "Work configuration changed");
      const prior = tx.get<{ config_json: string }>("SELECT config_json FROM work_config_revisions WHERE work_id = ? AND revision = ?", job.workId, work.desired_revision);
      if (!prior) throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "Work configuration is unavailable");
      const selected = (JSON.parse(prior.config_json) as { packages: Array<{ name: string }> }).packages;
      const exists = selected.some((item) => item.name === input.artifact.name);
      if (job.kind === "install" && exists) throw new PiPackageStoreError("PI_PACKAGE_ALREADY_INSTALLED", "Package is already installed in this Work");
      if (job.kind === "update" && !exists) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "Package is no longer installed in this Work");
      const revision = work.desired_revision + 1;
      this.insertArtifact(tx, input.artifact);
      tx.run(`INSERT INTO work_config_revisions(work_id,revision,config_json,created_by_user_id,created_at,runtime_profile_json,source_runtime_revision)
        VALUES (?,?,?,?,?,?,?)`, job.workId, revision, input.configJson, job.actorId, input.now, input.runtimeProfileJson, input.sourceRuntimeRevision);
      tx.run(`INSERT INTO work_context_snapshots(snapshot_id,work_id,internal_revision,configuration_json,image_identity,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?)`, input.snapshot.snapshotId, job.workId, revision, input.snapshot.configurationJson,
        input.snapshot.imageIdentity, input.snapshot.createdByUserId, input.snapshot.createdAt);
      tx.run("UPDATE works SET desired_revision = ?, desired_context_id = ?, updated_at = ? WHERE id = ?",
        revision, input.snapshot.snapshotId, input.now, job.workId);
    });
  }

  private appendDefaultSelection(tx: MutationContext, name: string, now: string): void {
    const row = tx.get<{ value_json: string }>("SELECT value_json FROM control_metadata WHERE key = 'default_work_configuration'");
    if (row === undefined) throw new Error("default Work configuration is not initialized");
    const envelope = JSON.parse(row.value_json) as { version: number; revision: number; configuration: Record<string, unknown> | null };
    if (envelope.version !== 1 || !Number.isSafeInteger(envelope.revision) || envelope.configuration === null || !Array.isArray(envelope.configuration.packages)) {
      throw new Error("default Work configuration has no package selection");
    }
    const packages = envelope.configuration.packages as Array<{ name: string; enabled: boolean }>;
    if (packages.some((item) => item.name === name)) throw new Error("package is already selected by default Work configuration");
    if (packages.length >= 64) throw new Error("default Work package limit exceeded");
    const next = { ...envelope, revision: envelope.revision + 1, configuration: { ...envelope.configuration, packages: [...packages, { name, enabled: true }] }, updatedAt: now };
    tx.run("UPDATE control_metadata SET value_json = ?, updated_at = ? WHERE key = 'default_work_configuration'", JSON.stringify(next), now);
  }

  private defaultContains(name: string): boolean {
    const row = this.database.prepare("SELECT value_json FROM control_metadata WHERE key = 'default_work_configuration'").get() as { value_json: string } | undefined;
    if (!row) return false;
    const envelope = JSON.parse(row.value_json) as { configuration?: { packages?: Array<{ name: string }> } | null };
    return envelope.configuration?.packages?.some((item) => item.name === name) ?? false;
  }

  isDefault(name: string): boolean { return this.defaultContains(name); }

  private assertCoreIdle(): void {
    if (this.database.prepare(`SELECT 1 FROM pi_package_jobs WHERE scope_kind = 'core' AND phase IN ${LIVE}`).get()) {
      throw new PiPackageStoreError("PI_PACKAGE_BUSY", "Core package catalog has an active operation");
    }
  }

  setCatalogEnabled(name: string, enabled: boolean, now: string): PiPackageCatalogRecord {
    return this.transaction(() => {
      this.assertCoreIdle();
      const current = this.getCatalog(name);
      if (!current) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${name} is not installed`);
      if (!enabled && this.defaultContains(name)) throw new PiPackageStoreError("PI_PACKAGE_IN_DEFAULTS", `package ${name} is selected by default`);
      if (current.enabled !== enabled) this.database.prepare("UPDATE pi_package_catalog SET enabled = ?, updated_at = ? WHERE name = ?").run(enabled ? 1 : 0, now, name);
      return this.getCatalog(name)!;
    });
  }

  removeCatalog(name: string): PiPackageCatalogRecord {
    return this.transaction(() => {
      this.assertCoreIdle();
      const current = this.getCatalog(name);
      if (!current) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${name} is not installed`);
      if (this.defaultContains(name)) throw new PiPackageStoreError("PI_PACKAGE_IN_DEFAULTS", `package ${name} is selected by default`);
      this.database.prepare("DELETE FROM pi_package_catalog WHERE name = ?").run(name);
      return current;
    });
  }

  insertArtifact(tx: MutationContext, artifact: PiPackageArtifactRecord): void {
    const existing = this.getArtifact(artifact.id);
    if (existing !== undefined) {
      if (existing.scopeKind !== artifact.scopeKind || existing.workId !== artifact.workId || existing.name !== artifact.name ||
          existing.contentDigest !== artifact.contentDigest || existing.metadataJson !== artifact.metadataJson || existing.storagePath !== artifact.storagePath) {
        throw new Error("package artifact identity collision");
      }
      return;
    }
    tx.run(`INSERT INTO pi_package_artifacts(id, scope_kind, work_id, name, content_digest, metadata_json, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, artifact.id, artifact.scopeKind, artifact.workId, artifact.name,
      artifact.contentDigest, artifact.metadataJson, artifact.storagePath, artifact.createdAt);
  }

  insertUpload(upload: PiPackageUploadRecord): void {
    if (upload.scopeKind === "work") {
      const work = this.database.prepare(`SELECT 1 FROM works WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL
        AND observed_state IN ('ready','degraded','stopped','failed')`).get(upload.workId, upload.actorId);
      if (!work || this.database.prepare("SELECT 1 FROM work_snapshot_locks WHERE work_id = ?").get(upload.workId)) {
        throw new PiPackageStoreError("PI_PACKAGE_BUSY", "Work changed during package upload");
      }
    }
    this.database.prepare(`INSERT INTO pi_package_uploads(id, actor_id, scope_kind, work_id, source_kind, display_name,
      digest, size, state, expires_at, lease_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      upload.id, upload.actorId, upload.scopeKind, upload.workId, upload.sourceKind, upload.displayName,
      upload.digest, upload.size, upload.state, upload.expiresAt, upload.leaseCount, upload.createdAt);
  }

  releaseUploadLease(id: string): void {
    this.database.prepare("UPDATE pi_package_uploads SET lease_count = lease_count - 1 WHERE id = ? AND lease_count > 0").run(id);
  }

  private releaseJobLeasesLocked(job: PiPackageJobRecord): void {
    const row = this.database.prepare("SELECT leases_released AS released FROM pi_package_jobs WHERE operation_id = ?")
      .get(job.operationId) as { released: number } | undefined;
    if (!row || row.released === 1) return;
    if (job.sourceUploadId !== null) this.database.prepare(
      "UPDATE pi_package_uploads SET lease_count = lease_count - 1 WHERE id = ? AND lease_count > 0",
    ).run(job.sourceUploadId);
    const source = JSON.parse(job.sourceJson) as { kind?: unknown; artifactId?: unknown };
    if (job.scopeKind === "work" && source.kind === "core" && typeof source.artifactId === "string") {
      this.database.prepare("UPDATE pi_package_artifacts SET lease_count = lease_count - 1 WHERE id = ? AND lease_count > 0")
        .run(source.artifactId);
    }
    this.database.prepare("UPDATE pi_package_jobs SET leases_released = 1 WHERE operation_id = ?").run(job.operationId);
  }

  /** Caller holds CoreStore's outer mutation transaction; queued jobs have not touched source bytes. */
  releaseQueuedWorkJobLeases(workId: string): void {
    for (const job of this.listJobs(true).filter((item) => item.workId === workId && item.phase === "queued")) {
      this.releaseJobLeasesLocked(job);
    }
  }

  /** Release a superseded in-flight job only after its helper and spool are gone. */
  releaseTerminalJobLeases(operationId: string): void {
    this.transaction(() => {
      const job = this.getJob(operationId);
      if (!job || !["succeeded", "failed", "superseded"].includes(job.phase)) return;
      this.releaseJobLeasesLocked(job);
    });
  }

  finishJob(operationId: string, workerEpoch: number, phase: "failed" | "superseded" | "cleanup-pending", now: string, resultJson: string, cleanupError?: string): void {
    this.transaction(() => {
      const job = this.getJob(operationId);
      if (job === undefined || job.workerEpoch !== workerEpoch || !["queued", "source", "prepare", "validate", "publish", "cleanup-pending"].includes(job.phase)) {
        throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "package operation is no longer current");
      }
      const operationState = phase === "cleanup-pending" ? "running" : phase;
      const changed = this.database.prepare("UPDATE operations SET state = ?, error_json = ?, updated_at = ? WHERE id = ? AND state IN ('pending','running')").run(operationState, resultJson, now, operationId);
      if (changed.changes !== 1) throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "package operation has already finished");
      this.database.prepare("UPDATE pi_package_jobs SET phase = ?, cleanup_error = ?, updated_at = ? WHERE operation_id = ?").run(phase, cleanupError ?? null, now, operationId);
      if (phase !== "cleanup-pending") this.releaseJobLeasesLocked(job);
    });
  }

  bumpWorkerEpoch(operationId: string, expectedEpoch: number, now: string): PiPackageJobRecord {
    return this.transaction(() => {
      const current = this.getJob(operationId);
      if (current === undefined || current.workerEpoch !== expectedEpoch || ["succeeded", "failed", "superseded"].includes(current.phase)) {
        throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "package operation is no longer current");
      }
      this.database.prepare("UPDATE pi_package_jobs SET worker_epoch = worker_epoch + 1, updated_at = ? WHERE operation_id = ?").run(now, operationId);
      return this.getJob(operationId)!;
    });
  }

  expireUploads(now: string): string[] {
    return this.transaction(() => {
      const rows = this.database.prepare("SELECT id FROM pi_package_uploads WHERE state = 'ready' AND expires_at <= ? AND lease_count = 0").all(now) as Array<{ id: string }>;
      for (const row of rows) this.database.prepare("UPDATE pi_package_uploads SET state = 'expired' WHERE id = ?").run(row.id);
      return rows.map(({ id }) => id);
    });
  }

  listExpiredUploads(): PiPackageUploadRecord[] {
    return (this.database.prepare(`SELECT ${UPLOAD} FROM pi_package_uploads WHERE state = 'expired' AND lease_count = 0`).all() as unknown as Array<Omit<PiPackageUploadRecord, "leaseCount"> & { leaseCount: number }>);
  }

  /** Return paths whose retired Core artifacts lost every catalog, job, and context-capture reference. */
  retireUnreferencedCoreArtifacts(cutoff: string): string[] {
    return this.transaction(() => {
      if (this.database.prepare(`SELECT 1 FROM pi_package_jobs WHERE phase IN ${LIVE} LIMIT 1`).get()) return [];
      const rows = this.database.prepare(`SELECT id, storage_path AS storagePath FROM pi_package_artifacts
        WHERE scope_kind = 'core' AND created_at <= ? AND lease_count = 0
          AND id NOT IN (SELECT head_artifact_id FROM pi_package_catalog)`).all(cutoff) as Array<{ id: string; storagePath: string }>;
      for (const row of rows) this.database.prepare("DELETE FROM pi_package_artifacts WHERE id = ?").run(row.id);
      return [...new Set(rows.map((row) => row.storagePath))].filter((path) => !this.database.prepare(
        "SELECT 1 FROM pi_package_artifacts WHERE storage_path = ? LIMIT 1",
      ).get(path));
    });
  }

  listCoreArtifactStoragePaths(): string[] {
    return (this.database.prepare("SELECT DISTINCT storage_path AS path FROM pi_package_artifacts WHERE scope_kind = 'core'")
      .all() as Array<{ path: string }>).map(({ path }) => path);
  }
}
