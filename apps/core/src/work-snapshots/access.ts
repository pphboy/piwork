import { Check } from "typebox/value";
import { ArchivedWorkOperationSchema, OperationDiagnosticsSchema, PublicOperationSchema, SafeDiagnosticSchema,
  type PublicOperation, type SafeDiagnostic, type WorkImportProvenance } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { authorizeWorkResource, InvisibleResourceError, type UserPrincipal } from "../work-access/policy.js";
import { appendStage, emptyOperationDiagnostics, publicOperation, safeDiagnostic } from "../work-management/diagnostics.js";
import type { WorkProvenanceArchive } from "./metadata.js";

export function authorizeSnapshotOwner(principal: UserPrincipal, ownerUserId: string | undefined, id: string): void {
  // A real enabled account is checked at admission; this also rejects accidental
  // use of a runtime/operator principal at an internal call site.
  if (!principal || (principal.role !== "user" && principal.role !== "admin") || principal.userId === "operator") throw new InvisibleResourceError();
  authorizeWorkResource(principal, ownerUserId === undefined ? undefined : { id, kind: "operation", workId: id, ownerUserId }, "read-content");
}
function parsed(text: string | null): unknown { try { return JSON.parse(text ?? "null"); } catch { return null; } }

/** No dispatch by historical kind, no writes, and no unvalidated payload projection. */
export function snapshotOperation(store: CoreStore, principal: UserPrincipal, operationId: string): PublicOperation | undefined {
  const job = store.snapshots.getJob(operationId);
  if (job) {
    authorizeSnapshotOwner(principal, job.ownerUserId, operationId);
    const operation = store.getOperation(operationId);
    if (!operation) throw new InvisibleResourceError();
    return publicOperation({ ...operation, workId: job.targetWorkId ?? job.sourceWorkId });
  }
  const history = store.snapshots.getHistory(operationId);
  if (!history) return undefined;
  const work = store.getWork(history.workId, true);
  authorizeSnapshotOwner(principal, work?.ownerUserId, operationId);
  const record = parsed(history.recordJson);
  if (!Check(ArchivedWorkOperationSchema, record)) throw new InvisibleResourceError();
  const provenance = store.snapshots.getProvenance(history.workId);
  const identities = parsed(provenance?.identityMapJson ?? null) as WorkProvenanceArchive | null;
  const services = new Map((identities?.sourceIdentityMap.services ?? []).flatMap((source) => {
    const target = identities?.targets.services.find((item) => item.key === source.key);
    return target ? [[source.sourceId, target.id] as const] : [];
  }));
  const diagnostic = (value: unknown): SafeDiagnostic | null => {
    if (!Check(SafeDiagnosticSchema, value)) return null;
    const serviceId = value.serviceId === undefined ? undefined : services.get(value.serviceId);
    return safeDiagnostic(value.code, value.stage, { correlationId: operationId,
      ...(value.skillName === undefined ? {} : { skillName: value.skillName }),
      ...(serviceId === undefined ? {} : { serviceId }),
      ...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }) });
  };
  const envelope = parsed(record.resultJson) as { result?: unknown; diagnostics?: unknown } | null;
  let diagnostics = emptyOperationDiagnostics();
  if (Check(OperationDiagnosticsSchema, envelope?.diagnostics)) {
    const source = envelope.diagnostics;
    for (const stage of source.stages) {
      const serviceId = stage.serviceId === undefined ? undefined : services.get(stage.serviceId);
      diagnostics = appendStage(diagnostics, stage.stage, stage.outcome, safeDiagnostic(stage.code, stage.stage, {
        ...(stage.skillName === undefined ? {} : { skillName: stage.skillName }), ...(serviceId === undefined ? {} : { serviceId }),
      }), stage.timestamp, stage.component);
    }
    const rollbackError = diagnostic(source.rollback.error);
    diagnostics = { ...diagnostics, truncated: source.truncated || diagnostics.truncated, diagnosticCollection: source.diagnosticCollection,
      rollback: { state: source.rollback.state, ...(rollbackError === null ? {} : { error: rollbackError }) } };
  }
  // Historical configuration documents may contain source platform references.
  // Keep their exact text in the archive, not in a current-installation DTO.
  let result: PublicOperation["result"] = null;
  if (Check(PublicOperationSchema.properties.result, envelope?.result) && envelope?.result !== null) {
    const source = envelope.result as Exclude<PublicOperation["result"], null>;
    if (source.observedState !== undefined && ["pending", "provisioning", "starting", "running", "stopping", "stopped", "failed", "deleting", "deleted"].includes(source.observedState)) result = { observedState: source.observedState };
  }
  return { operationId, workId: history.workId, kind: record.kind, state: record.state, createdAt: record.createdAt, updatedAt: record.updatedAt,
    correlationId: operationId, result, error: diagnostic(parsed(record.errorJson)), diagnostics };
}

export function importProvenance(store: CoreStore, principal: UserPrincipal, workId: string): WorkImportProvenance {
  const work = store.getWork(workId, true);
  authorizeSnapshotOwner(principal, work?.ownerUserId, workId);
  const provenance = store.snapshots.getProvenance(workId);
  if (!provenance) throw new InvisibleResourceError();
  return { sourcePackageDigest: provenance.packageDigest, importOperationId: provenance.importOperationId,
    operationMap: store.snapshots.listHistory(workId).map((record) => ({ sourceOperationId: record.sourceOperationId, operationId: record.operationId })) };
}
