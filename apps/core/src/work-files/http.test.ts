import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { decodeFileHelperFrame, encodeFileHelperFrame, FILE_HELPER_FRAME_KIND } from "@piwork/contracts";
import type { ContainerInspection, DockerRuntime, DockerStreamProcess, FileHelperSpec } from "@piwork/runtime-docker";
import { CoreApplication } from "../application/core-application.js";
import { ensureCorePaths } from "../application/paths.js";
import { ensureInstallationId } from "../runtime/docker-work-runtime.js";

const WORK = "work-test-12345678";
const IMAGE = `sha256:${"a".repeat(64)}`;
const NOW = "2026-09-28T00:00:00.000Z";

async function* frames(source: PassThrough) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of source) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5 && buffer.length >= 5 + buffer.readUInt32BE(1)) {
      const size = 5 + buffer.readUInt32BE(1);
      yield decodeFileHelperFrame(buffer.subarray(0, size));
      buffer = buffer.subarray(size);
    }
  }
}

class FakeDocker {
  content = Buffer.from("initial");
  containers = new Set<string>();
  createCalls = 0;
  lastRequest: Record<string, unknown> | undefined;
  partialMutation = false;
  failNextPutStorage = false;
  failReadAfterData = false;
  failRemove = false;
  async createFileHelper(spec: FileHelperSpec) { this.createCalls++; this.containers.add(spec.name); return spec.name; }
  async inspectFileHelper(spec: FileHelperSpec): Promise<ContainerInspection | undefined> {
    if (!this.containers.has(spec.name)) return undefined;
    return { exists: true, containerId: spec.name, name: spec.name, running: false, status: "exited",
      exitCode: 0, labels: {}, image: IMAGE };
  }
  async stopFileHelper() {}
  async removeFileHelper(spec: FileHelperSpec) {
    if (this.failRemove) throw new Error("Docker remove failed");
    this.containers.delete(spec.name);
  }
  async startFileHelper(spec: FileHelperSpec): Promise<DockerStreamProcess> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const completed = (async () => {
      const iterator = frames(stdin)[Symbol.asyncIterator]();
      const request = (await iterator.next()).value!;
      const payload = request.payload as { action: string; epoch: number; pathSegments: string[]; depth: 0 | 1 | null;
        range: { start: number; end: number | null } | { suffix: number } | null;
        conditions: { ifMatch: string | null; ifNoneMatch: string | null } };
      this.lastRequest = payload as unknown as Record<string, unknown>;
      if (payload.action === "CLEANUP") {
        stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 204, bytes: 0, entries: 1 }));
        return { stderr: Buffer.alloc(0), stderrTruncated: false };
      }
      if (payload.action === "GET" || payload.action === "HEAD" || payload.action === "PROPFIND") {
        if (payload.pathSegments[0] === "missing" || payload.pathSegments[0] === "link" && payload.action !== "PROPFIND") {
          stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ERROR,
            { code: payload.pathSegments[0] === "missing" ? "FILE_NOT_FOUND" : "FILE_TYPE_UNSUPPORTED", pathSegments: null }));
          return { stderr: Buffer.alloc(0), stderrTruncated: false };
        }
        const directory = payload.action === "PROPFIND" &&
          (payload.pathSegments.length === 0 || payload.pathSegments[0] === "empty");
        stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.META,
          directory ? { pathSegments: payload.pathSegments, kind: "directory", size: null, modifiedMs: 0 }
            : payload.pathSegments[0] === "link" ? { pathSegments: ["link"], kind: "symlink", size: null, modifiedMs: 0 }
            : { pathSegments: ["large.bin"], kind: "file", size: this.content.length, modifiedMs: 0 }));
        if (directory && payload.pathSegments.length === 0 && payload.depth === 1)
          stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.META,
            { pathSegments: [".hidden"], kind: "file", size: 1, modifiedMs: 0 }));
        if (payload.conditions.ifMatch && payload.conditions.ifMatch !== "*") {
          stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ERROR,
            { code: "FILE_PRECONDITION_FAILED", pathSegments: null }));
          return { stderr: Buffer.alloc(0), stderrTruncated: false };
        }
        if (payload.conditions.ifNoneMatch === "*" && payload.action !== "PROPFIND") {
          stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT, { status: 304, bytes: 0, entries: 0 }));
          return { stderr: Buffer.alloc(0), stderrTruncated: false };
        }
        let content = this.content;
        if (payload.range && payload.action === "GET") {
          const start = "suffix" in payload.range ? Math.max(0, this.content.length - payload.range.suffix)
            : payload.range.start;
          const end = "suffix" in payload.range ? this.content.length - 1
            : Math.min(payload.range.end ?? this.content.length - 1, this.content.length - 1);
          if (start >= this.content.length) {
            stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ERROR,
              { code: "FILE_RANGE_UNSATISFIABLE", pathSegments: null }));
            return { stderr: Buffer.alloc(0), stderrTruncated: false };
          }
          content = this.content.subarray(start, end + 1);
        }
        if (payload.action === "GET") {
          if (this.failReadAfterData) {
            this.failReadAfterData = false;
            stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_FROM_HELPER,
              content.subarray(0, Math.min(3, content.length))));
            stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ERROR,
              { code: "FILE_RUNTIME_UNAVAILABLE", pathSegments: null }));
            return { stderr: Buffer.alloc(0), stderrTruncated: false };
          }
          for (let offset = 0; offset < content.length; offset += 1024 * 1024)
            stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_FROM_HELPER,
              content.subarray(offset, offset + 1024 * 1024)));
        }
        stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT,
          { status: payload.action === "PROPFIND" ? 207 : payload.range && payload.action === "GET" ? 206 : 200,
            bytes: payload.action === "GET" ? content.length : 0,
            entries: payload.action === "PROPFIND" ? directory && payload.pathSegments.length === 0 && payload.depth === 1 ? 2 : 1 : 0 }));
      } else if (payload.action === "PUT") {
        const notice = (phase: "temporary" | "commit", device: string | null, inode: string | null) =>
          encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.PREPARED, { epoch: payload.epoch, phase,
            temporaryId: phase === "commit" ? null : `filetemp-${spec.jobId}`, parentSegments: [],
            name: phase === "commit" ? null : `.piwork-file-${spec.jobId}.tmp`, device, inode });
        stdout.write(notice("temporary", null, null)); await iterator.next();
        stdout.write(notice("temporary", "10", "20")); await iterator.next();
        const parts: Buffer[] = [];
        while (true) {
          const frame = (await iterator.next()).value!;
          if (frame.kind === FILE_HELPER_FRAME_KIND.END) break;
          assert.equal(frame.kind, FILE_HELPER_FRAME_KIND.DATA_TO_HELPER);
          parts.push(frame.payload as Buffer);
        }
        if (this.failNextPutStorage) {
          this.failNextPutStorage = false;
          stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ERROR,
            { code: "FILE_STORAGE_FULL", pathSegments: null }));
          return { stderr: Buffer.alloc(0), stderrTruncated: false };
        }
        stdout.write(notice("commit", null, null)); await iterator.next();
        this.content = Buffer.concat(parts);
        stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT,
          { status: 204, bytes: this.content.length, entries: 0 }));
      } else if (["MKCOL", "COPY", "MOVE", "DELETE"].includes(payload.action)) {
        stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.PREPARED,
          { epoch: payload.epoch, phase: "commit", temporaryId: null, parentSegments: [],
            name: null, device: null, inode: null }));
        assert.equal((await iterator.next()).value?.kind, FILE_HELPER_FRAME_KIND.ACK);
        if (this.partialMutation) {
          this.partialMutation = false;
          stdout.write(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ERROR,
            { code: "FILE_PERMISSION_DENIED", pathSegments: ["destination", "blocked"] }));
          stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT,
            { status: 207, bytes: 0, entries: 1 }));
        } else stdout.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.RESULT,
          { status: payload.action === "DELETE" ? 204 : 201, bytes: 0, entries: 0 }));
      } else throw new Error("unexpected helper action");
      return { stderr: Buffer.alloc(0), stderrTruncated: false };
    })();
    void completed.catch(() => undefined);
    stdout.on("error", () => undefined);
    return { stdin, stdout, completed,
      abort() { stdin.destroy(); stdout.destroy(); } };
  }
}

