import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { snapshotHelperCreateArgs, type SnapshotHelperSpec } from "./snapshot-helper.js";
import { DockerRuntime, DockerRuntimeError, type DockerCommandRunner } from "./docker.js";
import type { DockerStreamingRunner } from "./stream.js";

const spec: SnapshotHelperSpec = { installationId: "test-snapshot", jobId: "operation-test-000001", name: "snapshot-test-000001", imageId: `sha256:${"a".repeat(64)}`, volumeName: "test-volume-000001", spoolDirectory: "/tmp/snapshot-test-000001", action: "capture" };
test("trusted helpers have fixed entrypoint, no network and only scoped mounts", () => {
  const args = snapshotHelperCreateArgs(spec);
  assert.ok(args.includes(`piwork.installation_id=${spec.installationId}`));
  assert.ok(args.includes(`piwork.snapshot_job_id=${spec.jobId}`));
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args[args.indexOf("--entrypoint") + 1], "node");
  assert.ok(args.includes("--read-only")); assert.ok(args.includes("no-new-privileges"));
  assert.equal(args[args.indexOf("--cpus") + 1], "1");
  assert.equal(args[args.indexOf("--memory") + 1], "512m");
  assert.equal(args[args.indexOf("--pids-limit") + 1], "64");
  const mounts = args.flatMap((value, index) => value === "--mount" ? [args[index + 1]!] : []);
  assert.equal(mounts.length, 2); assert.ok(mounts[0]!.endsWith(",readonly"));
  assert.equal(args.some((value) => /docker.sock|--privileged|--env|TLS|MODEL/.test(value)), false);
  const restore = snapshotHelperCreateArgs({ ...spec, action: "restore", treeDigest: "b".repeat(64) });
  assert.equal(restore[restore.indexOf("--mount") + 1]!.endsWith(",readonly"), false);
});
test("helper arguments reject image tags, mount injection and untrusted action data", () => {
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, imageId: "user-image:latest" }));
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, volumeName: "volume,target=/host" }));
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, spoolDirectory: "/" }));
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, spoolDirectory: "/tmp/a/../b" }));
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, action: "restore", treeDigest: "../../etc" }));
});

test("upload verifier has no restoration capabilities, no user volume, and runs as the Core spool owner", () => {
  const args = snapshotHelperCreateArgs({ ...spec, volumeName: undefined, action: "verify-package", spoolUser: "1000:1000" });
  assert.equal(args[args.indexOf("--user") + 1], "1000:1000");
  assert.ok(!args.includes("--cap-add")); assert.equal(args.filter((value) => value === "--mount").length, 1);
  assert.ok(!args.some((value) => value.includes("type=volume")));
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, action: "verify-package", spoolUser: "1000:1000" }));
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, volumeName: undefined, action: "verify-package" }));
});

test("context restoration is confined to the job spool and rejects unsafe logical keys", () => {
  const args = snapshotHelperCreateArgs({ ...spec, volumeName: undefined, action: "restore-context", treeDigest: "b".repeat(64), contextKey: "c-000001" });
  assert.equal(args.filter((value) => value === "--mount").length, 1);
  assert.ok(!args.some((value) => value.includes("type=volume")));
  assert.deepEqual(args.slice(-3), ["restore-context", "b".repeat(64), "c-000001"]);
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, volumeName: undefined, action: "restore-context", treeDigest: "b".repeat(64), contextKey: "../escape" }));
  assert.throws(() => snapshotHelperCreateArgs({ ...spec, action: "restore-context", treeDigest: "b".repeat(64), contextKey: "c-000001" }));
});

test("helper execution and cleanup recheck exact installation/job ownership", async () => {
  let removed = false, wrongOwner = false;
  const runner: DockerCommandRunner = { async run(args) {
    if (args[0] === "create") return "container-helper-id\n";
    if (args[0] === "container" && args[1] === "rm") { removed = true; return "container-helper-id\n"; }
    if (args[0] === "container" && args[1] === "inspect") {
      if (removed) throw new DockerRuntimeError("No such container", args, "No such container", 1);
      return JSON.stringify([{ Id: "container-helper-id", Image: spec.imageId, Name: `/${spec.name}`,
        Config: { Labels: { "piwork.installation_id": spec.installationId, "piwork.snapshot_job_id": wrongOwner ? "other-job" : spec.jobId,
          "piwork.resource_kind": "snapshot-helper", "piwork.managed": "true" } },
        State: { Running: false, Status: "exited", ExitCode: 0 } }]);
    }
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  } };
  const streaming: DockerStreamingRunner = { spawn(args) {
    assert.deepEqual(args, ["container", "start", "--attach", spec.name]);
    const stdin = new PassThrough(), stdout = new PassThrough();
    queueMicrotask(() => stdout.end('{"tree":"safe"}\n'));
    return { stdin, stdout, completed: Promise.resolve({ stderr: Buffer.alloc(0), stderrTruncated: false }), abort() {} };
  } };
  const docker = new DockerRuntime(spec.installationId, runner, [], streaming);
  assert.equal(await docker.createSnapshotHelper(spec), "container-helper-id");
  assert.deepEqual(await docker.startSnapshotHelper(spec.name, spec.jobId), { tree: "safe" });
  wrongOwner = true;
  await assert.rejects(docker.removeSnapshotHelper(spec.name, spec.jobId), /ownership mismatch/);
  assert.equal(removed, false);
  wrongOwner = false;
  await docker.removeSnapshotHelper(spec.name, spec.jobId);
  assert.equal(removed, true);
});
