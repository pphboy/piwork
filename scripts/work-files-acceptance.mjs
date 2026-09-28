import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CoreApplication } from "../apps/core/dist/application/core-application.js";
import { ensureCorePaths } from "../apps/core/dist/application/paths.js";
import { ensureInstallationId } from "../apps/core/dist/runtime/docker-work-runtime.js";
import { FileCredentialStore } from "@piwork/client-sdk";
import { DockerRuntime } from "@piwork/runtime-docker";
import { WorkStore } from "@piwork/work-store";
import { readWorkPackage } from "@piwork/work-package";

const helperImage = process.env.PIWORK_FILE_HELPER_TEST_IMAGE?.trim();
const snapshotImage = process.env.PIWORK_SNAPSHOT_HELPER_TEST_IMAGE?.trim();
if (!helperImage || !snapshotImage) throw new Error("PIWORK_FILE_HELPER_TEST_IMAGE and PIWORK_SNAPSHOT_HELPER_TEST_IMAGE are required");
const rcloneCommand = process.env.PIWORK_RCLONE_BIN || "rclone";
const agentImage = process.env.PIWORK_AGENT_TEST_IMAGE?.trim() || "piwork-agentd:acceptance";
const root = await mkdtemp(join(tmpdir(), "piwork-work-files-"));
const workA = "work-files-a-12345678", workB = "work-files-b-12345678";
const workOther = "work-files-other-12345678";
const now = new Date().toISOString();
const administratorPassword = `file-acceptance-${randomUUID()}`;
let app, proxy, serviceServer;
const serviceSockets = new Set();
const volumes = [];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function command(binary, args, options = {}) {
  const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"], ...options });
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
  child.stdout.on("data", (bytes) => { stdout = Buffer.concat([stdout, bytes]); });
  child.stderr.on("data", (bytes) => { stderr = Buffer.concat([stderr, bytes]); });
  if (options.input !== undefined) child.stdin.end(options.input);
  else child.stdin.end();
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveCode);
  });
  if (code !== 0) throw new Error(`${binary} ${args[0] ?? ""} failed (${code}): ${stderr.toString().slice(0, 500)}`);
  return stdout.toString().trim();
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function startProxy(configPath, coreUrl, port) {
  const child = spawn(process.execPath, [resolve("apps/cli/dist/main.js"), "proxy", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PIWORK_CONFIG_PATH: configPath, PIWORK_CORE_URL: coreUrl },
  });
  let printed = "";
  const password = await new Promise((resolvePassword, reject) => {
    const timer = setTimeout(() => reject(new Error("CLI proxy startup timed out")), 15_000);
    child.stdout.on("data", (bytes) => {
      printed += bytes.toString();
      if (printed.length > 4096) { clearTimeout(timer); reject(new Error("CLI proxy printed too much startup output")); return; }
      const match = /WebDAV password: ([A-Za-z0-9_-]+)\n/.exec(printed);
      if (match) { clearTimeout(timer); resolvePassword(match[1]); }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("CLI proxy exited before ready")); });
  });
  assert.match(printed, /WebDAV status: available/);
  return { child, password };
}

async function rclone(...args) { return command(rcloneCommand, args, { env: { ...process.env, RCLONE_CONFIG: join(root, "rclone.conf") } }); }

async function waitUntil(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error("timed out waiting for file task cleanup");
}

