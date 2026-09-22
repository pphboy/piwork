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
  RuntimeSkillStateSchema,
  PublicOperationSchema,
  PublicSkillSchema,
  OperatorSkillSchema,
  SkillPathRequestSchema,
  type WorkConfig,
  normalizeAgentsMd,
  resolveBuiltInWorkTools,
  AGENTS_MD_MAX_BYTES,
  normalizeServiceDefinitionInput,
  ServiceDefinitionValidationError,
  validateResourcePolicy,
  WorkServiceAcceptanceCodec,
  WorkServiceCreateRequestCodec,
  WorkServicesService,
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
    agentCpuMillis: 500,
    agentMemoryBytes: 536_870_912,
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
    image: { reference: "python:3.13-slim" },
    command: "python3",
    args: [],
    environment: {},
    secretRefs: [],
    workingDirectory: "/",
    mounts: [],
    ports: [{ name: "http", containerPort: 8080, protocol: "tcp" }],
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
    runtime: { state: "unavailable", checkedAt: null, skills: [] },
  }), true);
  assert.equal(Check(WorkConfigSchema, { ...validWorkConfig, revision: 1 }), false);
  assert.equal(Check(WorkConfigurationViewSchema, {
    workId: "work-0199e6d8abcd",
    active: validWorkConfig,
    desired: validWorkConfig,
    pendingApply: false,
    runtime: { state: "unavailable", checkedAt: null, skills: [] },
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

test("runtime and operation projections are bounded and reject internal fields", () => {
  const runtime = { state: "ready", checkedAt: "2026-09-20T00:00:00Z", skills: [{
    name: "code-review", loaded: true, modelVisible: true, visibilityReason: null,
  }] };
  assert.equal(Check(RuntimeSkillStateSchema, runtime), true);
  assert.equal(Check(RuntimeSkillStateSchema, { ...runtime, contextIdentity: "secret" }), false);
  const operation = {
    operationId: "operation-0199e6d8abcd", workId: "work-0199e6d8abcd", kind: "create-work", state: "failed",
    createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:01Z", correlationId: "operation-0199e6d8abce",
    result: null,
    error: { code: "SKILL_LOAD_FAILED", stage: "skill-load", message: "The selected Skill could not be loaded.", retryable: false, remediation: "Correct the Skill and retry." },
    diagnostics: { stages: [], truncated: false, rollback: { state: "not-required" }, diagnosticCollection: { state: "unrecognized" } },
  };
  assert.equal(Check(PublicOperationSchema, operation), true);
  for (const forbidden of ["requestJson", "targetVersion", "contextIdentity", "imageIdentity", "digest", "hostPath", "storagePath"]) {
    assert.equal(Check(PublicOperationSchema, { ...operation, [forbidden]: "token=/tmp/private" }), false);
  }
  assert.equal(Check(PublicOperationSchema, {
    ...operation,
    error: { ...operation.error, message: "x", unknown: "injected" },
  }), false);
  assert.equal(Check(PublicOperationSchema, {
    ...operation,
    diagnostics: { ...operation.diagnostics, stages: [{
      timestamp: "2026-09-20T00:00:00Z", component: "core", stage: "skill-load", outcome: "failed",
      code: "SKILL_LOAD_FAILED", message: "The selected Skill could not be loaded.", path: "/private",
    }] },
  }), false);
});

test("service deployment input has exact fields, explicit storage, normalized defaults, and bounded probes", () => {
  const minimal = {
    name: "notes",
    image: { reference: "python:3.13-slim" },
    command: "python3",
    mounts: [{ source: "workspace" as const, target: "/var/data/workspace" as const, readOnly: false }],
  };
  const normalized = normalizeServiceDefinitionInput(minimal);
  assert.deepEqual(normalized, {
    ...minimal,
    args: [], environment: {}, secretRefs: [], workingDirectory: "/var/data/workspace", ports: [],
    cpuMillis: 250, memoryBytes: 134_217_728, enabled: true, required: false, restartPolicy: "bounded",
  });
  assert.deepEqual(normalizeServiceDefinitionInput({ ...minimal, mounts: [], workingDirectory: "/" }).workingDirectory, "/");
  for (const invalid of [
    { ...minimal, mounts: [] },
    { ...minimal, build: "." },
    { ...minimal, secretRefs: ["secret-a"] },
    { ...minimal, image: { reference: "https://registry/image" } },
    { ...minimal, image: { reference: "user:password@registry/image" } },
    { ...minimal, name: "agentd" },
    { ...minimal, ports: [{ name: "http", containerPort: 8080, protocol: "tcp" }, { name: "http", containerPort: 8081, protocol: "tcp" }] },
    { ...minimal, ports: [{ name: "http", containerPort: 8080, protocol: "tcp" }], readiness: { kind: "http", portName: "missing", path: "/ready" } },
    { ...minimal, readiness: { kind: "exec", command: ["true"], path: "/invalid" } },
  ]) assert.throws(() => normalizeServiceDefinitionInput(invalid), ServiceDefinitionValidationError);
  assert.throws(
    () => normalizeServiceDefinitionInput({ ...minimal, args: ["界".repeat(2_000)] }),
    (error) => error instanceof ServiceDefinitionValidationError && error.field === "args",
  );
  assert.throws(() => normalizeServiceDefinitionInput({ ...minimal, environment: { BIG: "x".repeat(1_048_576) } }), /1 MiB/);
});

test("work-services protobuf binding round trips without caller-controlled Work or Docker identity", () => {
  const request = {
    definition: {
      name: "notes", image: { reference: "python:3.13-slim" }, command: "python3", args: ["app.py"],
      environment: {}, secretRefs: [], workingDirectory: "/var/data/workspace",
      mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
      ports: [{ name: "http", containerPort: 8080, protocol: "tcp" }], cpuMillis: 250,
      memoryBytes: 134_217_728n, enabled: true, required: false, readiness: undefined, restartPolicy: "bounded",
    },
    idempotencyKey: "deploy-notes-v1",
  };
  assert.deepEqual(WorkServiceCreateRequestCodec.decode(WorkServiceCreateRequestCodec.encode(request).finish()), request);
  const acceptance = {
    workId: "work-0199e6d8abcd", serviceId: "service-0199e6d8abcd", operationId: "operation-0199e6d8abcd",
    correlationId: "operation-0199e6d8abcd", reused: false,
  };
  assert.deepEqual(WorkServiceAcceptanceCodec.decode(WorkServiceAcceptanceCodec.encode(acceptance).finish()), acceptance);
  assert.deepEqual(Object.keys(WorkServicesService), [
    "getDeploymentContext", "createService", "listServices", "getService", "updateService", "startService",
    "stopService", "restartService", "removeService", "retryService", "getOperation", "readServiceLogs",
  ]);
  const encoded = JSON.stringify(request, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  for (const forbidden of ["workId", "runtimeIdentity", "dockerId", "hostPath", "network", "privileged", "hostPort"]) {
    assert.equal(encoded.includes(forbidden), false);
  }
});

test("agent allocation must fit within aggregate Work resources", () => {
  assert.doesNotThrow(() => validateResourcePolicy(validWorkConfig.resources));
  assert.throws(() => validateResourcePolicy({ ...validWorkConfig.resources, agentCpuMillis: 1_001 }), /CPU budget/);
  assert.throws(() => validateResourcePolicy({ ...validWorkConfig.resources, agentMemoryBytes: validWorkConfig.resources.memoryBytes + 1 }), /memory budget/);
});
