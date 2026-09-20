import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { DockerDependencyError, DockerRuntime } from "./docker.js";
import { assertTestInstallationId, installationLabelFilter } from "./testing.js";

const execFile = promisify(execFileCallback);

test("logical container retries adopt one deterministically labelled instance", async () => {
  const installationId = assertTestInstallationId(process.env.PIWORK_TEST_INSTALLATION_ID ?? "");
  assert.equal(process.env.PIWORK_TEST_DOCKER_FILTER, installationLabelFilter(installationId));
  const runtime = new DockerRuntime(installationId);
  const spec = {
    workId: "work-0199e6d8abcd",
    kind: "agent" as const,
    logicalId: "generation-1",
    image: "ubuntu:22.04",
    command: ["sleep", "300"],
  };

  try {
    const image = await runtime.prepareImage(spec.image);
    assert.match(image.imageId, /^sha256:[a-f0-9]{64}$/);

    const first = await runtime.ensureContainer(spec);
    const retried = await runtime.ensureContainer(spec);
    assert.equal(first.created, true);
    assert.equal(retried.created, false);
    assert.equal(retried.containerId, first.containerId);
    assert.equal(retried.name, first.name);

    const { stdout } = await execFile("docker", [
      "container", "ls", "--all", "--quiet",
      "--filter", installationLabelFilter(installationId),
      "--filter", `label=piwork.logical_id=${spec.logicalId}`,
    ]);
    const matchingIds = stdout.trim().split("\n").filter(Boolean);
    assert.equal(matchingIds.length, 1);
    assert.equal(first.containerId.startsWith(matchingIds[0]!), true);

    const running = await runtime.startContainer(spec.workId, spec.kind, spec.logicalId);
    assert.equal(running.exists, true);
    assert.equal(running.running, true);
    const stopped = await runtime.stopContainer(spec.workId, spec.kind, spec.logicalId, 2);
    assert.equal(stopped.exists, true);
    assert.equal(stopped.running, false);
    await runtime.deleteContainer(spec.workId, spec.kind, spec.logicalId);
    assert.deepEqual(await runtime.inspectContainer(spec.workId, spec.kind, spec.logicalId), { exists: false });
  } finally {
    const { stdout } = await execFile("docker", [
      "container", "ls", "--all", "--quiet", "--filter", installationLabelFilter(installationId),
    ]);
    const ids = stdout.trim().split("\n").filter(Boolean);
    if (ids.length > 0) await execFile("docker", ["container", "rm", "--force", ...ids]);
  }
});

test("Work networks provide scoped aliases without host publication or cross-Work attachment", async () => {
  const installationId = assertTestInstallationId(process.env.PIWORK_TEST_INSTALLATION_ID ?? "");
  const runtime = new DockerRuntime(installationId);
  const workA = "work-0199networka";
  const workB = "work-0199networkb";
  const networkA = await runtime.ensureWorkNetwork(workA);
  const networkB = await runtime.ensureWorkNetwork(workB);
  const agentA = await runtime.ensureContainer({
    workId: workA,
    kind: "agent",
    logicalId: "generation-1",
    image: "ubuntu:22.04",
    command: ["sleep", "300"],
    network: { name: networkA.name, workId: workA, aliases: ["service-a"] },
  });
  const agentB = await runtime.ensureContainer({
    workId: workB,
    kind: "agent",
    logicalId: "generation-1",
    image: "ubuntu:22.04",
    command: ["sleep", "300"],
    network: { name: networkB.name, workId: workB, aliases: ["service-b"] },
  });

  try {
    await runtime.startContainer(workA, "agent", "generation-1");
    await runtime.startContainer(workB, "agent", "generation-1");
    const localLookup = await execFile("docker", ["container", "exec", agentA.containerId, "getent", "hosts", "service-a"]);
    assert.match(localLookup.stdout, /service-a/);
    await assert.rejects(
      execFile("docker", ["container", "exec", agentB.containerId, "getent", "hosts", "service-a"]),
    );
    const ports = await execFile("docker", [
      "container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", agentA.containerId,
    ]);
    assert.equal(ports.stdout.trim(), "{}");
    await assert.rejects(
      runtime.ensureContainer({
        workId: workB,
        kind: "service",
        logicalId: "illegal-cross-work",
        image: "ubuntu:22.04",
        command: ["sleep", "300"],
        network: { name: networkA.name, workId: workA, aliases: ["illegal"] },
      }),
      /cannot join another Work network/,
    );
  } finally {
    for (const [workId, logicalId] of [[workA, "generation-1"], [workB, "generation-1"]] as const) {
      await runtime.stopContainer(workId, "agent", logicalId, 2).catch(() => undefined);
      await runtime.deleteContainer(workId, "agent", logicalId).catch(() => undefined);
    }
    await runtime.deleteWorkNetwork(workA).catch(() => undefined);
    await runtime.deleteWorkNetwork(workB).catch(() => undefined);
  }
});

