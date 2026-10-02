import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkBusyError, WorkStore } from "@piwork/work-store";
import { AgentDaemonControl } from "./daemon.js";
import { RunManager, type RunExecutionContext, type RunExecutor } from "./runs.js";

const NOW = "2026-09-20T00:00:00.000Z";

test("unavailable Work storage rejects submission before executor side effects", async () => {
  await withStore(async (store) => {
    let executions = 0;
    const manager = readyManager(store, { async execute() { executions += 1; return { finalText: "unrecorded" }; } });
    store.close();
    assert.throws(() => manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "no-storage", prompt: "must not run" }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(executions, 0);
  });
});

test("submission is durable and idempotent with one active slot per Work and parallel different Works", async () => {
  await withStore(async (store) => {
    const executor = new ControlledExecutor();
    const manager = readyManager(store, executor);
    const first = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "submit-1", prompt: "hello" });
    const reused = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "submit-1", prompt: "hello" });
    assert.equal(reused.reused, true);
    assert.equal(reused.run.runId, first.run.runId);
    assert.throws(
      () => manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "submit-2", prompt: "second" }),
      (error) => error instanceof WorkBusyError,
    );
    const other = manager.submit({ workId: "work-b", sessionId: "session-b", submissionKey: "submit-b", prompt: "parallel" });
    await Promise.all([executor.waitUntilRunning(first.run.runId), executor.waitUntilRunning(other.run.runId)]);
    assert.equal(executor.running.size, 2);
    executor.resolve(first.run.runId, "answer-a");
    executor.resolve(other.run.runId, "answer-b");
    assert.equal((await manager.wait(first.run.runId)).state, "succeeded");
    assert.equal((await manager.wait(other.run.runId)).state, "succeeded");
  });
});

test("observer loss does not abort, model failure stays within the Run, and explicit cancel holds the slot through cleanup", async () => {
  await withStore(async (store) => {
    const executor = new ControlledExecutor();
    const manager = readyManager(store, executor);
    const run = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "observe", prompt: "stream" });
    run.run.runId;
    // Reading and then dropping an observation has no cancellation side effect.
    manager.watch(run.run.runId);
    assert.equal(manager.get(run.run.runId)?.state === "accepted" || manager.get(run.run.runId)?.state === "running", true);
    await executor.waitUntilRunning(run.run.runId);
    executor.reject(run.run.runId, new Error("fixture model failed with api-key-secret"));
    const failed = await manager.wait(run.run.runId);
    assert.equal(failed.state, "failed");
    assert.deepEqual(JSON.parse(failed.errorJson ?? "null"), {
      code: "MODEL_EXECUTION_FAILED",
      message: "Model execution failed.",
      retryable: true,
    });
    assert.doesNotMatch(failed.errorJson ?? "", /api-key-secret/);

    const cancelling = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "cancel", prompt: "wait" });
    await executor.waitUntilRunning(cancelling.run.runId);
    assert.equal(manager.cancel(cancelling.run.runId).state, "cancelling");
    assert.throws(
      () => manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "too-early", prompt: "blocked" }),
      (error) => error instanceof WorkBusyError,
    );
    executor.resolve(cancelling.run.runId, "partial cleanup result");
    assert.equal((await manager.wait(cancelling.run.runId)).state, "cancelled");
    const next = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "after-cancel", prompt: "allowed" });
    await executor.waitUntilRunning(next.run.runId);
    executor.resolve(next.run.runId, "done");
    assert.equal((await manager.wait(next.run.runId)).state, "succeeded");
  });
});

test("daemon recovery interrupts old active Runs and never repeats their external side effects", async () => {
  await withStore(async (store) => {
    let sideEffects = 0;
    const accepted = store.acceptRun({
      workId: "work-a", sessionId: "session-a", submissionKey: "crashed", requestDigest: "request", promptDigest: "prompt", now: NOW,
    });
    store.markRunRunning(accepted.run.runId, NOW);
    store.appendEvent(accepted.run.runId, "tool-end", JSON.stringify({ sideEffect: ++sideEffects }), NOW);
    const manager = readyManager(store, { async execute() { sideEffects += 1; return { finalText: "must not execute" }; } });
    const interrupted = manager.recover();
    assert.equal(interrupted[0]?.state, "interrupted");
    assert.equal(sideEffects, 1);
    assert.equal(store.getRun(accepted.run.runId)?.latestSequence, 2);
  });
});

