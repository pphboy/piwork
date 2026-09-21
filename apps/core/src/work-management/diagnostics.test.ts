import assert from "node:assert/strict";
import test from "node:test";
import type { OperationRecord } from "@piwork/core-store";
import { diagnosticFromError, emitDiagnostic, operationWithStage, publicOperation, safeDiagnostic } from "./diagnostics.js";

test("diagnostic conversion and JSON logging never forward hostile error text", () => {
  const hostile = new Error("token=abc /host/private SKILL.md injected");
  const diagnostic = diagnosticFromError(hostile, "skill-load", { skillName: "code-review" });
  assert.equal(diagnostic.code, "WORK_OPERATION_FAILED");
  assert.doesNotMatch(diagnostic.message, /abc|host|SKILL/);

  const forged = diagnosticFromError({
    code: "SKILL_LOAD_FAILED",
    message: '{"code":"RUNTIME_START_FAILED","message":"token=abc /host/private"}',
  }, "skill-load", { skillName: "code-review" });
  assert.equal(forged.code, "SKILL_LOAD_FAILED");
  assert.equal(forged.stage, "skill-load");
  assert.equal(forged.skillName, "code-review");
  assert.equal(forged.message, "The selected Skill could not be loaded.");

  const lines: string[] = [];
  emitDiagnostic({
    timestamp: "2026-09-21T00:00:00Z", level: "error", component: "core", stage: "skill-load",
    outcome: "failed", correlationId: "operation-1", code: "SKILL_LOAD_FAILED",
    message: "token=abc /host/private", skillName: "code-review",
  }, { write: (line) => lines.push(line) });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0]!, /abc|host\/private/);
  assert.match(lines[0]!, /The selected Skill could not be loaded/);

  emitDiagnostic({
    timestamp: "2026-09-21T00:00:00Z", level: "error", component: "core", stage: "skill-load",
    outcome: "failed", correlationId: "operation-1", code: "SKILL_LOAD_FAILED",
    message: "ignored", skillName: "# forged SKILL.md token=abc",
  }, { write: (line) => lines.push(line) });
  assert.doesNotMatch(lines[1]!, /forged|SKILL\.md|token=abc/);
});

test("Operation stage envelopes are bounded, retain terminal diagnostics, and project only safe fields", () => {
  const record: OperationRecord = {
    id: "operation-1", workId: "work-1", serviceId: null, kind: "apply-work-configuration",
    state: "running", targetVersion: 1, requestJson: '{"secret":"token=abc"}', resultJson: null,
    errorJson: '{"code":"SKILL_LOAD_FAILED","stage":"skill-load","message":"forged token=abc /host/private"}',
    createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z",
  };
  let next = record;
  for (let index = 0; index < 65; index += 1) {
    const staged = operationWithStage({
      record: next, stage: "skill-load", outcome: "failed",
      diagnostic: safeDiagnostic("SKILL_LOAD_FAILED", "skill-load", { skillName: "code-review" }),
      timestamp: `2026-09-21T00:00:${String(index).padStart(2, "0")}Z`,
    });
    next = { ...next, resultJson: staged.resultJson };
  }
  const projected = publicOperation(next);
  assert.equal(projected.diagnostics.stages.length, 64);
  assert.equal(projected.diagnostics.truncated, true);
  assert.equal(projected.error?.message, "The selected Skill could not be loaded.");
  assert.doesNotMatch(JSON.stringify(projected), /token=abc|host\/private/);

  const oversized = operationWithStage({
    record: next, stage: "skill-load", outcome: "failed",
    diagnostic: { ...safeDiagnostic("SKILL_LOAD_FAILED", "skill-load"), message: "x".repeat(70 * 1024) },
    timestamp: "2026-09-21T01:00:00Z",
  });
  assert.ok(Buffer.byteLength(JSON.stringify(oversized.diagnostics), "utf8") <= 64 * 1024);
  assert.equal(oversized.diagnostics.truncated, true);

  const rollbackError = safeDiagnostic("ROLLBACK_FAILED", "rollback");
  const withSecondaryOutcomes = operationWithStage({
    record: next, stage: "rollback", outcome: "failed", diagnostic: rollbackError,
    timestamp: "2026-09-21T01:00:01Z",
    rollback: { state: "failed", error: rollbackError },
    diagnosticCollection: { state: "unavailable", code: "DIAGNOSTIC_COLLECTION_FAILED" },
  });
  const afterAnotherStage = operationWithStage({
    record: { ...next, resultJson: withSecondaryOutcomes.resultJson },
    stage: "readiness", outcome: "interrupted",
    diagnostic: safeDiagnostic("WORK_OPERATION_FAILED", "readiness"),
    timestamp: "2026-09-21T01:00:02Z",
  });
  assert.equal(afterAnotherStage.diagnostics.rollback.state, "failed");
  assert.equal(afterAnotherStage.diagnostics.rollback.error?.code, "ROLLBACK_FAILED");
  assert.deepEqual(afterAnotherStage.diagnostics.diagnosticCollection, {
    state: "unavailable", code: "DIAGNOSTIC_COLLECTION_FAILED",
  });
});
