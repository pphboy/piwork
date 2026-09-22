import { createHash, randomUUID } from "node:crypto";
import { normalizeServiceDefinitionInput, type DiagnosticCode, type DiagnosticStage, type SafeDiagnostic, type ServiceDefinition, type ServiceDefinitionInput, type ServiceEndpoint } from "@piwork/contracts";
import { CoreStore, IdempotencyConflictError, type ServiceRecord, type WorkRecord } from "@piwork/core-store";
import { authorizeWorkResource, type UserPrincipal } from "../work-access/policy.js";
import { emitDiagnostic, operationWithStage, safeDiagnostic, type JsonLineLogger } from "../work-management/diagnostics.js";

export type ServicePrincipal =
  | { readonly kind: "user"; readonly user: UserPrincipal }
  | { readonly kind: "work-runtime"; readonly workId: string; readonly generation: number; readonly instanceId: string };
type ServicePrincipalInput = ServicePrincipal | UserPrincipal;

export interface ServiceQuotaPolicy {
  readonly hostCpuMillis: number;
  readonly hostMemoryBytes: number;
  readonly hostRetainedVolumeSlots?: number;
}

export interface ServiceRuntimeAdapter {
  resolveImage?(workId: string, definition: ServiceDefinition): Promise<string>;
  /** Verify the trusted Work network/storage inputs before container start. */
  prepare?(workId: string, definition: ServiceDefinition): Promise<void>;
  start(workId: string, definition: ServiceDefinition, imageIdentity?: string): Promise<void>;
  /** Resolve only when the service's declared readiness probe succeeds. */
  waitReady?(workId: string, definition: ServiceDefinition, timeoutMs: number): Promise<boolean>;
  stop?(workId: string, definition: ServiceDefinition, timeoutMs?: number): Promise<void>;
  remove?(workId: string, definition: ServiceDefinition): Promise<void>;
  logs?(workId: string, serviceId: string, tailLines: number): Promise<{ readonly text: string; readonly truncated: boolean }>;
  inspect?(workId: string, serviceId: string): Promise<{ readonly exists: boolean; readonly running: boolean; readonly containerId?: string; readonly exitCode?: number }>;
}

export interface AcceptedServiceOperation {
  readonly workId: string;
  readonly serviceId: string;
  readonly operationId: string;
  readonly correlationId: string;
  readonly reused: boolean;
}

export interface ServiceView {
  readonly workId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly desiredRevision: number;
  readonly appliedRevision: number | null;
  readonly enabled: boolean;
  readonly observedState: string;
  readonly lastError: unknown | null;
  readonly definition: ServiceDefinition;
  readonly endpoints: readonly ServiceEndpoint[];
  readonly createdAt: string;
}

export class ServiceNameConflictError extends Error {
  readonly code = "CONFLICT";

  constructor(readonly workId: string, readonly serviceName: string) {
    super(`service name ${serviceName} is already in use in Work ${workId}`);
    this.name = "ServiceNameConflictError";
  }
}

export class ServiceQuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";

  constructor(readonly dimension: "services" | "cpu" | "memory" | "volumes", message: string) {
    super(message);
    this.name = "ServiceQuotaExceededError";
  }
}

export class ServiceRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";
  constructor(readonly serviceId: string, readonly expected: number, readonly actual: number | undefined) {
    super(`service ${serviceId} revision conflict: expected ${expected}, actual ${actual ?? "missing"}`);
    this.name = "ServiceRevisionConflictError";
  }
}

export class ServicePreconditionError extends Error {
  readonly code = "FAILED_PRECONDITION";
  constructor(message: string) { super(message); this.name = "ServicePreconditionError"; }
}

class ServiceOperationSupersededError extends Error {
  constructor() { super("service operation was superseded by a newer target"); this.name = "ServiceOperationSupersededError"; }
}

export class WorkServiceManagementService {
  private readonly queues = new Map<string, Promise<void>>();
  private admissionClosed = false;
  private reconciliationTimer?: NodeJS.Timeout;
  private reconciling = false;

  constructor(
    private readonly store: CoreStore,
    private readonly runtime: ServiceRuntimeAdapter,
    private readonly now: () => Date = () => new Date(),
    private readonly quota: ServiceQuotaPolicy = {
      hostCpuMillis: 128_000,
      hostMemoryBytes: 256 * 1_024 * 1_024 * 1_024,
    },
    private readonly diagnosticLogger?: JsonLineLogger,
  ) {}