async function fixture(run: (base: string, token: string, docker: FakeDocker, application: CoreApplication) => Promise<void>, helper = true) {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-http-"));
  const paths = ensureCorePaths(directory);
  const docker = new FakeDocker();
  let agentRunning = true;
  const application = await CoreApplication.create({ paths,
    initialization: { administrator: { account: "owner", password: "correct horse battery" },
      runtime: { agentImage: "image:test", provider: "anthropic", model: "fixture", credential: "fixture-secret" } },
    runtimeFactory: async () => ({ async prepare() {}, async start() { throw new Error("not expected"); },
      async inspect() { return { exists: agentRunning, running: agentRunning, ready: agentRunning,
        instanceId: "instance-one", generation: 1 }; },
      async drain() {}, async stop() { agentRunning = false; }, async remove() { agentRunning = false; } }),
    ...(helper ? { fileHelperImage: "helper:local", fileHelperResolver: async () => IMAGE } : {}),
    fileDockerFactory: () => docker as unknown as DockerRuntime });
  try {
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const ownerId = application.store.getAuthenticationUserByAccount("owner")!.id;
    application.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${WORK}','${ownerId}','test','running','ready',1,1,'${NOW}','${NOW}');
      INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,created_at)
      VALUES ('volume-test','${ensureInstallationId(paths)}','${WORK}',NULL,'workspace','workspace-test','active',1,'${NOW}')`);
    application.store.ensureRuntimeGeneration(WORK, 1, NOW);
    application.store.updateRuntimeGeneration(WORK, 1, "ready", NOW, { instanceId: "instance-one" });
    const token = (await application.identity.login("owner", "correct horse battery", "fixture")).token;
    await run(`http://127.0.0.1:${address.port}`, token, docker, application);
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
}

