import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { decodeFileHelperFrame, encodeFileHelperFrame, FILE_HELPER_FRAME_KIND } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import type { ContainerInspection, DockerStreamProcess, FileHelperSpec } from "@piwork/runtime-docker";
import { WorkFileCoordinator, WorkFileExecutionError, type WorkFileExecutionInput, type WorkFileRuntime } from "./coordinator.js";
import { WorkFileAccessGuard } from "./access.js";

const NOW = "2026-09-28T00:00:00.000Z";
const IMAGE = `sha256:${"a".repeat(64)}`;
const conditions = { ifMatch: null, ifNoneMatch: null, ifModifiedSince: null, ifUnmodifiedSince: null };

async function* frames(source: PassThrough) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of source) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5 && buffer.length >= 5 + buffer.readUInt32BE(1)) {
      const length = 5 + buffer.readUInt32BE(1);
      yield decodeFileHelperFrame(buffer.subarray(0, length));
      buffer = buffer.subarray(length);
    }
  }
}

type Handler = (input: PassThrough, output: PassThrough, spec: FileHelperSpec) => Promise<void>;
class FakeRuntime {
  exists = false;
  running = false;
  removed = false;
  createdSpec?: FileHelperSpec;
  failCreate = false;
  delayCreate?: Promise<void>;
  constructor(private readonly handler: Handler) {}
  async createFileHelper(spec: FileHelperSpec) {
    this.createdSpec = spec;
    this.exists = true;
    await this.delayCreate;
    if (this.failCreate) throw new Error("create timed out after Docker created the container");
    return "container-test";
  }
  async startFileHelper(_spec: FileHelperSpec, signal?: AbortSignal): Promise<DockerStreamProcess> {
    this.running = true;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const abort = () => { stdin.destroy(); stdout.destroy(new Error("aborted")); this.running = false; };
    signal?.addEventListener("abort", abort, { once: true });
    const completed = this.handler(stdin, stdout, _spec).then(() => {
      this.running = false;
      return { stderr: Buffer.alloc(0), stderrTruncated: false };
    });
    void completed.catch(() => undefined);
    stdout.on("error", () => undefined);
    return { stdin, stdout, completed, abort };
  }
  async inspectFileHelper(_spec: FileHelperSpec): Promise<ContainerInspection | undefined> {
    if (!this.exists) return undefined;
    return { exists: true, containerId: "container-test", name: this.createdSpec!.name,
      running: this.running, status: this.running ? "running" : "exited", exitCode: 0,
      labels: {}, image: IMAGE };
  }
  async stopFileHelper(_spec: FileHelperSpec) { this.running = false; }
  async removeFileHelper(_spec: FileHelperSpec) { this.exists = false; this.removed = true; }
}

