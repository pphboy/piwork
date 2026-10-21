import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  LOG_EXPORT_LIMITS, LogExportAcceptedSchema, LogExportCreateInputSchema, LogExportProgressSchema,
  LogExportResultSchema, LogExportScopeSchema, LogExportViewSchema, LogExportWarningSchema,
} from "./log-export.js";

const digest = "a".repeat(64);
const scope = { includeCoreLogs: true, ownedWorkCount: 2, sourceCount: 3 };
const view = {
  exportId: "log-export-0000000001",
  correlationId: "correlation-1",
  cutoffTime: "2026-10-21T00:00:00Z",
  state: "ready",
  scope,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:01:00Z",
  progress: { processedSources: 3, totalSources: 3, collectedBytes: 1024 },
  complete: true,
  warningCount: 0,
  warnings: [],
  warningsTruncated: false,
  result: { filename: "piwork-logs.zip", size: 512, digest, readyAt: "2026-10-21T00:01:00Z", expiresAt: "2026-10-22T00:01:00Z" },
  error: null,
  cleanupPending: false,
};

test("create input accepts only one bounded idempotency key", () => {
  assert.equal(Check(LogExportCreateInputSchema, { idempotencyKey: "client-key" }), true);
  for (const invalid of [{}, { idempotencyKey: "" }, { idempotencyKey: "k".repeat(LOG_EXPORT_LIMITS.idempotencyKeyChars + 1) },
    { idempotencyKey: "key", ownerUserId: "user-1" }, { idempotencyKey: 1 }]) {
    assert.equal(Check(LogExportCreateInputSchema, invalid), false, JSON.stringify(invalid));
  }
});

test("scope is always inclusive of Core logs and bounded by the source budget", () => {
  assert.equal(Check(LogExportScopeSchema, scope), true);
  assert.equal(Check(LogExportScopeSchema, { ...scope, includeCoreLogs: false }), false);
  assert.equal(Check(LogExportScopeSchema, { ...scope, sourceCount: LOG_EXPORT_LIMITS.sources + 1 }), false);
  assert.equal(Check(LogExportScopeSchema, { ...scope, ownerUserId: "user-2" }), false);
});

test("ready view exposes a safe digest, bounded warnings and no internal identity", () => {
  assert.equal(Check(LogExportViewSchema, view), true);
  assert.equal(Check(LogExportViewSchema, { ...view, containerId: "abc" }), false);
  assert.equal(Check(LogExportViewSchema, { ...view, result: { ...view.result, digest: "sha256:secret" } }), false);
  assert.equal(Check(LogExportViewSchema, { ...view, warnings: Array.from({ length: LOG_EXPORT_LIMITS.warnings }, () => ({ code: "SOURCE_UNAVAILABLE", message: "missing" })) }), true);
  assert.equal(Check(LogExportViewSchema, { ...view, warnings: Array.from({ length: LOG_EXPORT_LIMITS.warnings + 1 }, () => ({ code: "SOURCE_UNAVAILABLE", message: "missing" })) }), false);
  assert.equal(Check(LogExportViewSchema, { ...view, result: null }), true);
  assert.equal(Check(LogExportViewSchema, { ...view, error: { code: "LOG_EXPORT_TIMEOUT", message: "timed out", correlationId: "c-1" } }), true);
  assert.equal(Check(LogExportViewSchema, { ...view, error: { code: "bad code", message: "x", correlationId: "c-1" } }), false);
});

test("accepted and progress values stay bounded", () => {
  assert.equal(Check(LogExportAcceptedSchema, { exportId: "log-export-0000000001", correlationId: "c-1", cutoffTime: "2026-10-21T00:00:00Z", state: "collecting", scope, reused: false }), true);
  assert.equal(Check(LogExportAcceptedSchema, { exportId: "short", correlationId: "c-1", cutoffTime: "2026-10-21T00:00:00Z", state: "collecting", scope, reused: false }), false);
  assert.equal(Check(LogExportProgressSchema, { processedSources: 1, totalSources: 2, collectedBytes: 0 }), true);
  assert.equal(Check(LogExportProgressSchema, { processedSources: -1, totalSources: 2, collectedBytes: 0 }), false);
  assert.equal(Check(LogExportResultSchema, view.result), true);
  assert.equal(Check(LogExportWarningSchema, { code: "SOURCE_UNAVAILABLE", message: "x".repeat(2049) }), false);
});
