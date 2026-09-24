import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreApplication } from "../application/core-application.js";
import { ensureCorePaths } from "../application/paths.js";
import { emptyOperationDiagnostics, operationEnvelope, safeDiagnostic } from "../work-management/diagnostics.js";
import { importProvenance, snapshotOperation } from "./access.js";

const NOW = "2026-09-23T00:00:00.000Z", WORK = "work-imported-00000001", OLD = "operation-source-00000001", ARCHIVED = "operation-archived-00000001";
test("snapshot and imported Operation HTTP reads are owner-only even before publication or after deletion, without scheduling archived kinds", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-snapshot-access-")), paths = ensureCorePaths(root);
  const app = await CoreApplication.create({ paths, initialization: { administrator: { account: "owner", password: "owner password is long" } } });
  try {
    const ownerLogin = await app.identity.login("owner", "owner password is long", "test"), owner = { userId: ownerLogin.user.id, role: "admin" as const };
    const other = await app.users.createUser(owner, { account: "other", password: "other password is long", role: "user" });
    const admin = await app.users.createUser(owner, { account: "other-admin", password: "admin password is long", role: "admin" });
    const otherLogin = await app.identity.login("other", "other password is long", "test"), adminLogin = await app.identity.login("other-admin", "admin password is long", "test");
    const store = app.store;
    const imported = store.acceptMutation({ principalId: owner.userId, workScope: "work-imports", operationKind: "import-work", idempotencyKey: "failed", requestDigest: "a".repeat(64), requestJson: "{}", targetVersion: 1, now: NOW }, (tx) => {
      store.snapshots.insertJob({ operationId: tx.operationId, ownerUserId: owner.userId, kind: "import", targetWorkId: WORK, sourceWorkId: null, snapshotId: null, packageId: null, name: "imported", requestDigest: "a".repeat(64), phase: "cleaned", deadlineAt: NOW, workerEpoch: 1, createdAt: NOW, updatedAt: NOW, cleanupError: null });
      return { resourceId: WORK };
    });
    store.updateOperation(imported.operationId, "failed", NOW, { resultJson: operationEnvelope({ correlationId: imported.operationId }), errorJson: JSON.stringify(safeDiagnostic("WORK_OPERATION_FAILED", "runtime-prepare")) });
    assert.equal(store.getWork(WORK), undefined); assert.equal(app.lifecycle.operation(owner, imported.operationId).workId, WORK);
    const address = await app.listen({ host: "127.0.0.1", port: 0 }), base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, authorization: string) => fetch(`${base}/api/v1/${path}`, { headers: { authorization } });
    for (const [authorization, status] of [[`Bearer ${ownerLogin.token}`, 200], [`Bearer ${otherLogin.token}`, 404], [`Bearer ${adminLogin.token}`, 403],
      [`Operator ${readFileSync(paths.operatorCredentialPath, "utf8").trim()}`, 401], ["Bearer agent-runtime-credential", 401]] as const)
      assert.equal((await request(`operations/${imported.operationId}`, authorization)).status, status);
    const fixture = store.acceptMutation({ principalId: owner.userId, workScope: "new-work", operationKind: "fixture", idempotencyKey: "published", requestDigest: "b".repeat(64), requestJson: "{}", targetVersion: 1, now: NOW }, (tx) => {
      tx.run("INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at,deleted_at) VALUES (?,?,'deleted source','deleted','deleted',1,1,?,?,?)", WORK, owner.userId, NOW, NOW, NOW);
      store.snapshots.insertProvenance({ workId: WORK, packageDigest: "c".repeat(64), importOperationId: imported.operationId, identityMapJson: JSON.stringify({ sourceIdentityMap: { version: 1, sourceWorkId: "work-original-00000001", contexts: [], services: [], operations: [{ key: "o-1", sourceId: OLD }] }, targets: { workId: WORK, contexts: [], services: [], operations: [{ key: "o-1", id: ARCHIVED }] }, archivedIdempotency: [] }) });
      store.snapshots.insertHistory({ workId: WORK, operationId: ARCHIVED, sourceOperationId: OLD, recordJson: JSON.stringify({ id: OLD, workId: "work-original-00000001", serviceId: null, kind: "future-execute-dangerous-action", state: "failed", targetVersion: 1, createdAt: NOW, updatedAt: NOW,
        requestJson: "OPAQUE_REQUEST_SENTINEL", resultJson: '{"result":{"arbitrary":"RESULT_SENTINEL"},"diagnostics":{"secret":"DIAGNOSTIC_SENTINEL"}}', errorJson: "ERROR_SENTINEL" }) });
      return { resourceId: WORK };
    });
    store.updateOperation(fixture.operationId, "succeeded", NOW);
    const before = store.listOperations();
    const projection = snapshotOperation(store, owner, ARCHIVED)!;
    assert.equal(projection.operationId, ARCHIVED); assert.equal(projection.correlationId, ARCHIVED); assert.equal(projection.workId, WORK);
    assert.equal(projection.result, null); assert.equal(projection.error, null); assert.deepEqual(projection.diagnostics, emptyOperationDiagnostics());
    assert.equal(JSON.stringify(projection).includes("SENTINEL"), false);
    assert.ok(store.snapshots.getHistory(ARCHIVED)!.recordJson.includes("OPAQUE_REQUEST_SENTINEL"));
    assert.equal(store.getOperation(ARCHIVED), undefined); assert.deepEqual(store.listOperations(), before);
    assert.deepEqual(importProvenance(store, owner, WORK), { sourcePackageDigest: "c".repeat(64), importOperationId: imported.operationId, operationMap: [{ sourceOperationId: OLD, operationId: ARCHIVED }] });
    const known = `${ARCHIVED}-known`, error = { ...safeDiagnostic("SERVICE_EXITED", "service-readiness"), message: "UNTRUSTED_MESSAGE_SENTINEL", remediation: "UNTRUSTED_REMEDIATION_SENTINEL", serviceId: "source-service-00000001", field: "UNTRUSTED_FIELD_SENTINEL", correlationId: OLD };
    store.snapshots.insertHistory({ workId: WORK, operationId: known, sourceOperationId: `${OLD}-known`, recordJson: JSON.stringify({ id: `${OLD}-known`, workId: "work-original-00000001", serviceId: null, kind: "known-or-future-label", state: "succeeded", targetVersion: 1, createdAt: NOW, updatedAt: NOW,
      requestJson: "unparsed", resultJson: operationEnvelope({ correlationId: OLD, result: { observedState: "stopped" }, diagnostics: { ...emptyOperationDiagnostics(), stages: [{ timestamp: NOW, component: "core", stage: "service-readiness", outcome: "failed", code: "SERVICE_EXITED", message: "UNTRUSTED_STAGE_SENTINEL" }] } }), errorJson: JSON.stringify(error) }) });
    const safe = snapshotOperation(store, owner, known)!;
    assert.deepEqual(safe.result, { observedState: "stopped" }); assert.equal(safe.error?.code, "SERVICE_EXITED");
    assert.equal(safe.error?.correlationId, known); assert.equal(safe.error?.serviceId, undefined);
    assert.equal(JSON.stringify(safe).includes("SENTINEL"), false); assert.equal(safe.diagnostics.stages.length, 1);
    for (const path of [`operations/${ARCHIVED}`, `works/${WORK}/import-provenance`]) {
      assert.equal((await request(path, `Bearer ${ownerLogin.token}`)).status, 200);
      assert.equal((await request(path, `Bearer ${otherLogin.token}`)).status, 404);
      assert.equal((await request(path, `Bearer ${adminLogin.token}`)).status, 403);
    }
    assert.throws(() => snapshotOperation(store, { userId: other.id, role: "user" }, ARCHIVED), /not found/);
    assert.throws(() => snapshotOperation(store, { userId: admin.id, role: "admin" }, ARCHIVED), /owner/);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
