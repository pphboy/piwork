import { createHash, randomUUID } from "node:crypto";
import type { ServiceDefinition, ServiceDefinitionInput } from "@piwork/contracts";
import { CoreStore, IdempotencyConflictError, type ServiceRecord, type WorkRecord } from "@piwork/core-store";
import { authorizeWorkResource, type UserPrincipal } from "../work-access/policy.js";

export interface ServiceQuotaPolicy {
  readonly hostCpuMillis: number;
  readonly hostMemoryBytes: number;
  readonly hostRetainedVolumeSlots?: number;
}

export interface ServiceRuntimeAdapter {
  start(definition: ServiceDefinition): Promise<void>;
  /** Resolve only when the service's declared readiness probe succeeds. */
  waitReady?(definition: ServiceDefinition, timeoutMs: number): Promise<boolean>;
  stop?(definition: ServiceDefinition): Promise<void>;
  remove?(definition: ServiceDefinition): Promise<void>;
}

export interface AcceptedServiceOperation {
  readonly serviceId: string;
  readonly operationId: string;
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

export class WorkServiceManagementService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly store: CoreStore,
    private readonly runtime: ServiceRuntimeAdapter,
    private readonly now: () => Date = () => new Date(),
    private readonly quota: ServiceQuotaPolicy = {
      hostCpuMillis: 128_000,
      hostMemoryBytes: 256 * 1_024 * 1_024 * 1_024,
    },
  ) {}

  create(
    principal: UserPrincipal,
    workId: string,
    input: { readonly definition: ServiceDefinitionInput; readonly idempotencyKey: string },
  ): AcceptedServiceOperation {
    const work = this.store.getWork(workId);
    authorizeWorkResource(principal, work === undefined ? undefined : asOwnedWork(work), "control");
    if (work !== undefined && (work.desiredState === "deleted" || work.observedState === "stopping" || work.observedState === "deleting")) {
      throw new ServicePreconditionError(`Work ${workId} is stopping or deleting; service mutations are closed`);
    }

    const serviceId = `service-${randomUUID()}`;
    const definition: ServiceDefinition = { ...input.definition, serviceId, revision: 1 };
    const requestJson = stableJson(input.definition);
    let accepted;
    try {
      accepted = this.store.acceptMutation({
        principalId: principal.userId,
        workScope: workId,
        operationKind: "create-service",
        idempotencyKey: input.idempotencyKey,
        requestDigest: digest(requestJson),
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
        if (retainedVolumes + definition.mounts.length > workResources.maxRetainedVolumes) {
          throw new ServiceQuotaExceededError("volumes", `Work ${workId} has reached its retained volume limit`);
        }
        const workCpu = tx.get<{ total: number }>(`SELECT COALESCE(SUM(desired_cpu_millis), 0) AS total
          FROM quota_reservations WHERE work_id = ?`, workId)?.total ?? 0;
        const workMemory = tx.get<{ total: number }>(`SELECT COALESCE(SUM(desired_memory_bytes), 0) AS total
          FROM quota_reservations WHERE work_id = ?`, workId)?.total ?? 0;
        const desiredCpu = definition.enabled ? definition.cpuMillis : 0;
        const desiredMemory = definition.enabled ? definition.memoryBytes : 0;
        if (workCpu + desiredCpu > workResources.cpuMillis) {
          throw new ServiceQuotaExceededError("cpu", `Work ${workId} CPU budget would be exceeded`);
        }
        if (workMemory + desiredMemory > workResources.memoryBytes) {
          throw new ServiceQuotaExceededError("memory", `Work ${workId} memory budget would be exceeded`);
        }
        const hostCpu = tx.get<{ total: number }>(`SELECT COALESCE(SUM(desired_cpu_millis), 0) AS total
          FROM quota_reservations`)?.total ?? 0;
        const hostMemory = tx.get<{ total: number }>(`SELECT COALESCE(SUM(desired_memory_bytes), 0) AS total
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
          if (hostVolumes + definition.mounts.length > this.quota.hostRetainedVolumeSlots) {
            throw new ServiceQuotaExceededError("volumes", "host retained volume budget would be exceeded");
          }
        }
        tx.run(`INSERT INTO service_revisions(
          work_id, service_id, revision, definition_json, resolved_image_digest, created_at
        ) VALUES (?, ?, 1, ?, ?, ?)`,
        workId, serviceId, stableJson(definition), definition.image.digest ?? null, now);
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
        definition.mounts.length,
        now);
        return { resourceId: serviceId };
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw error;
      if (error instanceof ServiceNameConflictError || error instanceof ServiceQuotaExceededError) throw error;
      if (this.store.listServices(workId).some((service) => service.name === input.definition.name)) {
        throw new ServiceNameConflictError(workId, input.definition.name);
      }
      throw error;
    }

    if (!accepted.reused) this.enqueue(workId, accepted.resourceId, accepted.operationId);
    return { serviceId: accepted.resourceId, operationId: accepted.operationId, reused: accepted.reused };
  }

  update(
    principal: UserPrincipal,
    workId: string,
    serviceId: string,
    expectedRevision: number,
    definitionInput: ServiceDefinitionInput,
    idempotencyKey: string,
  ): AcceptedServiceOperation {
    const existing = this.requireService(principal, workId, serviceId);
    const requestJson = stableJson({ expectedRevision, definition: definitionInput });
    const accepted = this.store.acceptMutation({
      principalId: principal.userId, workScope: workId, operationKind: "update-service",
      idempotencyKey, requestDigest: digest(requestJson), requestJson,
      targetVersion: expectedRevision + 1, workId, serviceId, now: this.now().toISOString(),
    }, (tx) => {
      const head = tx.get<{ desired_revision: number; name: string; enabled: number }>(
        `SELECT desired_revision, name, enabled FROM service_heads WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`, workId, serviceId);
      if (head === undefined) throw new Error(`service ${serviceId} was not found`);
      if (head.desired_revision !== expectedRevision) throw new ServiceRevisionConflictError(serviceId, expectedRevision, head.desired_revision);
      const nameConflict = tx.get<{ service_id: string }>(
        `SELECT service_id FROM service_heads WHERE work_id = ? AND name = ? AND service_id != ? AND tombstoned_at IS NULL`, workId, definitionInput.name, serviceId);
      if (nameConflict !== undefined) throw new ServiceNameConflictError(workId, definitionInput.name);
      const revision = expectedRevision + 1;
      const definition: ServiceDefinition = { ...definitionInput, serviceId, revision };
      this.assertQuotaDelta(tx, workId, existing, definition);
      const now = this.now().toISOString();
      tx.run(`INSERT INTO service_revisions(work_id, service_id, revision, definition_json, resolved_image_digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, workId, serviceId, revision, stableJson(definition), definition.image.digest ?? null, now);
      tx.run(`UPDATE service_heads SET name = ?, desired_revision = ?, enabled = ? WHERE work_id = ? AND service_id = ?`,
        definition.name, revision, definition.enabled ? 1 : 0, workId, serviceId);
      tx.run(`UPDATE quota_reservations SET desired_cpu_millis = ?, desired_memory_bytes = ?, volume_slots = ?, updated_at = ?
        WHERE work_id = ? AND subject_kind = 'service' AND subject_id = ?`,
        definition.enabled ? definition.cpuMillis : 0, definition.enabled ? definition.memoryBytes : 0,
        definition.mounts.length, now, workId, serviceId);
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "update");
    return { serviceId: accepted.resourceId, operationId: accepted.operationId, reused: accepted.reused };
  }

  restart(principal: UserPrincipal, workId: string, serviceId: string, idempotencyKey: string): AcceptedServiceOperation {
    const service = this.requireService(principal, workId, serviceId);
    const work = this.store.getWork(workId)!;
    if (work.desiredState !== "running") throw new ServicePreconditionError(`cannot restart service ${serviceId} while Work ${workId} is stopped`);
    if (!service.enabled) throw new ServicePreconditionError(`cannot restart disabled service ${serviceId}`);
    return this.acceptAction(principal, workId, serviceId, "restart-service", idempotencyKey, service.desiredRevision, "restart");
  }

  enable(principal: UserPrincipal, workId: string, serviceId: string, idempotencyKey: string): AcceptedServiceOperation {
    const service = this.requireService(principal, workId, serviceId);
    const requestJson = stableJson({ serviceId, action: "enable" });
    const accepted = this.store.acceptMutation({ principalId: principal.userId, workScope: workId, operationKind: "enable-service", idempotencyKey,
      requestDigest: digest(requestJson), requestJson, targetVersion: service.desiredRevision, workId, serviceId, now: this.now().toISOString() }, (tx) => {
      tx.run(`UPDATE service_heads SET enabled = 1 WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`, workId, serviceId);
      const definition = JSON.parse(tx.get<{ definition_json: string }>(`SELECT definition_json FROM service_revisions WHERE work_id = ? AND service_id = ? AND revision = (SELECT desired_revision FROM service_heads WHERE work_id = ? AND service_id = ?)`, workId, serviceId, workId, serviceId)!.definition_json) as ServiceDefinition;
      tx.run(`UPDATE quota_reservations SET desired_cpu_millis = ?, desired_memory_bytes = ?, updated_at = ? WHERE work_id = ? AND subject_kind = 'service' AND subject_id = ?`, definition.cpuMillis, definition.memoryBytes, this.now().toISOString(), workId, serviceId);
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "enable");
    return { serviceId: accepted.resourceId, operationId: accepted.operationId, reused: accepted.reused };
  }

  disable(principal: UserPrincipal, workId: string, serviceId: string, idempotencyKey: string): AcceptedServiceOperation {
    const service = this.requireService(principal, workId, serviceId);
    const requestJson = stableJson({ serviceId, action: "disable" });
    const accepted = this.store.acceptMutation({ principalId: principal.userId, workScope: workId, operationKind: "disable-service", idempotencyKey,
      requestDigest: digest(requestJson), requestJson, targetVersion: service.desiredRevision, workId, serviceId, now: this.now().toISOString() }, (tx) => {
      tx.run(`UPDATE service_heads SET enabled = 0 WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`, workId, serviceId);
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "disable");
    return { serviceId: accepted.resourceId, operationId: accepted.operationId, reused: accepted.reused };
  }

  remove(principal: UserPrincipal, workId: string, serviceId: string, idempotencyKey: string, purgeData = false): AcceptedServiceOperation {
    const service = this.requireService(principal, workId, serviceId, true);
    const requestJson = stableJson({ serviceId, purgeData });
    const accepted = this.store.acceptMutation({ principalId: principal.userId, workScope: workId, operationKind: "remove-service", idempotencyKey,
      requestDigest: digest(requestJson), requestJson, targetVersion: service.desiredRevision, workId, serviceId, now: this.now().toISOString() }, (tx) => {
      tx.tombstoneService(workId, serviceId, this.now().toISOString());
      return { resourceId: serviceId };
    });
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, "remove");
    return { serviceId: accepted.resourceId, operationId: accepted.operationId, reused: accepted.reused };
  }

  revisions(principal: UserPrincipal, workId: string, serviceId: string) {
    this.requireService(principal, workId, serviceId, true, false);
    return this.store.listServiceRevisions(workId, serviceId);
  }

  list(principal: UserPrincipal, workId: string): ServiceView[] {
    const work = this.store.getWork(workId);
    authorizeWorkResource(principal, work === undefined ? undefined : asOwnedWork(work), "read-metadata");
    return this.store.listServices(workId).map(toView);
  }

  show(principal: UserPrincipal, workId: string, serviceId: string): ServiceView {
    const work = this.store.getWork(workId);
    const service = this.store.getService(workId, serviceId);
    authorizeWorkResource(
      principal,
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
          lastErrorJson: JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
        });
        if (definition.required) throw error;
      }
    }
  }

  async stopServices(workId: string): Promise<void> {
    for (const service of this.store.listServices(workId)) {
      const definition = parseDefinition(service);
      if (this.runtime.stop !== undefined && service.observedState !== "stopped" && service.observedState !== "disabled") {
        await this.runtime.stop(definition);
      }
      this.releaseServiceOccupation(workId, service.serviceId);
      this.store.updateServiceObservedState(
        workId,
        service.serviceId,
        service.enabled ? "stopped" : "disabled",
        this.now().toISOString(),
      );
    }
  }

  async removeServiceInstances(workId: string): Promise<void> {
    for (const service of this.store.listServices(workId, true)) {
      const definition = parseDefinition(service);
      if (this.runtime.remove !== undefined) await this.runtime.remove(definition);
      if (this.store.getQuotaReservation(workId, "service", service.serviceId)?.occupiedCpuMillis !== 0) {
        this.releaseServiceOccupation(workId, service.serviceId);
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

  private requireService(principal: UserPrincipal, workId: string, serviceId: string, includeDeleted = false, mutation = true): ServiceRecord {
    const work = this.store.getWork(workId);
    const service = this.store.getService(workId, serviceId, includeDeleted);
    authorizeWorkResource(principal, work === undefined || service === undefined ? undefined : {
      kind: "service" as const, id: serviceId, workId, ownerUserId: work.ownerUserId,
    }, "control");
    if (service === undefined) throw new Error(`service ${serviceId} was not found`);
    if (mutation && (work?.desiredState === "deleted" || work?.observedState === "stopping" || work?.observedState === "deleting")) {
      throw new ServicePreconditionError(`Work ${workId} is stopping or deleting; service mutations are closed`);
    }
    return service;
  }

  private acceptAction(
    principal: UserPrincipal,
    workId: string,
    serviceId: string,
    operationKind: string,
    idempotencyKey: string,
    revision: number,
    action: "restart",
  ): AcceptedServiceOperation {
    const requestJson = stableJson({ serviceId, action });
    const accepted = this.store.acceptMutation({ principalId: principal.userId, workScope: workId, operationKind, idempotencyKey,
      requestDigest: digest(requestJson), requestJson, targetVersion: revision, workId, serviceId, now: this.now().toISOString() }, () => ({ resourceId: serviceId }));
    if (!accepted.reused) this.enqueue(workId, serviceId, accepted.operationId, action);
    return { serviceId: accepted.resourceId, operationId: accepted.operationId, reused: accepted.reused };
  }

  private assertQuotaDelta(tx: { get<T>(sql: string, ...parameters: any[]): T | undefined }, workId: string, current: ServiceRecord, next: ServiceDefinition): void {
    const configRow = tx.get<{ config_json: string }>(`SELECT config_json FROM work_config_revisions WHERE work_id = ? AND revision = (SELECT desired_revision FROM works WHERE id = ?)`, workId, workId);
    const limits = configRow === undefined ? { cpuMillis: this.quota.hostCpuMillis, memoryBytes: this.quota.hostMemoryBytes, maxServices: Number.MAX_SAFE_INTEGER, maxRetainedVolumes: Number.MAX_SAFE_INTEGER } : readResources(configRow.config_json);
    const reservation = tx.get<{ desired_cpu_millis: number; desired_memory_bytes: number; volume_slots: number }>(`SELECT desired_cpu_millis, desired_memory_bytes, volume_slots FROM quota_reservations WHERE work_id = ? AND subject_kind = 'service' AND subject_id = ?`, workId, current.serviceId);
    const oldCpu = reservation?.desired_cpu_millis ?? 0;
    const oldMemory = reservation?.desired_memory_bytes ?? 0;
    const oldVolumes = reservation?.volume_slots ?? 0;
    const newCpu = next.enabled ? next.cpuMillis : 0;
    const newMemory = next.enabled ? next.memoryBytes : 0;
    const totals = tx.get<{ cpu: number; memory: number }>(`SELECT COALESCE(SUM(desired_cpu_millis), 0) AS cpu, COALESCE(SUM(desired_memory_bytes), 0) AS memory FROM quota_reservations WHERE work_id = ?`, workId) ?? { cpu: 0, memory: 0 };
    if (totals.cpu - oldCpu + newCpu > limits.cpuMillis || totals.cpu - oldCpu + newCpu > this.quota.hostCpuMillis) throw new ServiceQuotaExceededError("cpu", "service update would exceed CPU budget");
    if (totals.memory - oldMemory + newMemory > limits.memoryBytes || totals.memory - oldMemory + newMemory > this.quota.hostMemoryBytes) throw new ServiceQuotaExceededError("memory", "service update would exceed memory budget");
    if (this.quota.hostRetainedVolumeSlots !== undefined) {
      const volumeTotal = tx.get<{ count: number }>(`SELECT COALESCE(SUM(volume_slots), 0) AS count FROM quota_reservations`)?.count ?? 0;
      if (volumeTotal - oldVolumes + next.mounts.length > this.quota.hostRetainedVolumeSlots) throw new ServiceQuotaExceededError("volumes", "service update would exceed retained volume budget");
    }
  }

  private enqueue(workId: string, serviceId: string, operationId: string, action: "create" | "update" | "restart" | "enable" | "disable" | "remove" = "create"): void {
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
      const definition = parseDefinition(service);
      if (action === "remove") {
        if (this.runtime.stop !== undefined && service.observedState !== "stopped" && service.observedState !== "disabled") await this.runtime.stop(definition);
        if (this.runtime.remove !== undefined) await this.runtime.remove(definition);
        this.releaseServiceOccupation(workId, serviceId);
        this.releaseServiceBudget(workId, serviceId);
      } else if (action === "disable") {
        if (this.runtime.stop !== undefined && service.observedState !== "stopped" && service.observedState !== "disabled") await this.runtime.stop(definition);
        this.releaseServiceOccupation(workId, serviceId);
        this.store.updateServiceObservedState(workId, serviceId, "disabled", this.now().toISOString());
        this.releaseServiceBudget(workId, serviceId);
      } else if (!service.enabled) {
        this.store.updateServiceObservedState(workId, serviceId, "disabled", this.now().toISOString());
      } else if (work.desiredState !== "running") {
        this.store.updateServiceObservedState(workId, serviceId, "stopped", this.now().toISOString());
      } else {
        if (action === "restart" && this.runtime.stop !== undefined) await this.runtime.stop(definition);
        if (action === "update" && service.appliedRevision !== null && service.appliedRevision !== definition.revision) {
          const previous = this.store.listServiceRevisions(workId, serviceId).find((revision) => revision.revision === service.appliedRevision);
          if (this.runtime.stop !== undefined && previous !== undefined) await this.runtime.stop(JSON.parse(previous.definitionJson) as ServiceDefinition);
          this.releaseServiceOccupation(workId, serviceId);
        }
        await this.ensureServiceRunning(workId, service, definition);
      }
      const current = this.store.getService(workId, serviceId, action === "remove")!;
      this.store.updateOperation(operationId, "succeeded", this.now().toISOString(), {
        resultJson: JSON.stringify({ observedState: current.observedState, revision: current.desiredRevision }),
      });
    } catch (error) {
      const errorJson = JSON.stringify({ message: error instanceof Error ? error.message : String(error) });
      if (this.store.getService(workId, serviceId) !== undefined) {
        this.store.updateServiceObservedState(workId, serviceId, "failed", this.now().toISOString(), { lastErrorJson: errorJson });
      }
      this.store.updateOperation(operationId, "failed", this.now().toISOString(), { errorJson });
    }
  }

  private async ensureServiceRunning(workId: string, service: ServiceRecord, definition: ServiceDefinition): Promise<void> {
    const current = this.store.getService(workId, service.serviceId);
    if (current?.observedState === "ready" && current.appliedRevision === definition.revision) return;
    this.store.updateServiceObservedState(workId, service.serviceId, "starting", this.now().toISOString());
    await this.runtime.start(definition);
    if (this.runtime.waitReady !== undefined) {
      const ready = await this.runtime.waitReady(definition, 120_000);
      if (!ready) throw new Error(`service ${service.serviceId} readiness timeout`);
    }
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
    createdAt: record.createdAt,
  };
}

function parseDefinition(record: ServiceRecord): ServiceDefinition {
  return JSON.parse(record.definitionJson) as ServiceDefinition;
}

function asOwnedWork(work: { readonly id: string; readonly ownerUserId: string }) {
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