test("bounded drain rejects new Runs, aborts at the deadline, and waits for the active slot to release", async () => {
  await withStore(async (store) => {
    const executor = new AbortSettlingExecutor();
    const manager = readyManager(store, executor);
    const active = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "drain-active", prompt: "wait" });
    await executor.waitUntilRunning(active.run.runId);

    const draining = manager.drain(1);
    assert.throws(
      () => manager.submit({ workId: "work-b", sessionId: "session-b", submissionKey: "drain-rejected", prompt: "no" }),
      /not ready to accept Runs/,
    );
    await draining;

    assert.equal(executor.running.size, 0);
    assert.equal(executor.abortedRunIds.has(active.run.runId), true);
    assert.equal(manager.get(active.run.runId)?.state, "cancelled");
  });
});

test("drain returns for container shutdown when a background child ignores parent abort", async () => {
  await withStore(async (store) => {
    let signal: AbortSignal | undefined;
    let running!: () => void;
    const started = new Promise<void>((resolve) => { running = resolve; });
    const manager = readyManager(store, { execute(context) {
      signal = context.signal;
      running();
      return new Promise(() => undefined);
    } });
    manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "detached-child", prompt: "wait" });
    await started;
    await Promise.race([manager.drain(1), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("drain hung")), 5_000))]);
    assert.equal(signal?.aborted, true);
  });
});

class ControlledExecutor implements RunExecutor {
  readonly running = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  execute(context: RunExecutionContext): Promise<{ finalText: string }> {
    context.emit("text", { delta: "started" });
    return new Promise((resolve, reject) => {
      this.running.set(context.runId, {
        resolve: (text) => { this.running.delete(context.runId); resolve({ finalText: text }); },
        reject: (error) => { this.running.delete(context.runId); reject(error); },
      });
    });
  }
  async waitUntilRunning(runId: string): Promise<void> {
    while (!this.running.has(runId)) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  resolve(runId: string, text: string): void { this.running.get(runId)?.resolve(text); }
  reject(runId: string, error: Error): void { this.running.get(runId)?.reject(error); }
}

class AbortSettlingExecutor implements RunExecutor {
  readonly running = new Set<string>();
  readonly abortedRunIds = new Set<string>();
  execute(context: RunExecutionContext): Promise<{ finalText: string }> {
    this.running.add(context.runId);
    return new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => {
        this.abortedRunIds.add(context.runId);
        setImmediate(() => {
          this.running.delete(context.runId);
          reject(new Error("aborted"));
        });
      }, { once: true });
    });
  }
  async waitUntilRunning(runId: string): Promise<void> {
    while (!this.running.has(runId)) await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function readyManager(store: WorkStore, executor: RunExecutor): RunManager {
  const daemon = new AgentDaemonControl({ workId: "fixture", generation: 1, instanceId: "instance" });
  daemon.configure({
    modelCredentialStatus: "available", contextIdentity: "context-fixture",
    loadedSkills: [], resolvedTools: ["read"], initializationComplete: true,
  });
  return new RunManager(store, daemon, executor, () => new Date(NOW));
}

async function withStore(run: (store: WorkStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "piwork-runs-"));
  const store = WorkStore.open(join(root, "work.sqlite"));
  for (const [workId, sessionId] of [["work-a", "session-a"], ["work-b", "session-b"]] as const) {
    store.createSession({ workId, sessionId, sdkHistoryPath: join(root, `${sessionId}.jsonl`), createdAt: NOW, updatedAt: NOW });
  }
  try { await run(store); }
  finally { store.close(); await rm(root, { recursive: true, force: true }); }
}
