import { createHash, randomUUID } from "node:crypto";
import type { OperationDiagnostics, PublicOperation, WorkConfig } from "@piwork/contracts";
import { CoreStore, PiPackageStoreError, type OperationRecord, type WorkConfigurationState, type WorkContextSnapshotInput, type WorkRecord } from "@piwork/core-store";
import { authorizeWorkResource, filterVisibleResources, type UserPrincipal } from "../work-access/policy.js";
import { WorkContextError, WorkContextStore } from "../configuration/work-context.js";
import { diagnosticFromError, emitDiagnostic, errorEnvelope, operationEnvelope, operationWithStage, publicOperation, safeDiagnostic, type JsonLineLogger } from "./diagnostics.js";
import { managedVolumeName } from "@piwork/runtime-docker";
import { snapshotOperation } from "../work-snapshots/access.js";

export interface WorkRuntimeState {
  readonly exists: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly instanceId?: string;
  readonly generation?: number;
}

export interface WorkRuntimeAdapter {
  resolveImageIdentity?(reference: string): Promise<string>;
  prepare(work: WorkRecord, configuration?: ResolvedWorkRuntimeConfiguration): Promise<void>;
  start(work: WorkRecord, generation: number, configuration?: ResolvedWorkRuntimeConfiguration): Promise<{ readonly instanceId: string; readonly generation: number }>;
  inspect(workId: string): Promise<WorkRuntimeState>;
  prepareConfigurationChange?(workId: string): Promise<{ readonly prepared: boolean; readonly busy: boolean; readonly activeRunCount: number }>;
  drain(workId: string, timeoutMs: number): Promise<void>;
  stop(workId: string, timeoutMs: number): Promise<void>;
  remove(workId: string, options?: { readonly preserveNetwork?: boolean }): Promise<void>;
  listManagedInstances?(): Promise<readonly { readonly workId: string; readonly instanceId: string }[]>;
}

export interface ResolvedWorkRuntimeConfiguration {
  readonly workConfig: WorkConfig;
  readonly runtimeProfileJson: string;
  readonly contextIdentity: string;
  readonly contextDirectory: string;
  readonly imageIdentity: string;
  readonly skillIdentities: readonly { readonly name: string; readonly identity: string }[];
  readonly packageBindings?: readonly { readonly name: string; readonly artifact: { readonly contentDigest: string; readonly resourceCounts: { readonly extensions: number; readonly skills: number; readonly prompts: number; readonly themes: number } } }[];
  readonly initializationOnly?: boolean;
  readonly correlationId?: string;
}

export interface WorkRecoveryReport {
  readonly adoptedWorkIds: readonly string[];
  readonly orphanedInstances: readonly { readonly workId: string; readonly instanceId: string }[];
}

export interface WorkServiceCoordinator {
  prepareEnabledServices(work: WorkRecord): Promise<void>;
  stopServices(workId: string, timeoutMs: number): Promise<void>;
  removeServiceInstances(workId: string): Promise<void>;
  hasFailedServices?(workId: string): boolean;
}

const NO_SERVICES: WorkServiceCoordinator = {
  async prepareEnabledServices() {},
  async stopServices() {},
  async removeServiceInstances() {},
};

export interface AcceptedWorkOperation {
  readonly workId: string;
  readonly operationId: string;
  readonly reused: boolean;
}

class ApplyConfigurationFailure extends Error {
  constructor(
    readonly primary: unknown,
    readonly rollback: OperationDiagnostics["rollback"],
  ) {
    super("Work configuration apply failed");
    this.name = "ApplyConfigurationFailure";
  }
}

class OperationSupersededError extends Error {
  constructor() {
    super("Work operation was superseded");
    this.name = "OperationSupersededError";
  }
}

export class WorkResourceQuotaError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  constructor(message: string) { super(message); this.name = "WorkResourceQuotaError"; }
}

