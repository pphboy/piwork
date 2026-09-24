import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DockerCliStreamingRunner } from "./stream.js";

test("binary process streams backpressure through a slow consumer", async () => {
  const runner = new DockerCliStreamingRunner(process.execPath);
  const child = runner.spawn(["-e", "process.stdin.pipe(process.stdout)"], { timeoutMs: 10000 });
  const input = (async function* () { for (let i = 0; i < 80; i++) yield Buffer.alloc(65536, i); })();
  const upload = pipeline(Readable.from(input), child.stdin);
  let bytes = 0, largestBuffer = 0;
  for await (const chunk of child.stdout) {
    bytes += (chunk as Buffer).length;
    largestBuffer = Math.max(largestBuffer, child.stdout.readableLength);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await upload; await child.completed;
  assert.equal(bytes, 80 * 65536);
  assert.ok(largestBuffer <= 2 * 1024 * 1024);
});
test("stderr is drained but strictly bounded", async () => {
  const child = new DockerCliStreamingRunner(process.execPath, 1024).spawn(["-e", "process.stderr.write(Buffer.alloc(1024*1024, 120)); process.stdout.write('ok')"]);
  child.stdin.end();
  let output = ""; for await (const chunk of child.stdout) output += String(chunk);
  const result = await child.completed;
  assert.equal(output, "ok"); assert.equal(result.stderr.length, 1024); assert.equal(result.stderrTruncated, true);
});
test("abort, timeout, nonzero exit and spawn failure settle completion", async () => {
  const runner = new DockerCliStreamingRunner(process.execPath);
  const controller = new AbortController();
  const child = runner.spawn(["-e", "setInterval(()=>{},1000)"], { signal: controller.signal });
  controller.abort();
  await assert.rejects(child.completed, { code: "DOCKER_STREAM_ABORTED" });
  const timeout = runner.spawn(["-e", "setInterval(()=>{},1000)"], { timeoutMs: 30 });
  await assert.rejects(timeout.completed, { code: "DOCKER_STREAM_TIMEOUT" });
  const failed = runner.spawn(["-e", "process.exit(19)"]); failed.stdin.end(); failed.stdout.resume();
  await assert.rejects(failed.completed, { code: "DOCKER_STREAM_FAILED", exitCode: 19 });
  const missing = new DockerCliStreamingRunner("/nonexistent/piwork-stream-test").spawn([]);
  await assert.rejects(missing.completed, { code: "DOCKER_STREAM_FAILED" });
});
test("closing a reader terminates a blocked writer", async () => {
  const child = new DockerCliStreamingRunner(process.execPath).spawn(["-e", "const b=Buffer.alloc(65536); function send(){while(process.stdout.write(b)){} process.stdout.once('drain',send)} send()"]);
  child.stdin.end();
  for await (const _ of child.stdout) break;
  await assert.rejects(child.completed, { code: "DOCKER_STREAM_ABORTED" });
});
