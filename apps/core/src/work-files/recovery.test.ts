import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeFileHelperFrame, encodeFileHelperFrame, FILE_HELPER_FRAME_KIND } from "@piwork/contracts";
import { CoreStore, type WorkFileJobRecord } from "@piwork/core-store";
import type { ContainerInspection, DockerStreamProcess, FileHelperSpec } from "@piwork/runtime-docker";
import type { DockerRuntime } from "@piwork/runtime-docker";
import type { WorkFileRuntime } from "./coordinator.js";
import { WorkFileRecovery } from "./recovery.js";
import { CoreApplication } from "../application/core-application.js";
import { ensureCorePaths } from "../application/paths.js";

const NOW = "2026-09-28T00:00:00.000Z";
const WORK = "work-test-12345678";
const IMAGE = `sha256:${"a".repeat(64)}`;

class Runtime {
  containers = new Map<string, { running: boolean; id: string }>();
  cleanupRequests: unknown[] = [];
  failRemove = false;
  async createFileHelper(spec: FileHelperSpec) {
    this.containers.set(spec.name, { running: false, id: spec.attemptId });
    return spec.attemptId;
  }
  async startFileHelper(spec: FileHelperSpec): Promise<DockerStreamProcess> {
    const record = this.containers.get(spec.name)!;
    record.running = true;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.once("data", (bytes: Buffer) => {
      const frame = decodeFileHelperFrame(bytes);
      this.cleanupRequests.push(frame.payload);
      record.running = false;
      stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 204, bytes: 0, entries: 1 }));
    });
    return { stdin, stdout, completed: Promise.resolve({ stderr: Buffer.alloc(0), stderrTruncated: false }),
      abort() { stdin.destroy(); stdout.destroy(); record.running = false; } };
  }
  async inspectFileHelper(spec: FileHelperSpec): Promise<ContainerInspection | undefined> {
    const record = this.containers.get(spec.name);
    return record && { exists: true, containerId: record.id, name: spec.name,
      running: record.running, status: record.running ? "running" : "exited", exitCode: 0,
      labels: {}, image: IMAGE };
  }
  async stopFileHelper(spec: FileHelperSpec) { this.containers.get(spec.name)!.running = false; }
  async removeFileHelper(spec: FileHelperSpec) {
    if (this.failRemove) { this.failRemove = false; throw new Error("Docker remove failed"); }
    this.containers.delete(spec.name);
  }
}

async function fixture(run: (store: CoreStore, runtime: Runtime, job: WorkFileJobRecord) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-recovery-"));
  const store = CoreStore.open({ databasePath: join(directory, "core.db") });
  try {
    store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${NOW}','${NOW}');
      INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-test','owner','digest','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${WORK}','owner','test','running','ready',1,1,'${NOW}','${NOW}')`);
    const attempt = { id: "attempt-test-1234", jobId: "filejob-test-1234", kind: "request" as const,
      epoch: 1, containerName: "piwork-file-old", containerId: null, state: "planned" as const,
      createdAt: NOW, updatedAt: NOW };
    const job = store.files.acceptJob({ id: attempt.jobId, workId: WORK, ownerUserId: "owner",
      sessionId: "session-test", coreEpoch: 1, runtimeGeneration: 1, kind: "PUT", state: "accepted",
      trustedImageId: IMAGE, volumeName: "workspace-test", pathSegmentsJson: '["note.txt"]',
      destinationSegmentsJson: null, acceptedAt: NOW, deadlineAt: "2026-09-28T00:30:00Z",
      updatedAt: NOW, cleanedAt: null, errorCode: null }, attempt);
    await run(store, new Runtime(), job);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

test("recovery stops the old helper, runs a separate cleanup attempt, and never replays PUT", async () => fixture(async (store, runtime, job) => {
  store.files.updateAttempt("attempt-test-1234", "planned", "creating", NOW);
  store.files.updateAttempt("attempt-test-1234", "creating", "running", NOW, "attempt-test-1234");
  runtime.containers.set("piwork-file-old", { running: true, id: "attempt-test-1234" });
  store.files.insertTemporary({ id: "filetemp-test-1234", jobId: job.id, parentSegmentsJson: "[]",
    name: ".piwork-file-test.tmp", device: "10", inode: "20", state: "created", createdAt: NOW, updatedAt: NOW });
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW);
  assert.equal(await recovery.recoverJob(job.id), true);
  assert.equal(store.files.getJob(job.id)?.state, "cleaned");
  assert.deepEqual(store.files.listAttempts(job.id).map((entry) => entry.state), ["removed", "removed"]);
  assert.equal(store.files.listTemporaries(job.id)[0]?.state, "cleaned");
  assert.equal(runtime.cleanupRequests.length, 1);
  assert.equal((runtime.cleanupRequests[0] as { action: string }).action, "CLEANUP");
  assert.equal(runtime.containers.size, 0);
}));

test("unknown temporary identity remains blocked and is never sent to cleanup", async () => fixture(async (store, runtime, job) => {
  store.files.updateAttempt("attempt-test-1234", "planned", "removed", NOW);
  store.files.insertTemporary({ id: "filetemp-test-1234", jobId: job.id, parentSegmentsJson: "[]",
    name: ".piwork-file-test.tmp", device: null, inode: null, state: "planned", createdAt: NOW, updatedAt: NOW });
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW);
  assert.equal(await recovery.recoverJob(job.id), false);
  assert.equal(store.files.getJob(job.id)?.state, "cleanup-pending");
  assert.equal(runtime.cleanupRequests.length, 0);
}));

