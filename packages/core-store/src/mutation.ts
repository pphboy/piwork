import { randomUUID } from "node:crypto";
import { type DatabaseSync, type SQLInputValue } from "node:sqlite";
import { SnapshotStoreError } from "./snapshot-errors.js";
import { assignServiceDomainLabel, assignWorkNetworkName } from "./network-identities.js";

export class IdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`idempotency key ${idempotencyKey} was already used with different content`);
    this.name = "IdempotencyConflictError";
  }
}

export class RevisionConflictError extends Error {
  constructor(
    readonly workId: string,
    readonly expected: number,
    readonly actual: number | undefined,
  ) {
    super(`work ${workId} revision conflict: expected ${expected}, actual ${actual ?? "missing"}`);
    this.name = "RevisionConflictError";
  }
}

export interface MutationRequest {
  readonly principalId: string;
  readonly workScope: string;
  readonly operationKind: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly requestJson: string;
  readonly targetVersion: number;
  readonly workId?: string;
  readonly serviceId?: string;
  readonly expectedWorkVersion?: number;
  readonly now?: string;
}

export interface MutationEffect {
  readonly resourceId: string;
  readonly resultJson?: string;
}

export interface AcceptedMutation {
  readonly operationId: string;
  readonly resourceId: string;
  readonly reused: boolean;
}

export interface MutationContext {
  readonly operationId: string;
  run(sql: string, ...parameters: SQLInputValue[]): void;
  get<T>(sql: string, ...parameters: SQLInputValue[]): T | undefined;
  tombstoneWork(workId: string, deletedAt: string): void;
  tombstoneService(workId: string, serviceId: string, deletedAt: string): void;
  assignWorkNetworkName(workId: string, now: string): string;
  assignServiceDomainLabel(workId: string, serviceId: string, name: string, now: string): string;
}

interface IdempotencyRow {
  readonly request_digest: string;
  readonly resource_id: string;
  readonly operation_id: string;
}

export function acceptMutation(
  database: DatabaseSync,
  request: MutationRequest,
  effect: (context: MutationContext) => MutationEffect,
): AcceptedMutation {
  database.exec("BEGIN IMMEDIATE");
  try {
    const prior = database.prepare(`SELECT request_digest, resource_id, operation_id
      FROM idempotency_records
      WHERE principal_id = ? AND work_scope = ? AND operation_kind = ? AND idempotency_key = ?`).get(
      request.principalId,
      request.workScope,
      request.operationKind,
      request.idempotencyKey,
    ) as unknown as IdempotencyRow | undefined;

    if (prior !== undefined) {
      if (prior.request_digest !== request.requestDigest) {
        throw new IdempotencyConflictError(request.idempotencyKey);
      }
      database.exec("COMMIT");
      return { operationId: prior.operation_id, resourceId: prior.resource_id, reused: true };
    }

    if (request.operationKind !== "export-work" && request.workId !== undefined && database.prepare("SELECT 1 FROM work_snapshot_locks WHERE work_id = ?").get(request.workId)) throw new SnapshotStoreError("WORK_SNAPSHOT_BUSY");
    verifyExpectedVersion(database, request);

    const now = request.now ?? new Date().toISOString();
    const operationId = `operation-${randomUUID()}`;
    database.prepare(`INSERT INTO operations(
      id, work_id, service_id, kind, state, target_version, request_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).run(
      operationId,
      request.workId ?? null,
      request.serviceId ?? null,
      request.operationKind,
      request.targetVersion,
      request.requestJson,
      now,
      now,
    );

    const mutation = effect(createMutationContext(database, operationId));
    database.prepare(`INSERT INTO idempotency_records(
      principal_id, work_scope, operation_kind, idempotency_key,
      request_digest, resource_id, operation_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      request.principalId,
      request.workScope,
      request.operationKind,
      request.idempotencyKey,
      request.requestDigest,
      mutation.resourceId,
      operationId,
      now,
    );
    if (mutation.resultJson !== undefined) {
      database.prepare("UPDATE operations SET result_json = ? WHERE id = ?").run(mutation.resultJson, operationId);
    }
    database.exec("COMMIT");
    return { operationId, resourceId: mutation.resourceId, reused: false };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function verifyExpectedVersion(database: DatabaseSync, request: MutationRequest): void {
  if (request.expectedWorkVersion === undefined) return;
  if (request.workId === undefined) throw new Error("expectedWorkVersion requires workId");
  const row = database.prepare("SELECT control_version AS version FROM works WHERE id = ?").get(request.workId) as
    | { version: number }
    | undefined;
  if (row?.version !== request.expectedWorkVersion) {
    throw new RevisionConflictError(request.workId, request.expectedWorkVersion, row?.version);
  }
}

export function createMutationContext(database: DatabaseSync, operationId: string): MutationContext {
  return {
    operationId,
    run(sql, ...parameters) {
      database.prepare(sql).run(...parameters);
    },
    get<T>(sql: string, ...parameters: SQLInputValue[]): T | undefined {
      return database.prepare(sql).get(...parameters) as T | undefined;
    },
    tombstoneWork(workId, deletedAt) {
      const result = database.prepare(`UPDATE works
        SET desired_state = 'deleted', deleted_at = ?, control_version = control_version + 1, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`).run(deletedAt, deletedAt, workId);
      if (result.changes !== 1) throw new Error(`work ${workId} cannot be tombstoned`);
    },
    tombstoneService(workId, serviceId, deletedAt) {
      const result = database.prepare(`UPDATE service_heads
        SET tombstoned_at = ?, observed_state = 'deleting'
        WHERE work_id = ? AND service_id = ? AND tombstoned_at IS NULL`).run(deletedAt, workId, serviceId);
      if (result.changes !== 1) throw new Error(`service ${serviceId} cannot be tombstoned`);
    },
    assignWorkNetworkName(workId, now) { return assignWorkNetworkName(database, workId, now); },
    assignServiceDomainLabel(workId, serviceId, name, now) { return assignServiceDomainLabel(database, workId, serviceId, name, now); },
  };
}
