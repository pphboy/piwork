import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  ApiErrorSchema,
  OperationSchema,
  ServiceDefinitionSchema,
  UserSchema,
  WorkConfigSchema,
  WorkConfigurationViewSchema,
  WorkConfigurationPatchSchema,
  SetWorkSkillsRequestSchema,
  PublicSkillSchema,
  OperatorSkillSchema,
  SkillPathRequestSchema,
  type WorkConfig,
  normalizeAgentsMd,
  resolveBuiltInWorkTools,
  AGENTS_MD_MAX_BYTES,
} from "./index.js";

const validWorkConfig: WorkConfig = {
  agentImage: { catalogId: "image-0199e6d8abcd" },
  skills: ["code-review", "release-notes"],
  agentsMd: "",
  modelRef: "model-0199e6d8abcd",
  mcpServers: [
    {
      serverId: "notes",
      transport: "stdio",
      required: true,
      command: "node",
      args: ["server.js"],
      timeoutMs: 30_000,
    },
  ],
  resources: {
    cpuMillis: 1_000,
    memoryBytes: 1_073_741_824,
    maxServices: 8,
    maxRetainedVolumes: 16,
  },
  tools: { allowed: ["read", "notes.search"], denied: ["bash"] },
};

test("control and internal contract samples validate", () => {
  assert.equal(Check(WorkConfigSchema, validWorkConfig), true);
  assert.equal(Check(UserSchema, {
    id: "user-0199e6d8abcd",
    account: "alice",
    role: "user",
    enabled: true,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  }), true);
  assert.equal(Check(ServiceDefinitionSchema, {
    serviceId: "service-0199e6d8abcd",
    name: "notes",
    revision: 1,
    image: { catalogId: "image-0199e6d8abcd" },
    args: [],
    environment: {},
    secretRefs: [],
    mounts: [],
    ports: [{ name: "http", containerPort: 8080, protocol: "tcp", alias: "notes" }],
    cpuMillis: 250,
    memoryBytes: 268_435_456,
    enabled: true,
    required: false,
    restartPolicy: "bounded",
  }), true);
  assert.equal(Check(OperationSchema, {
    id: "operation-0199e6d8abcd",
    workId: "work-0199e6d8abcd",
    kind: "start-work",
    state: "pending",
    targetVersion: 1,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  }), true);
  assert.equal(Check(ApiErrorSchema, {
    code: "UNSUPPORTED_LIMIT",
    message: "storage_bytes is not enforced by this runtime",
    retryable: false,
    field: "resources.storageBytes",
  }), true);
});

test("unknown fields and invalid enum values are rejected", () => {
  assert.equal(Check(WorkConfigSchema, { ...validWorkConfig, ownerId: "user-leak" }), false);
  assert.equal(Check(UserSchema, {
    id: "user-0199e6d8abcd",
    account: "alice",
    role: "superuser",
    enabled: true,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  }), false);
});

test("Work configuration contracts are revision-free and reject malformed selections", () => {
  assert.equal(Check(WorkConfigurationViewSchema, {
    workId: "work-0199e6d8abcd",
    active: validWorkConfig,
    desired: validWorkConfig,
    pendingApply: false,
  }), true);
  assert.equal(Check(WorkConfigSchema, { ...validWorkConfig, revision: 1 }), false);
  assert.equal(Check(WorkConfigurationViewSchema, {
    workId: "work-0199e6d8abcd",
    active: validWorkConfig,
    desired: validWorkConfig,
    pendingApply: false,
    desiredRevision: 4,
  }), false);
  assert.equal(Check(WorkConfigurationPatchSchema, {}), true);
  assert.equal(Check(WorkConfigurationPatchSchema, { skills: [] }), true);
  assert.equal(Check(SetWorkSkillsRequestSchema, { skills: [] }), true);
  assert.equal(Check(SetWorkSkillsRequestSchema, { skills: ["code-review", "code-review"] }), false);
  assert.equal(Check(SetWorkSkillsRequestSchema, { skills: ["Code_Review"] }), false);
  assert.equal(Check(SetWorkSkillsRequestSchema, { skills: ["code-review"], expectedRevision: 1 }), false);
});

test("Skill projections permit only approved public and operator fields", () => {
  const publicSkill = { name: "code-review" };
  const operatorSkill = {
    name: "code-review",
    enabled: true,
    fileCount: 3,
    totalBytes: 1_024,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  };
  assert.equal(Check(PublicSkillSchema, publicSkill), true);
  assert.equal(Check(OperatorSkillSchema, operatorSkill), true);
  for (const forbidden of ["description", "path", "storagePath", "content", "digest", "artifactId"]) {
    assert.equal(Check(PublicSkillSchema, { ...publicSkill, [forbidden]: "secret" }), false);
    assert.equal(Check(OperatorSkillSchema, { ...operatorSkill, [forbidden]: "secret" }), false);
  }
  assert.equal(Check(SkillPathRequestSchema, { path: "/tmp/code-review" }), true);
  assert.equal(Check(SkillPathRequestSchema, { path: "/tmp/code-review", name: "other" }), false);
});

test("unsupported hard storage limits are rejected instead of being stored", () => {
  const withUnsupportedLimit = {
    ...validWorkConfig,
    resources: { ...validWorkConfig.resources, storageBytes: 10_000_000 },
  };
  assert.equal(Check(WorkConfigSchema, withUnsupportedLimit), false);
});

test("Work context normalizes bounded AGENTS content and resolves open tools", () => {
  assert.equal(normalizeAgentsMd("hello"), "hello");
  assert.throws(() => normalizeAgentsMd("x".repeat(AGENTS_MD_MAX_BYTES + 1)), /exceeds/);
  assert.deepEqual(resolveBuiltInWorkTools({ allowed: [], denied: ["bash", "write"] }), ["read", "edit", "grep", "find", "ls"]);
});
