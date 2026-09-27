import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { DockerDependencyError, DockerRuntime, DockerRuntimeError, PiPackageHelperIncompatibleError,
  type DockerCommandRunner } from "./docker.js";
import type { DockerStreamingRunner } from "./stream.js";

const imageId = `sha256:${"a".repeat(64)}`;

test("package helper contract probe is image-bound and isolated", async () => {
  const calls: string[][] = [];
  const runner: DockerCommandRunner = { async run(args) {
    calls.push([...args]);
    if (args[0] === "image") return JSON.stringify([{ Id: imageId, Config: { Labels: { "io.piwork.package-helper.contract": "1" } } }]);
    return "";
  } };
  await new DockerRuntime("package-contract", runner).inspectPiPackageHelperContract(imageId);
  const probe = calls[1]!;
  assert.deepEqual(probe.slice(0, 5), ["container", "run", "--rm", "--network", "none"]);
  assert.ok(probe.includes("--read-only"));
  assert.ok(probe.includes("--cap-drop"));
  assert.deepEqual(probe.slice(probe.indexOf("--user"), probe.indexOf("--user") + 2), ["--user", "10001:10001"]);
  assert.ok(probe.includes(imageId));
  assert.equal(probe.some((arg) => arg.includes("docker.sock") || arg.includes("/var/data")), false);
});

test("missing label and missing helper file fail distinctly from Docker outage", async () => {
  const missingLabel = new DockerRuntime("package-contract", { async run() {
    return JSON.stringify([{ Id: imageId, Config: { Labels: {} } }]);
  } });
  await assert.rejects(missingLabel.inspectPiPackageHelperContract(imageId), PiPackageHelperIncompatibleError);
  const missingFile = new DockerRuntime("package-contract", { async run(args) {
    if (args[0] === "image") return JSON.stringify([{ Id: imageId, Config: { Labels: { "io.piwork.package-helper.contract": "1" } } }]);
    throw new DockerRuntimeError("probe failed", args, "", 42);
  } });
  await assert.rejects(missingFile.inspectPiPackageHelperContract(imageId), PiPackageHelperIncompatibleError);
  const unavailable = new DockerRuntime("package-contract", { async run(args) {
    throw new DockerRuntimeError("Cannot connect to the Docker daemon", args, "", 1);
  } });
  await assert.rejects(unavailable.inspectPiPackageHelperContract(imageId),
    (error) => error instanceof DockerDependencyError && error.reason === "RUNTIME_UNAVAILABLE");
});

test("package helper exposes only allowlisted command failures", async () => {
  const jobId = "operation-1", name = "piwork-pkg-prepare-operation-1";
  const runner: DockerCommandRunner = { async run() {
    return JSON.stringify([{ Id: "container-1", Image: imageId, Name: `/${name}`,
      Config: { Labels: { "piwork.installation_id": "package-contract", "piwork.pi_package_job_id": jobId,
        "piwork.resource_kind": "pi-package-helper", "piwork.managed": "true" } },
      State: { Running: false, Status: "exited", ExitCode: 1 } }]);
  } };
  const response = (errorCode: string | null): DockerStreamingRunner => ({ spawn() {
    const stdout = new PassThrough();
    queueMicrotask(() => { stdout.end(JSON.stringify({ errorCode, raw: "child-private-marker" })); });
    return { stdin: new Writable({ write(_chunk, _encoding, callback) { callback(); } }), stdout,
      completed: Promise.resolve({ stderr: Buffer.alloc(0), stderrTruncated: false }), abort() {} };
  } });
  for (const code of ["PI_PACKAGE_SOURCE_FETCH_FAILED", "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED"] as const) {
    const runtime = new DockerRuntime("package-contract", runner, [], response(code));
    await assert.rejects(runtime.startPiPackageHelper(name, jobId), (error: unknown) =>
      (error as { code?: string }).code === code && !(error as Error).message.includes("child-private-marker"));
  }
  const unknown = new DockerRuntime("package-contract", runner, [], response("UNTRUSTED_CODE"));
  await assert.rejects(unknown.startPiPackageHelper(name, jobId), (error: unknown) =>
    error instanceof DockerDependencyError && !(error as Error).message.includes("child-private-marker"));
});