test("raw route authenticates before exposing Work and rejects unnormalized paths", async () => fixture(async (base, token) => {
  const root = `${base}/api/v1/works/${WORK}/files`;
  const unauthorized = await fetch(`${root}/`);
  assert.equal(unauthorized.status, 401);
  const missing = await fetch(`${base}/api/v1/works/work-missing-1234/files/`,
    { headers: { authorization: `Bearer ${token}` } });
  assert.equal(missing.status, 404);
  const redirect = await fetch(root, { headers: { authorization: `Bearer ${token}` }, redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), `/api/v1/works/${WORK}/files/`);
  const raw = await new Promise<number>((resolve, reject) => {
    const address = new URL(base);
    const req = httpRequest({ hostname: address.hostname, port: Number(address.port),
      path: `/api/v1/works/${WORK}/files/a/%2e%2e/b`,
      headers: { authorization: `Bearer ${token}` } }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode!));
      });
    req.once("error", reject); req.end();
  });
  assert.equal(raw, 400);
}));

test("large PUT and GET use binary streaming beyond the Core JSON limit", async () => fixture(async (base, token, docker) => {
  const url = `${base}/api/v1/works/${WORK}/files/large.bin`;
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 37, 0x93);
  const uploaded = await fetch(url, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: bytes });
  assert.equal(uploaded.status, 204);
  assert.equal(docker.content.length, bytes.length);
  const downloaded = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-length"), String(bytes.length));
  assert.equal(createHash("sha256").update(Buffer.from(await downloaded.arrayBuffer())).digest("hex"),
    createHash("sha256").update(bytes).digest("hex"));
  assert.equal(docker.containers.size, 0);
}));