async function fixture(run: (store: CoreStore) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-coordinator-"));
  const store = CoreStore.open({ databasePath: join(directory, "core.db") });
  try {
    store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${NOW}','${NOW}');
      INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-test','owner','digest','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-test-12345678','owner','test','running','ready',1,1,'${NOW}','${NOW}');
      INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,created_at)
      VALUES ('volume-test','install-test','work-test-12345678',NULL,'workspace','workspace-test','active',1,'${NOW}')`);
    await run(store);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

function coordinator(store: CoreStore, runtime: FakeRuntime) {
  const guard = { async validate() {} };
  return new WorkFileCoordinator(store, runtime as WorkFileRuntime, "install-test", IMAGE, 1, guard, () => NOW);
}
function input(kind: WorkFileExecutionInput["kind"]): WorkFileExecutionInput {
  return { workId: "work-test-12345678", ownerUserId: "owner", sessionId: "session-test", runtimeGeneration: 1,
    kind, pathSegments: ["note.txt"], conditions };
}

test("read result streams bytes and removes a journaled helper", async () => fixture(async (store) => {
  const chunks: Buffer[] = [];
  const runtime = new FakeRuntime(async (stdin, stdout) => {
    for await (const frame of frames(stdin)) {
      assert.equal(frame.kind, FILE_HELPER_FRAME_KIND.REQUEST);
      stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.META,
        { pathSegments: ["note.txt"], kind: "file", size: 5, modifiedMs: 0 }));
      stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_FROM_HELPER, Buffer.from("hello")));
      stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 200, bytes: 5, entries: 0 }));
      return;
    }
  });
  const result = await coordinator(store, runtime).execute({ ...input("GET"), onData: (chunk) => { chunks.push(chunk); } });
  assert.equal(result.status, 200);
  assert.equal(Buffer.concat(chunks).toString(), "hello");
  assert.equal(store.files.listPendingJobs().length, 0);
  assert.equal(store.files.listAttempts(store.get<{ id: string }>("SELECT id FROM work_file_jobs")!.id)[0]?.state, "removed");
  assert.equal(runtime.removed, true);
}));

test("PUT waits for two temporary acknowledgements before sending data", async () => fixture(async (store) => {
  const received: number[] = [];
  const runtime = new FakeRuntime(async (stdin, stdout) => {
    const iterator = frames(stdin)[Symbol.asyncIterator]();
    const request = (await iterator.next()).value!;
    assert.equal(request.kind, FILE_HELPER_FRAME_KIND.REQUEST);
    const epoch = (request.payload as { epoch: number }).epoch;
    const prepared = (device: string | null, inode: string | null) =>
      encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.PREPARED, { epoch,
        phase: "temporary", temporaryId: "filetemp-test-1234", parentSegments: [],
        name: ".piwork-file-test.tmp", device, inode });
    stdout.write(prepared(null, null));
    assert.equal((await iterator.next()).value!.kind, FILE_HELPER_FRAME_KIND.ACK);
    stdout.write(prepared("10", "20"));
    assert.equal((await iterator.next()).value!.kind, FILE_HELPER_FRAME_KIND.ACK);
    while (true) {
      const frame = (await iterator.next()).value!;
      if (frame.kind === FILE_HELPER_FRAME_KIND.DATA_TO_HELPER) received.push(...frame.payload as Buffer);
      if (frame.kind === FILE_HELPER_FRAME_KIND.END) break;
    }
    stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.PREPARED,
      { epoch, phase: "commit", temporaryId: null,
        parentSegments: [], name: null, device: null, inode: null }));
    assert.equal((await iterator.next()).value!.kind, FILE_HELPER_FRAME_KIND.ACK);
    stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 201, bytes: 5, entries: 0 }));
  });
  const result = await coordinator(store, runtime).execute({ ...input("PUT"), expectedLength: 5,
    body: (async function* () { yield Buffer.from("hello"); })() });
  assert.equal(result.status, 201);
  assert.equal(Buffer.from(received).toString(), "hello");
  assert.equal(store.files.listPendingJobs().length, 0);
  assert.equal(store.get<{ state: string }>("SELECT state FROM work_file_temporaries")?.state, "published");
}));

test("creation timeout still retires a container that appeared before inspection", async () => fixture(async (store) => {
  const runtime = new FakeRuntime(async () => undefined);
  runtime.failCreate = true;
  await assert.rejects(coordinator(store, runtime).execute(input("GET")), /timed out/);
  const job = store.get<{ id: string; state: string }>("SELECT id, state FROM work_file_jobs")!;
  assert.equal(job.state, "cleaned");
  const attempt = store.files.listAttempts(job.id)[0]!;
  assert.equal(attempt.state, "removed");
  assert.equal(attempt.containerName, runtime.createdSpec?.name);
  assert.equal(runtime.exists, false);
}));

test("slow Docker creation is already journaled before the container starts", async () => fixture(async (store) => {
  let release!: () => void;
  const runtime = new FakeRuntime(async (stdin, stdout) => {
    for await (const _frame of frames(stdin)) {
      stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 200, bytes: 0, entries: 0 }));
      return;
    }
  });
  runtime.delayCreate = new Promise<void>((resolve) => { release = resolve; });
  const pending = coordinator(store, runtime).execute(input("HEAD"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const [job] = store.files.listPendingJobs();
  assert.equal(job?.state, "starting");
  const [attempt] = store.files.listAttempts(job!.id);
  assert.equal(attempt?.state, "creating");
  assert.equal(attempt?.containerName, runtime.createdSpec?.name);
  release();
  assert.equal((await pending).status, 200);
  assert.equal(runtime.removed, true);
}));

test("malformed helper frame leaves a recoverable job and removes known container", async () => fixture(async (store) => {
  const runtime = new FakeRuntime(async (_stdin, stdout) => { stdout.end(Buffer.from([17, 0, 0, 0, 2, 123])); });
  await assert.rejects(coordinator(store, runtime).execute(input("GET")),
    (error) => error instanceof WorkFileExecutionError && error.code === "FILE_BACKEND_PROTOCOL_ERROR");
  assert.equal(runtime.removed, true);
  assert.equal(store.files.listPendingJobs().length, 0);
}));

test("client abort stops and removes the helper without losing its journal", async () => fixture(async (store) => {
  const controller = new AbortController();
  const runtime = new FakeRuntime(async (stdin, stdout) => {
    for await (const _frame of frames(stdin)) {
      stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_FROM_HELPER, Buffer.from("x")));
      await new Promise<void>((resolve) => stdout.once("close", resolve));
      return;
    }
  });
  await assert.rejects(coordinator(store, runtime).execute({ ...input("GET"), signal: controller.signal,
    onData: () => controller.abort() }));
  assert.equal(runtime.removed, true);
  assert.equal(store.files.listPendingJobs().length, 0);
}));

test("failed PUT cleans a confirmed temporary through a separate journaled attempt", async () => fixture(async (store) => {
  let requestAttempt: string | undefined;
  let cleanupCount = 0;
  const runtime = new FakeRuntime(async (stdin, stdout, spec) => {
    if (requestAttempt !== undefined && spec.attemptId !== requestAttempt) {
      for await (const frame of frames(stdin)) {
        assert.equal(frame.kind, FILE_HELPER_FRAME_KIND.REQUEST);
        assert.equal((frame.payload as { action: string }).action, "CLEANUP");
        cleanupCount++;
        stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 204, bytes: 0, entries: 1 }));
        return;
      }
    }
    requestAttempt = spec.attemptId;
    const iterator = frames(stdin)[Symbol.asyncIterator]();
    const request = (await iterator.next()).value!;
    const epoch = (request.payload as { epoch: number }).epoch;
    const notice = (device: string | null, inode: string | null) =>
      encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.PREPARED, { epoch, phase: "temporary",
        temporaryId: "filetemp-test-1234", parentSegments: [], name: ".piwork-file-test.tmp", device, inode });
    stdout.write(notice(null, null));
    await iterator.next();
    stdout.write(notice("10", "20"));
    await iterator.next();
    await iterator.next(); // one DATA frame
    stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ERROR,
      { code: "FILE_STORAGE_FULL", pathSegments: null }));
  });
  await assert.rejects(coordinator(store, runtime).execute({ ...input("PUT"), expectedLength: 5,
    body: (async function* () { yield Buffer.from("hello"); })() }));
  const job = store.get<{ id: string; state: string }>("SELECT id, state FROM work_file_jobs")!;
  assert.equal(job.state, "cleaned");
  assert.deepEqual(store.files.listAttempts(job.id).map((entry) => entry.state), ["removed", "removed"]);
  assert.equal(store.files.listTemporaries(job.id)[0]?.state, "cleaned");
  assert.equal(cleanupCount, 1);
}));

test("missing RESULT after commit never replays the upload and preserves recovery ownership", async () => fixture(async (store) => {
  let requestAttempt: string | undefined;
  let cleanupCount = 0;
  const runtime = new FakeRuntime(async (stdin, stdout, spec) => {
    if (requestAttempt && spec.attemptId !== requestAttempt) {
      for await (const frame of frames(stdin)) {
        assert.equal((frame.payload as { action: string }).action, "CLEANUP");
        cleanupCount++;
        stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 204, bytes: 0, entries: 0 }));
        return;
      }
    }
    requestAttempt = spec.attemptId;
    const iterator = frames(stdin)[Symbol.asyncIterator]();
    const request = (await iterator.next()).value!;
    const epoch = (request.payload as { epoch: number }).epoch;
    const prepared = (phase: "temporary" | "commit", device: string | null, inode: string | null) =>
      encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.PREPARED, { epoch, phase,
        temporaryId: phase === "commit" ? null : "filetemp-test-1234", parentSegments: [],
        name: phase === "commit" ? null : ".piwork-file-test.tmp", device, inode });
    stdout.write(prepared("temporary", null, null)); await iterator.next();
    stdout.write(prepared("temporary", "10", "20")); await iterator.next();
    while ((await iterator.next()).value?.kind !== FILE_HELPER_FRAME_KIND.END) {}
    stdout.write(prepared("commit", null, null));
    assert.equal((await iterator.next()).value?.kind, FILE_HELPER_FRAME_KIND.ACK);
    stdout.end(); // the file may be published, but HTTP completion was lost
  });
  await assert.rejects(coordinator(store, runtime).execute({ ...input("PUT"), expectedLength: 5,
    body: (async function* () { yield Buffer.from("hello"); })() }));
  const job = store.get<{ id: string; state: string }>("SELECT id, state FROM work_file_jobs")!;
  assert.equal(job.state, "cleaned");
  assert.equal(store.files.listTemporaries(job.id)[0]?.state, "cleaned");
  assert.equal(cleanupCount, 1);
}));

test("revoked session cancels an in-progress upload before commit permission", async () => fixture(async (store) => {
  store.ensureRuntimeGeneration("work-test-12345678", 1, NOW);
  store.updateRuntimeGeneration("work-test-12345678", 1, "ready", NOW, { instanceId: "instance-one" });
  const guard = new WorkFileAccessGuard(store, { async inspect() {
    return { exists: true, running: true, ready: true, generation: 1, instanceId: "instance-one" };
  } }, () => NOW);
  let sawData!: () => void;
  const dataReceived = new Promise<void>((resolve) => { sawData = resolve; });
  let committed = false;
  const runtime = new FakeRuntime(async (stdin, stdout) => {
    const iterator = frames(stdin)[Symbol.asyncIterator]();
    const request = (await iterator.next()).value!;
    const epoch = (request.payload as { epoch: number }).epoch;
    const notice = (device: string | null, inode: string | null) =>
      encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.PREPARED, { epoch, phase: "temporary",
        temporaryId: "filetemp-test-1234", parentSegments: [], name: ".piwork-file-test.tmp", device, inode });
    stdout.write(notice(null, null));
    await iterator.next();
    stdout.write(notice("10", "20"));
    await iterator.next();
    for await (const frame of { [Symbol.asyncIterator]: () => iterator }) {
      if (frame.kind === FILE_HELPER_FRAME_KIND.DATA_TO_HELPER) sawData();
      if (frame.kind === FILE_HELPER_FRAME_KIND.ACK
        && (frame.payload as { phase: string }).phase === "commit") committed = true;
    }
  });
  const body = (async function* () { yield Buffer.from("first"); await new Promise<never>(() => undefined); })();
  const running = new WorkFileCoordinator(store, runtime as WorkFileRuntime, "install-test", IMAGE, 1, guard, () => NOW)
    .execute({ ...input("PUT"), body });
  await dataReceived;
  store.revokeLoginSession("session-test", NOW);
  await assert.rejects(running, /AUTH_REQUIRED/);
  assert.equal(committed, false);
  assert.equal(runtime.removed, true);
  assert.equal(store.files.listPendingJobs()[0]?.state, "cleanup-pending");
}));

test("idle file transfer returns timeout and retains its cleanup proof", async () => fixture(async (store) => {
  const runtime = new FakeRuntime(async (stdin, stdout) => {
    for await (const _frame of frames(stdin)) {
      await new Promise<void>((resolve) => stdout.once("close", resolve));
      return;
    }
  });
  const guard = { async validate() {} };
  const worker = new WorkFileCoordinator(store, runtime as WorkFileRuntime, "install-test", IMAGE, 1,
    guard, () => NOW, { connectTimeoutMs: 100, helperTimeoutMs: 100, idleTimeoutMs: 20, requestTimeoutMs: 100 });
  await assert.rejects(worker.execute(input("GET")),
    (error) => error instanceof WorkFileExecutionError && error.code === "FILE_TRANSFER_TIMEOUT");
  assert.equal(runtime.removed, true);
  assert.equal(store.files.listPendingJobs().length, 0);
}));

test("helper that never confirms startup is timed out before the idle deadline", async () => fixture(async (store) => {
  const runtime = new FakeRuntime(async (stdin, stdout) => {
    for await (const _frame of frames(stdin)) {
      await new Promise<void>((resolve) => stdout.once("close", resolve));
      return;
    }
  });
  const worker = new WorkFileCoordinator(store, runtime as WorkFileRuntime, "install-test", IMAGE, 1,
    { async validate() {} }, () => NOW,
    { connectTimeoutMs: 100, helperTimeoutMs: 20, idleTimeoutMs: 100, requestTimeoutMs: 200 });
  await assert.rejects(worker.execute(input("GET")),
    (error) => error instanceof WorkFileExecutionError && error.code === "FILE_TRANSFER_TIMEOUT");
  assert.equal(runtime.removed, true);
}));