test("timed-out create is kept pending until its exact late container appears", async () => fixture(async (store, runtime, job) => {
  store.files.updateAttempt("attempt-test-1234", "planned", "creating", NOW);
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW);
  assert.equal(await recovery.recoverJob(job.id), false);
  runtime.containers.set("piwork-file-old", { running: false, id: "attempt-test-1234" });
  assert.equal(await recovery.recoverJob(job.id), true);
  assert.equal(runtime.containers.size, 0);
}));

test("Docker remove failure retains attempt and retry completes without replay", async () => fixture(async (store, runtime, job) => {
  store.files.updateAttempt("attempt-test-1234", "planned", "creating", NOW);
  store.files.updateAttempt("attempt-test-1234", "creating", "created", NOW, "attempt-test-1234");
  runtime.containers.set("piwork-file-old", { running: false, id: "attempt-test-1234" });
  runtime.failRemove = true;
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW);
  assert.equal(await recovery.recoverJob(job.id), false);
  assert.equal(store.files.listAttempts(job.id)[0]?.state, "exited");
  assert.equal(await recovery.recoverJob(job.id), true);
  assert.equal(store.files.getJob(job.id)?.state, "cleaned");
}));

test("automatic cleanup retry budget is durable and explicit retry resets it", async () => fixture(async (store, runtime, job) => {
  store.files.updateAttempt("attempt-test-1234", "planned", "creating", NOW);
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW);
  for (let i = 0; i < 4; i++) assert.equal(await recovery.recoverJob(job.id), false);
  assert.equal(store.get<{ attempts: number }>("SELECT attempts FROM work_file_cleanup_retries")?.attempts, 3);
  assert.equal(await recovery.recoverJob(job.id, true), false);
  assert.equal(store.get<{ attempts: number }>("SELECT attempts FROM work_file_cleanup_retries")?.attempts, 1);
}));

test("one Work cleanup deadline bounds multiple slow helper inspections without marking jobs cleaned", async () => fixture(async (store, runtime, job) => {
  store.files.updateAttempt("attempt-test-1234", "planned", "created", NOW, "attempt-test-1234");
  runtime.containers.set("piwork-file-old", { running: true, id: "attempt-test-1234" });
  for (const index of [2, 3]) {
    const id = `filejob-slow-${index}`;
    store.files.acceptJob({ id, workId: WORK, ownerUserId: "owner", sessionId: "session-test",
      coreEpoch: 1, runtimeGeneration: 1, kind: "GET", state: "accepted", trustedImageId: IMAGE,
      volumeName: "workspace-test", pathSegmentsJson: '["note.txt"]', destinationSegmentsJson: null,
      acceptedAt: NOW, deadlineAt: "2026-09-28T00:30:00Z", updatedAt: NOW, cleanedAt: null,
      errorCode: null }, { id: `attempt-slow-${index}`, jobId: id, kind: "request", epoch: 1,
      containerName: `piwork-file-slow-${index}`, containerId: null, state: "planned",
      createdAt: NOW, updatedAt: NOW });
    store.files.updateAttempt(`attempt-slow-${index}`, "planned", "created", NOW, `attempt-slow-${index}`);
    runtime.containers.set(`piwork-file-slow-${index}`, { running: true, id: `attempt-slow-${index}` });
  }
  const originalInspect = runtime.inspectFileHelper.bind(runtime);
  runtime.inspectFileHelper = async (spec) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return originalInspect(spec);
  };
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW);
  const started = Date.now();
  assert.equal(await recovery.recoverWork(WORK, false, { deadlineAtMs: started + 25 }), false);
  assert.ok(Date.now() - started < 70, "all helpers share the same deadline");
  assert.equal(store.files.listPendingJobs(WORK).length, 3);
  assert.equal(store.files.getJob(job.id)?.state, "cleanup-pending");
}));