test("missing helper changes only file access availability", async () => fixture(async (base, token) => {
  const response = await fetch(`${base}/api/v1/works/${WORK}/files/large.bin`,
    { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-piwork-file-error"), "FILE_HELPER_UNAVAILABLE");
}, false));

test("stopped Work is denied, and file task quota returns 429 until slots are cleaned", async () => fixture(async (base, token, _docker, app) => {
  const url = `${base}/api/v1/works/${WORK}/files/large.bin`;
  const headers = { authorization: `Bearer ${token}` };
  app.store.exec(`UPDATE works SET observed_state = 'stopping' WHERE id = '${WORK}'`);
  const stopped = await fetch(url, { headers });
  assert.equal(stopped.status, 409);
  assert.equal(stopped.headers.get("x-piwork-file-error"), "WORK_FILES_UNAVAILABLE");
  app.store.exec(`UPDATE works SET observed_state = 'ready' WHERE id = '${WORK}'`);
  const session = app.identity.authenticate(token);
  for (let i = 0; i < 4; i++) app.store.files.acceptJob({ id: `filejob-busy-${i}`, workId: WORK,
    ownerUserId: session.user.id, sessionId: session.sessionId, coreEpoch: 1, runtimeGeneration: 1,
    kind: "GET", state: "accepted", trustedImageId: IMAGE, volumeName: "workspace-test",
    pathSegmentsJson: '["large.bin"]', destinationSegmentsJson: null, acceptedAt: NOW,
    deadlineAt: "2026-09-28T00:30:00Z", updatedAt: NOW, cleanedAt: null, errorCode: null });
  const busy = await fetch(url, { headers });
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "1");
  for (let i = 0; i < 4; i++) app.store.files.markCleaned(`filejob-busy-${i}`, NOW);
  assert.equal((await fetch(url, { headers })).status, 200);
}));

test("PROPFIND returns finite-depth live properties and PROPPATCH rejects persistence", async () => fixture(async (base, token) => {
  const url = `${base}/api/v1/works/${WORK}/files/large.bin`;
  const authorization = `Bearer ${token}`;
  const propfind = await fetch(url, { method: "PROPFIND", headers: { authorization, depth: "0" } });
  assert.equal(propfind.status, 207);
  const xml = await propfind.text();
  assert.match(xml, /<d:href>\/api\/v1\/works\/work-test-12345678\/files\/large.bin<\/d:href>/);
  assert.match(xml, /<d:getcontentlength>7<\/d:getcontentlength>/);
  const unknown = await fetch(url, { method: "PROPFIND", headers: { authorization, depth: "0",
    "content-type": "application/xml" },
    body: '<d:propfind xmlns:d="DAV:"><d:prop><d:missing/></d:prop></d:propfind>' });
  assert.equal(unknown.status, 207);
  assert.match(await unknown.text(), /HTTP\/1\.1 404 Not Found/);
  const infinity = await fetch(url, { method: "PROPFIND", headers: { authorization } });
  assert.equal(infinity.status, 403);
  assert.match(await infinity.text(), /propfind-finite-depth/);
  const patch = await fetch(url, { method: "PROPPATCH", headers: { authorization, "content-type": "application/xml" },
    body: '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>new</d:displayname></d:prop></d:set></d:propertyupdate>' });
  assert.equal(patch.status, 207);
  assert.match(await patch.text(), /HTTP\/1\.1 403 Forbidden/);
  const evil = await fetch(url, { method: "PROPFIND", headers: { authorization, depth: "0", "content-type": "application/xml" },
    body: '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>' });
  assert.equal(evil.status, 400);
}));

test("PROPPATCH rejects properties on a symlink without following or modifying it", async () => fixture(async (base, token, docker) => {
  const root = `${base}/api/v1/works/${WORK}/files/`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/xml" };
  const body = '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:getlastmodified>changed</d:getlastmodified></d:prop></d:set></d:propertyupdate>';
  const before = Buffer.from(docker.content);
  const link = await fetch(`${root}link`, { method: "PROPPATCH", headers, body });
  assert.equal(link.status, 207);
  assert.match(await link.text(), /<d:href>[^<]*\/link<\/d:href>.*HTTP\/1\.1 403 Forbidden/);
  assert.equal(docker.lastRequest?.action, "PROPFIND");
  assert.deepEqual(docker.content, before);
  const rootPatch = await fetch(root, { method: "PROPPATCH", headers, body });
  assert.equal(rootPatch.status, 403);
  const missing = await fetch(`${root}missing`, { method: "PROPPATCH", headers, body });
  assert.equal(missing.status, 404);
}));

test("collection PROPFIND includes itself and hidden children without claiming DAV class", async () => fixture(async (base, token) => {
  const root = `${base}/api/v1/works/${WORK}/files/`;
  const authorization = `Bearer ${token}`;
  const options = await fetch(root, { method: "OPTIONS", headers: { authorization } });
  assert.equal(options.status, 200);
  assert.equal(options.headers.get("dav"), null);
  const directory = await fetch(root, { method: "PROPFIND", headers: { authorization, depth: "1" } });
  assert.equal(directory.status, 207);
  const xml = await directory.text();
  assert.equal((xml.match(/<d:response>/g) ?? []).length, 2);
  assert.match(xml, /files\/\.hidden/);
  const empty = await fetch(`${root}empty/`, { method: "PROPFIND", headers: { authorization, depth: "1" } });
  assert.equal(empty.status, 207);
  assert.equal(((await empty.text()).match(/<d:response>/g) ?? []).length, 1);
  const oversized = await fetch(root, { method: "PROPFIND", headers: { authorization, depth: "0",
    "content-type": "application/xml" }, body: " ".repeat(65_537) });
  assert.equal(oversized.status, 413);
}));

test("GET, HEAD, Range and existence conditions preserve HTTP status and bytes", async () => fixture(async (base, token) => {
  const url = `${base}/api/v1/works/${WORK}/files/large.bin`;
  const authorization = `Bearer ${token}`;
  const head = await fetch(url, { method: "HEAD", headers: { authorization } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "7");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const partial = await fetch(url, { headers: { authorization, range: "bytes=1-3" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 1-3/7");
  assert.equal(await partial.text(), "nit");
  const unsatisfiable = await fetch(url, { headers: { authorization, range: "bytes=100-" } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), "bytes */7");
  const multipart = await fetch(url, { headers: { authorization, range: "bytes=0-1,3-4" } });
  assert.equal(multipart.status, 416);
  assert.equal(multipart.headers.get("content-range"), "bytes */7");
  const none = await fetch(url, { headers: { authorization, "if-none-match": "*" } });
  assert.equal(none.status, 304);
  const match = await fetch(url, { headers: { authorization, "if-match": '"tag"' } });
  assert.equal(match.status, 412);
  const ignored = await fetch(url, { headers: { authorization, range: "bytes=1-3", "if-range": '"tag"' } });
  assert.equal(ignored.status, 200);
  assert.equal(await ignored.text(), "initial");
}));

test("upload rejects partial content and unsupported encoding before creating a helper", async () => fixture(async (base, token, docker) => {
  const url = `${base}/api/v1/works/${WORK}/files/large.bin`;
  const authorization = `Bearer ${token}`;
  const partial = await fetch(url, { method: "PUT", headers: { authorization, "content-range": "bytes 0-1/2" }, body: "ab" });
  assert.equal(partial.status, 400);
  const compressed = await fetch(url, { method: "PUT", headers: { authorization, "content-encoding": "gzip" }, body: "ab" });
  assert.equal(compressed.status, 415);
  assert.equal(docker.content.toString(), "initial");
  assert.equal(docker.containers.size, 0);
}));

test("chunked PUT is accepted and storage failure returns 507 without replacing prior bytes", async () => fixture(async (base, token, docker, app) => {
  const address = new URL(base);
  const path = `/api/v1/works/${WORK}/files/large.bin`;
  const uploaded = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ hostname: address.hostname, port: Number(address.port), path, method: "PUT",
      headers: { authorization: `Bearer ${token}`, "transfer-encoding": "chunked" } }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode!));
      });
    req.once("error", reject);
    req.write("first"); req.write("second"); req.end();
  });
  assert.equal(uploaded, 204);
  assert.equal(docker.content.toString(), "firstsecond");
  docker.failNextPutStorage = true;
  const failed = await fetch(`${base}${path}`, { method: "PUT",
    headers: { authorization: `Bearer ${token}` }, body: "replacement" });
  assert.equal(failed.status, 507, JSON.stringify({ error: failed.headers.get("x-piwork-file-error"),
    jobs: app.store.get<{ states: string }>("SELECT group_concat(state || ':' || COALESCE(error_code,'')) AS states FROM work_file_jobs") }));
  assert.equal(failed.headers.get("x-piwork-file-error"), "FILE_STORAGE_FULL");
  assert.equal(docker.content.toString(), "firstsecond");
}));