test("managed volumes persist across replacement and enforce Work ownership and read-only mounts", async () => {
  const installationId = assertTestInstallationId(process.env.PIWORK_TEST_INSTALLATION_ID ?? "");
  const runtime = new DockerRuntime(installationId);
  const workA = "work-0199volumea";
  const workB = "work-0199volumeb";
  const volume = await runtime.ensureManagedVolume(workA, "workspace");
  await execFile("docker", [
    "run", "--rm",
    "--label", `piwork.installation_id=${installationId}`,
    "--mount", `type=volume,src=${volume.volumeName},dst=/state`,
    "ubuntu:22.04", "chmod", "0777", "/state",
  ]);
  const writerSpec = {
    workId: workA,
    kind: "agent" as const,
    logicalId: "generation-volume",
    image: "ubuntu:22.04",
    command: ["sleep", "300"],
    mounts: [{ type: "volume" as const, source: volume.volumeName, target: "/state" }],
  };

  try {
    const first = await runtime.ensureContainer(writerSpec);
    await runtime.startContainer(workA, "agent", writerSpec.logicalId);
    await execFile("docker", ["container", "exec", first.containerId, "sh", "-c", "printf persistent > /state/value"]);
    await runtime.stopContainer(workA, "agent", writerSpec.logicalId, 2);
    await runtime.deleteContainer(workA, "agent", writerSpec.logicalId);

    const replacement = await runtime.ensureContainer(writerSpec);
    assert.notEqual(replacement.containerId, first.containerId);
    await runtime.startContainer(workA, "agent", writerSpec.logicalId);
    const restored = await execFile("docker", ["container", "exec", replacement.containerId, "cat", "/state/value"]);
    assert.equal(restored.stdout, "persistent");

    const reader = await runtime.ensureContainer({
      workId: workA,
      kind: "service",
      logicalId: "reader",
      image: "ubuntu:22.04",
      command: ["sleep", "300"],
      mounts: [{ type: "volume", source: volume.volumeName, target: "/state", readOnly: true }],
    });
    await runtime.startContainer(workA, "service", "reader");
    const readable = await execFile("docker", ["container", "exec", reader.containerId, "cat", "/state/value"]);
    assert.equal(readable.stdout, "persistent");
    await assert.rejects(execFile("docker", ["container", "exec", reader.containerId, "touch", "/state/forbidden"]));

    await assert.rejects(
      runtime.ensureContainer({
        workId: workB,
        kind: "service",
        logicalId: "cross-work-volume",
        image: "ubuntu:22.04",
        command: ["sleep", "300"],
        mounts: [{ type: "volume", source: volume.volumeName, target: "/state" }],
      }),
      /not managed for this Work/,
    );
    await assert.rejects(
      runtime.ensureContainer({
        workId: workA,
        kind: "service",
        logicalId: "path-traversal",
        image: "ubuntu:22.04",
        command: ["sleep", "300"],
        mounts: [{ type: "volume", source: volume.volumeName, target: "/state/../escape" }],
      }),
      /unsafe container mount target/,
    );
  } finally {
    for (const [kind, logicalId] of [["agent", writerSpec.logicalId], ["service", "reader"]] as const) {
      await runtime.stopContainer(workA, kind, logicalId, 2).catch(() => undefined);
      await runtime.deleteContainer(workA, kind, logicalId).catch(() => undefined);
    }
    await runtime.deleteManagedVolume(workA, "workspace").catch(() => undefined);
  }
});