async function serviceHttp(port, hostname, path, headers = {}) {
  return new Promise((done, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port,
      path: `http://${hostname}${path}`, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => done({ status: response.statusCode,
        headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function serviceWebSocket(port, hostname) {
  return new Promise((done, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port,
      path: `ws://${hostname}/socket`, headers: { connection: "Upgrade", upgrade: "websocket",
        "sec-websocket-key": "aGVsbG8=", "sec-websocket-version": "13" } });
    request.once("upgrade", (response, socket) => {
      assert.equal(response.statusCode, 101);
      socket.once("data", (data) => { done(data.toString()); socket.destroy(); });
      socket.write("service-echo");
    });
    request.once("error", reject);
    request.end();
  });
}

try {
  const rcloneVersion = (await command(rcloneCommand, ["version"])).split("\n")[0];
  await command("docker", ["version", "--format", "{{.Server.Version}}"]).then((version) => assert.ok(version));
  await command("docker", ["image", "inspect", "--format", "{{.Id}}", helperImage]);
  await command("docker", ["image", "inspect", "--format", "{{.Id}}", snapshotImage]);
  const agentImageId = await command("docker", ["image", "inspect", "--format", "{{.Id}}", agentImage]);
  const paths = ensureCorePaths(join(root, "core"));
  const installationId = ensureInstallationId(paths);
  const running = new Map();
  const generations = new Map();
  app = await CoreApplication.create({ paths,
    initialization: { administrator: { account: "owner", password: administratorPassword },
      runtime: { agentImage: "image:fixture", provider: "anthropic", model: "fixture", credential: "fixture-secret" } },
    runtimeFactory: async () => ({ async prepare() {}, async start(work, generation) {
      running.set(work.id, true); generations.set(work.id, generation);
      return { instanceId: `instance-${work.id}`, generation }; },
      async inspect(workId) { const current = running.get(workId) === true;
        return { exists: current, running: current, ready: current,
          instanceId: current ? `instance-${workId}` : undefined,
          generation: current ? generations.get(workId) ?? 1 : undefined }; },
      async drain() {}, async stop(workId) { running.set(workId, false); },
      async remove(workId) { running.set(workId, false); } }),
    fileHelperImage: helperImage, snapshotHelperImage: snapshotImage });
  const snapshotFailures = [];
  const startSnapshotTask = app.startSnapshotTask.bind(app);
  app.startSnapshotTask = (task) => {
    void task.catch((error) => snapshotFailures.push({ name: error?.name, code: error?.code,
      message: String(error?.message ?? error).slice(0, 300) }));
    startSnapshotTask(task);
  };
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const login = await app.identity.login("owner", administratorPassword, "file-acceptance");
  const owner = login.user.id;
  const outsider = `user-other-${randomUUID()}`;
  app.store.createManagedUser({ id: outsider, account: "other", passwordDigest: "fixture-unused",
    role: "user", enabled: true, createdAt: now, updatedAt: now });
  const docker = new DockerRuntime(installationId);
  for (const [index, workId, ownerId] of [["a", workA, owner], ["b", workB, owner], ["other", workOther, outsider]]) {
    const volume = await docker.ensureManagedVolume(workId, "work-workspace");
    assert.equal(volume.created, true);
    volumes.push({ workId, name: volume.volumeName });
    await command("docker", ["run", "--rm", "--network", "none", "--mount",
      `type=volume,source=${volume.volumeName},target=/workspace`, "python:3.13-slim", "chown", "-R", "10001:10001", "/workspace"]);
    if (workId === workA) continue;
    app.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${workId}','${ownerId}','files-${index}','running','ready',1,1,'${now}','${now}');
      INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,created_at)
      VALUES ('volume-${index}','${installationId}','${workId}',NULL,'workspace','${volume.volumeName}','active',1,'${now}')`);
    app.store.ensureRuntimeGeneration(workId, 1, now);
    app.store.updateRuntimeGeneration(workId, 1, "ready", now, { instanceId: `instance-${workId}` });
    running.set(workId, true);
    generations.set(workId, 1);
  }
  const configuration = { agentImage: { catalogId: "image-files-acceptance" },
    skills: [], packages: [], agentsMd: "", modelRef: "model-files-acceptance", mcpServers: [],
    resources: { cpuMillis: 1000, memoryBytes: 1_073_741_824, agentCpuMillis: 500,
      agentMemoryBytes: 536_870_912, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: [], denied: [] } };
  const context = app.workContexts.build({ workId: workA, snapshotId: "context-files-acceptance",
    configuration, imageIdentity: agentImageId, skills: [], createdAt: now });
  const created = app.lifecycle.create({ userId: owner, role: "admin" }, { workId: workA,
    name: "files-a", configuration, idempotencyKey: "files-create-acceptance",
    runtimeProfileJson: JSON.stringify({ version: 1, revision: 1, agentImage: agentImageId,
      model: { provider: "anthropic", id: "fixture", credentialRef: "fixture-secret" }, updatedAt: now }),
    sourceRuntimeRevision: 1,
    snapshot: { snapshotId: context.snapshotId, configurationJson: JSON.stringify(context.configuration),
      imageIdentity: context.metadata.imageIdentity, createdByUserId: owner, createdAt: context.metadata.createdAt } });
  await app.lifecycle.waitForIdle();
  assert.equal(app.store.getOperation(created.operationId).state, "succeeded");
  const privateVolume = await docker.ensureManagedVolume(workA, "work-private");
  assert.equal(privateVolume.created, true);
  volumes.push({ workId: workA, name: privateVolume.volumeName, logicalId: "work-private" });
  const historySeed = join(root, "history-seed");
  await mkdir(historySeed);
  WorkStore.open(join(historySeed, "work.sqlite")).close();
  await command("docker", ["run", "--rm", "--network", "none",
    "--mount", `type=volume,source=${privateVolume.volumeName},target=/var/data`,
    "--mount", `type=bind,source=${historySeed},target=/seed,readonly`, "python:3.13-slim",
    "sh", "-c", "cp /seed/work.sqlite /var/data/work.sqlite && chown 10001:10001 /var/data/work.sqlite"]);
  serviceServer = createHttpServer((request, response) => {
    if (request.url === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      setTimeout(() => response.end("data: second\n\n"), 50);
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "set-cookie": "app=ok" });
    response.end(JSON.stringify({ path: request.url, authorization: request.headers.authorization,
      cookie: request.headers.cookie, platformToken: request.headers["x-piwork-gateway-token"] }));
  });
  serviceServer.on("upgrade", (_request, socket) => {
    serviceSockets.add(socket);
    socket.once("close", () => serviceSockets.delete(socket));
    socket.write("HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n");
    socket.on("data", (data) => socket.write(data));
  });
  await new Promise((done) => serviceServer.listen(0, "127.0.0.1", done));
  const servicePort = serviceServer.address().port;
  let serviceRunning = true;
  app.serviceRuntime = { async inspect() { return { exists: serviceRunning, running: serviceRunning }; },
    async routeTarget() { return serviceRunning ? { address: "127.0.0.1" } : undefined; },
    async stop() { serviceRunning = false; }, async remove() { serviceRunning = false; } };
  const serviceId = "service-files-acceptance";
  const serviceDefinition = JSON.stringify({ serviceId, revision: 1, name: "notes", enabled: true,
    required: false, cpuMillis: 100, memoryBytes: 134217728,
    ports: [{ name: "web", protocol: "tcp", containerPort: servicePort }],
    readiness: { kind: "http", portName: "web", path: "/" } });
  app.store.exec(`INSERT INTO service_heads VALUES ('${workB}','${serviceId}','notes',1,1,1,'ready',NULL,NULL);
    INSERT INTO service_revisions VALUES ('${workB}','${serviceId}',1,'${serviceDefinition}',NULL,'${now}');
    INSERT INTO quota_reservations VALUES ('${workB}','service','${serviceId}',0,0,0,0,1,0,'${now}')`);
  const serviceHostname = app.services.domainResolver.assignDefault(workB, serviceId, "notes", now);
  const credentialPath = join(root, "client.json");
  await new FileCredentialStore(credentialPath).save({ version: 1, coreUrl, token: login.token,
    expiresAt: login.expiresAt, user: login.user });
  const cli = async (...args) => JSON.parse(await command(process.execPath,
    [resolve("apps/cli/dist/main.js"), "--json", ...args],
    { cwd: root, env: { ...process.env, PIWORK_CONFIG_PATH: credentialPath, PIWORK_CORE_URL: coreUrl } }));
  const port = await freePort();
  proxy = await startProxy(credentialPath, coreUrl, port);
  const serviceBefore = await serviceHttp(port, serviceHostname, "/hello", {
    authorization: "Bearer application-token", cookie: "app=session" });
  assert.equal(serviceBefore.status, 200);
  assert.deepEqual(serviceBefore.headers["set-cookie"], ["app=ok"]);
  assert.deepEqual(JSON.parse(serviceBefore.body), { path: "/hello", authorization: "Bearer application-token",
    cookie: "app=session" });
  assert.equal((await serviceHttp(port, serviceHostname, "/events")).body, "data: first\n\ndata: second\n\n");
  assert.equal(await serviceWebSocket(port, serviceHostname), "service-echo");
  const pac = await fetch(`http://127.0.0.1:${port}/proxy.pac`);
  assert.equal(pac.status, 200);
  assert.match(await pac.text(), new RegExp(`PROXY 127.0.0.1:${port}`));
  assert.equal(Buffer.from(proxy.password, "base64url").length, 32);
  const obscured = await command(rcloneCommand, ["obscure", "-"], { input: `${proxy.password}\n` });
  const config = [workA, workB].map((workId, index) => `[work${index + 1}]\ntype = webdav\nurl = http://127.0.0.1:${port}/works/${workId}/files/\nvendor = other\nuser = piwork\npass = ${obscured}\n`).join("\n");
  await writeFile(join(root, "rclone.conf"), config, { mode: 0o600 });
  await chmod(join(root, "rclone.conf"), 0o600);
  const large = Buffer.alloc(16 * 1024 * 1024 + 37, 0x93);
  const largePath = join(root, "large.bin");
  await writeFile(largePath, large);
  await rclone("copyto", largePath, "work1:large.bin");
  await rclone("copyto", largePath, "work1:中文 空格%#.bin");
  await rclone("mkdir", "work1:empty");
  await rclone("copyto", largePath, "work1:.hidden");
  const listed = await rclone("lsf", "work1:");
  for (const name of ["large.bin", "中文 空格%#.bin", "empty/", ".hidden"])
    assert.ok(listed.includes(name), `rclone did not list ${name}`);
  assert.equal((await rclone("lsf", "work2:")).trim(), "");
  const downloaded = join(root, "downloaded.bin");
  await rclone("copyto", "work1:large.bin", downloaded);
  assert.equal(digest(await readFile(downloaded)), digest(large));
  await rclone("copyto", "work1:large.bin", "work1:copy.bin");
  await rclone("moveto", "work1:copy.bin", "work1:moved.bin");
  await rclone("deletefile", "work1:moved.bin");
  assert.ok(!(await rclone("lsf", "work1:")).includes("moved.bin"));
  const response = await fetch(`${coreUrl}/api/v1/works/${workOther}/files/`,
    { method: "PROPFIND", headers: { authorization: `Bearer ${login.token}`, depth: "0" } });
  assert.equal(response.status, 404);
  const volumeA = volumes.find((item) => item.workId === workA).name;
  const fromService = await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/workspace,readonly`, "python:3.13-slim",
    "python", "-c", "import hashlib; print(hashlib.sha256(open('/workspace/large.bin','rb').read()).hexdigest())"]);
  assert.equal(fromService, digest(large));
  await assert.rejects(command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/workspace,readonly`, "python:3.13-slim",
    "python", "-c", "open('/workspace/service-should-not-write','wb').write(b'x')"]));
  await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/var/data/workspace`, "--entrypoint", "node", agentImage,
    "-e", "require('node:fs').writeFileSync('/var/data/workspace/agent-created.txt','agent workspace bytes')"]);
  const agentFile = join(root, "agent-created.txt");
  await rclone("copyto", "work1:agent-created.txt", agentFile);
  assert.equal((await readFile(agentFile)).toString(), "agent workspace bytes");
  await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/workspace`, "python:3.13-slim",
    "python", "-c", "open('/workspace/service-created.txt','wb').write(b'service workspace bytes')"]);
  const serviceFile = join(root, "service-created.txt");
  await rclone("copyto", "work1:service-created.txt", serviceFile);
  assert.equal((await readFile(serviceFile)).toString(), "service workspace bytes");
  const basic = `Basic ${Buffer.from(`piwork:${proxy.password}`).toString("base64")}`;
  const held = httpRequest({ host: "127.0.0.1", port,
    path: `/works/${workA}/files/partial-new.bin`, method: "PUT",
    headers: { authorization: basic, "transfer-encoding": "chunked" } });
  held.on("error", () => undefined);
  held.write(Buffer.alloc(1024 * 1024, 0x7f));
  await waitUntil(() => app.store.files.listPendingJobs(workA).some((job) => job.kind === "PUT"));
  const competition = await fetch(`http://127.0.0.1:${port}/works/${workA}/files/second.bin`,
    { method: "PUT", headers: { authorization: basic }, body: "second" });
  assert.equal(competition.status, 429);
  held.destroy();
  await waitUntil(() => !app.store.files.hasPending(workA), 20_000);
  assert.ok(!(await rclone("lsf", "work1:")).includes("partial-new.bin"));
  await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/var/data/workspace`, "--entrypoint", "node", agentImage,
    "-e", "require('node:fs').symlinkSync('/etc/passwd','/var/data/workspace/outside-link')"]);
  const link = await fetch(`http://127.0.0.1:${port}/works/${workA}/files/outside-link`,
    { headers: { authorization: basic } });
  assert.equal(link.status, 409);
  const linkState = async () => command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/var/data/workspace,readonly`, "--entrypoint", "node", agentImage,
    "-e", "const f=require('node:fs'),p='/var/data/workspace/outside-link',s=f.lstatSync(p);process.stdout.write(JSON.stringify({target:f.readlinkSync(p),size:s.size,mtimeMs:s.mtimeMs}))"]);
  const beforePatch = await linkState();
  const patchedLink = await fetch(`${coreUrl}/api/v1/works/${workA}/files/outside-link`,
    { method: "PROPPATCH", headers: { authorization: `Bearer ${login.token}`, "content-type": "application/xml" },
      body: '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:getlastmodified>changed</d:getlastmodified></d:prop></d:set></d:propertyupdate>' });
  assert.equal(patchedLink.status, 207);
  assert.match(await patchedLink.text(), /HTTP\/1\.1 403 Forbidden/);
  assert.equal(await linkState(), beforePatch, "PROPPATCH changed the symlink itself");
  await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/var/data/workspace`, "--entrypoint", "node", agentImage,
    "-e", "const f=require('node:fs'),r='/var/data/workspace';f.mkdirSync(r+'/race-parent');f.mkdirSync(r+'/outside-parent');f.writeFileSync(r+'/outside-parent/sentinel','unchanged')"]);
  const racer = command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/var/data/workspace`, "--entrypoint", "node", agentImage,
    "-e", "const f=require('node:fs'),r='/var/data/workspace',end=Date.now()+5000;while(Date.now()<end){try{f.renameSync(r+'/race-parent',r+'/race-old')}catch{};try{f.symlinkSync('outside-parent',r+'/race-parent')}catch{};try{f.unlinkSync(r+'/race-parent')}catch{};try{f.renameSync(r+'/race-old',r+'/race-parent')}catch{}}"]);
  await new Promise((done) => setTimeout(done, 300));
  for (let i = 0; i < 12; i++) {
    const response = await fetch(`http://127.0.0.1:${port}/works/${workA}/files/race-parent/race.txt`,
      { method: "PUT", headers: { authorization: basic }, body: `race-${i}` });
    assert.ok([201, 204, 404, 409].includes(response.status), `unsafe race status ${response.status}`);
  }
  await racer;
  const raceResult = await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/var/data/workspace,readonly`, "--entrypoint", "node", agentImage,
    "-e", "const f=require('node:fs'),r='/var/data/workspace/outside-parent';process.stdout.write(String(f.existsSync(r+'/race.txt'))+' '+f.readFileSync(r+'/sentinel','utf8'))"]);
  assert.equal(raceResult, "false unchanged", "parent symlink race wrote outside its authorized path");
  await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/var/data/workspace`, "--entrypoint", "node", agentImage,
    "-e", "const f=require('node:fs'),r='/var/data/workspace';f.unlinkSync(r+'/outside-link');if(f.existsSync(r+'/race-parent')&&f.lstatSync(r+'/race-parent').isSymbolicLink())f.unlinkSync(r+'/race-parent');if(f.existsSync(r+'/race-old'))f.renameSync(r+'/race-old',r+'/race-parent')"]);
  const stoppingUpload = httpRequest({ host: "127.0.0.1", port,
    path: `/works/${workA}/files/large.bin`, method: "PUT",
    headers: { authorization: basic, "transfer-encoding": "chunked" } });
  stoppingUpload.on("error", () => undefined);
  stoppingUpload.write(Buffer.alloc(1024 * 1024, 0x42));
  await waitUntil(() => app.store.files.listPendingJobs(workA).some((job) => job.kind === "PUT"));
  const stopped = app.lifecycle.stop({ userId: owner, role: "admin" }, workA, "files-stop-acceptance");
  await app.lifecycle.waitForIdle();
  stoppingUpload.destroy();
  if (app.store.getOperation(stopped.operationId).state === "failed") {
    assert.notEqual(app.store.getWork(workA).observedState, "stopped", "uncertain Docker creation cannot produce false stopped");
    await waitUntil(() => app.store.files.listPendingJobs(workA).every((job) =>
      app.store.files.listAttempts(job.id).every((attempt) => attempt.state !== "creating")), 20_000);
    let retryOperation;
    for (let retry = 0; retry < 3; retry++) {
      await app.fileRecovery.recoverWork(workA, true);
      const retried = app.lifecycle.stop({ userId: owner, role: "admin" }, workA, `files-stop-retry-${retry}`);
      await app.lifecycle.waitForIdle();
      retryOperation = app.store.getOperation(retried.operationId);
      if (retryOperation.state === "succeeded") break;
    }
    assert.equal(retryOperation.state, "succeeded", JSON.stringify({
      operation: retryOperation,
      jobs: app.store.files.listPendingJobs(workA).map((job) => ({ state: job.state, error: job.errorCode,
        attempts: app.store.files.listAttempts(job.id).map((attempt) => attempt.state),
        temporaries: app.store.files.listTemporaries(job.id).map((temp) => temp.state) })) }));
  }
  assert.equal(app.store.getWork(workA).observedState, "stopped");
  assert.equal(app.store.files.hasPending(workA), false);
  const stoppedResponse = await fetch(`http://127.0.0.1:${port}/works/${workA}/files/large.bin`,
    { headers: { authorization: basic } });
  assert.equal(stoppedResponse.status, 409);
  const afterStop = await command("docker", ["run", "--rm", "--network", "none", "--user", "10001:10001",
    "--mount", `type=volume,source=${volumeA},target=/workspace,readonly`, "python:3.13-slim",
    "python", "-c", "import hashlib; print(hashlib.sha256(open('/workspace/large.bin','rb').read()).hexdigest())"]);
  assert.equal(afterStop, digest(large));
  const startedAgain = app.lifecycle.start({ userId: owner, role: "admin" }, workA, "files-start-again-acceptance");
  await app.lifecycle.waitForIdle();
  assert.equal(app.store.getOperation(startedAgain.operationId).state, "succeeded");
  assert.equal(app.store.getWork(workA).observedState, "ready");
  const afterRestartPath = join(root, "after-restart.bin");
  await rclone("copyto", "work1:large.bin", afterRestartPath);
  assert.equal(digest(await readFile(afterRestartPath)), digest(large));
  const exportStop = app.lifecycle.stop({ userId: owner, role: "admin" }, workA, "files-export-stop");
  await app.lifecycle.waitForIdle();
  assert.equal(app.store.getOperation(exportStop.operationId).state, "succeeded");
  const packagePath = join(root, "source.work");
  let exported;
  try { exported = await cli("work", "export", workA, "--output", packagePath); }
  catch (error) {
    const jobs = app.store.snapshots.listJobs().filter((job) => job.sourceWorkId === workA);
    throw new Error(`${error.message}; snapshot=${JSON.stringify(jobs.map((job) => ({ phase: job.phase,
      cleanupError: job.cleanupError, operation: app.store.getOperation(job.operationId)?.errorJson })))}; cause=${JSON.stringify(snapshotFailures)}`);
  }
  assert.equal(exported.workId, workA);
  assert.equal(exported.digest, digest(await readFile(packagePath)));
  const portable = await readWorkPackage(createReadStream(packagePath));
  assert.equal(portable.digest, exported.digest);
  assert.ok(!JSON.stringify(portable.spec).includes(helperImage), "file helper configuration leaked into .work");
  assert.ok(!JSON.stringify(portable.spec).includes("work_file_jobs"), "file journal leaked into .work");
  const imported = await cli("work", "import", packagePath, "--wait");
  const importedId = imported.workId ?? imported.result?.workId;
  assert.ok(typeof importedId === "string" && importedId !== workA, JSON.stringify(imported));
  volumes.push({ workId: importedId, logicalId: "work-workspace" }, { workId: importedId, logicalId: "work-private" });
  assert.equal(app.store.getWork(importedId).observedState, "stopped");
  assert.equal(app.store.getWork(workA).observedState, "stopped");
  assert.equal((await fetch(`http://127.0.0.1:${port}/works/${importedId}/files/large.bin`,
    { headers: { authorization: basic } })).status, 409);
  const importStart = app.lifecycle.start({ userId: owner, role: "admin" }, importedId, "files-import-start");
  await app.lifecycle.waitForIdle();
  assert.equal(app.store.getOperation(importStart.operationId).state, "succeeded");
  const importedConfig = [workA, workB, importedId].map((workId, index) =>
    `[work${index + 1}]\ntype = webdav\nurl = http://127.0.0.1:${port}/works/${workId}/files/\nvendor = other\nuser = piwork\npass = ${obscured}\n`).join("\n");
  await writeFile(join(root, "rclone.conf"), importedConfig, { mode: 0o600 });
  const importedPath = join(root, "imported-large.bin");
  await rclone("copyto", "work3:large.bin", importedPath);
  assert.equal(digest(await readFile(importedPath)), digest(large));
  assert.equal(JSON.parse((await serviceHttp(port, serviceHostname, "/after-import", {
    authorization: "Bearer application-token", cookie: "app=session" })).body).path, "/after-import");
  assert.equal(await serviceWebSocket(port, serviceHostname), "service-echo");
  await app.services.shutdown();
  const revocable = await app.identity.login("owner", administratorPassword, "file-revocation");
  const directCore = new URL(coreUrl);
  const revokedUpload = httpRequest({ hostname: directCore.hostname, port: Number(directCore.port),
    path: `/api/v1/works/${workB}/files/revoked-partial.bin`, method: "PUT",
    headers: { authorization: `Bearer ${revocable.token}`, "transfer-encoding": "chunked" } });
  revokedUpload.on("error", () => undefined);
  revokedUpload.write(Buffer.alloc(1024 * 1024, 0x57));
  await waitUntil(() => app.store.files.listPendingJobs(workB).some((job) => job.kind === "PUT"));
  app.identity.logout(revocable.token);
  await waitUntil(() => !app.store.files.hasPending(workB), 20_000);
  revokedUpload.destroy();
  assert.ok(!(await rclone("lsf", "work2:")).includes("revoked-partial.bin"));
  const shutdownUpload = httpRequest({ host: "127.0.0.1", port,
    path: `/works/${workB}/files/shutdown-partial.bin`, method: "PUT",
    headers: { authorization: basic, "transfer-encoding": "chunked" } });
  shutdownUpload.on("error", () => undefined);
  shutdownUpload.write(Buffer.alloc(1024 * 1024, 0x45));
  await waitUntil(() => app.store.files.listPendingJobs(workB).some((job) => job.kind === "PUT"));
  const shutdownStarted = Date.now();
  await app.close();
  shutdownUpload.destroy();
  assert.ok(Date.now() - shutdownStarted < 45_000, "Core shutdown exceeded the existing 45s budget");
  const helpers = await command("docker", ["container", "ls", "-aq", "--filter", `label=piwork.installation_id=${installationId}`,
    "--filter", "label=piwork.resource_kind=file-helper"]);
  assert.equal(helpers, "", "file helper remains after graceful shutdown");
  console.log(`work-files acceptance passed: Docker, ${rcloneVersion}, two owned Works, owner isolation, 16 MiB SHA-256, shared workspace`);
} finally {
  const cleanupFailures = [];
  if (proxy) {
    proxy.child.kill("SIGINT");
    await new Promise((done) => proxy.child.once("close", done)).catch((error) => cleanupFailures.push(error));
  }
  if (app) await app.close().catch((error) => cleanupFailures.push(error));
  for (const socket of serviceSockets) socket.destroy();
  if (serviceServer) await new Promise((done) => serviceServer.close(done)).catch((error) => cleanupFailures.push(error));
  for (const item of volumes.reverse()) {
    try {
      const docker = new DockerRuntime(ensureInstallationId(app.paths));
      await docker.deleteManagedVolume(item.workId, item.logicalId ?? "work-workspace");
    } catch (error) { cleanupFailures.push(error); }
  }
  await rm(root, { recursive: true, force: true }).catch((error) => cleanupFailures.push(error));
  if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, "work-files acceptance cleanup failed");
}
