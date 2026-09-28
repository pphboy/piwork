import assert from "node:assert/strict";
import test from "node:test";
import { DockerRuntime, type DockerCommandRunner } from "./docker.js";

const IMAGE = `sha256:${"a".repeat(64)}`;

test("file helper image resolution checks immutable ID, Linux and protocol label", async () => {
  let record: unknown = { Id: IMAGE, Os: "linux", Config: { Labels: { "piwork.file_protocol": "1" } } };
  const commands: string[][] = [];
  const runner: DockerCommandRunner = { run: async (args) => {
    commands.push([...args]);
    return JSON.stringify([record]);
  } };
  const runtime = new DockerRuntime("installation-test", runner);
  assert.equal(await runtime.resolveFileHelperImage("helper:local"), IMAGE);
  assert.deepEqual(commands, [["image", "inspect", "helper:local"]]);
  for (const invalid of [
    { Id: IMAGE, Os: "linux", Config: { Labels: {} } },
    { Id: IMAGE, Os: "linux", Config: { Labels: { "piwork.file_protocol": "0" } } },
    { Id: "helper:mutable", Os: "linux", Config: { Labels: { "piwork.file_protocol": "1" } } },
    { Id: IMAGE, Os: "windows", Config: { Labels: { "piwork.file_protocol": "1" } } },
  ]) {
    record = invalid;
    await assert.rejects(runtime.resolveFileHelperImage("helper:local"), /FILE_HELPER_IMAGE_INCOMPATIBLE/);
  }
  await assert.rejects(runtime.resolveFileHelperImage("-bad"), /Invalid configured/);
});