test("committed PUT with persistent helper removal failure returns cleanup required and preserves the complete file", async () => fixture(async (base, token, docker, app) => {
  const url = `${base}/api/v1/works/${WORK}/files/large.bin`;
  const headers = { authorization: `Bearer ${token}` };
  docker.failRemove = true;
  const failed = await fetch(url, { method: "PUT", headers, body: "complete replacement" });
  assert.equal(failed.status, 409);
  assert.equal(failed.headers.get("x-piwork-file-error"), "FILE_CLEANUP_REQUIRED");
  assert.equal(docker.content.toString(), "complete replacement");
  assert.equal(app.store.files.hasPending(WORK), true);
  const blocked = await fetch(url, { headers });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.headers.get("x-piwork-file-error"), "FILE_CLEANUP_REQUIRED");
  docker.failRemove = false;
  assert.equal(await app.fileRecovery.recoverWork(WORK, true), true);
  const recovered = await fetch(url, { headers });
  assert.equal(recovered.status, 200);
  assert.equal(await recovered.text(), "complete replacement");
}));

test("GET backend failure after body starts closes the stream without appending XML", async () => fixture(async (base, token, docker) => {
  docker.failReadAfterData = true;
  let failed = false;
  try {
    const response = await fetch(`${base}/api/v1/works/${WORK}/files/large.bin`,
      { headers: { authorization: `Bearer ${token}` } });
    await response.arrayBuffer();
  } catch { failed = true; }
  assert.equal(failed, true);
}));

