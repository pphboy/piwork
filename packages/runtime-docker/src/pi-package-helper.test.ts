import assert from "node:assert/strict";
import test from "node:test";
import { piPackageHelperCreateArgs, type PiPackageHelperSpec } from "./pi-package-helper.js";

const base: PiPackageHelperSpec = {
  installationId: "installation-1", jobId: "operation-1", name: "package-prepare-1",
  imageId: `sha256:${"a".repeat(64)}`, volumeName: "pi-package-volume-1", action: "prepare",
  sourceDirectory: "/tmp/piwork/package-source-1", networkName: "pi-package-egress-1",
};

test("prepare helper is non-root, bounded and mounts only source input plus a temporary volume", () => {
  const args = piPackageHelperCreateArgs(base);
  assert.deepEqual(args.slice(args.indexOf("--user"), args.indexOf("--user") + 2), ["--user", "10001:10001"]);
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop"));
  assert.deepEqual(args.slice(args.indexOf("--cpus"), args.indexOf("--cpus") + 2), ["--cpus", "2"]);
  assert.deepEqual(args.slice(args.indexOf("--memory"), args.indexOf("--memory") + 2), ["--memory", "2g"]);
  assert.deepEqual(args.slice(args.indexOf("--pids-limit"), args.indexOf("--pids-limit") + 2), ["--pids-limit", "256"]);
  assert.ok(args.includes("type=bind,source=/tmp/piwork/package-source-1,target=/package/source,readonly"));
  assert.ok(args.includes("type=volume,source=pi-package-volume-1,target=/package/work"));
  assert.equal(args.some((arg) => arg.includes("docker.sock") || arg.includes("/home/") || arg.includes("/var/data")), false);
});

test("trusted init and capture have no network while capture mounts result read-only", () => {
  const init = piPackageHelperCreateArgs({ ...base, action: "init", sourceDirectory: undefined, networkName: undefined });
  assert.deepEqual(init.slice(init.indexOf("--network"), init.indexOf("--network") + 2), ["--network", "none"]);
  const capture = piPackageHelperCreateArgs({ ...base, action: "capture", sourceDirectory: undefined, networkName: undefined, spoolDirectory: "/tmp/piwork/spool-1" });
  assert.ok(capture.includes("type=volume,source=pi-package-volume-1,target=/package/work,readonly"));
  assert.ok(capture.includes("type=bind,source=/tmp/piwork/spool-1,target=/package/spool"));
  assert.deepEqual(capture.slice(capture.indexOf("--network"), capture.indexOf("--network") + 2), ["--network", "none"]);
  assert.throws(() => piPackageHelperCreateArgs({ ...base, imageId: "untrusted:latest" }));
  assert.throws(() => piPackageHelperCreateArgs({ ...base, sourceDirectory: "/" }));
});
