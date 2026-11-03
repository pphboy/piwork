import test from "node:test";
import assert from "node:assert/strict";
import { runProcess } from "./core-integration-process.mjs";

test("delayed signal handling receives a bounded process-group kill and cannot return a successful result", async () => {
  const controller = new AbortController();
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)",
    ],
    {
      env: process.env,
      signal: controller.signal,
      graceMs: 30,
      onSpawn(child) {
        child.stdout.once("data", () => controller.abort());
      },
    },
  );
  assert.equal(result.aborted, true);
  assert.notEqual(result.exitCode, 0);
});

test("missing executables, explicit failure and timeout retain failure instead of fabricating a package PASS", async () => {
  assert.notEqual(
    (await runProcess("/missing/integration-command", [], { env: {} }))
      .exitCode,
    0,
  );
  assert.equal(
    (
      await runProcess(process.execPath, ["-e", "process.exitCode=7"], {
        env: process.env,
      })
    ).exitCode,
    7,
  );
  const timeout = await runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { env: process.env, timeoutMs: 30, graceMs: 30 },
  );
  assert.equal(timeout.timedOut, true);
  assert.notEqual(timeout.exitCode, 0);
});

test("a failed worker cannot leave a descendant holding its output pipes indefinitely", async () => {
  const program = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); setTimeout(()=>process.exit(7),20);`;
  const result = await runProcess(process.execPath, ["-e", program], {
    env: process.env,
    graceMs: 30,
    timeoutMs: 2000,
  });
  assert.equal(result.orphaned, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 7);
});

test("a successful package remains successful only after owned live descendants are actually cleaned", async () => {
  const program =
    "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setTimeout(()=>process.exit(0),20)";
  const result = await runProcess(process.execPath, ["-e", program], {
    env: process.env,
    graceMs: 30,
    timeoutMs: 2000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.orphaned, true);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(result.timedOut, false);
});

test("detached descendants are reaped on success, failure and cancellation without touching an unrelated sentinel", async () => {
  const { spawn } = await import("node:child_process");
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  try {
    for (const mode of ["success", "failure", "cancel"]) {
      const controller = new AbortController();
      let owned;
      const program =
        "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{detached:true,stdio:'ignore'});console.log(c.pid);c.unref();" +
        (mode === "cancel"
          ? "setInterval(()=>{},1000)"
          : "process.exitCode=" + (mode === "failure" ? 7 : 0));
      const result = await runProcess(process.execPath, ["-e", program], {
        env: process.env,
        signal: controller.signal,
        graceMs: 50,
        onSpawn(child) {
          child.stdout.once("data", (data) => {
            owned = Number(data.toString().trim());
            if (mode === "cancel") controller.abort();
          });
        },
      });
      assert(owned > 0);
      assert.equal(result.cleanupConfirmed, true, mode);
      assert.throws(
        () => process.kill(owned, 0),
        (error) => error.code === "ESRCH",
        mode + " must reap even detached zombies",
      );
      assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
      assert.equal(result.aborted, mode === "cancel");
      if (mode !== "cancel")
        assert.equal(result.exitCode, mode === "failure" ? 7 : 0);
    }
  } finally {
    sentinel.kill("SIGKILL");
    await new Promise((resolve) => sentinel.once("close", resolve));
  }
});