  create(
    principal: ServicePrincipalInput,
    workId: string,
    input: { readonly definition: ServiceDefinitionInput; readonly idempotencyKey: string },
  ): AcceptedServiceOperation {
    this.assertAccepting();
    const work = this.store.getWork(workId);
    this.authorizePrincipal(principal, workId, work, "control");
    if (work !== undefined && (work.desiredState === "deleted" || work.observedState === "stopping" || work.observedState === "deleting")) {
      throw new ServicePreconditionError(`Work ${workId} is stopping or deleting; service mutations are closed`);
    }

    const serviceId = `service-${randomUUID()}`;
    const normalized = normalizeServiceDefinitionInput(input.definition);
    const definition: ServiceDefinition = { ...normalized, serviceId, revision: 1 };
    const publicRequestJson = stableJson(normalized);
    const requestJson = stableJson({ definition: normalized, serviceRevision: 1, workControlVersion: work?.controlVersion ?? 0 });
    let accepted;
    try {
      accepted = this.store.acceptMutation({
        principalId: principalKey(principal),
        workScope: workId,
        operationKind: "create-service",
        idempotencyKey: input.idempotencyKey,
        requestDigest: digest(publicRequestJson),
        requestJson,
        targetVersion: 1,
        workId,
        serviceId,
        now: this.now().toISOString(),
      }, (tx) => {
        const now = this.now().toISOString();
        const existingName = tx.get<{ service_id: string }>(`SELECT service_id FROM service_heads
          WHERE work_id = ? AND name = ? AND tombstoned_at IS NULL`, workId, definition.name);
        if (existingName !== undefined) throw new ServiceNameConflictError(workId, definition.name);

        const configRow = tx.get<{ config_json: string }>(`SELECT config_json FROM work_config_revisions
          WHERE work_id = ? AND revision = (SELECT desired_revision FROM works WHERE id = ?)`, workId, workId);
        const workResources = configRow === undefined
          ? { cpuMillis: this.quota.hostCpuMillis, memoryBytes: this.quota.hostMemoryBytes, maxServices: Number.MAX_SAFE_INTEGER, maxRetainedVolumes: Number.MAX_SAFE_INTEGER }
          : readResources(configRow.config_json);
        const serviceCount = tx.get<{ count: number }>(`SELECT COUNT(*) AS count FROM service_heads
          WHERE work_id = ? AND tombstoned_at IS NULL`, workId)?.count ?? 0;
        if (serviceCount + 1 > workResources.maxServices) {
          throw new ServiceQuotaExceededError("services", `Work ${workId} has reached its service limit`);
        }
        const retainedVolumes = tx.get<{ count: number }>(`SELECT COUNT(*) AS count FROM volume_records
          WHERE work_id = ? AND state != 'purged'`, workId)?.count ?? 0;
        if (retainedVolumes > workResources.maxRetainedVolumes) {
          throw new ServiceQuotaExceededError("volumes", `Work ${workId} has reached its retained volume limit`);
        }
        const workCpu = tx.get<{ total: number }>(`SELECT COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS total
          FROM quota_reservations WHERE work_id = ?`, workId)?.total ?? 0;
        const workMemory = tx.get<{ total: number }>(`SELECT COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS total
          FROM quota_reservations WHERE work_id = ?`, workId)?.total ?? 0;
        const desiredCpu = definition.enabled ? definition.cpuMillis : 0;
        const desiredMemory = definition.enabled ? definition.memoryBytes : 0;
        if (workCpu + desiredCpu > workResources.cpuMillis) {
          throw new ServiceQuotaExceededError("cpu", `Work ${workId} CPU budget would be exceeded`);
        }
        if (workMemory + desiredMemory > workResources.memoryBytes) {
          throw new ServiceQuotaExceededError("memory", `Work ${workId} memory budget would be exceeded`);
        }
        const hostCpu = tx.get<{ total: number }>(`SELECT COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS total
          FROM quota_reservations`)?.total ?? 0;
        const hostMemory = tx.get<{ total: number }>(`SELECT COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS total
          FROM quota_reservations`)?.total ?? 0;
        if (hostCpu + desiredCpu > this.quota.hostCpuMillis) {
          throw new ServiceQuotaExceededError("cpu", "host CPU budget would be exceeded");
        }
        if (hostMemory + desiredMemory > this.quota.hostMemoryBytes) {
          throw new ServiceQuotaExceededError("memory", "host memory budget would be exceeded");
        }
        if (this.quota.hostRetainedVolumeSlots !== undefined) {
          const hostVolumes = tx.get<{ count: number }>(`SELECT COUNT(*) AS count FROM volume_records
            WHERE state != 'purged'`)?.count ?? 0;
          if (hostVolumes > this.quota.hostRetainedVolumeSlots) {
            throw new ServiceQuotaExceededError("volumes", "host retained volume budget would be exceeded");
          }
        }
        tx.run(`INSERT INTO service_revisions(
          work_id, service_id, revision, definition_json, resolved_image_digest, created_at
        ) VALUES (?, ?, 1, ?, ?, ?)`,
        workId, serviceId, stableJson(definition), null, now);
        tx.run(`INSERT INTO service_heads(
          work_id, service_id, name, desired_revision, applied_revision,
          enabled, observed_state, tombstoned_at, last_error_json
        ) VALUES (?, ?, ?, 1, NULL, ?, 'pending', NULL, NULL)`,
        workId, serviceId, definition.name, definition.enabled ? 1 : 0);
        tx.run(`INSERT INTO quota_reservations(
          work_id, subject_kind, subject_id, desired_cpu_millis, desired_memory_bytes,
          occupied_cpu_millis, occupied_memory_bytes, service_slots, volume_slots, updated_at
        ) VALUES (?, 'service', ?, ?, ?, 0, 0, 1, ?, ?)`,
        workId,
        serviceId,
        definition.enabled ? definition.cpuMillis : 0,
        definition.enabled ? definition.memoryBytes : 0,
        0,
        now);
        if (usesWorkspace(definition)) attachWorkspaceReference(tx, workId, serviceId, now);
        return { resourceId: serviceId };
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw error;
      if (error instanceof ServiceNameConflictError || error instanceof ServiceQuotaExceededError) throw error;
      if (this.store.listServices(workId, true).some((service) => service.name === normalized.name)) {
        throw new ServiceNameConflictError(workId, normalized.name);
      }
      throw error;
    }

    if (!accepted.reused) this.enqueue(workId, accepted.resourceId, accepted.operationId);
    return { workId, serviceId: accepted.resourceId, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }

  update(
    principal: ServicePrincipalInput,
    workId: string,
    serviceId: string,
    expectedRevision: number,
    definitionInput: ServiceDefinitionInput,
    idempotencyKey: string,
  ): AcceptedServiceOperation {
    this.assertAccepting();
    const existing = this.requireService(principal, workId, serviceId);
    const normalized = normalizeServiceDefinitionInput(definitionInput);
    if (normalized.name !== existing.name) throw new ServicePreconditionError("service name is immutable");
    const publicRequestJson = stableJson({ expectedRevision, definition: normalized });
    const requestJson = stableJson({ expectedRevision, definition: normalized, serviceRevision: expectedRevision + 1, workControlVersion: this.store.getWork(workId)?.controlVersion ?? 0 });
    const accepted = this.store.acceptMutation({
      principalId: principalKey(principal), workScope: workId, operationKind: "update-service",
      idempotencyKey, requestDigest: digest(publicRequestJson), requestJson,
      targetVersion: expectedRevision + 1, workId, serviceId, now: this.now().toISOString(),
    }, (tx) => {
      const head = tx.get<{ desired_revision: number; name: string; enabled: number }>(
        `SELECT desired_revision, name, enabled FROM service_heads WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`, workId, serviceId);
      if (head === undefined) throw new Error(`service ${serviceId} was not found`);
      if (head.desired_revision !== expectedRevision) throw new ServiceRevisionConflictError(serviceId, expectedRevision, head.desired_revision);
      const nameConflict = tx.get<{ service_id: string }>(
        `SELECT service_id FROM service_heads WHERE work_id = ? AND name = ? AND service_id != ? AND tombstoned_at IS NULL`, workId, normalized.name, serviceId);
      if (nameConflict !== undefined) throw new ServiceNameConflictError(workId, definitionInput.name);
      const revision = expectedRevision + 1;
      const definition: ServiceDefinition = { ...normalized, serviceId, revision };
      this.assertQuotaDelta(tx, workId, existing, definition);
      const now = this.now().toISOString();
      tx.run(`INSERT INTO service_revisions(work_id, service_id, revision, definition_json, resolved_image_digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, workId, serviceId, revision, stableJson(definition),
        parseDefinition(existing).image.reference === definition.image.reference ? existing.resolvedImageDigest : null, now);
      tx.run(`UPDATE service_heads SET name = ?, desired_revision = ?, enabled = ? WHERE work_id = ? AND service_id = ?`,
        definition.name, revision, definition.enabled ? 1 : 0, workId, serviceId);
      tx.run(`UPDATE quota_reservations SET desired_cpu_millis = ?, desired_memory_bytes = ?, volume_slots = ?, updated_at = ?
        WHERE work_id = ? AND subject_kind = 'service' AND subject_id = ?`,
        definition.enabled ? definition.cpuMillis : 0, definition.enabled ? definition.memoryBytes : 0,
        0, now, workId, serviceId);
      const usedWorkspace = usesWorkspace(parseDefinition(existing));
      if (!usedWorkspace && usesWorkspace(definition)) attachWorkspaceReference(tx, workId, serviceId, now);
      if (usedWorkspace && !usesWorkspace(definition)) detachWorkspaceReference(tx, workId, serviceId, now);
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "update");
    return { workId, serviceId: accepted.resourceId, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }

  restart(principal: ServicePrincipalInput, workId: string, serviceId: string, idempotencyKey: string): AcceptedServiceOperation {
    this.assertAccepting();
    const service = this.requireService(principal, workId, serviceId);
    const work = this.store.getWork(workId)!;
    if (work.desiredState !== "running") throw new ServicePreconditionError(`cannot restart service ${serviceId} while Work ${workId} is stopped`);
    if (!service.enabled) throw new ServicePreconditionError(`cannot restart disabled service ${serviceId}`);
    return this.acceptAction(principal, workId, serviceId, "restart-service", idempotencyKey, service.desiredRevision, "restart");
  }

  retry(principal: ServicePrincipalInput, workId: string, serviceId: string, idempotencyKey: string): AcceptedServiceOperation {
    this.assertAccepting();
    const service = this.requireService(principal, workId, serviceId);
    if (!service.enabled) throw new ServicePreconditionError(`cannot retry disabled service ${serviceId}`);
    const accepted = this.acceptAction(principal, workId, serviceId, "retry-service", idempotencyKey, service.desiredRevision, "retry", false);
    if (!accepted.reused) {
      const binding = this.store.getServiceRuntimeBinding(workId, serviceId);
      this.store.putServiceRuntimeBinding({
        workId, serviceId, revision: service.desiredRevision,
        containerId: binding?.containerId ?? null, imageIdentity: service.resolvedImageDigest,
        recoveryCount: 0, recoveryWindowStartedAt: null, nextRetryAt: null, readySince: null,
        updatedAt: this.now().toISOString(),
      });
      this.enqueue(workId, serviceId, accepted.operationId, "retry");
    }
    return accepted;
  }

  operation(principal: ServicePrincipalInput, workId: string, operationId: string) {
    const operation = this.store.getOperation(operationId);
    if (operation === undefined || operation.workId !== workId || operation.serviceId === null) throw new Error("service operation was not found");
    this.requireService(principal, workId, operation.serviceId, true, false);
    return operation;
  }

  async logs(principal: ServicePrincipalInput, workId: string, serviceId: string, tailLines = 100) {
    const work = this.store.getWork(workId, true);
    const service = this.store.getService(workId, serviceId, true);
    if (isRuntimePrincipal(principal)) this.authorizePrincipal(principal, workId, work, "read-metadata");
    else authorizeWorkResource(userPrincipal(principal), work === undefined || service === undefined ? undefined : {
      kind: "service" as const, id: serviceId, workId, ownerUserId: work.ownerUserId,
    }, "read-content");
    const collectedAt = this.now().toISOString();
    if (service === undefined || this.runtime.logs === undefined) return { serviceId, status: "unavailable" as const, text: "", truncated: false, collectedAt, reason: "service logs are unavailable" };
    try {
      if (this.runtime.inspect !== undefined && !(await this.runtime.inspect(workId, serviceId)).exists) {
        return { serviceId, status: "unavailable" as const, text: "", truncated: false, collectedAt, reason: "service instance is unavailable" };
      }
      const value = await this.runtime.logs(workId, serviceId, Math.min(Math.max(tailLines, 1), 200));
      const bounded = boundUtf8(redactApplicationOutput(value.text, parseDefinition(service)), 64 * 1_024);
      const truncated = value.truncated || bounded.truncated;
      return { serviceId, status: truncated ? "truncated" as const : "available" as const, text: bounded.text, truncated, collectedAt };
    } catch {
      return { serviceId, status: "unavailable" as const, text: "", truncated: false, collectedAt, reason: "service log collection failed" };
    }
  }

  enable(principal: ServicePrincipalInput, workId: string, serviceId: string, idempotencyKey: string): AcceptedServiceOperation {
    this.assertAccepting();
    const service = this.requireService(principal, workId, serviceId);
    const publicRequestJson = stableJson({ serviceId, action: "enable" });
    const requestJson = stableJson({ serviceId, action: "enable", workControlVersion: this.store.getWork(workId)?.controlVersion ?? 0 });
    const accepted = this.store.acceptMutation({ principalId: principalKey(principal), workScope: workId, operationKind: "enable-service", idempotencyKey,
      requestDigest: digest(publicRequestJson), requestJson, targetVersion: service.desiredRevision, workId, serviceId, now: this.now().toISOString() }, (tx) => {
      tx.run(`UPDATE service_heads SET enabled = 1 WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`, workId, serviceId);
      const definition = JSON.parse(tx.get<{ definition_json: string }>(`SELECT definition_json FROM service_revisions WHERE work_id = ? AND service_id = ? AND revision = (SELECT desired_revision FROM service_heads WHERE work_id = ? AND service_id = ?)`, workId, serviceId, workId, serviceId)!.definition_json) as ServiceDefinition;
      this.assertQuotaDelta(tx, workId, service, { ...definition, enabled: true });
      tx.run(`UPDATE quota_reservations SET desired_cpu_millis = ?, desired_memory_bytes = ?, updated_at = ? WHERE work_id = ? AND subject_kind = 'service' AND subject_id = ?`, definition.cpuMillis, definition.memoryBytes, this.now().toISOString(), workId, serviceId);
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "enable");
    return { workId, serviceId: accepted.resourceId, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }

  disable(principal: ServicePrincipalInput, workId: string, serviceId: string, idempotencyKey: string): AcceptedServiceOperation {
    this.assertAccepting();
    const service = this.requireService(principal, workId, serviceId);
    const publicRequestJson = stableJson({ serviceId, action: "disable" });
    const requestJson = stableJson({ serviceId, action: "disable", workControlVersion: this.store.getWork(workId)?.controlVersion ?? 0 });
    const accepted = this.store.acceptMutation({ principalId: principalKey(principal), workScope: workId, operationKind: "disable-service", idempotencyKey,
      requestDigest: digest(publicRequestJson), requestJson, targetVersion: service.desiredRevision, workId, serviceId, now: this.now().toISOString() }, (tx) => {
      tx.run(`UPDATE service_heads SET enabled = 0 WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`, workId, serviceId);
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "disable");
    return { workId, serviceId: accepted.resourceId, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }

  remove(principal: ServicePrincipalInput, workId: string, serviceId: string, idempotencyKey: string, purgeData = false): AcceptedServiceOperation {
    this.assertAccepting();
    const service = this.requireService(principal, workId, serviceId, true);
    const publicRequestJson = stableJson({ serviceId, purgeData });
    const requestJson = stableJson({ serviceId, purgeData, workControlVersion: this.store.getWork(workId)?.controlVersion ?? 0 });
    const accepted = this.store.acceptMutation({ principalId: principalKey(principal), workScope: workId, operationKind: "remove-service", idempotencyKey,
      requestDigest: digest(publicRequestJson), requestJson, targetVersion: service.desiredRevision, workId, serviceId, now: this.now().toISOString() }, (tx) => {
      tx.tombstoneService(workId, serviceId, this.now().toISOString());
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "remove");
    return { workId, serviceId: accepted.resourceId, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }

  revisions(principal: ServicePrincipalInput, workId: string, serviceId: string) {
    this.requireService(principal, workId, serviceId, true, false);
    return this.store.listServiceRevisions(workId, serviceId);
  }

  list(principal: ServicePrincipalInput, workId: string): ServiceView[] {
    const work = this.store.getWork(workId);
    this.authorizePrincipal(principal, workId, work, "read-metadata");
    return this.store.listServices(workId).map(toView);
  }

  show(principal: ServicePrincipalInput, workId: string, serviceId: string): ServiceView {
    const work = this.store.getWork(workId);
    const service = this.store.getService(workId, serviceId);
    if (isRuntimePrincipal(principal)) this.authorizePrincipal(principal, workId, work, "read-metadata");
    else authorizeWorkResource(
      userPrincipal(principal),
      work === undefined || service === undefined ? undefined : {
        kind: "service" as const,
        id: serviceId,
        workId,
        ownerUserId: work.ownerUserId,
      },
      "read-metadata",
    );
    return toView(service!);
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }

  startReconciliation(intervalMs = 2_000): void {
    if (this.reconciliationTimer !== undefined || this.admissionClosed) return;
    this.reconciliationTimer = setInterval(() => void this.reconcileAll(), intervalMs);
    this.reconciliationTimer.unref();
  }

  closeAdmission(): void { this.admissionClosed = true; }

  async shutdown(): Promise<void> {
    this.closeAdmission();
    if (this.reconciliationTimer !== undefined) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
    await this.waitForIdle();
  }

  async reconcileAll(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      for (const work of this.store.listWorks()) {
        if (work.desiredState !== "running" || work.observedState === "stopping" || work.observedState === "deleting") continue;
        for (const service of this.store.listServices(work.id)) await this.reconcileService(work, service);
        const latest = this.store.getWork(work.id);
        if (latest !== undefined && ["ready", "degraded"].includes(latest.observedState)) {
          const failed = this.store.listServices(work.id).some((service) => ["failed", "unknown"].includes(service.observedState));
          const next = failed ? "degraded" : "ready";
          if (latest.observedState !== next) this.store.updateWorkObservedState(work.id, next, this.now().toISOString());
        }
      }
    } finally { this.reconciling = false; }
  }

  async prepareEnabledServices(work: WorkRecord): Promise<void> {
    for (const service of this.store.listServices(work.id)) {
      const definition = parseDefinition(service);
      if (!service.enabled) {
        if (service.observedState !== "disabled") {
          this.store.updateServiceObservedState(work.id, service.serviceId, "disabled", this.now().toISOString());
        }
        continue;
      }
      if (work.desiredState !== "running") {
        if (service.observedState !== "stopped") {
          this.store.updateServiceObservedState(work.id, service.serviceId, "stopped", this.now().toISOString());
        }
        continue;
      }
      try {
        await this.ensureServiceRunning(work.id, service, definition);
      } catch (error) {
        this.store.updateServiceObservedState(work.id, service.serviceId, "failed", this.now().toISOString(), {
          lastErrorJson: JSON.stringify(serviceDiagnostic(error, service.serviceId)),
        });
        if (definition.required) throw error;
      }
    }
  }

  hasFailedServices(workId: string): boolean {
    return this.store.listServices(workId).some((service) => ["failed", "unknown"].includes(service.observedState));
  }

  async stopServices(workId: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const results = await Promise.allSettled(this.store.listServices(workId).map(async (service) => {
      const correlationId = `shutdown-${workId}`;
      this.emitServiceDiagnostic(workId, service.serviceId, undefined, "service-stop", "started", "WORK_OPERATION_FAILED", correlationId);
      try {
        const definition = parseDefinition(service);
        if (this.runtime.stop !== undefined && service.observedState !== "stopped" && service.observedState !== "disabled") {
          await beforeDeadline(
            this.runtime.stop(workId, definition, Math.max(1, deadline - Date.now())),
            deadline,
            `service ${service.serviceId} stop timed out`,
          );
        }
        if (this.runtime.inspect !== undefined) {
          const actual = await beforeDeadline(this.runtime.inspect(workId, service.serviceId), deadline, `service ${service.serviceId} shutdown inspection timed out`);
          if (actual.exists && actual.running) throw new Error(`service ${service.serviceId} could not confirm shutdown`);
        }
        this.releaseServiceOccupation(workId, service.serviceId);
        const binding = this.store.getServiceRuntimeBinding(workId, service.serviceId);
        if (binding !== undefined) this.store.putServiceRuntimeBinding({ ...binding, readySince: null, updatedAt: this.now().toISOString() });
        this.store.updateServiceObservedState(
          workId,
          service.serviceId,
          service.enabled ? "stopped" : "disabled",
          this.now().toISOString(),
        );
        this.emitServiceDiagnostic(workId, service.serviceId, undefined, "service-stop", "succeeded", "WORK_OPERATION_FAILED", correlationId);
      } catch (error) {
        this.emitServiceDiagnostic(workId, service.serviceId, undefined, "service-stop", "failed", serviceDiagnostic(error, correlationId, service.serviceId, "service-stop").code, correlationId);
        throw error;
      }
    }));
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, `failed to stop ${failures.length} service(s) for Work ${workId}`);
  }

  async removeServiceInstances(workId: string): Promise<void> {
    for (const service of this.store.listServices(workId, true)) {
      const correlationId = `cleanup-${workId}`;
      this.emitServiceDiagnostic(workId, service.serviceId, undefined, "service-remove", "started", "WORK_OPERATION_FAILED", correlationId);
      try {
        const definition = parseDefinition(service);
        if (this.runtime.remove !== undefined) await this.runtime.remove(workId, definition);
        if (this.store.getQuotaReservation(workId, "service", service.serviceId)?.occupiedCpuMillis !== 0) {
          this.releaseServiceOccupation(workId, service.serviceId);
        }
        this.store.deleteServiceRuntimeBinding(workId, service.serviceId);
        this.emitServiceDiagnostic(workId, service.serviceId, undefined, "service-remove", "succeeded", "WORK_OPERATION_FAILED", correlationId);
      } catch (error) {
        this.emitServiceDiagnostic(workId, service.serviceId, undefined, "service-remove", "failed", serviceDiagnostic(error, correlationId, service.serviceId, "service-remove").code, correlationId);
        throw error;
      }
    }
  }

  releaseServiceOccupation(workId: string, serviceId: string, now = this.now().toISOString()): ServiceView {
    const service = this.store.getService(workId, serviceId, true);
    if (service === undefined) throw new Error(`service ${serviceId} was not found`);
    this.store.updateQuotaOccupation(workId, "service", serviceId, 0, 0, now);
    return toView(this.store.getService(workId, serviceId, true)!);
  }

  releaseServiceBudget(workId: string, serviceId: string, now = this.now().toISOString()): ServiceView {
    const service = this.store.getService(workId, serviceId, true);
    if (service === undefined) throw new Error(`service ${serviceId} was not found`);
    if (service.enabled && service.tombstonedAt === null) {
      throw new Error(`service ${serviceId} is still enabled and retains its budget`);
    }
    const reservation = this.store.getQuotaReservation(workId, "service", serviceId);
    if (reservation !== undefined && (reservation.occupiedCpuMillis !== 0 || reservation.occupiedMemoryBytes !== 0)) {
      throw new Error(`service ${serviceId} still occupies runtime resources`);
    }
    this.store.releaseQuotaReservation(workId, "service", serviceId, now);
    return toView(this.store.getService(workId, serviceId, true)!);
  }

  private requireService(principal: ServicePrincipalInput, workId: string, serviceId: string, includeDeleted = false, mutation = true): ServiceRecord {
    const work = this.store.getWork(workId);
    const service = this.store.getService(workId, serviceId, includeDeleted);
    if (isRuntimePrincipal(principal)) this.authorizePrincipal(principal, workId, work, "control");
    else authorizeWorkResource(userPrincipal(principal), work === undefined || service === undefined ? undefined : {
      kind: "service" as const, id: serviceId, workId, ownerUserId: work.ownerUserId,
    }, "control");
    if (service === undefined) throw new Error(`service ${serviceId} was not found`);
    if (mutation && (work?.desiredState === "deleted" || work?.observedState === "stopping" || work?.observedState === "deleting")) {
      throw new ServicePreconditionError(`Work ${workId} is stopping or deleting; service mutations are closed`);
    }
    return service;
  }

  private acceptAction(
    principal: ServicePrincipalInput,
    workId: string,
    serviceId: string,
    operationKind: string,
    idempotencyKey: string,
    revision: number,
    action: "restart" | "retry",
    enqueue = true,
  ): AcceptedServiceOperation {
    const publicRequestJson = stableJson({ serviceId, action });
    const requestJson = stableJson({ serviceId, action, workControlVersion: this.store.getWork(workId)?.controlVersion ?? 0 });
    const accepted = this.store.acceptMutation({ principalId: principalKey(principal), workScope: workId, operationKind, idempotencyKey,
      requestDigest: digest(publicRequestJson), requestJson, targetVersion: revision, workId, serviceId, now: this.now().toISOString() }, () => ({ resourceId: serviceId }));
    if (!accepted.reused && enqueue) this.enqueue(workId, serviceId, accepted.operationId, action);
    return { workId, serviceId: accepted.resourceId, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }

  private assertQuotaDelta(tx: { get<T>(sql: string, ...parameters: any[]): T | undefined }, workId: string, current: ServiceRecord, next: ServiceDefinition): void {
    const configRow = tx.get<{ config_json: string }>(`SELECT config_json FROM work_config_revisions WHERE work_id = ? AND revision = (SELECT desired_revision FROM works WHERE id = ?)`, workId, workId);
    const limits = configRow === undefined ? { cpuMillis: this.quota.hostCpuMillis, memoryBytes: this.quota.hostMemoryBytes, maxServices: Number.MAX_SAFE_INTEGER, maxRetainedVolumes: Number.MAX_SAFE_INTEGER } : readResources(configRow.config_json);
    const reservation = tx.get<{ desired_cpu_millis: number; desired_memory_bytes: number; occupied_cpu_millis: number; occupied_memory_bytes: number }>(`SELECT desired_cpu_millis, desired_memory_bytes, occupied_cpu_millis, occupied_memory_bytes FROM quota_reservations WHERE work_id = ? AND subject_kind = 'service' AND subject_id = ?`, workId, current.serviceId);
    const oldCpu = Math.max(reservation?.desired_cpu_millis ?? 0, reservation?.occupied_cpu_millis ?? 0);
    const oldMemory = Math.max(reservation?.desired_memory_bytes ?? 0, reservation?.occupied_memory_bytes ?? 0);
    const newCpu = next.enabled ? next.cpuMillis : 0;
    const newMemory = next.enabled ? next.memoryBytes : 0;
    const chargedCpu = Math.max(newCpu, reservation?.occupied_cpu_millis ?? 0);
    const chargedMemory = Math.max(newMemory, reservation?.occupied_memory_bytes ?? 0);
    const totals = tx.get<{ cpu: number; memory: number }>(`SELECT COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS cpu, COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS memory FROM quota_reservations WHERE work_id = ?`, workId) ?? { cpu: 0, memory: 0 };
    const hostTotals = tx.get<{ cpu: number; memory: number }>(`SELECT COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS cpu, COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS memory FROM quota_reservations`) ?? { cpu: 0, memory: 0 };
    if (totals.cpu - oldCpu + chargedCpu > limits.cpuMillis || hostTotals.cpu - oldCpu + chargedCpu > this.quota.hostCpuMillis) throw new ServiceQuotaExceededError("cpu", "service update would exceed CPU budget");
    if (totals.memory - oldMemory + chargedMemory > limits.memoryBytes || hostTotals.memory - oldMemory + chargedMemory > this.quota.hostMemoryBytes) throw new ServiceQuotaExceededError("memory", "service update would exceed memory budget");
    if (this.quota.hostRetainedVolumeSlots !== undefined) {
      const volumeTotal = tx.get<{ count: number }>(`SELECT COUNT(*) AS count FROM volume_records WHERE state != 'purged'`)?.count ?? 0;
      if (volumeTotal > this.quota.hostRetainedVolumeSlots) throw new ServiceQuotaExceededError("volumes", "service update would exceed retained volume budget");
    }
  }

  private enqueue(workId: string, serviceId: string, operationId: string, action: "create" | "update" | "restart" | "retry" | "enable" | "disable" | "remove" = "create"): void {
    this.recordServiceStage(operationId, "service-accept", "succeeded", safeDiagnostic("WORK_OPERATION_FAILED", "service-accept", { serviceId, correlationId: operationId }));
    this.emitServiceDiagnostic(workId, serviceId, operationId, "service-accept", "succeeded", "WORK_OPERATION_FAILED");
    const prior = this.queues.get(serviceId) ?? Promise.resolve();
    const next = prior.catch(() => undefined)
      .then(() => this.applyOperation(workId, serviceId, operationId, action))
      .finally(() => {
        if (this.queues.get(serviceId) === next) this.queues.delete(serviceId);
      });
    this.queues.set(serviceId, next);
  }

  private async applyOperation(workId: string, serviceId: string, operationId: string, action: string): Promise<void> {
    const operation = this.store.getOperation(operationId);
    if (operation === undefined || operation.state === "succeeded" || operation.state === "failed") return;
    this.store.updateOperation(operationId, "running", this.now().toISOString());
    try {
      const service = this.store.getService(workId, serviceId, action === "remove");
      const work = this.store.getWork(workId);
      if (service === undefined || work === undefined) throw new Error("accepted service definition is missing");
      const captured = this.store.listServiceRevisions(workId, serviceId)
        .find((revision) => revision.revision === operation.targetVersion);
      if (captured === undefined) throw new Error("accepted service revision is missing");
      const definition = JSON.parse(captured.definitionJson) as ServiceDefinition;
      const capturedService: ServiceRecord = {
        ...service,
        desiredRevision: captured.revision,
        definitionJson: captured.definitionJson,
        resolvedImageDigest: captured.resolvedImageDigest,
        createdAt: captured.createdAt,
      };
      const acceptedRequest = JSON.parse(operation.requestJson) as { workControlVersion?: unknown };
      const capturedWorkControlVersion = Number(acceptedRequest.workControlVersion);
      if (!["remove", "disable"].includes(action)
        && Number.isSafeInteger(capturedWorkControlVersion)
        && work.controlVersion !== capturedWorkControlVersion) {
        throw new ServiceOperationSupersededError();
      }
      if (!["remove", "disable"].includes(action) && !this.revisionIsCurrent(workId, serviceId, definition.revision)) {
        throw new ServiceOperationSupersededError();
      }
      if (action === "remove") {
        if (this.runtime.stop !== undefined && service.observedState !== "stopped" && service.observedState !== "disabled") {
          this.emitServiceDiagnostic(workId, serviceId, operationId, "service-stop", "started", "WORK_OPERATION_FAILED");
          await this.runtime.stop(workId, definition);
          this.emitServiceDiagnostic(workId, serviceId, operationId, "service-stop", "succeeded", "WORK_OPERATION_FAILED");
        }
        if (this.runtime.remove !== undefined) {
          this.emitServiceDiagnostic(workId, serviceId, operationId, "service-remove", "started", "WORK_OPERATION_FAILED");
          await this.runtime.remove(workId, definition);
        }
        this.releaseServiceOccupation(workId, serviceId);
        this.store.detachServiceVolumeReferences(workId, serviceId, this.now().toISOString());
        this.releaseServiceBudget(workId, serviceId);
      } else if (action === "disable") {
        if (this.runtime.stop !== undefined && service.observedState !== "stopped" && service.observedState !== "disabled") {
          this.emitServiceDiagnostic(workId, serviceId, operationId, "service-stop", "started", "WORK_OPERATION_FAILED");
          await this.runtime.stop(workId, definition);
        }
        this.releaseServiceOccupation(workId, serviceId);
        this.store.updateQuotaDesired(workId, "service", serviceId, 0, 0, this.now().toISOString());
        this.store.updateServiceObservedState(workId, serviceId, "disabled", this.now().toISOString());
      } else if (!service.enabled) {
        this.store.updateServiceObservedState(workId, serviceId, "disabled", this.now().toISOString());
      } else if (work.desiredState !== "running") {
        this.store.updateServiceObservedState(workId, serviceId, "stopped", this.now().toISOString());
      } else {
        if (action === "restart" && this.runtime.stop !== undefined) {
          this.emitServiceDiagnostic(workId, serviceId, operationId, "service-stop", "started", "WORK_OPERATION_FAILED");
          await this.runtime.stop(workId, definition);
          this.emitServiceDiagnostic(workId, serviceId, operationId, "service-stop", "succeeded", "WORK_OPERATION_FAILED");
        }
        if (action === "update" && service.appliedRevision !== null && service.appliedRevision !== definition.revision) {
          const previous = this.store.listServiceRevisions(workId, serviceId).find((revision) => revision.revision === service.appliedRevision);
          if (this.runtime.stop !== undefined && previous !== undefined) await this.runtime.stop(workId, JSON.parse(previous.definitionJson) as ServiceDefinition);
          if (this.runtime.remove !== undefined && previous !== undefined) await this.runtime.remove(workId, JSON.parse(previous.definitionJson) as ServiceDefinition);
          this.releaseServiceOccupation(workId, serviceId);
        }
        await this.ensureServiceRunning(workId, capturedService, definition,
          Number.isSafeInteger(capturedWorkControlVersion) ? capturedWorkControlVersion : undefined, operationId);
      }
      const current = this.store.getService(workId, serviceId, action === "remove")!;
      const successStage: DiagnosticStage = action === "remove" ? "service-remove"
        : action === "disable" ? "service-stop" : "service-readiness";
      const terminal = operationWithStage({
        record: this.store.getOperation(operationId)!, stage: successStage, outcome: "succeeded",
        diagnostic: safeDiagnostic("WORK_OPERATION_FAILED", successStage, { serviceId, correlationId: operationId }),
        timestamp: this.now().toISOString(), result: { observedState: current.observedState },
      });
      this.store.updateOperation(operationId, "succeeded", this.now().toISOString(), {
        resultJson: terminal.resultJson,
      });
      this.emitServiceDiagnostic(workId, serviceId, operationId, successStage, "succeeded", "WORK_OPERATION_FAILED");
    } catch (error) {
      if (error instanceof ServiceOperationSupersededError) {
        const diagnostic = safeDiagnostic("OPERATION_SUPERSEDED", "service-recovery", { serviceId, correlationId: operationId });
        const terminal = operationWithStage({ record: this.store.getOperation(operationId)!, stage: diagnostic.stage, outcome: "interrupted", diagnostic, timestamp: this.now().toISOString() });
        this.store.updateOperation(operationId, "superseded", this.now().toISOString(), { resultJson: terminal.resultJson });
        this.emitServiceDiagnostic(workId, serviceId, operationId, diagnostic.stage, "interrupted", diagnostic.code);
        return;
      }
      const diagnostic = serviceDiagnostic(error, operationId, serviceId,
        action === "remove" ? "service-remove" : action === "disable" ? "service-stop" : undefined);
      const errorJson = JSON.stringify(diagnostic);
      if (this.store.getService(workId, serviceId) !== undefined) {
        this.store.updateServiceObservedState(workId, serviceId, "failed", this.now().toISOString(), { lastErrorJson: errorJson });
      }
      let diagnosticCollection: Parameters<typeof operationWithStage>[0]["diagnosticCollection"];
      if (this.runtime.logs !== undefined && ["service-start", "service-readiness"].includes(diagnostic.stage)) {
        try {
          const collected = await beforeDeadline(this.runtime.logs(workId, serviceId, 100), Date.now() + 2_000, "service diagnostic collection timed out");
          diagnosticCollection = { state: collected.truncated ? "truncated" : "available" };
        } catch {
          diagnosticCollection = { state: "unavailable", code: "DIAGNOSTIC_COLLECTION_FAILED" };
          this.emitServiceDiagnostic(workId, serviceId, operationId, diagnostic.stage, "failed", "DIAGNOSTIC_COLLECTION_FAILED");
        }
      }
      const terminal = operationWithStage({
        record: this.store.getOperation(operationId)!, stage: diagnostic.stage, outcome: "failed", diagnostic,
        timestamp: this.now().toISOString(), ...(diagnosticCollection === undefined ? {} : { diagnosticCollection }),
      });
      this.store.updateOperation(operationId, "failed", this.now().toISOString(), { errorJson, resultJson: terminal.resultJson });
      this.emitServiceDiagnostic(workId, serviceId, operationId, diagnostic.stage, "failed", diagnostic.code);
    }
  }

  private recordServiceStage(operationId: string, stage: DiagnosticStage, outcome: "succeeded" | "failed" | "interrupted", diagnostic: SafeDiagnostic): void {
    const operation = this.store.getOperation(operationId);
    if (operation === undefined) return;
    try {
      const stages = (JSON.parse(operation.resultJson ?? "{}") as { diagnostics?: { stages?: Array<{ stage?: string; serviceId?: string }> } }).diagnostics?.stages ?? [];
      if (stages.some((item) => item.stage === stage && item.serviceId === diagnostic.serviceId)) return;
    } catch { /* Replace malformed internal diagnostics with a safe envelope. */ }
    const staged = operationWithStage({ record: operation, stage, outcome, diagnostic, timestamp: this.now().toISOString() });
    this.store.updateOperation(operationId, operation.state, this.now().toISOString(), { resultJson: staged.resultJson });
  }

  private emitServiceDiagnostic(
    workId: string,
    serviceId: string,
    operationId: string | undefined,
    stage: DiagnosticStage,
    outcome: "started" | "succeeded" | "failed" | "interrupted",
    code: DiagnosticCode,
    correlationId = operationId ?? `service-${serviceId}`,
  ): void {
    emitDiagnostic({
      timestamp: this.now().toISOString(), level: outcome === "failed" ? "error" : outcome === "interrupted" ? "warn" : "info",
      component: "core", stage, outcome, correlationId, code,
      message: "Service operation state changed.", workId, ...(operationId === undefined ? {} : { operationId }), serviceId,
    }, this.diagnosticLogger);
  }

  private async ensureServiceRunning(workId: string, service: ServiceRecord, definition: ServiceDefinition, workControlVersion?: number, operationId?: string): Promise<void> {
    if (!this.targetIsCurrent(workId, service.serviceId, definition, workControlVersion)) throw new ServiceOperationSupersededError();
    const current = this.store.getService(workId, service.serviceId);
    if (current?.observedState === "ready" && current.appliedRevision === definition.revision) {
      if (this.runtime.inspect === undefined) return;
      const actual = await this.runtime.inspect(workId, service.serviceId);
      if (actual.exists && actual.running) return;
    }
    this.store.updateServiceObservedState(workId, service.serviceId, "starting", this.now().toISOString());
    let imageIdentity = service.resolvedImageDigest;
    this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-image", "started", "WORK_OPERATION_FAILED");
    if (imageIdentity === null && this.runtime.resolveImage !== undefined) {
      imageIdentity = await this.runtime.resolveImage(workId, definition);
      this.store.bindServiceImage(workId, service.serviceId, definition.revision, imageIdentity);
    }
    this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-image", "succeeded", "WORK_OPERATION_FAILED");
    this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-storage", "started", "WORK_OPERATION_FAILED");
    await this.runtime.prepare?.(workId, definition);
    this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-storage", "succeeded", "WORK_OPERATION_FAILED");
    this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-start", "started", "WORK_OPERATION_FAILED");
    await this.runtime.start(workId, definition, imageIdentity ?? undefined);
    this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-start", "succeeded", "WORK_OPERATION_FAILED");
    await this.assertTarget(workId, service.serviceId, definition, workControlVersion);
    if (this.runtime.waitReady !== undefined) {
      this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-readiness", "started", "WORK_OPERATION_FAILED");
      const ready = await this.runtime.waitReady(workId, definition, definition.readiness?.deadlineMs ?? 120_000);
      if (!ready) throw Object.assign(new Error(`service ${service.serviceId} readiness timeout`), { code: "SERVICE_READINESS_TIMEOUT" });
      this.emitServiceDiagnostic(workId, service.serviceId, operationId, "service-readiness", "succeeded", "WORK_OPERATION_FAILED");
    }
    await this.assertTarget(workId, service.serviceId, definition, workControlVersion);
    this.store.updateQuotaOccupation(
      workId,
      "service",
      service.serviceId,
      definition.cpuMillis,
      definition.memoryBytes,
      this.now().toISOString(),
    );
    this.store.updateServiceObservedState(workId, service.serviceId, "ready", this.now().toISOString(), {
      appliedRevision: definition.revision,
    });
    const actual = await this.runtime.inspect?.(workId, service.serviceId);
    const previousBinding = this.store.getServiceRuntimeBinding(workId, service.serviceId);
    this.store.putServiceRuntimeBinding({
      workId, serviceId: service.serviceId, revision: definition.revision,
      containerId: actual?.containerId ?? previousBinding?.containerId ?? null,
      imageIdentity: imageIdentity ?? null,
      recoveryCount: previousBinding?.recoveryCount ?? 0,
      recoveryWindowStartedAt: previousBinding?.recoveryWindowStartedAt ?? null,
      nextRetryAt: null,
      readySince: previousBinding?.readySince ?? this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    });
  }

  private async assertTarget(workId: string, serviceId: string, definition: ServiceDefinition, workControlVersion?: number): Promise<void> {
    if (this.targetIsCurrent(workId, serviceId, definition, workControlVersion)) return;
    if (this.runtime.stop !== undefined) await this.runtime.stop(workId, definition).catch(() => undefined);
    throw new ServiceOperationSupersededError();
  }

  private targetIsCurrent(workId: string, serviceId: string, definition: ServiceDefinition, workControlVersion?: number): boolean {
    const work = this.store.getWork(workId, true);
    const current = this.store.getService(workId, serviceId, true);
    return work?.desiredState === "running" && (workControlVersion === undefined || work.controlVersion === workControlVersion)
      && work.observedState !== "stopping" && work.observedState !== "stopped" && work.observedState !== "deleting"
      && current?.tombstonedAt === null && current.enabled && current.desiredRevision === definition.revision;
  }

  private revisionIsCurrent(workId: string, serviceId: string, revision: number): boolean {
    const current = this.store.getService(workId, serviceId, true);
    return current?.tombstonedAt === null && current.desiredRevision === revision;
  }

  private authorizePrincipal(principal: ServicePrincipalInput, workId: string, work: WorkRecord | undefined, action: "control" | "read-metadata"): void {
    if (!isRuntimePrincipal(principal)) {
      authorizeWorkResource(userPrincipal(principal), work === undefined ? undefined : asOwnedWork(work), action);
      return;
    }
    if (principal.workId !== workId || work === undefined || work.desiredState !== "running" || !["ready", "degraded"].includes(work.observedState)) throw new ServicePreconditionError("runtime identity is outside the active Work scope");
    const generation = this.store.getRuntimeGeneration(workId, principal.generation);
    if (generation?.state !== "ready" || generation.instanceId !== principal.instanceId) {
      throw new ServicePreconditionError("runtime identity is stale or inactive");
    }
  }

  private assertAccepting(): void {
    if (this.admissionClosed) throw new ServicePreconditionError("Core is shutting down; service mutations are closed");
  }

  private async reconcileService(work: WorkRecord, service: ServiceRecord): Promise<void> {
    if (!service.enabled || this.runtime.inspect === undefined) return;
    const definition = parseDefinition(service);
    let actual;
    try { actual = await this.runtime.inspect(work.id, service.serviceId); }
    catch {
      const correlationId = `recovery-${service.serviceId}`;
      const diagnostic = serviceDiagnostic({ code: "DOCKER_UNAVAILABLE" }, correlationId, service.serviceId, "service-recovery");
      this.store.updateServiceObservedState(work.id, service.serviceId, "unknown", this.now().toISOString(), {
        lastErrorJson: JSON.stringify(diagnostic),
      });
      this.emitServiceDiagnostic(work.id, service.serviceId, undefined, "service-recovery", "failed", "DOCKER_UNAVAILABLE", correlationId);
      return;
    }
    const now = this.now();
    const nowText = now.toISOString();
    let binding = this.store.getServiceRuntimeBinding(work.id, service.serviceId);
    if (actual.exists && actual.running) {
      if (service.observedState !== "ready" || service.appliedRevision !== definition.revision) {
        try { await this.ensureServiceRunning(work.id, service, definition); } catch { return; }
        binding = this.store.getServiceRuntimeBinding(work.id, service.serviceId);
      }
      if (binding !== undefined && binding.readySince !== null && now.getTime() - Date.parse(binding.readySince) >= 10 * 60_000
        && binding.recoveryCount > 0) {
        this.store.putServiceRuntimeBinding({ ...binding, recoveryCount: 0, recoveryWindowStartedAt: null, nextRetryAt: null, updatedAt: nowText });
      }
      return;
    }
    if (definition.restartPolicy === "never") {
      this.store.updateServiceObservedState(work.id, service.serviceId, "failed", nowText, { lastErrorJson: JSON.stringify(serviceDiagnostic({ code: "SERVICE_EXITED" }, `recovery-${service.serviceId}`, service.serviceId)) });
      return;
    }
    binding ??= {
      workId: work.id, serviceId: service.serviceId, revision: definition.revision,
      containerId: null, imageIdentity: service.resolvedImageDigest, recoveryCount: 0,
      recoveryWindowStartedAt: nowText, nextRetryAt: null, readySince: null, updatedAt: nowText,
    };
    if (binding.recoveryCount >= 3 && binding.nextRetryAt === null) return;
    if (binding.nextRetryAt === null) {
      this.store.putServiceRuntimeBinding({ ...binding, readySince: null, recoveryWindowStartedAt: binding.recoveryWindowStartedAt ?? nowText, nextRetryAt: new Date(now.getTime() + 1_000).toISOString(), updatedAt: nowText });
      return;
    }
    if (Date.parse(binding.nextRetryAt) > now.getTime()) return;
    const nextCount = binding.recoveryCount + 1;
    const nextDelay = nextCount === 1 ? 5_000 : nextCount === 2 ? 15_000 : null;
    this.store.putServiceRuntimeBinding({ ...binding, recoveryCount: nextCount, readySince: null,
      nextRetryAt: nextDelay === null ? null : new Date(now.getTime() + nextDelay).toISOString(), updatedAt: nowText });
    const correlationId = `recovery-${service.serviceId}`;
    this.emitServiceDiagnostic(work.id, service.serviceId, undefined, "service-recovery", "started", "WORK_OPERATION_FAILED", correlationId);
    try {
      await this.ensureServiceRunning(work.id, service, definition);
      this.emitServiceDiagnostic(work.id, service.serviceId, undefined, "service-recovery", "succeeded", "WORK_OPERATION_FAILED", correlationId);
    }
    catch (error) {
      const diagnostic = serviceDiagnostic(error, correlationId, service.serviceId);
      this.store.updateServiceObservedState(work.id, service.serviceId, "failed", nowText, { lastErrorJson: JSON.stringify(diagnostic) });
      this.emitServiceDiagnostic(work.id, service.serviceId, undefined, "service-recovery", "failed", diagnostic.code, correlationId);
    }
  }
}

function toView(record: ServiceRecord): ServiceView {
  return {
    workId: record.workId,
    serviceId: record.serviceId,
    name: record.name,
    desiredRevision: record.desiredRevision,
    appliedRevision: record.appliedRevision,
    enabled: record.enabled,
    observedState: record.observedState,
    lastError: record.lastErrorJson === null ? null : JSON.parse(record.lastErrorJson),
    definition: parseDefinition(record),
    endpoints: endpoints(parseDefinition(record)),
    createdAt: record.createdAt,
  };
}

function endpoints(definition: ServiceDefinition): ServiceEndpoint[] {
  return definition.ports.map((port) => ({
    name: port.name,
    protocol: port.protocol,
    host: `svc-${definition.name}`,
    port: port.containerPort,
    ...(definition.readiness?.kind === "http" && definition.readiness.portName === port.name
      ? { url: `http://svc-${definition.name}:${port.containerPort}${definition.readiness.path}` }
      : {}),
  }));
}

function parseDefinition(record: ServiceRecord): ServiceDefinition {
  return JSON.parse(record.definitionJson) as ServiceDefinition;
}

function asOwnedWork(work: { readonly id: string; readonly ownerUserId: string }) {
  return { kind: "work" as const, id: work.id, workId: work.id, ownerUserId: work.ownerUserId };
}

function principalKey(principal: ServicePrincipalInput): string {
  return isRuntimePrincipal(principal) ? `work-agent:${principal.workId}` : userPrincipal(principal).userId;
}

function isRuntimePrincipal(principal: ServicePrincipalInput): principal is Extract<ServicePrincipal, { kind: "work-runtime" }> {
  return "kind" in principal && principal.kind === "work-runtime";
}

function userPrincipal(principal: Exclude<ServicePrincipalInput, Extract<ServicePrincipal, { kind: "work-runtime" }>>): UserPrincipal {
  return "kind" in principal ? principal.user : principal;
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

function usesWorkspace(definition: ServiceDefinition): boolean {
  return definition.mounts.some((mount) => mount.source === "workspace");
}

function attachWorkspaceReference(
  tx: { run(sql: string, ...parameters: any[]): void },
  workId: string,
  serviceId: string,
  now: string,
): void {
  tx.run(`INSERT OR IGNORE INTO volume_references(volume_id, consumer_kind, consumer_id, created_at)
    SELECT id, 'service', ?, ? FROM volume_records
    WHERE work_id = ? AND volume_role = 'workspace' AND state IN ('active', 'retained')`, serviceId, now, workId);
  tx.run(`UPDATE volume_records SET
    reference_count = (SELECT COUNT(*) FROM volume_references WHERE volume_id = volume_records.id),
    state = 'active', retained_at = NULL
    WHERE work_id = ? AND volume_role = 'workspace' AND state IN ('active', 'retained')`, workId);
}

function detachWorkspaceReference(
  tx: { run(sql: string, ...parameters: any[]): void },
  workId: string,
  serviceId: string,
  now: string,
): void {
  tx.run(`DELETE FROM volume_references WHERE consumer_kind = 'service' AND consumer_id = ?
    AND volume_id IN (SELECT id FROM volume_records WHERE work_id = ? AND volume_role = 'workspace')`, serviceId, workId);
  tx.run(`UPDATE volume_records SET
    reference_count = (SELECT COUNT(*) FROM volume_references WHERE volume_id = volume_records.id),
    state = CASE WHEN (SELECT COUNT(*) FROM volume_references WHERE volume_id = volume_records.id) = 0 THEN 'retained' ELSE 'active' END,
    retained_at = CASE WHEN (SELECT COUNT(*) FROM volume_references WHERE volume_id = volume_records.id) = 0 THEN COALESCE(retained_at, ?) ELSE NULL END
    WHERE work_id = ? AND volume_role = 'workspace' AND state IN ('active', 'retained')`, now, workId);
}

function boundUtf8(value: string, maximumBytes: number): { readonly text: string; readonly truncated: boolean } {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length <= maximumBytes) return { text: value, truncated: false };
  return { text: encoded.subarray(0, maximumBytes).toString("utf8"), truncated: true };
}

function redactApplicationOutput(value: string, definition: ServiceDefinition): string {
  let redacted = value.replace(/(token|password|secret|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]");
  for (const [name, secret] of Object.entries(definition.environment)) {
    if (!/(token|password|secret|api[_-]?key)/i.test(name) || secret.length < 1) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number, message: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(message);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), remaining); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function serviceDiagnostic(error: unknown, correlationId: string, serviceId = correlationId, stageHint?: DiagnosticStage): SafeDiagnostic {
  const item = error as { code?: unknown; name?: string };
  const code: DiagnosticCode = item.code === "IMAGE_UNAVAILABLE" || item.code === "MOUNT_DENIED" || item.code === "QUOTA_EXCEEDED"
    || item.code === "SERVICE_EXITED" || item.code === "SERVICE_READINESS_TIMEOUT" || item.code === "DOCKER_UNAVAILABLE"
    ? item.code
    : item.name === "ServiceExitedError" ? "SERVICE_EXITED"
    : item.name === "ServiceReadinessTimeoutError" ? "SERVICE_READINESS_TIMEOUT"
    : item.name === "DockerDependencyError" ? "DOCKER_UNAVAILABLE" : "SERVICE_START_FAILED";
  const stage: DiagnosticStage = stageHint ?? (code === "IMAGE_UNAVAILABLE" ? "service-image"
    : code === "MOUNT_DENIED" ? "service-storage"
      : code === "SERVICE_READINESS_TIMEOUT" || code === "SERVICE_EXITED" ? "service-readiness"
        : "service-start");
  return {
    code,
    stage,
    message: stage === "service-readiness" ? "The service did not become ready before its deadline."
      : stage === "service-image" ? "The selected service image is unavailable."
      : "The service runtime could not reach the requested state.",
    retryable: true,
    remediation: "Inspect bounded service logs, correct the dependency or definition, then retry.",
    correlationId,
    serviceId,
  };
}

function readResources(configJson: string): {
  readonly cpuMillis: number;
  readonly memoryBytes: number;
  readonly maxServices: number;
  readonly maxRetainedVolumes: number;
} {
  const config = JSON.parse(configJson) as { resources?: Partial<{
    cpuMillis: number;
    memoryBytes: number;
    maxServices: number;
    maxRetainedVolumes: number;
  }> };
  const resources = config.resources;
  if (resources === undefined) throw new Error("Work configuration has no resource policy");
  return {
    cpuMillis: resources.cpuMillis ?? 0,
    memoryBytes: resources.memoryBytes ?? 0,
    maxServices: resources.maxServices ?? 0,
    maxRetainedVolumes: resources.maxRetainedVolumes ?? 0,
  };
}