test("abort cancels a stalled periodic recovery without losing its journal", async () => fixture(async (store, runtime, job) => {
  store.files.updateAttempt("attempt-test-1234", "planned", "created", NOW, "attempt-test-1234");
  runtime.containers.set("piwork-file-old", { running: true, id: "attempt-test-1234" });
  runtime.inspectFileHelper = async () => new Promise((resolve) => setTimeout(() => resolve(undefined), 200));
  const controller = new AbortController();
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW);
  const pending = recovery.recoverAll({ signal: controller.signal });
  const started = Date.now();
  controller.abort();
  assert.deepEqual(await pending, [WORK]);
  assert.ok(Date.now() - started < 100);
  assert.equal(store.files.getJob(job.id)?.state, "cleanup-pending");
}));

test("Core close cancels its active file recovery before waiting for shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-close-"));
  const runtime = new Runtime();
  const application = await CoreApplication.create({ paths: ensureCorePaths(directory),
    initialization: { administrator: { account: "owner", password: "correct horse battery" } },
    fileDockerFactory: () => runtime as unknown as DockerRuntime });
  try {
    const ownerId = application.store.getAuthenticationUserByAccount("owner")!.id;
    application.store.exec(`INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-close','${ownerId}','digest','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${WORK}','${ownerId}','test','running','ready',1,1,'${NOW}','${NOW}')`);
    const job = application.store.files.acceptJob({ id: "filejob-close-1234", workId: WORK,
      ownerUserId: ownerId, sessionId: "session-close", coreEpoch: application.fileCoreEpoch,
      runtimeGeneration: 1, kind: "GET", state: "accepted", trustedImageId: IMAGE,
      volumeName: "workspace-test", pathSegmentsJson: "[]", destinationSegmentsJson: null,
      acceptedAt: NOW, deadlineAt: "2026-09-28T00:30:00Z", updatedAt: NOW,
      cleanedAt: null, errorCode: null },
    { id: "attempt-close-1234", jobId: "filejob-close-1234", kind: "request", epoch: 1,
      containerName: "piwork-file-close", containerId: null, state: "planned",
      createdAt: NOW, updatedAt: NOW });
    application.store.files.updateAttempt("attempt-close-1234", "planned", "created", NOW, "attempt-close-1234");
    application.store.files.updateJobState(job.id, "accepted", "cleanup-pending", NOW, "FILE_CLEANUP_REQUIRED");
    runtime.containers.set("piwork-file-close", { running: true, id: "attempt-close-1234" });
    runtime.inspectFileHelper = async () => new Promise((resolve) => setTimeout(() => resolve(undefined), 300));
    const internal = application as unknown as { fileRecoveryAbort: AbortController; fileRecoveryTask?: Promise<void> };
    internal.fileRecoveryTask = application.fileRecovery.recoverAll({ signal: internal.fileRecoveryAbort.signal }).then(() => undefined);
    const started = Date.now();
    await application.close();
    assert.ok(Date.now() - started < 150, "close aborts background recovery before awaiting it");
    const reopened = CoreStore.open({ databasePath: application.paths.databasePath });
    try { assert.equal(reopened.files.getJob(job.id)?.state, "cleanup-pending"); }
    finally { reopened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("SIGTERM exits nonzero within the Core budget after stalled file cleanup and still stops service and agent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-shutdown-process-"));
  const eventsPath = join(directory, "events.txt");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../../../scripts/work-files-shutdown-worker.mjs", import.meta.url))], {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
      PIWORK_SHUTDOWN_DIR: directory, PIWORK_SHUTDOWN_EVENTS: eventsPath } });
  let output = "", errors = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { errors += chunk; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`shutdown worker did not start: ${errors.slice(-500)}`)), 10_000);
      const check = () => { if (output.includes("READY\n")) { clearTimeout(timer); child.stdout.off("data", check); resolve(); } };
      child.stdout.on("data", check);
      check();
    });
    const started = Date.now();
    child.kill("SIGTERM");
    let timeout: NodeJS.Timeout | undefined;
    const result = await Promise.race([closed, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`shutdown worker hung: ${errors.slice(-500)}`)), 10_000);
    })]).finally(() => clearTimeout(timeout));
    assert.deepEqual(result, { code: 1, signal: null }, errors);
    assert.ok(Date.now() - started < 45_000);
    assert.deepEqual((await readFile(eventsPath, "utf8")).trim().split("\n"), ["service-stop", "agent-stop"]);
    const store = CoreStore.open({ databasePath: join(directory, "core.sqlite") });
    try {
      assert.equal(store.files.getJob("filejob-shutdown-1234")?.state, "cleanup-pending");
      assert.notEqual(store.getWork("work-shutdown-12345678")?.observedState, "stopped");
    } finally { store.close(); }
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("periodic recovery leaves live current-epoch transfers alone", async () => fixture(async (store, runtime, job) => {
  const recovery = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW, job.coreEpoch);
  assert.deepEqual(await recovery.recoverAll(), []);
  assert.equal(store.files.getJob(job.id)?.state, "accepted");
  assert.equal(store.files.listAttempts(job.id)[0]?.state, "planned");
  const older = new WorkFileRecovery(store, runtime as WorkFileRuntime, "install-test", () => NOW, job.coreEpoch + 1);
  assert.deepEqual(await older.recoverAll(), []);
  assert.equal(store.files.getJob(job.id)?.state, "cleaned");
}));

