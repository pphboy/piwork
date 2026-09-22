import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONTRACT_VERSION, WORK_SERVICE_MCP_TOOL_NAMES } from "@piwork/contracts";
import { managedVolumeName } from "@piwork/runtime-docker";
import { DockerWorkRuntimeAdapter, RuntimeReadinessError, verifyExpectedReadiness } from "./docker-work-runtime.js";
import { ensureCorePaths } from "../application/paths.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { WorkContextStore } from "../configuration/work-context.js";
import { inspectSkillTree } from "../configuration/skill-tree.js";

const WORK = { id: "work-0199e6d8abcd", ownerUserId: "user-1", name: "fixture", desiredState: "running", observedState: "ready", desiredRevision: 1, activeRevision: 1, controlVersion: 1, deletedAt: null, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z" } as const;

test("readiness requires the complete captured context, ordered Skills, and effective tools", () => {
  const record = { workId: WORK.id, generation: 4, instanceId: "agent-4" };
  const workConfig = {
    agentImage: { catalogId: "image-a" }, skills: ["alpha"], agentsMd: "", modelRef: "model-a", mcpServers: [],
    resources: { cpuMillis: 1000, memoryBytes: 512 * 1024 * 1024, agentCpuMillis: 1000, agentMemoryBytes: 512 * 1024 * 1024, maxServices: 0, maxRetainedVolumes: 0 },
    tools: { allowed: ["read"], denied: [] },
  };
  const configuration = { contextIdentity: "context-a", skillIdentities: [{ name: "alpha", identity: "sha256:alpha" }], workConfig };
  const ready = {
    workId: WORK.id, generation: 4n, instanceId: "agent-4", protocolVersion: CONTRACT_VERSION,
    acceptingRuns: true, draining: false, contextContractVersion: 1, contextIdentity: "context-a",
    initializationComplete: true,
    loadedSkills: [{ name: "alpha", identity: "sha256:alpha", loaded: true, modelVisible: true, visibilityReason: "" }],
    resolvedTools: ["read"], activeRunCount: 0,
  };
  assert.doesNotThrow(() => verifyExpectedReadiness(ready, record, configuration));
  for (const incompatible of [
    { ...ready, protocolVersion: "" },
    { ...ready, contextContractVersion: 0 },
    { ...ready, initializationComplete: false },
  ]) {
    assert.throws(() => verifyExpectedReadiness(incompatible, record, configuration),
      (error) => error instanceof RuntimeReadinessError && error.code === "AGENT_CONTEXT_INCOMPATIBLE");
  }
  for (const mismatch of [
    { ...ready, generation: 3n },
    { ...ready, contextIdentity: "context-stale" },
    { ...ready, resolvedTools: ["bash"] },
    { ...ready, loadedSkills: [{ ...ready.loadedSkills[0]!, identity: "sha256:other" }] },
    { ...ready, loadedSkills: [] },
  ]) {
    assert.throws(() => verifyExpectedReadiness(mismatch, record, configuration),
      (error) => error instanceof RuntimeReadinessError && error.code === "AGENT_CONTEXT_MISMATCH");
  }

  const serviceTools = WORK_SERVICE_MCP_TOOL_NAMES.map((name) => `work-services.${name}`);
  const serviceWorkConfig = {
    ...workConfig,
    mcpServers: [{
      serverId: "work-services", transport: "stdio" as const, required: true,
      command: "/usr/local/bin/piwork-service-mcp", args: [],
    }],
    tools: { allowed: ["read", ...serviceTools], denied: [] },
  };
  assert.doesNotThrow(() => verifyExpectedReadiness(
    { ...ready, resolvedTools: ["read", ...serviceTools] },
    record,
    { ...configuration, workConfig: serviceWorkConfig },
  ));
  assert.throws(() => verifyExpectedReadiness(
    { ...ready, resolvedTools: ["read", ...serviceTools.slice(1)] },
    record,
    { ...configuration, workConfig: serviceWorkConfig },
  ), (error) => error instanceof RuntimeReadinessError && error.code === "AGENT_CONTEXT_MISMATCH");
});

test("readiness polling detects an exited exact generation and retains only recognized diagnostics", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-readiness-exit-"));
  try {
    const paths = ensureCorePaths(root);
    const adapter = new DockerWorkRuntimeAdapter(paths, "install-readiness");
    const record = { workId: WORK.id, generation: 7, instanceId: "agent-7" };
    const configuration = runtimeConfiguration("context-seven");
    const labels = {
      "piwork.generation": "7", "piwork.instance_id": "agent-7",
      "piwork.protocol_version": CONTRACT_VERSION, "piwork.context_identity": "context-seven",
    };
    const target = adapter as unknown as {
      readiness: () => Promise<never>;
      docker: {
        inspectContainer(): Promise<unknown>;
        collectContainerLogs(): Promise<{ text: string; truncated: boolean }>;
      };
      waitReady(record: unknown, configuration: unknown, expectedContainerId: string): Promise<void>;
    };
    target.readiness = async () => { throw new Error("connection refused /private/socket"); };
    target.docker = {
      async inspectContainer() { return { exists: true, containerId: "container-7", running: false, exitCode: 23, labels }; },
      async collectContainerLogs() {
        return {
          text: [
            "secret plain output must be ignored",
            JSON.stringify({ component: "agentd", outcome: "failed", code: "SKILL_LOAD_FAILED", stage: "skill-load", correlationId: "forged", workId: WORK.id }),
            JSON.stringify({ component: "agentd", outcome: "failed", code: "SKILL_LOAD_FAILED", stage: "skill-load", correlationId: "agent-7", workId: WORK.id, skillName: "alpha", message: "/private/skill body" }),
          ].join("\n"),
          truncated: false,
        };
      },
    };
    await assert.rejects(
      target.waitReady(record, configuration, "container-7"),
      (error) => error instanceof RuntimeReadinessError
        && error.code === "SKILL_LOAD_FAILED"
        && error.stage === "skill-load"
        && error.skillName === "alpha"
        && error.exitCode === 23
        && error.diagnosticCollection.state === "available",
    );

    target.docker.collectContainerLogs = async () => { throw new Error("docker stderr secret"); };
    await assert.rejects(
      target.waitReady(record, configuration, "container-7"),
      (error) => error instanceof RuntimeReadinessError
        && error.code === "AGENT_EXITED"
        && error.exitCode === 23
        && error.diagnosticCollection.state === "unavailable"
        && error.diagnosticCollection.code === "DIAGNOSTIC_COLLECTION_FAILED",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readiness polling preserves the 30-second budget with bounded concurrent attempts", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-readiness-timeout-"));
  let clock = 0;
  try {
    const paths = ensureCorePaths(root);
    const adapter = new DockerWorkRuntimeAdapter(paths, "install-readiness", {
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    });
    const record = { workId: WORK.id, generation: 8, instanceId: "agent-8" };
    const configuration = runtimeConfiguration("context-eight");
    let inspectionCalls = 0;
    const target = adapter as unknown as {
      readiness: () => Promise<never>;
      docker: {
        inspectContainer(): Promise<unknown>;
        collectContainerLogs(): Promise<{ text: string; truncated: boolean }>;
      };
      waitReady(record: unknown, configuration: unknown, expectedContainerId: string): Promise<void>;
    };
    target.readiness = async () => { throw new Error("not ready"); };
    target.docker = {
      async inspectContainer() {
        inspectionCalls += 1;
        return { exists: true, containerId: "container-8", running: true, labels: {
          "piwork.generation": "8", "piwork.instance_id": "agent-8",
          "piwork.protocol_version": CONTRACT_VERSION, "piwork.context_identity": "context-eight",
        } };
      },
      async collectContainerLogs() { return { text: "unknown output", truncated: false }; },
    };
    await assert.rejects(
      target.waitReady(record, configuration, "container-8"),
      (error) => error instanceof RuntimeReadinessError
        && error.code === "AGENT_READINESS_TIMEOUT"
        && error.diagnosticCollection.state === "unrecognized",
    );
    assert.equal(clock, 30_000);
    assert.ok(inspectionCalls > 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime Skill state is live evidence for the exact recorded context and generation", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-runtime-skill-state-"));
  try {
    const paths = ensureCorePaths(root);
    const skillDirectory = join(root, "alpha");
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, "SKILL.md"), "---\ndescription: alpha\n---\nAlpha\n");
    const skill = inspectSkillTree(skillDirectory);
    const configuration = {
      agentImage: { catalogId: "image-0199e6d8abcd" }, skills: ["alpha"], agentsMd: "", modelRef: "model-0199e6d8abcd", mcpServers: [],
      resources: { cpuMillis: 1000, memoryBytes: 1024 * 1024 * 1024, agentCpuMillis: 500, agentMemoryBytes: 512 * 1024 * 1024, maxServices: 8, maxRetainedVolumes: 16 },
      tools: { allowed: ["read"], denied: [] },
    };
    new WorkContextStore(paths.workContextsDirectory).build({
      workId: WORK.id, snapshotId: "context-status", configuration,
      imageIdentity: `sha256:${"a".repeat(64)}`,
      skills: [{ name: "alpha", identity: skill.identity, directory: skillDirectory }],
      createdAt: "2026-09-21T00:00:00Z",
    });
    mkdirSync(join(paths.runtimeDirectory, WORK.id), { recursive: true });
    writeFileSync(join(paths.runtimeDirectory, WORK.id, "runtime-state.json"), JSON.stringify({
      workId: WORK.id, generation: 9, instanceId: "agent-9", networkName: "network",
      imageId: `sha256:${"a".repeat(64)}`, contextIdentity: "context-status", correlationId: "runtime-status",
      tls: { caCertificatePath: "", serverCertificatePath: "", serverPrivateKeyPath: "", clientCertificatePath: "", clientPrivateKeyPath: "", serverName: "", clientCommonName: "" },
    }));
    const adapter = new DockerWorkRuntimeAdapter(paths, "install-status");
    let inspection = {
      exists: true, running: true,
      labels: { "piwork.generation": "9", "piwork.instance_id": "agent-9", "piwork.protocol_version": CONTRACT_VERSION, "piwork.context_identity": "context-status" },
    };
    const target = adapter as unknown as {
      docker: { inspectContainer(): Promise<unknown> };
      readiness(): Promise<unknown>;
    };
    target.docker = { async inspectContainer() { return inspection; } };
    target.readiness = async () => ({
      workId: WORK.id, generation: 9n, instanceId: "agent-9", protocolVersion: CONTRACT_VERSION,
      acceptingRuns: true, draining: false, contextContractVersion: 1, contextIdentity: "context-status",
      initializationComplete: true,
      loadedSkills: [{ name: "alpha", identity: skill.identity, loaded: true, modelVisible: false, visibilityReason: "read-tools-disabled" }],
      resolvedTools: ["read"], activeRunCount: 0,
    });
    const ready = await adapter.runtimeSkillState(WORK.id);
    assert.equal(ready.state, "ready");
    assert.equal(typeof ready.checkedAt, "string");
    assert.deepEqual(ready.skills, [{ name: "alpha", loaded: true, modelVisible: false, visibilityReason: "read-tools-disabled" }]);
    inspection = { ...inspection, labels: { ...inspection.labels, "piwork.generation": "8" } };
    assert.deepEqual((await adapter.runtimeSkillState(WORK.id)).skills, []);
    inspection = { ...inspection, running: false };
    assert.deepEqual((await adapter.runtimeSkillState(WORK.id)).skills, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runtimeConfiguration(contextIdentity: string) {
  return {
    contextIdentity,
    contextDirectory: "/unused",
    imageIdentity: `sha256:${"a".repeat(64)}`,
    runtimeProfileJson: "{}",
    skillIdentities: [],
    workConfig: {
      agentImage: { catalogId: "image-a" }, skills: [], agentsMd: "", modelRef: "model-a", mcpServers: [],
      resources: { cpuMillis: 1000, memoryBytes: 512 * 1024 * 1024, agentCpuMillis: 1000, agentMemoryBytes: 512 * 1024 * 1024, maxServices: 0, maxRetainedVolumes: 0 },
      tools: { allowed: [], denied: [] },
    },
  };
}

test("Docker runtime requires a validated active context and a read-only context mount", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-docker-runtime-"));
  try {
    const paths = ensureCorePaths(root);
    new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory).configure({ agentImage: "piwork:test", provider: "piwork-deterministic", model: "deterministic", credential: "unused" });
    const adapter = new DockerWorkRuntimeAdapter(paths, "install-0199e6d8abcd");
    const context = join(paths.workContextsDirectory, WORK.id, "contexts", "context-a");
    const forbidden = join(paths.skillsDirectory, "managed-skill");
    mkdirSync(context, { recursive: true });
    mkdirSync(forbidden, { recursive: true });
    let inspection: {
      exists: boolean;
      running: boolean;
      image?: string;
      labels: Record<string, string>;
      mounts: Array<{ type: string; source: string; destination: string; readOnly: boolean }>;
    } = {
      exists: true,
      running: false,
      image: `sha256:${"a".repeat(64)}`,
      labels: { "piwork.context_identity": "other", "piwork.generation": "1", "piwork.instance_id": "agent-1", "piwork.protocol_version": CONTRACT_VERSION },
      mounts: [{ type: "bind", source: context, destination: "/run/piwork", readOnly: true }],
    };
    const preparedReferences: string[] = [];
    let retainedVolumeMissing = false;
    const fakeDocker = {
      inspectContainer: async () => inspection,
      startContainer: async () => inspection,
      prepareImage: async (reference: string) => {
        preparedReferences.push(reference);
        return { reference, imageId: reference, repoDigests: [] };
      },
      ensureWorkNetwork: async () => ({ name: "network", networkId: "network", created: false }),
      ensureManagedVolume: async () => ({ volumeName: "volume", created: false }),
      requireManagedVolume: async () => {
        if (retainedVolumeMissing) throw new Error("retained workspace volume is missing");
        return { volumeName: "volume", created: false };
      },
      initializeManagedVolume: async () => {},
    };
    (adapter as unknown as { docker: unknown }).docker = fakeDocker;
    (adapter as unknown as { waitReady: () => Promise<void> }).waitReady = async () => {};
    await assert.rejects(() => adapter.prepare(WORK), /validated context snapshot/);
    mkdirSync(join(paths.runtimeDirectory, WORK.id), { recursive: true });
    writeFileSync(join(paths.runtimeDirectory, WORK.id, "runtime-state.json"), JSON.stringify({ workId: WORK.id, generation: 1, instanceId: "agent-1", networkName: "network", imageId: `sha256:${"a".repeat(64)}`, contextIdentity: "expected", correlationId: "runtime-test", tls: { caCertificatePath: "", serverCertificatePath: "", serverPrivateKeyPath: "", clientCertificatePath: "", clientPrivateKeyPath: "", serverName: "", clientCommonName: "" } }));
    const configuration = { workConfig: {} as never, runtimeProfileJson: "{}", contextIdentity: "expected", contextDirectory: context, imageIdentity: `sha256:${"a".repeat(64)}`, skillIdentities: [] };
    await adapter.prepare(WORK, configuration);
    assert.deepEqual(preparedReferences, [configuration.imageIdentity]);
    retainedVolumeMissing = true;
    await assert.rejects(() => adapter.prepare(WORK, configuration), /retained workspace volume is missing/);
    retainedVolumeMissing = false;

    preparedReferences.length = 0;
    fakeDocker.prepareImage = async (reference: string) => {
      preparedReferences.push(reference);
      throw new Error("captured image is missing");
    };
    await assert.rejects(() => adapter.prepare(WORK, configuration), /captured image is missing/);
    assert.deepEqual(preparedReferences, [configuration.imageIdentity]);
    fakeDocker.prepareImage = async (reference: string) => {
      preparedReferences.push(reference);
      return { reference, imageId: `sha256:${"b".repeat(64)}`, repoDigests: [] };
    };
    await assert.rejects(() => adapter.prepare(WORK, configuration), /image does not match/);

    await assert.rejects(() => adapter.start(WORK, 1, configuration), /does not match the active Work context/);

    inspection = { ...inspection, labels: { "piwork.context_identity": "expected", "piwork.generation": "1", "piwork.instance_id": "agent-1", "piwork.protocol_version": CONTRACT_VERSION }, mounts: [{ type: "bind", source: root, destination: "/run/piwork", readOnly: true }] };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /context mount is invalid/);

    inspection = { ...inspection, mounts: [] };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /context mount is invalid/);

    inspection = { ...inspection, mounts: [{ type: "bind", source: context, destination: "/run/piwork", readOnly: false }] };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /context mount is invalid/);

    const otherWorkContext = join(paths.workContextsDirectory, "work-0199other", "contexts", "context-a");
    mkdirSync(otherWorkContext, { recursive: true });
    inspection = { ...inspection, mounts: [{ type: "bind", source: otherWorkContext, destination: "/run/piwork", readOnly: true }] };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /context mount is invalid/);

    inspection = { ...inspection, mounts: [
      { type: "bind", source: context, destination: "/run/piwork", readOnly: true },
      { type: "bind", source: forbidden, destination: "/legacy-skill", readOnly: true },
    ] };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /unauthorized bind mount/);

    inspection = { ...inspection, mounts: [{ type: "bind", source: context, destination: "/run/piwork", readOnly: true }] };
    inspection = { ...inspection, image: `sha256:${"b".repeat(64)}` };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /image does not match/);
    inspection = { ...inspection, image: `sha256:${"a".repeat(64)}`, labels: { "piwork.context_identity": "expected", "piwork.generation": "2", "piwork.instance_id": "agent-1", "piwork.protocol_version": CONTRACT_VERSION } };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /identity does not match/);
    inspection = { ...inspection, labels: { "piwork.context_identity": "expected", "piwork.generation": "1", "piwork.instance_id": "agent-1", "piwork.protocol_version": "0" } };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /protocol does not match/);
    inspection = { ...inspection,
      labels: { "piwork.context_identity": "expected", "piwork.generation": "1", "piwork.instance_id": "agent-1", "piwork.protocol_version": CONTRACT_VERSION },
      mounts: [
        { type: "bind", source: context, destination: "/run/piwork", readOnly: true },
        { type: "volume", source: managedVolumeName("install-0199e6d8abcd", WORK.id, "work-private"), destination: "/var/data", readOnly: false },
        { type: "volume", source: managedVolumeName("install-0199e6d8abcd", WORK.id, "work-workspace"), destination: "/var/data/workspace", readOnly: false },
      ],
    };
    assert.deepEqual(await adapter.start(WORK, 1, configuration), { instanceId: "agent-1", generation: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