test("directory mutations map Destination, Depth and Overwrite without leaving this Work", async () => fixture(async (base, token, docker) => {
  const root = `/api/v1/works/${WORK}/files/`;
  const authorization = `Bearer ${token}`;
  const source = `${base}${root}source`;
  const mkcol = await fetch(`${base}${root}folder`, { method: "MKCOL", headers: { authorization } });
  assert.equal(mkcol.status, 201);
  assert.equal(docker.lastRequest?.action, "MKCOL");
  const copy = await fetch(source, { method: "COPY", headers: { authorization, depth: "0", overwrite: "F",
    destination: `${base}${root}destination` } });
  assert.equal(copy.status, 201);
  assert.deepEqual(docker.lastRequest?.destinationSegments, ["destination"]);
  assert.equal(docker.lastRequest?.depth, 0);
  assert.equal(docker.lastRequest?.overwrite, false);
  const move = await fetch(source, { method: "MOVE", headers: { authorization,
    destination: `${root}destination`, overwrite: "T" } });
  assert.equal(move.status, 201);
  assert.deepEqual(docker.lastRequest?.destinationSegments, ["destination"]);
  assert.equal(docker.lastRequest?.depth, "infinity");
  const deleted = await fetch(source, { method: "DELETE", headers: { authorization } });
  assert.equal(deleted.status, 204);
  assert.equal(docker.lastRequest?.action, "DELETE");
  const before = docker.createCalls;
  for (const invalid of [
    "https://example.net/outside", `${base}/api/v1/works/other-work/files/target`,
    `${root}target?query=1`, `${base}${root}target#fragment`,
  ]) {
    const denied = await fetch(source, { method: "COPY", headers: { authorization, destination: invalid } });
    assert.equal(denied.status, 403, invalid);
  }
  assert.equal(docker.createCalls, before);
  assert.equal((await fetch(`${base}${root}`, { method: "DELETE", headers: { authorization } })).status, 403);
  assert.equal((await fetch(source, { method: "MOVE", headers: { authorization, destination: root, depth: "0" } })).status, 403);
  assert.equal((await fetch(source, { method: "COPY", headers: { authorization, destination: `${root}target`, depth: "1" } })).status, 400);
  assert.equal((await fetch(source, { method: "DELETE", headers: { authorization, depth: "0" } })).status, 400);
  assert.equal((await fetch(source, { method: "MKCOL", headers: { authorization }, body: "nonempty" })).status, 415);
  assert.equal((await fetch(source, { method: "LOCK", headers: { authorization } })).status, 405);
  assert.equal((await fetch(source, { method: "UNLOCK", headers: { authorization } })).status, 405);
  assert.equal(docker.createCalls, before);
}));

test("partial directory failure returns a bounded 207 multistatus", async () => fixture(async (base, token, docker) => {
  docker.partialMutation = true;
  const response = await fetch(`${base}/api/v1/works/${WORK}/files/destination`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 207);
  const xml = await response.text();
  assert.match(xml, /\/api\/v1\/works\/work-test-12345678\/files\/destination\/blocked/);
  assert.match(xml, /FILE_PERMISSION_DENIED/);
}));
