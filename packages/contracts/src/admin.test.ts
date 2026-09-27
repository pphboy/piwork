import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  ADMIN_JSON_MAX_BYTES, AGENTS_MD_MAX_BYTES,
  AdminStatusSchema, AdminRuntimeViewSchema, AdminRuntimeInputSchema, AdminRuntimeResultSchema,
  AdminDefaultWorkViewSchema, AdminDefaultWorkPatchSchema, AdminUsersSchema, AdminSkillsSchema,
  AdminPackageDetailSchema, AdminPackageInstallRequestSchema, AdminPackageUpdateRequestSchema,
  AdminPackageOperationAcceptanceSchema, AdminPackageOperationSchema, AdminErrorSchema,
  AdminEmptyActionSchema, encodeAdminPathSegment, normalizeAgentsMd,
  validateAdminDefaultWorkPatch,
} from "./index.js";

const time = "2026-09-20T00:00:00Z";
const status = { adminApiVersion: 1, state: "READY", ready: true,
  checks: { administrator: true, runtimeConfigured: true, runtimeAvailable: true, filesystemMigrationReady: true } };
const runtime = { configured: true, agentImage: "piwork:latest",
  model: { provider: "openai", id: "gpt", credentialAvailable: true }, updatedAt: time };
const user = { id: "user-0199e6d8abcd", account: "alice", role: "admin", enabled: true, createdAt: time, updatedAt: time };
const skill = { name: "code-review", enabled: true, fileCount: 1, totalBytes: 20, createdAt: time, updatedAt: time };
const counts = { extensions: 1, skills: 0, prompts: 0, themes: 0 };
const catalog = { name: "@team/tools", version: null, sourceKind: "zip", enabled: true, isDefault: false, resourceCounts: counts };
const acceptance = { operationId: "operation-0199e6d8abcd", workId: null, correlationId: "correlation-0199e6d8abcd",
  reused: false, scope: "core", kind: "pi-package-install", name: null };

test("admin DTOs accept public shapes and reject private fields", () => {
  for (const [schema, good, bad] of [
    [AdminStatusSchema, status, { ...status, secret: "x" }],
    [AdminRuntimeViewSchema, runtime, { ...runtime, revision: 1 }],
    [AdminRuntimeInputSchema, { agentImage: "piwork:latest", provider: "openai", model: "gpt", credential: "secret" },
      { agentImage: "piwork:latest", provider: "openai", model: "gpt", credential: "secret", revision: 1 }],
    [AdminRuntimeResultSchema, { runtime, status }, { runtime: { ...runtime, credentialRef: "secret" }, status }],
    [AdminDefaultWorkViewSchema, { configuration: null, baseImage: null }, { configuration: null, baseImage: null, revision: 1 }],
    [AdminUsersSchema, { users: [user] }, { users: [{ ...user, passwordHash: "secret" }] }],
    [AdminSkillsSchema, { skills: [skill] }, { skills: [{ ...skill, path: "/private" }] }],
    [AdminPackageDetailSchema, { ...catalog, resolvedSource: "upload:fixture" }, { ...catalog, resolvedSource: "upload:fixture", path: "/private" }],
    [AdminPackageOperationAcceptanceSchema, acceptance, { ...acceptance, scope: "work" }],
    [AdminPackageOperationSchema, { operationId: acceptance.operationId, workId: null, kind: acceptance.kind,
      state: "running", packagePhase: "prepare", name: null, result: null, error: null, createdAt: time, updatedAt: time },
      { operationId: acceptance.operationId, workId: "work-0199e6d8abcd", kind: acceptance.kind,
        state: "running", packagePhase: "prepare", name: null, result: null, error: null, createdAt: time, updatedAt: time }],
    [AdminErrorSchema, { code: "INVALID_REQUEST", message: "invalid", correlationId: acceptance.correlationId, field: "agentsMd" },
      { code: "INVALID_REQUEST", message: "invalid", correlationId: acceptance.correlationId, stack: "private" }],
  ] as const) {
    assert.equal(Check(schema, good), true);
    assert.equal(Check(schema, bad), false);
  }
});

test("admin JSON input, patch and path boundaries", () => {
  assert.equal(ADMIN_JSON_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(Check(AdminDefaultWorkPatchSchema, {}), false);
  assert.equal(Check(AdminDefaultWorkPatchSchema, { agentsMd: "", skills: [], packages: [] }), true);
  assert.equal(Check(AdminDefaultWorkPatchSchema, { agentsMd: "x", revision: 1 }), false);
  assert.equal(Check(AdminDefaultWorkPatchSchema, { packages: ["tools", "tools"] }), false);
  assert.equal(Check(AdminDefaultWorkPatchSchema, { skills: ["code-review", "code-review"] }), false);
  assert.equal(Check(AdminEmptyActionSchema, {}), true);
  assert.equal(Check(AdminEmptyActionSchema, { enabled: true }), false);
  const boundary = "界".repeat(Math.floor(AGENTS_MD_MAX_BYTES / 3)) + "x";
  assert.equal(Buffer.byteLength(boundary), AGENTS_MD_MAX_BYTES);
  assert.equal(normalizeAgentsMd(boundary), boundary);
  assert.equal(Check(AdminDefaultWorkPatchSchema, { agentsMd: boundary }), true);
  assert.throws(() => normalizeAgentsMd(`${boundary}x`), RangeError);
  assert.throws(() => validateAdminDefaultWorkPatch({ agentsMd: `${boundary}x` }), RangeError);
  // Escaped JSON can be larger than the raw UTF-8 text but remains within 2 MiB.
  assert.ok(Buffer.byteLength(JSON.stringify({ agentsMd: "\\".repeat(AGENTS_MD_MAX_BYTES) })) < ADMIN_JSON_MAX_BYTES);
  assert.equal(encodeAdminPathSegment("@team/tools"), "%40team%2Ftools");
  assert.equal(Check(AdminPackageInstallRequestSchema, { source: { kind: "npm", spec: "tools" }, idempotencyKey: "k" }), true);
  assert.equal(Check(AdminPackageUpdateRequestSchema, { source: { kind: "upload", uploadId: "upload-0199e6d8abcd" }, idempotencyKey: "k" }), true);
  assert.equal(Check(AdminPackageInstallRequestSchema, { source: { kind: "core", name: "tools" }, idempotencyKey: "k" }), false);
  assert.equal(Check(AdminPackageInstallRequestSchema, { source: { kind: "git", spec: "https://example.com/repo" }, idempotencyKey: "" }), false);
});
