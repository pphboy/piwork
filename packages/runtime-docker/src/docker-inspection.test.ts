import assert from "node:assert/strict";
import test from "node:test";
import {
  DockerRuntime,
  type DockerCommandRunner,
} from "./docker.js";

const installationId = "installation-fixture";
const workId = "work-0199inspection";
const logicalId = "generation-1";

test("Docker inspection parses adoption fields and handles missing and ambiguous resources", async () => {
  const runtime = new DockerRuntime(installationId, runner(["container-id"], inspection()));
  assert.deepEqual(await runtime.inspectContainer(workId, "agent", logicalId), {
    exists: true,
    containerId: "container-id",
    name: "piwork-agent-fixture",
    running: true,
    status: "running",
    exitCode: 0,
    specHash: "sha256-spec",
    labels: inspection()[0]!.Config.Labels,
    image: "sha256:image",
    user: "10001:10001",
    mounts: [{ type: "volume", source: "data-volume", destination: "/var/data", readOnly: false }],
    networkAddresses: { "work-network": "172.30.0.7" },
  });

  assert.deepEqual(
    await new DockerRuntime(installationId, runner([], inspection())).inspectContainer(workId, "agent", logicalId),
    { exists: false },
  );
  await assert.rejects(
    new DockerRuntime(installationId, runner(["one", "two"], inspection())).inspectContainer(workId, "agent", logicalId),
    /multiple containers claim logical identity/,
  );
});

test("Docker inspection rejects cross-installation and mismatched Work identities", async () => {
  const crossInstallation = inspection({ "piwork.installation_id": "another-installation" });
  await assert.rejects(
    new DockerRuntime(installationId, runner(["container-id"], crossInstallation)).inspectContainer(workId, "agent", logicalId),
    /not managed by this installation/,
  );

  const mismatchedWork = inspection({ "piwork.work_id": "work-elsewhere" });
  await assert.rejects(
    new DockerRuntime(installationId, runner(["container-id"], mismatchedWork)).inspectContainer(workId, "agent", logicalId),
    /identity does not match/,
  );
});

function runner(ids: readonly string[], record: unknown): DockerCommandRunner {
  return {
    async run(args) {
      if (args[0] === "container" && args[1] === "ls") return `${ids.join("\n")}${ids.length === 0 ? "" : "\n"}`;
      if (args[0] === "container" && args[1] === "inspect") return JSON.stringify(record);
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    },
  };
}

function inspection(overrides: Readonly<Record<string, string>> = {}) {
  return [{
    Id: "container-id",
    Name: "/piwork-agent-fixture",
    Config: {
      Image: "sha256:image",
      User: "10001:10001",
      Labels: {
        "piwork.installation_id": installationId,
        "piwork.managed": "true",
        "piwork.work_id": workId,
        "piwork.resource_kind": "agent",
        "piwork.logical_id": logicalId,
        "piwork.spec_hash": "sha256-spec",
        ...overrides,
      },
    },
    State: { Running: true, Status: "running", ExitCode: 0 },
    Mounts: [{ Type: "volume", Source: "data-volume", Destination: "/var/data", RW: true }],
    NetworkSettings: { Networks: { "work-network": { IPAddress: "172.30.0.7" } } },
  }];
}
