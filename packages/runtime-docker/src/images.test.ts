import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import type { ImageBlobStore, NormalizedImage } from "@piwork/work-package";
import { DockerRuntime } from "./docker.js";
import type { DockerStreamingRunner } from "./stream.js";

const id = `sha256:${"a".repeat(64)}`;
const image: NormalizedImage = { image: { imageId: id, platform: { os: "linux", architecture: "amd64", variant: null }, config: "a".repeat(64), layers: [] }, blobs: [] };
const store: ImageBlobStore = { async put() { throw new Error("unused"); }, async *read() { throw new Error("unused"); } };

test("captured image path rejects tags and existing identity reuses without save/load/pull", async () => {
  const commands: readonly string[][] = [];
  const logged = commands as string[][];
  const runtime = new DockerRuntime("test-images", { async run(args) { logged.push([...args]); return JSON.stringify([{ Id: id, Os: "linux", Architecture: "amd64" }]); } }, [], { spawn() { throw new Error("must not spawn"); } });
  await assert.rejects(runtime.inspectCapturedImage("mutable:tag"), TypeError);
  await assert.rejects(runtime.saveCapturedImage("mutable:tag", store), TypeError);
  assert.deepEqual(await runtime.loadVerifiedImage(image, store), { imageId: id, reused: true });
  assert.deepEqual(commands, [["image", "inspect", id]]);
  await assert.rejects(runtime.loadVerifiedImage({ ...image, image: { ...image.image, platform: { ...image.image.platform, architecture: "arm64" } } }, store), /INCOMPATIBLE/);
  assert.ok(commands.every((command) => command[1] === "inspect"));
});

test("save uses only captured ID and aborts failed parse without pruning shared images", async () => {
  const commands: string[][] = []; let aborted = false;
  const streaming: DockerStreamingRunner = { spawn(args) {
    commands.push([...args]); const stdout = new PassThrough(); stdout.end(Buffer.from("invalid tar"));
    return { stdin: new PassThrough(), stdout, completed: Promise.resolve({ stderr: Buffer.alloc(0), stderrTruncated: false }), abort() { aborted = true; } };
  } };
  const runtime = new DockerRuntime("test-images", { async run(args) { commands.push([...args]); return JSON.stringify([{ Id: id, Os: "linux", Architecture: "amd64" }]); } }, [], streaming);
  await assert.rejects(runtime.saveCapturedImage(id, store));
  assert.equal(aborted, true); assert.deepEqual(commands, [["image", "inspect", id], ["image", "save", id]]);
});