test("managed containers enforce resource and privilege policy and reject unsafe runtime requests", async () => {
  const installationId = assertTestInstallationId(process.env.PIWORK_TEST_INSTALLATION_ID ?? "");
  const runtime = new DockerRuntime(installationId);
  const workId = "work-0199hardened";
  const logicalId = "generation-secure";
  const network = await runtime.ensureWorkNetwork(workId);

  try {
    const container = await runtime.ensureContainer({
      workId,
      kind: "agent",
      logicalId,
      image: "ubuntu:22.04",
      command: ["sleep", "300"],
      cpuMillis: 750,
      memoryBytes: 96 * 1_024 * 1_024,
      user: "65532:65532",
      network: { name: network.name, workId },
    });
    const inspection = await execFile("docker", ["container", "inspect", container.containerId]);
    const record = JSON.parse(inspection.stdout)[0] as Record<string, any>;
    assert.equal(record.HostConfig.Privileged, false);
    assert.equal(record.HostConfig.NetworkMode, network.name);
    assert.equal(record.HostConfig.Memory, 96 * 1_024 * 1_024);
    assert.equal(record.HostConfig.NanoCpus, 750_000_000);
    assert.equal(record.HostConfig.RestartPolicy.Name, "no");
    assert.equal(record.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(record.HostConfig.CapDrop, ["ALL"]);
    assert.deepEqual(record.HostConfig.SecurityOpt, ["no-new-privileges:true"]);
    assert.equal(record.Config.User, "65532:65532");
    assert.equal(record.HostConfig.Binds, null);

    await assert.rejects(
      runtime.ensureContainer({
        workId,
        kind: "service",
        logicalId: "root-user",
        image: "ubuntu:22.04",
        command: ["sleep", "300"],
        user: "0:0",
      }),
      /non-root numeric user/,
    );
    await assert.rejects(
      runtime.ensureContainer({
        workId,
        kind: "service",
        logicalId: "host-network",
        image: "ubuntu:22.04",
        command: ["sleep", "300"],
        network: { name: "host", workId },
      }),
      /not the managed private network/,
    );
    await assert.rejects(
      runtime.ensureContainer({
        workId,
        kind: "service",
        logicalId: "docker-socket",
        image: "ubuntu:22.04",
        command: ["sleep", "300"],
        mounts: [{ type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" }],
      }),
      /Docker socket mounts are forbidden/,
    );
    await assert.rejects(
      runtime.ensureContainer({
        workId,
        kind: "service",
        logicalId: "host-bind",
        image: "ubuntu:22.04",
        command: ["sleep", "300"],
        mounts: [{ type: "bind", source: "/etc", target: "/host" }],
      }),
      /outside configured runtime roots/,
    );
  } finally {
    await runtime.stopContainer(workId, "agent", logicalId, 2).catch(() => undefined);
    await runtime.deleteContainer(workId, "agent", logicalId).catch(() => undefined);
    await runtime.deleteWorkNetwork(workId).catch(() => undefined);
  }
});

test("runtime dependency failures remain distinct and missing storage is never recreated implicitly", async () => {
  const installationId = assertTestInstallationId(process.env.PIWORK_TEST_INSTALLATION_ID ?? "");
  const runtime = new DockerRuntime(installationId);
  const workId = "work-0199failures";

  assert.deepEqual(await runtime.inspectContainer(workId, "agent", "unknown-generation"), { exists: false });
  await assert.rejects(
    runtime.requireManagedVolume(workId, "missing-data"),
    (error) => error instanceof DockerDependencyError
      && error.reason === "RESOURCE_MISSING"
      && !error.retryable,
  );
  const missingAfter = await execFile("docker", [
    "volume", "ls", "--quiet",
    "--filter", installationLabelFilter(installationId),
    "--filter", "label=piwork.logical_id=missing-data",
  ]);
  assert.equal(missingAfter.stdout.trim(), "");

  const unwritable = await runtime.ensureManagedVolume(workId, "unwritable-data");
  try {
    await assert.rejects(
      runtime.assertManagedVolumeWritable(workId, "unwritable-data"),
      (error) => error instanceof DockerDependencyError && error.reason === "VOLUME_NOT_WRITABLE",
    );
    const available = await runtime.assertDiskCapacity(0);
    assert.equal(available > 0, true);
    await assert.rejects(
      runtime.assertDiskCapacity(Math.min(Number.MAX_SAFE_INTEGER, available + 1)),
      (error) => error instanceof DockerDependencyError
        && error.reason === "DISK_INSUFFICIENT"
        && error.retryable,
    );
  } finally {
    await execFile("docker", ["volume", "rm", "--force", unwritable.volumeName]).catch(() => undefined);
  }
});
