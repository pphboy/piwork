import assert from "node:assert/strict";
import test from "node:test";
import { fileHelperCreateArgs, type FileHelperSpec } from "./file-helper.js";

const spec: FileHelperSpec = {
  installationId: "installation-test", workId: "work-test", jobId: "filejob-test",
  attemptId: "attempt-test", epoch: 1, name: "piwork-file-test",
  imageId: `sha256:${"a".repeat(64)}`, volumeName: "workspace-test", readOnly: false,
};

test("file helper create args allow one workspace volume and no network, privilege or credential mount", () => {
  const args = fileHelperCreateArgs(spec);
  assert.deepEqual(args.slice(0, 2), ["container", "create"]);
  assert.deepEqual(args.slice(args.indexOf("--network"), args.indexOf("--network") + 2), ["--network", "none"]);
  assert.deepEqual(args.slice(args.indexOf("--user"), args.indexOf("--user") + 2), ["--user", "10001:10001"]);
  assert.equal(args.filter((arg) => arg === "--mount").length, 1);
  assert.equal(args.find((arg) => arg.startsWith("type=volume")), "type=volume,source=workspace-test,target=/workspace");
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--interactive"));
  assert.ok(args.includes("--cap-drop"));
  assert.equal(args.includes("--privileged"), false);
  assert.equal(args.includes("--publish"), false);
  assert.equal(args.some((arg) => arg.includes("docker.sock") || arg.includes("/var/data")), false);
  const readOnly = fileHelperCreateArgs({ ...spec, readOnly: true });
  assert.equal(readOnly.find((arg) => arg.startsWith("type=volume")), "type=volume,source=workspace-test,target=/workspace,readonly");
  for (const invalid of [
    { ...spec, imageId: "helper:latest" }, { ...spec, epoch: -1 }, { ...spec, name: "--rm" },
    { ...spec, volumeName: "workspace,source=other" },
  ]) assert.throws(() => fileHelperCreateArgs(invalid), /Invalid file helper identity/);
});