export class WorkLifecycleService {
  private readonly queues = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    private readonly store: CoreStore,
    private readonly runtime: WorkRuntimeAdapter,
    private readonly now: () => Date = () => new Date(),
    private readonly drainTimeoutMs = 30_000,
    private readonly stopTimeoutMs = 10_000,
    private readonly services: WorkServiceCoordinator = NO_SERVICES,
    private readonly contexts?: WorkContextStore,
    private readonly diagnosticLogger?: JsonLineLogger,
    private readonly installationId?: string,
    private readonly hostQuota = { cpuMillis: 128_000, memoryBytes: 256 * 1_024 * 1_024 * 1_024 },
  ) {}

  create(
    principal: UserPrincipal,
    input: {
      readonly name: string;
      readonly configuration: WorkConfig;
      readonly idempotencyKey: string;
      readonly runtimeProfileJson?: string;
      readonly sourceRuntimeRevision?: number;
      readonly workId?: string;
      readonly snapshot?: WorkContextSnapshotInput;
      readonly correlationId?: string;
    },
  ): AcceptedWorkOperation {
    this.assertAccepting();
    const workId = input.workId ?? `work-${randomUUID()}`;
    const publicRequestJson = stableJson({ name: input.name, configuration: input.configuration });
    const requestJson = stableJson({
      name: input.name,
      configuration: input.configuration,
      capturedSnapshotId: input.snapshot?.snapshotId ?? null,
      capturedRevision: 1,
    });
    let accepted;
    try {
      accepted = this.store.acceptMutation({
        principalId: principal.userId,
        workScope: "new-work",
        operationKind: "create-work",
        idempotencyKey: input.idempotencyKey,
        requestDigest: digest(publicRequestJson),
        requestJson,
        targetVersion: 1,
        now: this.now().toISOString(),
      }, (tx) => {
        const now = this.now().toISOString();
        this.store.snapshots.assertNameAvailable(principal.userId, input.name);
        const host = tx.get<{ cpu: number; memory: number }>(`SELECT
          COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS cpu,
          COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS memory FROM quota_reservations`) ?? { cpu: 0, memory: 0 };
        if (host.cpu + input.configuration.resources.agentCpuMillis > this.hostQuota.cpuMillis) throw new WorkResourceQuotaError("host CPU budget would be exceeded");
        if (host.memory + input.configuration.resources.agentMemoryBytes > this.hostQuota.memoryBytes) throw new WorkResourceQuotaError("host memory budget would be exceeded");
        tx.run(`INSERT INTO works(
          id, owner_user_id, name, desired_state, observed_state,
          desired_revision, active_revision, control_version, created_at, updated_at
        ) VALUES (?, ?, ?, 'running', 'provisioning', 1, NULL, 1, ?, ?)`, workId, principal.userId, input.name, now, now);
        tx.run(`INSERT INTO work_config_revisions(
          work_id, revision, config_json, created_by_user_id, created_at,
          runtime_profile_json, source_runtime_revision
        ) VALUES (?, 1, ?, ?, ?, ?, ?)`, workId, JSON.stringify(input.configuration), principal.userId, now,
          input.runtimeProfileJson ?? null, input.sourceRuntimeRevision ?? null);
        tx.run(`INSERT INTO quota_reservations(
          work_id, subject_kind, subject_id, desired_cpu_millis, desired_memory_bytes,
          occupied_cpu_millis, occupied_memory_bytes, service_slots, volume_slots, updated_at
        ) VALUES (?, 'agent', 'agentd', ?, ?, ?, ?, 0, 2, ?)`,
        workId,
        input.configuration.resources.agentCpuMillis,
        input.configuration.resources.agentMemoryBytes,
        input.configuration.resources.agentCpuMillis,
        input.configuration.resources.agentMemoryBytes,
        now);
        if (this.installationId !== undefined) {
          for (const [role, logicalId] of [["agent-private", "work-private"], ["workspace", "work-workspace"]] as const) {
            const volumeId = `volume-${createHash("sha256").update(`${this.installationId}\0${workId}\0${logicalId}`).digest("hex").slice(0, 24)}`;
            tx.run(`INSERT INTO volume_records(
              id, installation_id, work_id, service_id, volume_role, runtime_name, state,
              reference_count, retained_at, purged_at, created_at
            ) VALUES (?, ?, ?, NULL, ?, ?, 'active', 1, NULL, NULL, ?)`,
            volumeId, this.installationId, workId, role, managedVolumeName(this.installationId, workId, logicalId), now);
            tx.run(`INSERT INTO volume_references(volume_id, consumer_kind, consumer_id, created_at)
              VALUES (?, 'work', ?, ?)`, volumeId, workId, now);
          }
        }
        if (input.snapshot !== undefined) this.store.insertInitialWorkContext(workId, 1, input.snapshot);
        return { resourceId: workId };
      });
    } catch (error) {
      if (input.snapshot !== undefined) this.contexts?.remove(workId, input.snapshot.snapshotId);
      throw error;
    }
    if (accepted.reused && input.snapshot !== undefined) this.contexts?.remove(workId, input.snapshot.snapshotId);
    this.store.attachOperationToWork(accepted.operationId, accepted.resourceId);
    if (!accepted.reused) this.store.updateOperation(accepted.operationId, "pending", this.now().toISOString(), {
      resultJson: operationEnvelope({ correlationId: input.correlationId ?? accepted.operationId }),
    });
    this.enqueue(accepted.resourceId);
    return { workId: accepted.resourceId, operationId: accepted.operationId, reused: accepted.reused };
  }

  list(principal: UserPrincipal): WorkRecord[] {
    return filterVisibleResources(principal, this.store.listWorks().map(asOwnedWork), "read-metadata")
      .map((visible) => this.store.getWork(visible.id)!)
      .filter(Boolean);
  }

  show(principal: UserPrincipal, workId: string): WorkRecord {
    const work = this.store.getWork(workId);
    authorizeWorkResource(principal, work === undefined ? undefined : asOwnedWork(work), "read-metadata");
    return work!;
  }

  operation(principal: UserPrincipal, operationId: string): PublicOperation {
    const snapshot = snapshotOperation(this.store, principal, operationId);
    if (snapshot !== undefined) return snapshot;
    const operation = this.store.getOperation(operationId);
    if (operation === undefined || operation.workId === null) throw invisible();
    const work = this.store.getWork(operation.workId, true);
    authorizeWorkResource(principal, work === undefined ? undefined : { ...asOwnedWork(work), kind: "operation", id: operation.id }, "read-metadata");
    const result = publicOperation(operation);
    const job = this.store.packages.getJob(operationId);
    return job?.scopeKind === "work" && job.workId === operation.workId
      ? { ...result, packagePhase: job.phase }
      : result;
  }

  start(principal: UserPrincipal, workId: string, idempotencyKey: string): AcceptedWorkOperation {
    return this.mutateDesired(principal, workId, "start-work", "running", idempotencyKey);
  }

  stop(principal: UserPrincipal, workId: string, idempotencyKey: string): AcceptedWorkOperation {
    return this.mutateDesired(principal, workId, "stop-work", "stopped", idempotencyKey);
  }

  retry(principal: UserPrincipal, workId: string, idempotencyKey: string): AcceptedWorkOperation {
    return this.mutateDesired(principal, workId, "retry-work", "running", idempotencyKey, true);
  }

  delete(principal: UserPrincipal, workId: string, idempotencyKey: string): AcceptedWorkOperation {
    return this.mutateDesired(principal, workId, "delete-work", "deleted", idempotencyKey);
  }

  applyConfiguration(
    principal: UserPrincipal,
    workId: string,
    idempotencyKey: string,
    expectedRevision?: number,
    correlationId?: string,
  ): AcceptedWorkOperation {
    this.assertAccepting();
    const work = this.store.getWork(workId);
    authorizeWorkResource(principal, work === undefined ? undefined : asOwnedWork(work), "control");
    if (this.store.packages.listJobs(true).some((job) => job.workId === workId)) throw new PiPackageStoreError("PI_PACKAGE_BUSY", "Work package preparation is active");
    const state = this.store.getWorkConfiguration(workId);
    if (state === undefined) throw invisible();
    // Capture the desired immutable context before queueing. Later edits are
    // allowed to commit while this snapshot is being prepared; activation is
    // fenced to this captured identity and therefore leaves pendingApply true.
    const capturedRevision = state.desiredRevision;
    const capturedContextId = state.desiredContextId;
    if (expectedRevision !== undefined && expectedRevision !== capturedRevision) {
      const error = new Error(`Work ${workId} configuration revision conflict`);
      error.name = "ConfigurationRevisionConflictError";
      throw error;
    }
    const requestJson = stableJson({ capturedSnapshotId: capturedContextId, capturedRevision });
    const targetVersion = work!.controlVersion + 1;
    const accepted = this.store.acceptMutation({
      principalId: principal.userId,
      workScope: workId,
      operationKind: "apply-work-configuration",
      idempotencyKey,
      requestDigest: digest(stableJson({})),
      requestJson,
      targetVersion,
      workId,
      expectedWorkVersion: work!.controlVersion,
      now: this.now().toISOString(),
    }, (tx) => {
      const now = this.now().toISOString();
      tx.run("UPDATE works SET control_version = control_version + 1, updated_at = ? WHERE id = ?", now, workId);
      tx.run(`UPDATE operations SET state = 'superseded', updated_at = ?
        WHERE work_id = ? AND state IN ('pending', 'running') AND target_version < ?`, now, workId, targetVersion);
      return { resourceId: workId };
    });
    if (!accepted.reused) this.store.updateOperation(accepted.operationId, "pending", this.now().toISOString(), {
      resultJson: operationEnvelope({ correlationId: correlationId ?? accepted.operationId }),
    });
    this.enqueue(workId);
    return { workId, operationId: accepted.operationId, reused: accepted.reused };
  }

  async recover(): Promise<WorkRecoveryReport> {
    const knownWorks = new Set(this.store.listWorks(true).map((work) => work.id));
    const managed = await this.runtime.listManagedInstances?.() ?? [];
    const orphanedInstances = managed.filter((instance) => !knownWorks.has(instance.workId));
    const adoptedWorkIds = managed.filter((instance) => knownWorks.has(instance.workId)).map((instance) => instance.workId);
    const unfinishedWorkIds = new Set(this.store.listOperations(["pending", "running"])
      .filter((operation) => this.store.snapshots.getJob(operation.id) === undefined && this.store.packages.getJob(operation.id) === undefined)
      .flatMap((operation) => operation.workId === null ? [] : [operation.workId]));
    for (const work of this.store.listWorks(true)) {
      if (this.store.snapshots.getLock(work.id)) continue;
      if (work.desiredState === "running" && !unfinishedWorkIds.has(work.id)) {
        this.mutateDesired(
          { userId: work.ownerUserId, role: "user" },
          work.id,
          "recover-work-after-core-restart",
          "running",
          `core-recovery-${randomUUID()}`,
          true,
        );
      }
    }
    for (const operation of this.store.listOperations(["pending", "running"])) {
      if (this.store.snapshots.getJob(operation.id) || this.store.packages.getJob(operation.id)
        || (operation.workId !== null && this.store.snapshots.getLock(operation.workId))) continue;
      if (operation.state === "running") {
        const interrupted = operationWithStage({
          record: operation,
          stage: "runtime-start",
          outcome: "interrupted",
          diagnostic: safeDiagnostic("WORK_OPERATION_FAILED", "runtime-start"),
          timestamp: this.now().toISOString(),
        });
        this.updateOperationSafely(operation.id, "pending", { resultJson: interrupted.resultJson }, operation.id, operation.workId ?? undefined);
      }
      if (operation.workId !== null) this.enqueue(operation.workId);
    }
    for (const work of this.store.listWorks(true)) this.enqueue(work.id);
    await this.waitForIdle();
    return { adoptedWorkIds: [...new Set(adoptedWorkIds)], orphanedInstances };
  }

  async shutdown(stopManagedRuntimes = false): Promise<void> {
    this.shuttingDown = true;
    await this.waitForIdle();
    if (!stopManagedRuntimes) return;
    const works = this.store.listWorks(true).filter((work) => work.desiredState !== "deleted");
    const results = await Promise.allSettled(works.map((work) => this.ensureStopped(work)));
    const failures: unknown[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const work = works[index]!;
        failures.push(result.reason);
        emitDiagnostic({ timestamp: this.now().toISOString(), level: "error", component: "core", stage: "rollback", outcome: "failed", correlationId: `shutdown-${work.id}`, code: "WORK_OPERATION_FAILED", message: "Managed Work shutdown failed.", workId: work.id });
      }
    });
    if (failures.length > 0) throw new AggregateError(failures, `Core shutdown left ${failures.length} managed Work runtime(s) unresolved`);
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }

  private mutateDesired(
    principal: UserPrincipal,
    workId: string,
    kind: string,
    desiredState: "running" | "stopped" | "deleted",
    idempotencyKey: string,
    forceVersion = false,
  ): AcceptedWorkOperation {
    this.assertAccepting();
    const work = this.store.getWork(workId, desiredState === "deleted");
    authorizeWorkResource(principal, work === undefined ? undefined : asOwnedWork(work), "control");
    if (desiredState === "running" && this.store.packages.listJobs(true).some((job) => job.workId === workId)) {
      throw new PiPackageStoreError("PI_PACKAGE_BUSY", "Work package preparation is active");
    }
    const captured = desiredState === "running" ? this.selectRetainedContext(workId) : null;
    const publicRequestJson = stableJson({ desiredState, retry: forceVersion });
    const requestJson = stableJson({
      desiredState,
      retry: forceVersion,
      ...(captured === null ? {} : {
        capturedSnapshotId: captured.snapshotId,
        capturedRevision: captured.revision,
      }),
    });
    const targetVersion = work!.controlVersion + 1;
    const accepted = this.store.acceptMutation({
      principalId: principal.userId,
      workScope: workId,
      operationKind: kind,
      idempotencyKey,
      requestDigest: digest(publicRequestJson),
      requestJson,
      targetVersion,
      workId,
      expectedWorkVersion: work!.controlVersion,
      now: this.now().toISOString(),
    }, (tx) => {
      const now = this.now().toISOString();
      if (desiredState === "deleted") tx.tombstoneWork(workId, now);
      else tx.run(`UPDATE works SET desired_state = ?, control_version = control_version + 1,
        updated_at = ? WHERE id = ?`, desiredState, now, workId);
      tx.run(`UPDATE operations SET state = 'superseded', updated_at = ?
        WHERE work_id = ? AND state IN ('pending', 'running') AND target_version < ?`, now, workId, targetVersion);
      if (desiredState !== "running") {
        this.store.packages.releaseQueuedWorkJobLeases(workId);
        tx.run(`UPDATE operations SET state = 'superseded', updated_at = ? WHERE id IN
          (SELECT operation_id FROM pi_package_jobs WHERE work_id = ? AND phase IN ('queued','source','prepare','validate','publish','cleanup-pending'))
          AND state IN ('pending','running')`, now, workId);
        tx.run(`UPDATE pi_package_jobs SET phase = 'superseded', updated_at = ? WHERE work_id = ?
          AND phase IN ('queued','source','prepare','validate','publish','cleanup-pending')`, now, workId);
      }
      return { resourceId: workId };
    });
    this.enqueue(workId);
    return { workId, operationId: accepted.operationId, reused: accepted.reused };
  }

  private enqueue(workId: string): void {
    const prior = this.queues.get(workId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(() => this.reconcile(workId)).finally(() => {
      if (this.queues.get(workId) === next) this.queues.delete(workId);
    });
    this.queues.set(workId, next);
  }

  private async reconcile(workId: string): Promise<void> {
    if (this.store.snapshots.getLock(workId)) return;
    const work = this.store.getWork(workId, true);
    if (work === undefined) return;
    const operations = this.store.listOperations(["pending", "running"])
      .filter((operation) => operation.workId === workId && this.store.snapshots.getJob(operation.id) === undefined
        && this.store.packages.getJob(operation.id) === undefined)
      .sort((left, right) => left.targetVersion - right.targetVersion);
    const current = operations.at(-1);
    if (current === undefined) return;
    const correlationId = publicOperation(current).correlationId;
    for (const stale of operations.slice(0, -1)) {
      this.store.updateOperation(stale.id, "superseded", this.now().toISOString());
    }
    if (!this.updateOperationSafely(current.id, "running", {}, current.id, workId)) return;
    emitDiagnostic({ timestamp: this.now().toISOString(), level: "info", component: "core", stage: "runtime-start", outcome: "started", correlationId, code: "WORK_OPERATION_FAILED", message: "Work operation started.", workId, operationId: current.id });
    try {
      if (current.kind === "apply-work-configuration") {
        const request = JSON.parse(current.requestJson) as { capturedSnapshotId?: unknown; capturedRevision?: unknown };
        const snapshotId = typeof request.capturedSnapshotId === "string" ? request.capturedSnapshotId : null;
        const revision = Number(request.capturedRevision);
        const result = await this.applyConfigurationNow(workId, Number.isSafeInteger(revision) ? revision : 0, snapshotId, current.targetVersion, current.id, correlationId);
        const persisted = operationWithStage({
          record: this.store.getOperation(current.id) ?? current,
          stage: "activation",
          outcome: "succeeded",
          diagnostic: safeDiagnostic("WORK_OPERATION_FAILED", "activation"),
          timestamp: this.now().toISOString(),
          result: { configuration: publicConfiguration(result) },
        });
        this.store.completeWorkContextActivation({
          workId,
          snapshotId: snapshotId!,
          operationId: current.id,
          targetVersion: current.targetVersion,
          observedState: this.store.getWork(workId)!.desiredState === "running" ? "ready" : "stopped",
          resultJson: persisted.resultJson,
          now: this.now().toISOString(),
        });
        emitDiagnostic({ timestamp: this.now().toISOString(), level: "info", component: "core", stage: "activation", outcome: "succeeded", correlationId, code: "WORK_OPERATION_FAILED", message: "Work configuration was activated.", workId, operationId: current.id });
        return;
      }
      const latest = this.store.getWork(workId, true)!;
      if (latest.desiredState === "running") {
        const request = JSON.parse(current.requestJson) as { capturedSnapshotId?: unknown };
        const capturedContextId = typeof request.capturedSnapshotId === "string" ? request.capturedSnapshotId : null;
        await this.ensureRunning(latest, capturedContextId, current.id, correlationId);
      }
      else if (latest.desiredState === "stopped") await this.ensureStopped(latest);
      else await this.ensureDeleted(latest);
      const after = this.store.getWork(workId, true)!;
      if (after.controlVersion === current.targetVersion || current.kind === "create-work") {
        const persisted = operationWithStage({
          record: this.store.getOperation(current.id) ?? current,
          stage: "readiness",
          outcome: "succeeded",
          diagnostic: safeDiagnostic("WORK_OPERATION_FAILED", "readiness"),
          timestamp: this.now().toISOString(),
          result: { observedState: after.observedState },
        });
        const saved = this.updateOperationSafely(current.id, "succeeded", { resultJson: persisted.resultJson }, current.id, workId);
        if (saved) emitDiagnostic({ timestamp: this.now().toISOString(), level: "info", component: "core", stage: "readiness", outcome: "succeeded", correlationId, code: "WORK_OPERATION_FAILED", message: "Work runtime reached the requested state.", workId, operationId: current.id });
      } else {
        this.updateOperationSafely(current.id, "superseded", {}, current.id, workId);
        this.enqueue(workId);
      }
    } catch (error) {
      if (error instanceof OperationSupersededError || (error as { name?: unknown }).name === "OperationSupersededError"
        || this.store.getOperation(current.id)?.state === "superseded") {
        this.enqueue(workId);
        return;
      }
      const primary = error instanceof ApplyConfigurationFailure ? error.primary : error;
      if ((primary as { code?: unknown }).code !== "WORK_BUSY"
        && !(error instanceof ApplyConfigurationFailure && error.rollback.state === "succeeded")) {
        this.store.updateWorkObservedState(workId, "failed", this.now().toISOString());
      }
      const diagnostic = diagnosticFromError(primary, "runtime-start");
      const diagnosticCollection = (primary as { diagnosticCollection?: OperationDiagnostics["diagnosticCollection"] }).diagnosticCollection;
      const persisted = operationWithStage({
        record: this.store.getOperation(current.id) ?? current,
        stage: diagnostic.stage,
        outcome: "failed",
        diagnostic,
        timestamp: this.now().toISOString(),
        ...(error instanceof ApplyConfigurationFailure ? { rollback: error.rollback } : {}),
        ...(diagnosticCollection === undefined ? {} : { diagnosticCollection }),
      });
      this.updateOperationSafely(current.id, "failed", {
        resultJson: persisted.resultJson,
        errorJson: errorEnvelope(diagnostic),
      }, current.id, workId);
      const reason = (primary as { diagnosticReason?: unknown }).diagnosticReason;
      emitDiagnostic({ timestamp: this.now().toISOString(), level: "error", component: "core", stage: diagnostic.stage, outcome: "failed", correlationId, code: diagnostic.code, message: diagnostic.message, workId, operationId: current.id, ...(diagnostic.skillName === undefined ? {} : { skillName: diagnostic.skillName }), ...(typeof reason === "string" ? { reason } : {}) });
    }
  }

  private updateOperationSafely(
    operationId: string,
    state: OperationRecord["state"],
    output: { readonly resultJson?: string | null; readonly errorJson?: string | null },
    correlationId: string,
    workId?: string,
  ): boolean {
    try {
      this.store.updateOperation(operationId, state, this.now().toISOString(), output);
      return true;
    } catch {
      emitDiagnostic({
        timestamp: this.now().toISOString(), level: "error", component: "core",
        stage: "runtime-start", outcome: "failed", correlationId,
        code: "DIAGNOSTIC_PERSIST_FAILED", message: "Operation diagnostic persistence failed.",
        ...(workId === undefined ? {} : { workId }), operationId,
      }, this.diagnosticLogger);
      return false;
    }
  }

  private recordOperationStage(operationId: string, workId: string, stage: Parameters<typeof safeDiagnostic>[1]): void {
    const record = this.store.getOperation(operationId);
    if (record === undefined || record.state !== "running") return;
    const diagnostic = safeDiagnostic("WORK_OPERATION_FAILED", stage);
    const persisted = operationWithStage({
      record, stage, outcome: "succeeded", diagnostic, timestamp: this.now().toISOString(),
    });
    if (this.updateOperationSafely(operationId, "running", { resultJson: persisted.resultJson }, operationId, workId)) {
      emitDiagnostic({
        timestamp: this.now().toISOString(), level: "info", component: "core", stage, outcome: "succeeded",
        correlationId: publicOperation(record).correlationId, code: diagnostic.code, message: diagnostic.message, workId, operationId,
      }, this.diagnosticLogger);
    }
  }

  private async runOperationStage<T>(
    operationId: string,
    workId: string,
    stage: Parameters<typeof safeDiagnostic>[1],
    failureCode: "RUNTIME_PREPARE_FAILED" | "RUNTIME_START_FAILED",
    action: () => Promise<T>,
  ): Promise<T> {
    const correlationId = publicOperation(this.store.getOperation(operationId)!).correlationId;
    emitDiagnostic({
      timestamp: this.now().toISOString(), level: "info", component: "core", stage, outcome: "started",
      correlationId, code: failureCode, message: "Work operation stage started.", workId, operationId,
    }, this.diagnosticLogger);
    try {
      const result = await action();
      this.recordOperationStage(operationId, workId, stage);
      return result;
    } catch (error) {
      const item = error as { code?: unknown; stage?: unknown };
      if (typeof item.code !== "string") item.code = failureCode;
      if (typeof item.stage !== "string") item.stage = stage;
      throw error;
    }
  }

  private async ensureRunning(work: WorkRecord, capturedContextId: string | null, operationId: string, correlationId: string): Promise<void> {
    this.store.updateWorkObservedState(work.id, "starting", this.now().toISOString());
    const actual = await this.runtime.inspect(work.id);
    const state = this.store.getWorkConfiguration(work.id);
    const contextId = state?.activeContextId ?? capturedContextId;
    if (contextId === null || contextId === undefined) throw new WorkContextError("CONTEXT_NOT_FOUND");
    const contextRecord = this.store.getWorkContextSnapshot(work.id, contextId);
    if (contextRecord === undefined || contextRecord.internalRevision === null) throw new WorkContextError("CONTEXT_NOT_FOUND");
    const runtimeRevision = contextRecord.internalRevision;
    const configuration = { ...this.resolveContextRuntimeConfiguration(work.id, contextId), correlationId };
    this.recordOperationStage(operationId, work.id, "context-validate");
    if (!actual.exists) {
      await this.runOperationStage(operationId, work.id, "runtime-prepare", "RUNTIME_PREPARE_FAILED", () => this.runtime.prepare(work, configuration));
      this.store.ensureRuntimeGeneration(work.id, work.controlVersion, this.now().toISOString());
      const started = await this.runOperationStage(operationId, work.id, "runtime-start", "RUNTIME_START_FAILED", () => this.runtime.start(work, work.controlVersion, configuration));
      this.store.updateRuntimeGeneration(work.id, work.controlVersion, "starting", this.now().toISOString(), {
        instanceId: started.instanceId,
      });
    } else if (!actual.running) {
      const started = await this.runOperationStage(operationId, work.id, "runtime-start", "RUNTIME_START_FAILED", () => this.runtime.start(work, work.controlVersion, configuration));
      const startedGeneration = started.generation;
      this.store.ensureRuntimeGeneration(work.id, startedGeneration, this.now().toISOString());
      this.store.updateRuntimeGeneration(work.id, startedGeneration, "starting", this.now().toISOString(), {
        instanceId: started.instanceId,
      });
    } else {
      const adoptedGeneration = actual.generation ?? work.controlVersion;
      this.store.ensureRuntimeGeneration(work.id, adoptedGeneration, this.now().toISOString());
      this.store.updateRuntimeGeneration(work.id, adoptedGeneration, actual.ready ? "ready" : "starting", this.now().toISOString(), {
        instanceId: actual.instanceId,
        readySince: actual.ready ? this.now().toISOString() : undefined,
      });
    }
    await this.services.prepareEnabledServices(work);
    const ready = await this.runtime.inspect(work.id);
    if (!ready.exists || !ready.running || !ready.ready) throw new Error("daemon did not become ready");
    this.recordOperationStage(operationId, work.id, "skill-validate");
    this.recordOperationStage(operationId, work.id, "skill-load");
    this.recordOperationStage(operationId, work.id, "readiness");
    const readyGeneration = ready.generation ?? work.controlVersion;
    this.store.updateRuntimeGeneration(work.id, readyGeneration, "ready", this.now().toISOString(), {
      instanceId: ready.instanceId,
      readySince: this.now().toISOString(),
    });
    if (state?.activeContextId === null) {
      this.store.activateWorkContext(work.id, contextId, this.now().toISOString());
      this.recordOperationStage(operationId, work.id, "activation");
    }
    this.store.updateWorkObservedState(work.id, this.services.hasFailedServices?.(work.id) === true ? "degraded" : "ready", this.now().toISOString(), runtimeRevision);
  }

  private async applyConfigurationNow(workId: string, expectedRevision: number, capturedContextId: string | null, targetVersion: number, operationId: string, correlationId: string): Promise<WorkConfigurationState> {
    const state = this.store.getWorkConfiguration(workId);
    if (state === undefined) throw invisible();
    const work = this.store.getWork(workId)!;
    this.assertCurrentTarget(workId, targetVersion);
    if (capturedContextId !== null && state.activeContextId === capturedContextId) return state;
    const candidate = capturedContextId === null
      ? undefined
      : { ...this.resolveContextRuntimeConfiguration(workId, capturedContextId), correlationId };
    if (candidate === undefined) throw new WorkContextError("CONTEXT_NOT_FOUND");
    this.recordOperationStage(operationId, workId, "context-validate");
    const candidateContextId = capturedContextId;
    if (candidateContextId === null) throw new Error("Work runtime context is unavailable");

    // Image/profile preparation is deliberately completed before the running
    // instance is touched. Most invalid applies therefore leave active Runs
    // and the old active revision unchanged.
    await this.runOperationStage(operationId, workId, "runtime-prepare", "RUNTIME_PREPARE_FAILED", () => this.runtime.prepare(work, candidate));
    if (work.desiredState !== "running") {
      const existing = await this.runtime.inspect(workId);
      if (existing.exists) {
        if (existing.running) await this.runtime.stop(workId, this.stopTimeoutMs);
        await this.runtime.remove(workId, { preserveNetwork: true });
        await this.runOperationStage(operationId, workId, "runtime-prepare", "RUNTIME_PREPARE_FAILED", () => this.runtime.prepare(work, candidate));
      }
      const validation = { ...candidate, initializationOnly: true };
      const generation = this.nextRuntimeGeneration(workId);
      this.store.ensureRuntimeGeneration(workId, generation, this.now().toISOString());
      let validated = false;
      try {
        await this.runOperationStage(operationId, workId, "runtime-start", "RUNTIME_START_FAILED", () => this.runtime.start(work, generation, validation));
        this.recordOperationStage(operationId, workId, "skill-validate");
        this.recordOperationStage(operationId, workId, "skill-load");
        this.recordOperationStage(operationId, workId, "readiness");
        this.assertCurrentTarget(workId, targetVersion);
        validated = true;
        return projectedActivation(this.store.getWorkConfiguration(workId)!, candidateContextId, expectedRevision, candidate.workConfig);
      } finally {
        try {
          await this.runtime.stop(workId, this.stopTimeoutMs);
          const stopped = await this.runtime.inspect(workId);
          if (stopped.running) throw new Error("runtime could not confirm initialization shutdown");
          await this.runtime.remove(workId, { preserveNetwork: true });
          this.store.updateRuntimeGeneration(workId, generation, validated ? "stopped" : "failed", this.now().toISOString());
        } catch (cleanupError) {
          this.store.updateRuntimeGeneration(workId, generation, "stopping", this.now().toISOString());
          throw cleanupError;
        }
      }
    }

    const previous = state.activeContextId === null
      ? undefined
      : { ...this.resolveContextRuntimeConfiguration(workId, state.activeContextId), correlationId };
    const actual = await this.runtime.inspect(workId);
    const generation = this.nextRuntimeGeneration(workId);
    try {
      if (actual.exists && actual.running) {
        if (actual.generation !== undefined && this.store.getRuntimeGeneration(workId, actual.generation) !== undefined) {
          this.store.updateRuntimeGeneration(workId, actual.generation, "draining", this.now().toISOString());
        }
        if (this.runtime.prepareConfigurationChange !== undefined) {
          const gate = await this.runtime.prepareConfigurationChange(workId);
          if (!gate.prepared || gate.busy) {
            throw Object.assign(new Error("Work has an active Run"), { name: "WorkBusyError", code: "WORK_BUSY" });
          }
        } else {
          await this.runtime.drain(workId, this.drainTimeoutMs);
        }
        this.store.updateWorkObservedState(workId, "starting", this.now().toISOString());
      }
      if (actual.exists) {
        await this.services.stopServices(workId, this.stopTimeoutMs);
        if (actual.running) await this.runtime.stop(workId, this.stopTimeoutMs);
        for (const item of this.store.listRuntimeGenerations(workId)) {
          if (["preparing", "starting", "ready", "draining", "stopping"].includes(item.state)) {
            this.store.updateRuntimeGeneration(workId, item.generation, "stopped", this.now().toISOString());
          }
        }
        await this.runtime.remove(workId, { preserveNetwork: true });
      }
      await this.runOperationStage(operationId, workId, "runtime-prepare", "RUNTIME_PREPARE_FAILED", () => this.runtime.prepare(work, candidate));
      this.store.ensureRuntimeGeneration(workId, generation, this.now().toISOString());
      const started = await this.runOperationStage(operationId, workId, "runtime-start", "RUNTIME_START_FAILED", () => this.runtime.start(work, generation, candidate));
      this.recordOperationStage(operationId, workId, "skill-validate");
      this.recordOperationStage(operationId, workId, "skill-load");
      this.recordOperationStage(operationId, workId, "readiness");
      const ready = await this.runtime.inspect(workId);
      if (!ready.exists || !ready.running || !ready.ready) throw new Error("updated Work runtime did not become ready");
      await this.services.prepareEnabledServices(work);
      this.store.updateRuntimeGeneration(workId, generation, "ready", this.now().toISOString(), {
        instanceId: started.instanceId,
        readySince: this.now().toISOString(),
      });
      try {
        this.assertCurrentTarget(workId, targetVersion);
      } catch (error) {
        await this.runtime.stop(workId, this.stopTimeoutMs).catch(() => undefined);
        await this.runtime.remove(workId, { preserveNetwork: true }).catch(() => undefined);
        throw error;
      }
      return projectedActivation(this.store.getWorkConfiguration(workId)!, candidateContextId, expectedRevision, candidate.workConfig);
    } catch (error) {
      let rollback: OperationDiagnostics["rollback"] = { state: "not-required" };
      if (error instanceof OperationSupersededError) throw error;
      if ((error as { code?: unknown }).code === "WORK_BUSY") {
        if (actual.generation !== undefined && this.store.getRuntimeGeneration(workId, actual.generation) !== undefined) {
          this.store.updateRuntimeGeneration(workId, actual.generation, "ready", this.now().toISOString(), {
            instanceId: actual.instanceId,
            readySince: this.now().toISOString(),
          });
        }
        throw new ApplyConfigurationFailure(error, rollback);
      }
      if (this.store.getRuntimeGeneration(workId, generation) !== undefined) {
        this.store.updateRuntimeGeneration(workId, generation, "failed", this.now().toISOString());
      }
      if (previous !== undefined) {
        try {
          const failed = await this.runtime.inspect(workId);
          if (failed.exists && failed.running) await this.runtime.stop(workId, this.stopTimeoutMs);
          if (failed.exists) await this.runtime.remove(workId, { preserveNetwork: true });
          await this.runtime.prepare(work, previous);
          const rollbackGeneration = generation + 1;
          this.store.ensureRuntimeGeneration(workId, rollbackGeneration, this.now().toISOString());
          const restored = await this.runtime.start(work, rollbackGeneration, previous);
          const restoredState = await this.runtime.inspect(workId);
          if (!restoredState.exists || !restoredState.running || !restoredState.ready) throw new Error("previous Work runtime could not be restored");
          await this.services.prepareEnabledServices(work);
          this.store.updateRuntimeGeneration(workId, rollbackGeneration, "ready", this.now().toISOString(), {
            instanceId: restored.instanceId,
            readySince: this.now().toISOString(),
          });
          this.store.updateWorkObservedState(workId, "ready", this.now().toISOString(), state.activeRevision ?? undefined);
          rollback = { state: "succeeded" };
          this.recordOperationStage(operationId, workId, "rollback");
        } catch {
          rollback = { state: "failed", error: safeDiagnostic("ROLLBACK_FAILED", "rollback") };
          this.store.updateWorkObservedState(workId, "failed", this.now().toISOString());
        }
      }
      throw new ApplyConfigurationFailure(error, rollback);
    }
  }

  private nextRuntimeGeneration(workId: string): number {
    return this.store.nextRuntimeGeneration(workId);
  }

  private assertCurrentTarget(workId: string, targetVersion: number): void {
    const current = this.store.getWork(workId, true);
    if (current === undefined || current.controlVersion !== targetVersion) throw new OperationSupersededError();
  }

  private resolveContextRuntimeConfiguration(workId: string, snapshotId: string): ResolvedWorkRuntimeConfiguration {
    const snapshot = this.store.getWorkContextSnapshot(workId, snapshotId);
    if (snapshot === undefined || snapshot.internalRevision === null) throw new WorkContextError("CONTEXT_NOT_FOUND");
    const stored = this.store.getWorkConfigRevision(workId, snapshot.internalRevision);
    if (stored === undefined || stored.runtimeProfileJson === null) throw new WorkContextError("CONTEXT_NOT_FOUND");
    if (this.contexts === undefined) throw new WorkContextError("CONTEXT_NOT_FOUND");
    const context = this.contexts.load(workId, snapshotId);
    if (snapshot.configurationJson !== stored.configJson
      || snapshot.configurationJson !== JSON.stringify(context.configuration)
      || snapshot.imageIdentity !== context.metadata.imageIdentity) {
      throw new WorkContextError("CONTEXT_OWNERSHIP");
    }
    return {
      workConfig: JSON.parse(snapshot.configurationJson) as WorkConfig,
      runtimeProfileJson: stored.runtimeProfileJson,
      contextIdentity: snapshotId,
      contextDirectory: context.directory,
      imageIdentity: snapshot.imageIdentity,
      skillIdentities: context.metadata.skills,
      packageBindings: context.metadata.packageBindings,
    };
  }

  private selectRetainedContext(workId: string): { readonly snapshotId: string; readonly revision: number } | null {
    const state = this.store.getWorkConfiguration(workId);
    if (state?.activeContextId !== null && state?.activeContextId !== undefined) {
      const active = this.store.getWorkContextSnapshot(workId, state.activeContextId);
      return active?.internalRevision === null || active?.internalRevision === undefined
        ? null
        : { snapshotId: active.snapshotId, revision: active.internalRevision };
    }
    const initial = this.store.listWorkContextSnapshots()
      .find((snapshot) => snapshot.workId === workId && snapshot.internalRevision === 1);
    return initial === undefined ? null : { snapshotId: initial.snapshotId, revision: 1 };
  }

  private async ensureStopped(work: WorkRecord): Promise<void> {
    this.store.updateWorkObservedState(work.id, "stopping", this.now().toISOString());
    let actual: WorkRuntimeState | undefined;
    const failures: unknown[] = [];
    try { actual = await this.runtime.inspect(work.id); }
    catch (error) { failures.push(error); }
    let drainFailure: unknown;
    if (actual?.exists && actual.running) {
      if (actual.generation !== undefined && this.store.getRuntimeGeneration(work.id, actual.generation) !== undefined) {
        this.store.updateRuntimeGeneration(work.id, actual.generation, "draining", this.now().toISOString());
      }
      try { await this.runtime.drain(work.id, this.drainTimeoutMs); }
      catch (error) { drainFailure = error; }
    }
    let serviceFailure = false;
    try { await this.services.stopServices(work.id, this.stopTimeoutMs); }
    catch (error) { serviceFailure = true; failures.push(error); }
    if (actual?.running || actual === undefined) {
      try { await this.runtime.stop(work.id, this.stopTimeoutMs); }
      catch (error) { failures.push(error); }
    }
    let runtimeStopped = false;
    try {
      const stopped = await this.runtime.inspect(work.id);
      runtimeStopped = !stopped.exists || !stopped.running;
      if (!runtimeStopped) failures.push(new Error("runtime could not confirm shutdown"));
    } catch (error) { failures.push(error); }
    if (runtimeStopped && actual?.generation !== undefined && this.store.getRuntimeGeneration(work.id, actual.generation) !== undefined) {
      this.store.updateRuntimeGeneration(work.id, actual.generation, "stopped", this.now().toISOString());
    }
    if (runtimeStopped && !serviceFailure) this.store.updateWorkObservedState(work.id, "stopped", this.now().toISOString());
    if (drainFailure !== undefined) failures.push(drainFailure);
    if (failures.length > 0) throw new AggregateError(failures, `Work ${work.id} shutdown was not fully confirmed`);
  }

  private async ensureDeleted(work: WorkRecord): Promise<void> {
    await this.ensureStopped(work);
    await this.services.removeServiceInstances(work.id);
    await this.runtime.remove(work.id);
    this.store.retainWorkVolumes(work.id, this.now().toISOString());
    const actual = await this.runtime.inspect(work.id);
    if (actual.exists) throw new Error("runtime could not confirm deletion");
    this.store.updateWorkObservedState(work.id, "deleted", this.now().toISOString());
  }

  private assertAccepting(): void {
    if (this.shuttingDown) throw new Error("Core is shutting down");
  }
}

function asOwnedWork(work: WorkRecord) {
  return { kind: "work" as const, id: work.id, workId: work.id, ownerUserId: work.ownerUserId };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item === null || Array.isArray(item) || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function invisible(): Error {
  const error = new Error("resource was not found");
  error.name = "WorkNotFoundError";
  return error;
}

function publicConfiguration(state: WorkConfigurationState) {
  return {
    workId: state.workId,
    active: state.activeConfigJson === null ? null : JSON.parse(state.activeConfigJson) as WorkConfig,
    desired: JSON.parse(state.desiredConfigJson) as WorkConfig,
    pendingApply: state.pendingRestart,
    runtime: { state: "unavailable" as const, checkedAt: null, skills: [] },
  };
}

function projectedActivation(
  state: WorkConfigurationState,
  snapshotId: string,
  revision: number,
  configuration: WorkConfig,
): WorkConfigurationState {
  return {
    ...state,
    activeRevision: revision,
    activeConfigJson: JSON.stringify(configuration),
    activeContextId: snapshotId,
    pendingRestart: state.desiredContextId !== snapshotId,
  };
}
