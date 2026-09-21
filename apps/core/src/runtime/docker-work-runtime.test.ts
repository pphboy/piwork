import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DockerWorkRuntimeAdapter } from "./docker-work-runtime.js";
import { ensureCorePaths } from "../application/paths.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";

const WORK = { id: "work-0199e6d8abcd", ownerUserId: "user-1", name: "fixture", desiredState: "running", observedState: "ready", desiredRevision: 1, activeRevision: 1, controlVersion: 1, deletedAt: null, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z" } as const;

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
    let inspection = {
      exists: true,
      running: false,
      labels: { "piwork.context_identity": "other" },
      mounts: [{ type: "bind", source: context, destination: "/run/piwork", readOnly: true }],
    };
    const fakeDocker = {
      inspectContainer: async () => inspection,
      startContainer: async () => inspection,
      prepareImage: async () => ({ reference: "piwork:test", imageId: `sha256:${"a".repeat(64)}`, repoDigests: [] }),
      ensureWorkNetwork: async () => ({ name: "network", networkId: "network", created: false }),
      ensureManagedVolume: async () => ({ volumeName: "volume", created: false }),
    };
    (adapter as unknown as { docker: unknown }).docker = fakeDocker;
    (adapter as unknown as { waitReady: () => Promise<void> }).waitReady = async () => {};
    await assert.rejects(() => adapter.prepare(WORK), /validated context snapshot/);
    mkdirSync(join(paths.runtimeDirectory, WORK.id), { recursive: true });
    writeFileSync(join(paths.runtimeDirectory, WORK.id, "runtime-state.json"), JSON.stringify({ workId: WORK.id, generation: 1, instanceId: "agent-1", networkName: "network", imageId: `sha256:${"a".repeat(64)}`, tls: { caCertificatePath: "", serverCertificatePath: "", serverPrivateKeyPath: "", clientCertificatePath: "", clientPrivateKeyPath: "", serverName: "", clientCommonName: "" } }));
    const configuration = { workConfig: {} as never, runtimeProfileJson: "{}", contextIdentity: "expected", contextDirectory: context };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /does not match the active Work context/);

    inspection = { ...inspection, labels: { "piwork.context_identity": "expected" }, mounts: [{ type: "bind", source: root, destination: "/run/piwork", readOnly: true }] };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /context mount is invalid/);

    inspection = { ...inspection, mounts: [
      { type: "bind", source: context, destination: "/run/piwork", readOnly: true },
      { type: "bind", source: forbidden, destination: "/legacy-skill", readOnly: true },
    ] };
    await assert.rejects(() => adapter.start(WORK, 1, configuration), /unauthorized bind mount/);

    inspection = { ...inspection, mounts: [{ type: "bind", source: context, destination: "/run/piwork", readOnly: true }] };
    assert.deepEqual(await adapter.start(WORK, 1, configuration), { instanceId: "agent-1", generation: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
