import { createHash, randomUUID } from "node:crypto";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore, type OperationRecord, type WorkRecord } from "@piwork/core-store";
import { authorizeWorkResource, filterVisibleResources, type UserPrincipal } from "../work-access/policy.js";

export interface WorkRuntimeState {
  readonly exists: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly instanceId?: string;
  readonly generation?: number;
}

export interface WorkRuntimeAdapter {
  prepare(work: WorkRecord): Promise<void>;
  start(work: WorkRecord, generation: number): Promise<{ readonly instanceId: string; readonly generation: number }>;
  inspect(workId: string): Promise<WorkRuntimeState>;
  drain(workId: string, timeoutMs: number): Promise<void>;
  stop(workId: string, timeoutMs: number): Promise<void>;
  remove(workId: string): Promise<void>;
  listManagedInstances?(): Promise<readonly { readonly workId: string; readonly instanceId: string }[]>;
}

export interface WorkRecoveryReport {
  readonly adoptedWorkIds: readonly string[];
  readonly orphanedInstances: readonly { readonly workId: string; readonly instanceId: string }[];
}

export interface WorkServiceCoordinator {
  prepareEnabledServices(work: WorkRecord): Promise<void>;
  stopServices(workId: string, timeoutMs: number): Promise<void>;
  removeServiceInstances(workId: string): Promise<void>;
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
  ) {}

  create(
    principal: UserPrincipal,
    input: { readonly name: string; readonly configuration: WorkConfig; readonly idempotencyKey: string },
  ): AcceptedWorkOperation {
    this.assertAccepting();
    const workId = `work-${randomUUID()}`;
    const requestJson = stableJson({ name: input.name, configuration: input.configuration });
    const accepted = this.store.acceptMutation({
      principalId: principal.userId,
      workScope: "new-work",
      operationKind: "create-work",
      idempotencyKey: input.idempotencyKey,
      requestDigest: digest(requestJson),
      requestJson,
      targetVersion: 1,
      now: this.now().toISOString(),
    }, (tx) => {
      const now = this.now().toISOString();
      tx.run(`INSERT INTO works(
        id, owner_user_id, name, desired_state, observed_state,
        desired_revision, active_revision, control_version, created_at, updated_at
      ) VALUES (?, ?, ?, 'running', 'provisioning', 1, NULL, 1, ?, ?)`, workId, principal.userId, input.name, now, now);
      tx.run(`INSERT INTO work_config_revisions(
        work_id, revision, config_json, created_by_user_id, created_at
      ) VALUES (?, 1, ?, ?, ?)`, workId, JSON.stringify(input.configuration), principal.userId, now);
      return { resourceId: workId };
    });
    this.store.attachOperationToWork(accepted.operationId, accepted.resourceId);
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

  operation(principal: UserPrincipal, operationId: string): OperationRecord {
    const operation = this.store.getOperation(operationId);
    if (operation === undefined || operation.workId === null) throw invisible();
    const work = this.store.getWork(operation.workId, true);
    authorizeWorkResource(principal, work === undefined ? undefined : { ...asOwnedWork(work), kind: "operation", id: operation.id }, "read-metadata");
    return operation;
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

  async recover(): Promise<WorkRecoveryReport> {
    const knownWorks = new Set(this.store.listWorks(true).map((work) => work.id));
    const managed = await this.runtime.listManagedInstances?.() ?? [];
    const orphanedInstances = managed.filter((instance) => !knownWorks.has(instance.workId));
    const adoptedWorkIds = managed.filter((instance) => knownWorks.has(instance.workId)).map((instance) => instance.workId);
    for (const operation of this.store.listOperations(["pending", "running"])) {
      if (operation.workId !== null) this.enqueue(operation.workId);
    }
    for (const work of this.store.listWorks(true)) this.enqueue(work.id);
    await this.waitForIdle();
    return { adoptedWorkIds: [...new Set(adoptedWorkIds)], orphanedInstances };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.waitForIdle();
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
    const requestJson = stableJson({ desiredState, retry: forceVersion });
    const targetVersion = work!.controlVersion + 1;
    const accepted = this.store.acceptMutation({
      principalId: principal.userId,
      workScope: workId,
      operationKind: kind,
      idempotencyKey,
      requestDigest: digest(requestJson),
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
    const work = this.store.getWork(workId, true);
    if (work === undefined) return;
    const operations = this.store.listOperations(["pending", "running"])
      .filter((operation) => operation.workId === workId)
      .sort((left, right) => left.targetVersion - right.targetVersion);
    const current = operations.at(-1);
    if (current === undefined) return;
    for (const stale of operations.slice(0, -1)) {
      this.store.updateOperation(stale.id, "superseded", this.now().toISOString());
    }
    this.store.updateOperation(current.id, "running", this.now().toISOString());
    try {
      const latest = this.store.getWork(workId, true)!;
      if (latest.desiredState === "running") await this.ensureRunning(latest);
      else if (latest.desiredState === "stopped") await this.ensureStopped(latest);
      else await this.ensureDeleted(latest);
      const after = this.store.getWork(workId, true)!;
      if (after.controlVersion === current.targetVersion || current.kind === "create-work") {
        this.store.updateOperation(current.id, "succeeded", this.now().toISOString(), {
          resultJson: JSON.stringify({ observedState: after.observedState }),
        });
      } else {
        this.store.updateOperation(current.id, "superseded", this.now().toISOString());
        this.enqueue(workId);
      }
    } catch (error) {
      this.store.updateWorkObservedState(workId, "failed", this.now().toISOString());
      this.store.updateOperation(current.id, "failed", this.now().toISOString(), {
        errorJson: JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
      });
    }
  }

  private async ensureRunning(work: WorkRecord): Promise<void> {
    this.store.updateWorkObservedState(work.id, "starting", this.now().toISOString());
    const actual = await this.runtime.inspect(work.id);
    if (!actual.exists) {
      await this.runtime.prepare(work);
      await this.services.prepareEnabledServices(work);
      this.store.ensureRuntimeGeneration(work.id, work.controlVersion, this.now().toISOString());
      const started = await this.runtime.start(work, work.controlVersion);
      this.store.updateRuntimeGeneration(work.id, work.controlVersion, "starting", this.now().toISOString(), {
        instanceId: started.instanceId,
      });
    } else if (!actual.running) {
      const started = await this.runtime.start(work, work.controlVersion);
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
    const ready = await this.runtime.inspect(work.id);
    if (!ready.exists || !ready.running || !ready.ready) throw new Error("daemon did not become ready");
    const readyGeneration = ready.generation ?? work.controlVersion;
    this.store.updateRuntimeGeneration(work.id, readyGeneration, "ready", this.now().toISOString(), {
      instanceId: ready.instanceId,
      readySince: this.now().toISOString(),
    });
    this.store.updateWorkObservedState(work.id, "ready", this.now().toISOString(), work.desiredRevision);
  }

  private async ensureStopped(work: WorkRecord): Promise<void> {
    this.store.updateWorkObservedState(work.id, "stopping", this.now().toISOString());
    const actual = await this.runtime.inspect(work.id);
    if (actual.exists && actual.running) {
      if (actual.generation !== undefined && this.store.getRuntimeGeneration(work.id, actual.generation) !== undefined) {
        this.store.updateRuntimeGeneration(work.id, actual.generation, "draining", this.now().toISOString());
      }
      await this.runtime.drain(work.id, this.drainTimeoutMs);
      await this.services.stopServices(work.id, this.stopTimeoutMs);
      await this.runtime.stop(work.id, this.stopTimeoutMs);
    }
    const stopped = await this.runtime.inspect(work.id);
    if (stopped.exists && stopped.running) throw new Error("runtime could not confirm shutdown");
    if (actual.generation !== undefined && this.store.getRuntimeGeneration(work.id, actual.generation) !== undefined) {
      this.store.updateRuntimeGeneration(work.id, actual.generation, "stopped", this.now().toISOString());
    }
    this.store.updateWorkObservedState(work.id, "stopped", this.now().toISOString());
  }

  private async ensureDeleted(work: WorkRecord): Promise<void> {
    await this.ensureStopped(work);
    await this.services.removeServiceInstances(work.id);
    await this.runtime.remove(work.id);
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