test("Core startup retires journaled file helpers before ordinary Work recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-startup-"));
  const fileRuntime = new Runtime();
  const application = await CoreApplication.create({ paths: ensureCorePaths(directory),
    initialization: { administrator: { account: "owner", password: "correct horse battery" },
      runtime: { agentImage: "image:test", provider: "anthropic", model: "fixture", credential: "fixture-secret" } },
    runtimeFactory: async () => ({ async prepare() {}, async start() { throw new Error("not expected"); },
      async inspect() { return { exists: false, running: false, ready: false }; },
      async drain() {}, async stop() {}, async remove() {} }),
    fileDockerFactory: () => fileRuntime as unknown as DockerRuntime });
  try {
    const ownerId = application.store.getAuthenticationUserByAccount("owner")!.id;
    application.store.exec(`INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-test','${ownerId}','digest','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${WORK}','${ownerId}','test','running','ready',1,1,'${NOW}','${NOW}')`);
    const job = application.store.files.acceptJob({ id: "filejob-startup-1234", workId: WORK,
      ownerUserId: ownerId, sessionId: "session-test", coreEpoch: application.fileCoreEpoch + 1, runtimeGeneration: 1,
      kind: "GET", state: "accepted", trustedImageId: IMAGE, volumeName: "workspace-test",
      pathSegmentsJson: "[]", destinationSegmentsJson: null, acceptedAt: NOW,
      deadlineAt: "2026-09-28T00:30:00Z", updatedAt: NOW, cleanedAt: null, errorCode: null },
    { id: "attempt-startup-1234", jobId: "filejob-startup-1234", kind: "request", epoch: 1,
      containerName: "piwork-file-startup", containerId: null, state: "planned", createdAt: NOW, updatedAt: NOW });
    application.store.files.updateAttempt("attempt-startup-1234", "planned", "creating", NOW);
    application.store.files.updateAttempt("attempt-startup-1234", "creating", "running", NOW, "attempt-startup-1234");
    fileRuntime.containers.set("piwork-file-startup", { running: true, id: "attempt-startup-1234" });
    application.store.exec(`UPDATE works SET desired_state = 'stopped', observed_state = 'stopping' WHERE id = '${WORK}'`);
    await application.listen({ host: "127.0.0.1", port: 0 });
    assert.equal(application.store.files.getJob(job.id)?.state, "cleaned");
    assert.equal(fileRuntime.containers.size, 0);
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
});
