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

test("owned initialization log collection uses a bounded tail, output, and command timeout", async () => {
  const calls: Array<{ args: readonly string[]; timeoutMs?: number }> = [];
  const runtime = new DockerRuntime(installationId, {
    async run(args, timeoutMs) {
      calls.push({ args, timeoutMs });
      if (args[0] === "container" && args[1] === "ls") return "container-id\n";
      if (args[0] === "container" && args[1] === "inspect") return JSON.stringify(inspection());
      if (args[0] === "container" && args[1] === "logs") return "x".repeat(70 * 1024);
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    },
  });
  const logs = await runtime.collectContainerLogs(workId, "agent", logicalId, 999);
  assert.equal(logs.truncated, true);
  assert.equal(Buffer.byteLength(logs.text, "utf8"), 64 * 1024);
  const logCall = calls.find((call) => call.args[1] === "logs");
  assert.deepEqual(logCall?.args.slice(0, 4), ["container", "logs", "--tail", "200"]);
  assert.equal(logCall?.timeoutMs, 2_000);
});

test("log collection never follows a replacement container with the reused logical name", async () => {
  let logsCalled = false;
  const runtime = new DockerRuntime(installationId, {
    async run(args) {
      if (args[0] === "container" && args[1] === "ls") return "replacement-container\n";
      if (args[0] === "container" && args[1] === "logs") { logsCalled = true; return "replacement logs"; }
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    },
  });
  await assert.rejects(
    runtime.collectContainerLogs(workId, "agent", logicalId, 200, "original-container"),
    /identity changed/,
  );
  assert.equal(logsCalled, false);
});

test("log collection accepts Docker's short listing ID for the exact full immutable ID", async () => {
  const full = "a".repeat(64);
  const short = full.slice(0, 12);
  const calls: string[][] = [];
  const runtime = new DockerRuntime(installationId, {
    async run(args) {
      calls.push([...args]);
      if (args[0] === "container" && args[1] === "ls") return `${short}\n`;
      if (args[0] === "container" && args[1] === "inspect") return JSON.stringify(inspection({}));
      if (args[0] === "container" && args[1] === "logs") return "diagnostic\n";
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    },
  });
  assert.equal((await runtime.collectContainerLogs(workId, "agent", logicalId, 200, full)).text, "diagnostic\n");
  assert.equal(calls.find((args) => args[1] === "logs")?.at(-1), full);
});

test("container creation emits trusted workdir/control route and keeps service privilege restricted", async () => {
  const calls: Array<readonly string[]> = [];
  const commandRunner: DockerCommandRunner = {
    async run(args) {
      calls.push(args);
      if (args[0] === "container" && args[1] === "ls") return "";
      if (args[0] === "container" && args[1] === "create") return `container-${calls.length}`;
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    },
  };
  const runtime = new DockerRuntime(installationId, commandRunner);
  await runtime.ensureContainer({
    workId, kind: "agent", logicalId: "agent-control", image: "sha256:image",
    workingDirectory: "/var/data/workspace", controlHost: { hostname: "piwork-core", address: "host-gateway" },
  });
  const created = calls.find((args) => args[1] === "create")!;
  assert.ok(created.includes("--read-only"));
  assert.deepEqual(created.slice(created.indexOf("--cap-drop"), created.indexOf("--cap-drop") + 2), ["--cap-drop", "ALL"]);
  assert.deepEqual(created.slice(created.indexOf("--workdir"), created.indexOf("--workdir") + 2), ["--workdir", "/var/data/workspace"]);
  assert.deepEqual(created.slice(created.indexOf("--add-host"), created.indexOf("--add-host") + 2), ["--add-host", "piwork-core:host-gateway"]);
  await assert.rejects(runtime.ensureContainer({
    workId, kind: "service", logicalId: "service-control", image: "sha256:image",
    controlHost: { hostname: "piwork-core", address: "host-gateway" },
  }), /restricted to agent/);
});

test("managed volume mounts preserve initialized ownership and contents", async () => {
  const calls: Array<readonly string[]> = [];
  const runtime = new DockerRuntime(installationId, {
    async run(args) {
      calls.push(args);
      if (args[0] === "container" && args[1] === "ls") return "";
      if (args[0] === "container" && args[1] === "create") return "container-volume";
      if (args[0] === "volume" && args[1] === "ls") return "workspace-volume\n";
      if (args[0] === "volume" && args[1] === "inspect") return JSON.stringify([{
        Name: "workspace-volume",
        Labels: { "piwork.installation_id": installationId, "piwork.managed": "true", "piwork.work_id": workId, "piwork.logical_id": "workspace", "piwork.volume_kind": "managed-data" },
      }]);
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    },
  });
  await runtime.ensureContainer({
    workId, kind: "agent", logicalId: "agent-volume", image: "sha256:image",
    mounts: [{ type: "volume", source: "workspace-volume", target: "/var/data/workspace" }],
  });
  const created = calls.find((args) => args[1] === "create")!;
  const rendered = created[created.indexOf("--mount") + 1];
  assert.match(rendered!, /(?:^|,)volume-nocopy(?:,|$)/);
});

test("volume initialization helper is bounded, non-networked, and does not recursively rewrite data", async () => {
  const calls: Array<{ args: readonly string[]; timeoutMs?: number }> = [];
  const runtime = new DockerRuntime(installationId, {
    async run(args, timeoutMs) {
      calls.push({ args, timeoutMs });
      if (args[0] === "volume" && args[1] === "ls") return "volume-a\n";
      if (args[0] === "container" && args[1] === "run") return "";
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    },
  });
  await runtime.initializeManagedVolume(workId, "workspace", "sha256:image");
  const helper = calls.find((call) => call.args[1] === "run")!;
  assert.equal(helper.timeoutMs, 30_000);
  assert.deepEqual(helper.args.slice(helper.args.indexOf("--user"), helper.args.indexOf("--user") + 2), ["--user", "0:0"]);
  assert.ok(helper.args.includes("none"));
  assert.ok(helper.args.includes("CHOWN"));
  assert.equal(helper.args.includes("-R"), false);
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
    Image: "sha256:image",
    Name: "/piwork-agent-fixture",
    Config: {
      Image: "agent:mutable",
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
    Mounts: [{ Type: "volume", Name: "data-volume", Source: "/var/lib/docker/volumes/data-volume/_data", Destination: "/var/data", RW: true }],
    NetworkSettings: { Networks: { "work-network": { IPAddress: "172.30.0.7" } } },
  }];
}
