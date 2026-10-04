import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
const nativeCli = process.env.PIWORK_TEST_NATIVE_CLI || fileURLToPath(new URL("../../../../dist/go/piwork-cli", import.meta.url));
const workPackagePath = fileURLToPath(new URL("../../../../internal/workpackage/testdata/golden-native-pi-package.work", import.meta.url));
const WORK_PACKAGE_MIME = "application/vnd.piwork.work-package";
const FILE_ACCESS_PROFILE = "workspace-transfer-v1";
const FILE_ROOT_TEMPLATE = "/api/v1/works/{workId}/files/";
const FILE_LIMITS = {
  maxHeaderBytes: 32768, maxXmlBytes: 65536, maxXmlDepth: 32, maxProperties: 128,
  maxMetadataBytes: 16777216, maxDirectoryEntries: 10000, maxTreeEntries: 10000,
  maxFileBytes: 10737418240, maxTreeBytes: 10737418240, maxSegmentBytes: 255,
  maxPathBytes: 4096, maxPathDepth: 128, maxCoreRequests: 16, maxUserRequests: 8,
  maxWorkRequests: 4, maxWorkMutations: 1, connectTimeoutMs: 10000,
  helperTimeoutMs: 10000, idleTimeoutMs: 60000, requestTimeoutMs: 1800000,
  authorizationRecheckMs: 2000,
};
function spawnClient(args: string[], env: NodeJS.ProcessEnv) {
  return spawn(nativeCli, args, { env });
}
async function saveTestCredential(path: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}
const browserLaunchOptions = process.env.PIWORK_TEST_BROWSER_BIN
  ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN }
  : { headless: true, channel: "chromium" as const };

test("browser signs in and out without exposing Core bearer to page storage", async () => {
  const workPackage = await readFile(workPackagePath);
  const workPackageDigest = createHash("sha256").update(workPackage).digest("hex");
  let slowLoginStarted!: () => void;
  const slowLogin = new Promise<void>((done) => { slowLoginStarted = done; });
  const createPayloads: Record<string, unknown>[] = [];
  let missingOperationReads = 0;
  let flakyOperationReads = 0;
  let expiredSession = false;
  let importRequests = 0;
  const corePaths: string[] = [];
  const core = createServer(async (request, response) => {
    corePaths.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    if (request.url === "/healthz") return response.end(JSON.stringify({status:"healthy"}));
    if (request.url === "/readyz") return response.end(JSON.stringify({ready:true}));
    if (request.url === "/healthz") response.end(JSON.stringify({ status: "ok" }));
    else if (request.url === "/readyz") { response.writeHead(503); response.end(JSON.stringify({ code: "RUNTIME_UNAVAILABLE" })); }
    else if (request.url === "/api/v1/service-access") response.end(JSON.stringify({ version: 1, protocols: ["http", "ws"] }));
    else if (request.url === "/api/v1/file-access") response.end(JSON.stringify({ version: 1, protocol: "webdav",
      profile: FILE_ACCESS_PROFILE, rootTemplate: FILE_ROOT_TEMPLATE, limits: FILE_LIMITS, available: false, reason: "File helper unavailable" }));
    else if (request.url === "/api/v1/login") {
      expiredSession = false;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const input = JSON.parse(Buffer.concat(chunks).toString()) as { account?: string };
      if (input.account === "slow") { slowLoginStarted(); await new Promise((done) => setTimeout(done, 500)); }
      response.end(JSON.stringify({ token: "browser-private-core-token", expiresAt: "2099-01-01T00:00:00.000Z",
        user: { id: "browser-user", account: "owner", role: "user" } }));
    } else if (request.url === "/api/v1/me") {
      if (expiredSession || request.headers.authorization !== "Bearer browser-private-core-token") { response.writeHead(401); response.end("{}"); }
      else response.end(JSON.stringify({ id: "browser-user", account: "owner", role: "user", expiresAt: "2099-01-01T00:00:00.000Z" }));
    } else if (request.url === "/api/v1/works" && request.method === "GET")
      response.end(JSON.stringify({ works: [] }));
    else if (request.url === "/api/v1/works" && request.method === "POST") {
      const pieces: Buffer[] = []; for await (const piece of request) pieces.push(piece as Buffer);
      createPayloads.push(JSON.parse(Buffer.concat(pieces).toString()) as Record<string, unknown>);
      const name = createPayloads.at(-1)?.name;
      response.writeHead(202); response.end(JSON.stringify({ workId: "work-browser-create-1234",
        ...(name === "No ID Work" ? {} : { operationId: name === "Missing Operation" ? "operation-browser-missing-1234"
          : name === "Superseded Work" ? "operation-browser-superseded-1234"
            : name === "Flaky Work" ? "operation-browser-flaky-1234" : "operation-browser-create-1234" }) }));
    } else if (request.url === "/api/v1/work-packages" && request.method === "POST") {
      const pieces: Buffer[] = []; for await (const piece of request) pieces.push(piece as Buffer);
      assert.equal(request.headers["content-type"], WORK_PACKAGE_MIME);
      assert.deepEqual(Buffer.concat(pieces), workPackage);
      response.writeHead(201); response.end(JSON.stringify({ packageId: "package-browser-1234", digest: workPackageDigest,
        size: workPackage.length, expiresAt: "2099-01-01T00:00:00.000Z", bindingRequirements: { models: [], secrets: [] } }));
    } else if (request.url === "/api/v1/work-imports" && request.method === "POST") {
      importRequests++;
      const pieces: Buffer[] = []; for await (const piece of request) pieces.push(piece as Buffer);
      const input = JSON.parse(Buffer.concat(pieces).toString()) as { name?: string };
      if (input.name === "taken") { response.writeHead(409); response.end(JSON.stringify({ code: "WORK_NAME_CONFLICT", message: "That Work name is already in use" })); }
      else if (input.name === "denied") { response.writeHead(403); response.end(JSON.stringify({ code: "PERMISSION_DENIED", message: "Import permission denied" })); }
      else if (input.name === "requires-model") { response.writeHead(422); response.end(JSON.stringify({ code: "MODEL_BINDING_REQUIRED", message: "Model binding is required" })); }
      else {
        if (input.name === "expires-after-acceptance") expiredSession = true;
        response.writeHead(202); response.end(JSON.stringify({ workId: "work-import-browser-1234", name: input.name ?? "golden",
        operationId: input.name === "expires-after-acceptance" ? "operation-expiring-import-1234" : "operation-import-browser-1234", correlationId: "correlation-import-browser-1234", reused: false })); }
    } else if (request.url === "/api/v1/operations/operation-expiring-import-1234")
      response.end(JSON.stringify({ operationId: "operation-expiring-import-1234", state: "succeeded", error: null }));
    else if (request.url === "/api/v1/operations/operation-import-browser-1234")
      response.end(JSON.stringify({ operationId: "operation-import-browser-1234", state: "succeeded", error: null }));
    else if (request.url === "/api/v1/works/work-import-browser-1234")
      response.end(JSON.stringify({ id: "work-import-browser-1234", name: "chosen", desiredState: "stopped", observedState: "stopped" }));
    else if (request.url === "/api/v1/works/work-import-browser-1234/start" && request.method === "POST") {
      response.writeHead(202); response.end(JSON.stringify({ workId: "work-import-browser-1234", operationId: "operation-import-start-browser-1234" }));
    } else if (request.url === "/api/v1/operations/operation-browser-create-1234")
      response.end(JSON.stringify({ operationId: "operation-browser-create-1234", state: "pending", error: null }));
    else if (request.url === "/api/v1/operations/operation-browser-missing-1234") {
      missingOperationReads++;
      response.writeHead(404); response.end(JSON.stringify({ code: "OPERATION_NOT_FOUND" }));
    }
    else if (request.url === "/api/v1/operations/operation-browser-superseded-1234")
      response.end(JSON.stringify({ operationId: "operation-browser-superseded-1234", state: "superseded", error: null }));
    else if (request.url === "/api/v1/operations/operation-browser-flaky-1234") {
      flakyOperationReads++;
      if (flakyOperationReads === 1) { response.writeHead(503); response.end(JSON.stringify({ code: "CORE_UNAVAILABLE" })); }
      else response.end(JSON.stringify({ operationId: "operation-browser-flaky-1234", state: "succeeded", error: null }));
    }
    else if (request.url === "/api/v1/logout") response.end("{}");
    else { response.writeHead(404); response.end("{}"); }
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const otherCore = createServer((_request, response) => { response.writeHead(404); response.end("{}"); });
  await new Promise<void>((done) => otherCore.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const otherAddress = otherCore.address(); assert(otherAddress && typeof otherAddress !== "string");
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-browser-"));
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const localAddress = listener.address(); assert(localAddress && typeof localAddress !== "string");
  const port = localAddress.port;
  await new Promise<void>((done) => listener.close(() => done()));
  const child = spawnClient(["--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { ...process.env, PIWORK_CONFIG_PATH: join(directory, "client.json") });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const launchUrl = await new Promise<string>((done, fail) => {
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.stdout.on("data", (chunk: Buffer) => {
        const url = chunk.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
        if (url) done(url[0]);
      });
      child.once("exit", (code) => fail(new Error(`Desktop exited ${code}: ${stderr}`)));
      setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
    });
    browser = await chromium.launch(browserLaunchOptions);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(launchUrl);
    await page.getByRole('heading', {name:'Connect to your Core'}).waitFor();
    await page.getByLabel('Account', {exact:true}).fill('owner');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', {name:'Sign in',exact:true}).click();
    await page.getByRole('heading', {name:'Works',exact:true}).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /browser-private-core-token/);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    const create = async (name: string) => { await page.getByRole('button', {name:'New Work',exact:true}).first().click(); await page.locator('#create-name').fill(name); await page.getByRole('button',{name:'Create Work',exact:true}).click(); };
    await create('Default Work');
    await page.getByRole('heading',{name:'Create Work',exact:true}).waitFor();
    assert.equal(createPayloads[0]?.name, 'Default Work'); assert.equal('skills' in createPayloads[0]!, false); assert.equal('packages' in createPayloads[0]!, false);
    await page.getByRole('button',{name:'Pause checking',exact:true}).click();
    const before = corePaths.filter(path => path === '/api/v1/operations/operation-browser-create-1234').length;
    await page.waitForTimeout(2300);
    assert.equal(corePaths.filter(path => path === '/api/v1/operations/operation-browser-create-1234').length, before);
    await page.getByRole('button',{name:'Close dialog'}).click();
    await create('Missing Operation');
    await expect(page.locator('#modal')).toContainText('Observation interrupted. OPERATION_NOT_FOUND');
    await page.waitForTimeout(2400); assert.equal(missingOperationReads, 1, '404 operation was automatically polled again');
    await page.getByRole('button',{name:'Close dialog'}).click();
    await create('No ID Work');
    await page.getByText('The acceptance response has no Operation ID. Check known operations.',{exact:true}).waitFor();
    assert.equal(createPayloads.filter(p => p.name === 'No ID Work').length, 1);
    await page.getByRole('button',{name:'Close dialog'}).click();
    await create('Superseded Work');
    await page.getByText('superseded',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Pause checking',exact:true}).count(), 0);
    await page.getByRole('button',{name:'Close dialog'}).click();
    await page.getByRole('button',{name:'Import Work',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Import Work',exact:true})).toBeVisible();
    await page.locator('#work-file-input').setInputFiles(workPackagePath);
    await page.getByText('Package format and contents verified locally.',{exact:true}).waitFor().catch(async error => { throw new Error(`${error}\nLocal inspection view: ${await page.locator('#modal').innerText()}`); });
    assert.equal(importRequests, 0, 'inspection submitted import without consent');
    await page.getByRole('button',{name:'Close dialog'}).click();
    await page.locator('[data-action=account]').click();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('heading',{name:'Connect to your Core'}).waitFor();
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  } finally {
    await browser?.close();
    if (child.exitCode === null) { const exited = new Promise<void>((done) => child.once("exit", () => done())); child.kill("SIGINT"); await exited; }
    await new Promise<void>((done) => core.close(() => done()));
    await new Promise<void>((done) => otherCore.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser Work lifecycle keeps stopped failures out of Retry and preserves Delete Operation", async () => {
  const workId = "work-lifecycle-12345678";
  const workPackage = await readFile(workPackagePath);
  const workPackageDigest = createHash("sha256").update(workPackage).digest("hex");
  const work = { id: workId, name: "Lifecycle Work", desiredState: "stopped", observedState: "stopped" };
  const longWork = { id: "work-long-name-12345678", name: "A very long Work name that should wrap cleanly across lines without hiding its current state or actions in a narrow browser window", desiredState: "running", observedState: "ready" };
  let deleted = false;
  let showLong = false;
  const submitted: string[] = [];
  let exportCalls = 0;
  let snapshotDownloads = 0;
  const core = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/healthz") return response.end(JSON.stringify({status:"healthy"}));
    if (request.url === "/readyz") return response.end(JSON.stringify({ready:true}));
    if (request.url === "/api/v1/me") return response.end(JSON.stringify({ id: "owner", account: "owner", role: "user" }));
    if (request.url === "/api/v1/works") return response.end(JSON.stringify({ works: deleted ? showLong ? [longWork] : [] : [work] }));
    if (request.url === `/api/v1/works/${workId}`) return response.end(JSON.stringify(work));
    if (request.url === `/api/v1/works/${workId}/exports` && request.method === "POST") {
      exportCalls++;
      if (exportCalls === 1) { response.writeHead(409); return response.end(JSON.stringify({ code: "WORK_BUSY", message: "Snapshot lock is held by a writer" })); }
      response.writeHead(202); return response.end(JSON.stringify({ workId, operationId: "operation-export-browser-1234", snapshotId: "snapshot-export-browser-1234" }));
    }
    if (request.url === "/api/v1/operations/operation-export-browser-1234")
      return response.end(JSON.stringify({ operationId: "operation-export-browser-1234", state: "succeeded", error: null }));
    if (request.url === "/api/v1/work-snapshots/snapshot-export-browser-1234")
      return response.end(JSON.stringify({ workId, snapshotId: "snapshot-export-browser-1234", operationId: "operation-export-browser-1234",
        state: "succeeded", digest: workPackageDigest, size: workPackage.length, expiresAt: "2099-01-01T00:00:00Z", error: null }));
    if (request.url === "/api/v1/work-snapshots/snapshot-export-browser-1234/content") {
      snapshotDownloads++;
      response.writeHead(200, { "content-type": WORK_PACKAGE_MIME, "content-length": workPackage.length, "x-piwork-sha256": workPackageDigest });
      return response.end(workPackage);
    }
    if (request.url === "/api/v1/work-snapshots/expired-snapshot-1234") {
      response.writeHead(410); return response.end(JSON.stringify({ code: "SNAPSHOT_EXPIRED", message: "Snapshot expired" }));
    }
    if (request.url === "/api/v1/work-snapshots/bad-snapshot-1234")
      return response.end(JSON.stringify({ workId, snapshotId: "bad-snapshot-1234", operationId: "operation-export-browser-1234",
        state: "succeeded", digest: workPackageDigest, size: workPackage.length, expiresAt: "2099-01-01T00:00:00Z", error: null }));
    if (request.url === "/api/v1/work-snapshots/bad-snapshot-1234/content") {
      const bad = Buffer.from(workPackage); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
      response.writeHead(200, { "content-type": WORK_PACKAGE_MIME, "content-length": bad.length, "x-piwork-sha256": workPackageDigest });
      return response.end(bad);
    }
    if (request.url === "/api/v1/work-snapshots/full-snapshot-1234")
      return response.end(JSON.stringify({ workId, snapshotId: "full-snapshot-1234", operationId: "operation-export-browser-1234",
        state: "succeeded", digest: workPackageDigest, size: 6 * 1024 ** 3, expiresAt: "2099-01-01T00:00:00Z", error: null }));
    if (request.url === `/api/v1/works/${workId}/start` && request.method === "POST") {
      submitted.push("start"); work.desiredState = "running"; work.observedState = "starting";
      response.writeHead(202); return response.end(JSON.stringify({ workId, operationId: "start-superseded-1234" }));
    }
    if (request.url === `/api/v1/works/${workId}/stop` && request.method === "POST") {
      submitted.push("stop"); work.desiredState = "stopped"; work.observedState = "failed";
      response.writeHead(202); return response.end(JSON.stringify({ workId, operationId: "stop-failed-1234" }));
    }
    if (request.url === `/api/v1/works/${workId}/delete` && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      assert.equal("purgeData" in (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>), false);
      submitted.push("delete"); deleted = true;
      response.writeHead(202); return response.end(JSON.stringify({ workId, operationId: "delete-succeeded-1234" }));
    }
    if (request.url === "/api/v1/operations/stop-failed-1234")
      return response.end(JSON.stringify({ operationId: "stop-failed-1234", state: "failed", error: { message: "Stop failed" } }));
    if (request.url === "/api/v1/operations/start-superseded-1234")
      return response.end(JSON.stringify({ operationId: "start-superseded-1234", state: submitted.includes("stop") ? "superseded" : "pending", error: null }));
    if (request.url === "/api/v1/operations/delete-succeeded-1234")
      return response.end(JSON.stringify({ operationId: "delete-succeeded-1234", state: "succeeded", error: null }));
    if (request.method === "POST" && request.url?.startsWith(`/api/v1/works/${workId}/`)) submitted.push(request.url.slice(request.url.lastIndexOf("/") + 1));
    response.writeHead(404); response.end("{}");
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-lifecycle-"));
  await saveTestCredential(join(directory, "client.json"), { version: 1, coreUrl, token: "lifecycle-token",
    expiresAt: "2099-01-01T00:00:00Z", user: { id: "owner", account: "owner", role: "user" } });
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const local = listener.address(); assert(local && typeof local !== "string");
  const port = local.port;
  await new Promise<void>((done) => listener.close(() => done()));
  const child = spawnClient(["--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { ...process.env, PIWORK_CONFIG_PATH: join(directory, "client.json") });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const launchUrl = await new Promise<string>((done, fail) => {
      child.stdout.on("data", (chunk: Buffer) => { const match = chunk.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
        if (match) done(match[0]); });
      child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
      setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
    });
    browser = await chromium.launch(browserLaunchOptions);
    const page = await browser.newPage();
    await page.goto(launchUrl);
    await page.getByRole('heading',{name:'Works',exact:true}).waitFor();
    await page.locator('[data-action=open-work]').filter({hasText:'Lifecycle Work'}).click();
    await page.getByRole('heading', {name: 'Lifecycle Work', exact: true}).waitFor();
    await page.getByRole('button',{name:'Start Work',exact:true}).first().click();
    await page.getByText('pending',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Close dialog'}).click();
    await page.getByRole('button',{name:'Work options'}).click();
    await page.getByRole('button',{name:'Export Work',exact:true}).last().click();
    assert.equal(exportCalls, 0, 'running Work export submitted implicitly');
    await page.getByRole('button',{name:'Stop Work first',exact:true}).click();
    await page.getByRole('button',{name:'Stop Work',exact:true}).last().click();
    await page.getByText('failed',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Close dialog'}).click();
    assert.equal(await page.getByRole('button',{name:'Retry Work',exact:true}).count(), 0, 'failed Stop offered a Start retry');
    assert.deepEqual(submitted, ['start','stop']);
    await page.getByRole('button',{name:'Work options'}).click();
    await page.getByRole('button',{name:'Delete Work',exact:true}).click();
    await page.locator('#delete-confirm').check();
    await page.getByRole('button',{name:'Delete Work',exact:true}).last().click();
    await page.getByText('succeeded',{exact:true}).waitFor();
    assert.deepEqual(submitted, ['start','stop','delete']);
    await page.getByRole('button',{name:'Close dialog'}).click();
    await page.getByRole('button',{name:'Known operations',exact:true}).click();
    await page.getByText('delete-succeeded-1234',{exact:false}).first().waitFor();
    assert.equal(exportCalls, 0);
  } finally {
    await browser?.close();
    if (child.exitCode === null) { const exited = new Promise<void>((done) => child.once("exit", () => done())); child.kill("SIGINT"); await exited; }
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser opens a running Work Service in an iframe and a separate local tab", async () => {
  const workId = "work-12345678-1234-1234-1234-123456789012";
  const hostname = "notes.w-a1b2c3d4.work";
  const serviceId = "notes";
  const serviceRecord = "service-record-42";
  const boardHostname = "boards.w-a1b2c3d4.work";
  const blockedHostname = "blocked.w-a1b2c3d4.work";
  const upstream: string[] = [];
  let appLoginRequests = 0;
  let appRootLoads = 0;
  const service = { workId, serviceId, name: "Notes", enabled: true, observedState: "ready", desiredRevision: 1,
    appliedRevision: 1, lastError: null, endpoints: [], createdAt: "2026-01-01T00:00:00Z",
    access: { hostname, defaultUrl: `http://${hostname}/`, defaultPortName: "web", status: "available",
      ports: [{ name: "alternate", port: 8080, url: `http://${hostname}:8080/` },
        { name: "web", port: 80, url: `http://${hostname}:80/` }] } };
  const board = { ...service, serviceId: "boards", name: "Boards", access: { hostname: boardHostname,
    defaultUrl: `http://${boardHostname}/`, defaultPortName: "web", status: "available",
    ports: [{ name: "web", port: 80, url: `http://${boardHostname}/` }] } };
  const blocked = { ...service, serviceId: "blocked", name: "Blocked", access: { hostname: blockedHostname,
    defaultUrl: `http://${blockedHostname}/`, defaultPortName: "web", status: "available",
    ports: [{ name: "web", port: 80, url: `http://${blockedHostname}/` }] } };
  const worker = { ...service, serviceId: "worker", name: "Worker", enabled: false, observedState: "failed",
    access: { hostname: "worker.w-a1b2c3d4.work", defaultUrl: null, defaultPortName: null,
      status: "no-default-port", ports: [] as { name: string; port: number; url: string }[] } };
  const work = { id: workId, name: "笔记工作", desiredState: "running", observedState: "ready",
    updatedAt: "2026-01-01T00:00:00Z" };
  let workspaceText = "\ufeffhello\r\n";
  let rejectNextNoteSave = false;
  let disconnectNextNoteSave = false;
  let notePutCalls = 0;
  const actionFiles = new Map<string, string>([["ops.txt", "ops"], ["partial.txt", "partial"]]);
  let folderCreated = false;
  let copyMutations = 0;
  let uploadedPackage = false;
  let installedUploadId = "";
  const packageSources: Record<string, unknown>[] = [];
  const packageActions: string[] = [];
  let packageRemoved = false;
  const installedPackage = { name: "@example/tools", desired: { version: "1.0.0", enabled: true },
    active: { version: "0.9.0", enabled: true }, runtime: { availability: "available", loaded: true }, pendingApply: true };
  const desiredConfiguration: Record<string, unknown> = { agentImage: { catalogId: "runtime-image-00000001" },
    modelRef: "runtime-model-00000001", skills: [], packages: [], agentsMd: "Saved instructions",
    mcpServers: [], resources: { memoryBytes: 1_073_741_824, cpuShares: 1024 }, tools: { allowed: [], denied: [] } };
  let activeConfiguration: Record<string, unknown> = { ...desiredConfiguration, agentsMd: "Active instructions" };
  let settingsPendingApply = false;
  const settingsWrites: { path: string; body: Record<string, unknown> }[] = [];
  let applyAttempts = 0;
  let releaseFailedApply!: () => void;
  const failedApplyReleased = new Promise<void>((done) => { releaseFailedApply = done; });
  let runSubmissions = 0;
  let runEventReads = 0;
  let runStateReads = 0;
  let runCancelRequests = 0;
  let finalRunResolved = false;
  let releaseFinalRun!: () => void;
  const finalRunReleased = new Promise<void>((done) => { releaseFinalRun = () => { finalRunResolved = true; done(); }; });
  let sessionFetches = 0;
  let sessionCreates = 0;
  let submittedPrompt = "";
  let runAnswer = "";
  const sessions = [{ sessionId: "session-12345678", title: "Analyze notes" }];
  let servicesAvailable = true;
  let workerRemoved = false;
  const workerActions: string[] = [];
  const boardActions: string[] = [];
  const upgradedSockets = new Set<import("node:stream").Duplex>();
  const coreRoot = `/api/v1/works/${workId}/files/`;
  let coreSessionRevoked = false;
  const core = createServer(async (request, response) => {
    if (request.url === "/healthz") return response.end(JSON.stringify({status:"healthy"}));
    if (request.url === "/readyz") return response.end(JSON.stringify({ready:true}));
    if (request.url === "/api/v1/me") {
      const secondUser = request.headers.authorization === "Bearer second-user-secret";
      if (coreSessionRevoked && !secondUser) { response.writeHead(401); return response.end(JSON.stringify({ code: "UNAUTHENTICATED", message: "Session revoked" })); }
      return response.end(JSON.stringify({ id: secondUser ? "second-user" : "owner",
        account: secondUser ? "second-user" : "owner", role: "user" }));
    }
    if (request.url === "/api/v1/login") return response.end(JSON.stringify({ token: "second-user-secret",
      expiresAt: "2099-01-01T00:00:00Z", user: { id: "second-user", account: "second-user", role: "user" } }));
    if (request.url === "/api/v1/logout") return response.end("{}");
    if (request.url === "/api/v1/works") return response.end(JSON.stringify({ works: [work] }));
    if (request.url === `/api/v1/works/${workId}`) return response.end(JSON.stringify(work));
    if (request.url === `/api/v1/works/${workId}/services`) return response.end(JSON.stringify({ services: servicesAvailable
      ? workerRemoved ? [service, board, blocked] : [service, board, blocked, worker] : [] }));
    if (request.url === `/api/v1/works/${workId}/services/${serviceId}`) return response.end(JSON.stringify(service));
    if (request.url === `/api/v1/works/${workId}/services/${serviceId}/logs?tailLines=100`)
      return response.end(JSON.stringify({ serviceId, status: "truncated", text: "recent output", truncated: true,
        collectedAt: "2026-09-29T00:00:00.000Z" }));
    if (request.url === `/api/v1/works/${workId}/services/boards`) return response.end(JSON.stringify(board));
    if (request.url === `/api/v1/works/${workId}/services/boards/enable` && request.method === "POST") {
      boardActions.push("enable"); board.enabled = true;
      response.writeHead(202);
      return response.end(JSON.stringify({ operationId: "board-enable-operation", serviceId: "boards", workId }));
    }
    if (request.url === "/api/v1/operations/board-enable-operation")
      return response.end(JSON.stringify({ operationId: "board-enable-operation", state: "succeeded", error: null }));
    if (request.url === `/api/v1/works/${workId}/services/blocked`) return response.end(JSON.stringify(blocked));
    if (request.url === `/api/v1/works/${workId}/services/worker` && request.method === "GET")
      return workerRemoved ? (response.writeHead(404), response.end("{}")) : response.end(JSON.stringify(worker));
    if (request.url === `/api/v1/works/${workId}/services/worker/logs?tailLines=100`)
      return response.end(JSON.stringify({ serviceId: "worker", status: "unavailable", text: "", truncated: false,
        collectedAt: "2026-09-29T00:00:00.000Z", reason: "service instance is unavailable" }));
    if (/^\/api\/v1\/works\/[^/]+\/services\/worker\/(enable|disable|remove)$/.test(request.url ?? "") && request.method === "POST") {
      const actual = request.url!.split("/").at(-1)!;
      const action = actual === "enable" ? "start" : actual === "disable" ? "stop" : "remove";
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      assert.equal("purgeData" in (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>), false);
      workerActions.push(action);
      if (action === "start") worker.enabled = true;
      if (action === "stop") worker.enabled = false;
      if (action === "remove") workerRemoved = true;
      response.writeHead(202);
      return response.end(JSON.stringify({ operationId: `worker-${action}-operation`, serviceId: "worker", workId }));
    }
    if (request.url?.startsWith("/api/v1/operations/worker-"))
      return response.end(JSON.stringify({ operationId: request.url.split("/").at(-1), state: "succeeded", error: null }));
    if (request.url === `/api/v1/works/${workId}/models`) return response.end(JSON.stringify({models:[{modelRef:"model-test-0000000001",label:"Test model",provider:"fixture",model:"one"}],defaultModel:{modelRef:null,label:"Work model",provider:"fixture",model:"one"},availability:"available",checkedAt:new Date().toISOString()}));
    if (request.url === `/api/v1/works/${workId}/sessions` && request.method === "GET") {
      sessionFetches++;
      return response.end(JSON.stringify({ sessions }));
    }
    if (request.url === `/api/v1/works/${workId}/sessions` && request.method === "POST") {
      sessionCreates++;
      sessions.push({ sessionId: "session-new-1234", title: "Fresh analysis" });
      response.writeHead(201);
      return response.end(JSON.stringify({ sessionId: "session-new-1234" }));
    }
    if (request.url === `/api/v1/works/${workId}/sessions/session-12345678`)
      return response.end(JSON.stringify({session:{workId,sessionId:request.url!.split("/").at(-1),modelPreference:null,source:{kind:"chat"}},messages:[],runs:[]}));
    if (request.url === `/api/v1/works/${workId}/sessions/session-new-1234`)
      return response.end(JSON.stringify({session:{workId,sessionId:request.url!.split("/").at(-1),modelPreference:null,source:{kind:"chat"}},messages:[],runs:[]}));
    if (request.url === `/api/v1/works/${workId}/runs` && request.method === "POST") {
      runSubmissions++;
      const pieces: Buffer[] = []; for await (const piece of request) pieces.push(piece as Buffer);
      submittedPrompt = (JSON.parse(Buffer.concat(pieces).toString()) as { prompt: string }).prompt;
      if (submittedPrompt === "Busy draft") {
        response.writeHead(409, { "content-type": "application/json" });
        return response.end(JSON.stringify({ code: "RUN_BUSY", message: "Agent is busy" }));
      }
      runAnswer = `Notes analyzed. Source: workspace /note.txt (${workspaceText}); Notes Service API /api/data (${serviceRecord}).`;
      response.writeHead(202, { "content-type": "application/json" });
      return response.end(JSON.stringify({ run: { runId: submittedPrompt === "Expired cursor" ? "run-expired"
        : submittedPrompt === "Read inaccessible /private" ? "run-unreachable" : "run-12345678" }, reused: false }));
    }
    if (request.url === `/api/v1/works/${workId}/runs/run-unreachable/events?after=0`) {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      return response.end(`${JSON.stringify({ sequence: "1", kind: { $case: "text",
        text: { delta: "Cannot read /private: the path is not accessible. No page data was synchronized." } } })}\n`);
    }
    if (request.url === `/api/v1/works/${workId}/runs/run-unreachable`)
      return response.end(JSON.stringify({ state: 4, finalText: "Cannot read /private: the path is not accessible." }));
    if (request.url === `/api/v1/works/${workId}/runs/run-expired/events?after=0`) {
      response.writeHead(410, { "content-type": "application/json" });
      return response.end(JSON.stringify({ code: "EVENT_CURSOR_EXPIRED", message: "event history expired" }));
    }
    if (request.url === `/api/v1/works/${workId}/runs/run-expired`)
      return response.end(JSON.stringify({ state: 4, finalText: "Already completed." }));
    if (request.url === `/api/v1/works/${workId}/runs/run-12345678/events?after=0`) {
      runEventReads++;
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      return response.end(`${JSON.stringify({ sequence: "1", kind: { $case: "text", text: { delta: runAnswer } } })}\n${JSON.stringify({ sequence: "2", kind: { $case: "state", state: { state: 2 } } })}\n`);
    }
    if (request.url === `/api/v1/works/${workId}/runs/run-12345678/events?after=2`) {
      runEventReads++;
      await finalRunReleased;
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      return response.end(`${JSON.stringify({ sequence: "3", kind: { $case: "tool", tool: { toolName: "Read file", phase: "complete" } } })}\n${JSON.stringify({ sequence: "4", kind: { $case: "state", state: { state: 4, finalText: "Notes analyzed." } } })}\n`);
    }
    if (request.url === `/api/v1/works/${workId}/runs/run-12345678/cancel` && request.method === "POST") {
      runCancelRequests++;
      releaseFinalRun(); // Core's successful terminal result wins the cancel race.
      response.writeHead(202); return response.end(JSON.stringify({ runId: "run-12345678", state: 4 }));
    }
    if (request.url === `/api/v1/works/${workId}/runs/run-12345678`) {
      runStateReads++;
      return response.end(JSON.stringify({ state: finalRunResolved ? 4 : 2, finalText: runAnswer }));
    }
    if (request.url === "/api/v1/skills" && request.method === "GET")
      return response.end(JSON.stringify({ skills: [{ name: "review-skill" }, { name: "file-skill" }] }));
    if (request.url === "/api/v1/packages" && request.method === "GET")
      return response.end(JSON.stringify({ packages: [{ name: "@example/catalog-only", version: "2.0.0" }] }));
    if (request.url === `/api/v1/works/${workId}/configuration` && request.method === "GET")
      return response.end(JSON.stringify({ desired: desiredConfiguration, active: activeConfiguration,
        pendingApply: settingsPendingApply, runtime: { state: work.observedState === "failed" ? "failed"
          : ["ready", "degraded"].includes(work.observedState) ? "ready" : "unavailable",
          checkedAt: "2026-09-29T00:00:00.000Z",
          skills: work.observedState === "ready" ? [{ name: "review-skill", loaded: true, modelVisible: true, visibilityReason: null }] : [] } }));
    if (request.url === `/api/v1/works/${workId}/configuration/apply` && request.method === "POST") {
      applyAttempts++;
      if (applyAttempts === 1) { response.writeHead(409); return response.end(JSON.stringify({ code: "RUN_BUSY", message: "Agent is busy" })); }
      response.writeHead(202); return response.end(JSON.stringify({ operationId: applyAttempts === 3
        ? "settings-apply-failed" : "settings-apply-operation" }));
    }
    if (request.url === "/api/v1/operations/settings-apply-failed") {
      await failedApplyReleased;
      work.observedState = "failed";
      return response.end(JSON.stringify({ operationId: "settings-apply-failed", state: "failed",
        error: { message: "Configuration validation failed", remediation: "Correct the saved configuration" },
        diagnostics: { rollback: { state: "failed" } } }));
    }
    if (request.url === "/api/v1/operations/settings-apply-operation") {
      activeConfiguration = structuredClone(desiredConfiguration); settingsPendingApply = false;
      return response.end(JSON.stringify({ operationId: "settings-apply-operation", state: "succeeded", error: null }));
    }
    if (request.url?.startsWith(`/api/v1/works/${workId}/configuration`) && request.method === "PUT") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      settingsWrites.push({ path: request.url, body });
      if (request.url.endsWith("/skills") && Array.isArray(body.skills) && body.skills.includes("missing-skill")) {
        response.writeHead(400); return response.end(JSON.stringify({ code: "SKILL_NOT_FOUND", message: "Unknown Skill missing-skill" }));
      }
      if (request.url.endsWith("/packages") && Array.isArray(body.packages)
        && body.packages.some((item) => (item as { name?: string }).name === "missing-package")) {
        response.writeHead(400); return response.end(JSON.stringify({ code: "PACKAGE_NOT_FOUND", message: "Unknown Pi Package missing-package" }));
      }
      if (request.url.endsWith("/skills")) desiredConfiguration.skills = body.skills;
      else if (request.url.endsWith("/packages")) desiredConfiguration.packages = body.packages;
      else if (request.url.endsWith("/agents")) desiredConfiguration.agentsMd = body.agentsMd;
      else if (body.configuration && typeof body.configuration === "object") {
        const next = body.configuration as Record<string, unknown>;
        if (next.modelRef === "invalid-model") { response.writeHead(400);
          return response.end(JSON.stringify({ code: "INVALID_CONFIGURATION", message: "configuration.modelRef is invalid" })); }
        Object.assign(desiredConfiguration, next);
      }
      else { response.writeHead(400); return response.end(JSON.stringify({ code: "INVALID_CONFIGURATION", message: "configuration.modelRef is invalid" })); }
      settingsPendingApply = true;
      return response.end(JSON.stringify({ workId, desired: desiredConfiguration, active: activeConfiguration, pendingApply: true }));
    }
    if (request.url === `/api/v1/works/${workId}/packages` && request.method === "GET")
      return response.end(JSON.stringify({ packages: [packageRemoved
        ? { ...installedPackage, desired: null, pendingApply: true } : installedPackage] }));
    if (request.url === `/api/v1/works/${workId}/packages/%40example%2Ftools` && request.method === "GET")
      return response.end(JSON.stringify(installedPackage));
    if (request.url?.startsWith(`/api/v1/works/${workId}/packages/%40example%2Ftools`)) {
      const action = request.url.split("/").at(-1)!;
      packageActions.push(action === "%40example%2Ftools" ? "remove" : action);
      if (action === "remove" || request.method === "DELETE") { packageRemoved = true; response.writeHead(204); return response.end(); }
      if (action === "enable") installedPackage.desired.enabled = true;
      if (action === "disable") installedPackage.desired.enabled = false;
      if (action === "update") { response.writeHead(202); return response.end(JSON.stringify({ operationId: "package-update-operation" })); }
      return response.end(JSON.stringify(installedPackage));
    }
    if (request.url === "/api/v1/operations/package-update-operation")
      return response.end(JSON.stringify({ operationId: "package-update-operation", state: "succeeded", error: null }));
    if (request.url === `/api/v1/works/${workId}/package-uploads` && request.method === "POST") {
      for await (const _piece of request) { /* Consume the validated ZIP. */ }
      uploadedPackage = request.headers["x-piwork-package-source"] === "zip";
      return response.end(JSON.stringify({ uploadId: "browser-upload-12345678", expiresAt: "2099-01-01T00:00:00.000Z" }));
    }
    if (request.url === `/api/v1/works/${workId}/packages` && request.method === "POST") {
      const pieces: Buffer[] = []; for await (const piece of request) pieces.push(piece as Buffer);
      const source = (JSON.parse(Buffer.concat(pieces).toString()) as { source: Record<string, unknown> }).source;
      packageSources.push(source);
      if (JSON.stringify(source).includes("broken-source")) {
        response.writeHead(422); return response.end(JSON.stringify({ code: "PACKAGE_SOURCE_UNAVAILABLE",
          message: `Cannot resolve ${String(source.kind)} package source` }));
      }
      if (source.kind === "upload") installedUploadId = String(source.uploadId);
      response.writeHead(202); return response.end(JSON.stringify({ operationId: "browser-package-operation" }));
    }
    if (request.url === "/api/v1/file-access") return response.end(JSON.stringify({ version: 1, protocol: "webdav",
      profile: FILE_ACCESS_PROFILE, rootTemplate: FILE_ROOT_TEMPLATE, limits: FILE_LIMITS, available: true, reason: null }));
    if (request.url === "/api/v1/service-access") return response.end(JSON.stringify({ version: 1, protocols: ["http", "ws"] }));
    if (request.url === coreRoot && request.method === "PROPFIND") {
      response.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
      return response.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files"><d:response><d:href>${coreRoot}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>${coreRoot}note.txt</d:href><d:propstat><d:prop><d:getcontentlength>${Buffer.byteLength(workspaceText)}</d:getcontentlength><d:getlastmodified>Tue, 29 Sep 2026 00:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>${coreRoot}binary.bin</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>${coreRoot}large.txt</d:href><d:propstat><d:prop><d:getcontentlength>1048577</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>${coreRoot}shortcut</d:href><d:propstat><d:prop><d:resourcetype/><p:kind>symlink</p:kind></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>${coreRoot}docs/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Tue, 29 Sep 2026 00:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${[...actionFiles].map(([name, contents]) => '<d:response><d:href>'+coreRoot+encodeURIComponent(name)+'</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>'+Buffer.byteLength(contents)+'</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>').join("")}${folderCreated ? '<d:response><d:href>'+coreRoot+'new%20folder/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>' : ""}</d:multistatus>`);
    }
    if (request.url === `${coreRoot}docs/` && request.method === "PROPFIND") {
      response.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
      return response.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${coreRoot}docs/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    }
    if (request.url?.startsWith(coreRoot) && request.method === "PROPFIND" && request.headers.depth === "0") {
      const name = decodeURIComponent(request.url.slice(coreRoot.length));
      if (!actionFiles.has(name)) { response.writeHead(404); return response.end("{}"); }
      response.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
      return response.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${request.url}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${Buffer.byteLength(actionFiles.get(name)!)}</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    }
    if (request.url === `${coreRoot}new%20folder/` && request.method === "MKCOL") {
      folderCreated = true; response.writeHead(201); return response.end();
    }
    if (request.url?.startsWith(coreRoot) && ["MOVE", "COPY", "DELETE"].includes(request.method ?? "")) {
      if (request.method === "COPY") copyMutations++;
      const name = decodeURIComponent(request.url.slice(coreRoot.length));
      if (!actionFiles.has(name)) { response.writeHead(404); return response.end("{}"); }
      if (request.method === "DELETE" && name === "partial.txt") {
        response.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
        return response.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${coreRoot}partial.txt/child</d:href><d:status>HTTP/1.1 204 No Content</d:status></d:response><d:response><d:href>${coreRoot}partial.txt</d:href><d:status>HTTP/1.1 423 Locked</d:status></d:response></d:multistatus>`);
      }
      if (request.method === "DELETE") actionFiles.delete(name);
      else {
        const destination = String(request.headers.destination ?? "");
        assert(destination.startsWith(coreRoot));
        const next = decodeURIComponent(destination.slice(coreRoot.length));
        actionFiles.set(next, actionFiles.get(name)!);
        if (request.method === "MOVE") actionFiles.delete(name);
      }
      response.writeHead(204); return response.end();
    }
    if (request.url?.startsWith(coreRoot) && request.method === "GET") {
      const name = decodeURIComponent(request.url.slice(coreRoot.length));
      if (actionFiles.has(name)) return response.end(actionFiles.get(name));
    }
    if (request.url === `${coreRoot}note.txt` && request.method === "GET") {
      response.setHeader("content-type", "text/plain"); return response.end(workspaceText);
    }
    if (request.url === `${coreRoot}binary.bin` && request.method === "GET") return response.end(Buffer.from([0, 1, 2]));
    if (request.url === `${coreRoot}note.txt` && request.method === "PUT") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      notePutCalls++;
      if (disconnectNextNoteSave) { disconnectNextNoteSave = false; request.socket.destroy(); return; }
      if (rejectNextNoteSave) { rejectNextNoteSave = false; response.writeHead(412); return response.end(); }
      workspaceText = Buffer.concat(chunks).toString(); response.writeHead(204); return response.end();
    }
    if (request.url === `/api/v1/service-access/resolve?hostname=${hostname}&port=80`)
      return response.end(JSON.stringify({ hostname, port: 80, workId, serviceId }));
    if (request.url === `/api/v1/service-access/resolve?hostname=${hostname}&port=8080`)
      return response.end(JSON.stringify({ hostname, port: 8080, workId, serviceId }));
    if (request.url === `/api/v1/service-access/resolve?hostname=${boardHostname}&port=80`)
      return response.end(JSON.stringify({ hostname: boardHostname, port: 80, workId, serviceId: "boards" }));
    if (request.url === `/api/v1/service-access/resolve?hostname=${blockedHostname}&port=80`)
      return response.end(JSON.stringify({ hostname: blockedHostname, port: 80, workId, serviceId: "blocked" }));
    if (request.url === `/api/v1/service-gateway/${hostname}/80/`) {
      appRootLoads++;
      upstream.push(String(request.headers.authorization ?? ""));
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("set-cookie", "sid=notes; Domain=.work; Path=/");
      return response.end(`<!doctype html><html><body><h1>Notes app</h1><p>Real Service preview</p><button id="app-login">Sign in app</button><p id="app-login-result"></p><script>
        document.getElementById('app-login').onclick = async () => {
          document.getElementById('app-login-result').textContent = 'Signing in app';
          try {
            const result = await fetch('/login', { method: 'POST', body: 'app-password' });
            document.getElementById('app-login-result').textContent = result.ok ? 'App signed in' : 'App sign-in failed: ' + result.status;
          } catch (error) { document.getElementById('app-login-result').textContent = 'App sign-in error: ' + error; }
        };
        document.body.dataset.ready = 'yes';
      </script></body></html>`);
    }
    if (request.url === `/api/v1/service-gateway/${hostname}/80/login` && request.method === "POST") {
      appLoginRequests++;
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      assert.equal(Buffer.concat(chunks).toString(), "app-password");
      response.writeHead(200, { "set-cookie": "app-session=ready; Domain=.work; Path=/; HttpOnly" });
      return response.end("signed in");
    }
    if (request.url === `/api/v1/service-gateway/${hostname}/80/events`) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      return response.end("data: service-event-ready\n\n");
    }
    if (request.url === `/api/v1/service-gateway/${hostname}/80/api/data`)
      return response.end(JSON.stringify({ record: serviceRecord }));
    if (request.url === `/api/v1/service-gateway/${hostname}/8080/`) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      return response.end("<!doctype html><html><body><h1>Alternate app</h1></body></html>");
    }
    if (request.url === `/api/v1/service-gateway/${boardHostname}/80/`) {
      upstream.push(String(request.headers.authorization ?? ""));
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("set-cookie", "sid=boards; Domain=.work; Path=/");
      return response.end("<!doctype html><html><body><h1>Boards app</h1></body></html>");
    }
    if (request.url === `/api/v1/service-gateway/${blockedHostname}/80/`) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("x-frame-options", "DENY");
      response.setHeader("content-security-policy", "frame-ancestors 'none'");
      return response.end("<!doctype html><html><body><h1>Blocked app</h1></body></html>");
    }
    response.writeHead(404); response.end("{}");
  });
  core.on("upgrade", (request, socket) => {
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    if (request.url !== `/api/v1/service-gateway/${hostname}/80/socket`) { socket.destroy(); return; }
    const key = String(request.headers["sec-websocket-key"] ?? "");
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.concat([Buffer.from([0x81, 20]), Buffer.from("service-socket-ready")]));
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-preview-"));
  await saveTestCredential(join(directory, "client.json"), { version: 1, coreUrl, token: "platform-secret",
    expiresAt: "2099-01-01T00:00:00Z", user: { id: "owner", account: "owner", role: "user" } });
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const local = listener.address(); assert(local && typeof local !== "string");
  const port = local.port;
  await new Promise<void>((done) => listener.close(() => done()));
  const child = spawnClient(["--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { ...process.env, PIWORK_CONFIG_PATH: join(directory, "client.json") });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let davProxy: ReturnType<typeof spawn> | undefined;
  try {
    const launchUrl = await new Promise<string>((done, fail) => {
      child.stdout.on("data", (chunk: Buffer) => { const match = chunk.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
        if (match) done(match[0]); });
      child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
      setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
    });
    browser = await chromium.launch(browserLaunchOptions);
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const capture = async (name: string) => {
      if (!process.env.PIWORK_DESKTOP_SCREENSHOTS) return;
      await mkdir(process.env.PIWORK_DESKTOP_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: join(process.env.PIWORK_DESKTOP_SCREENSHOTS, `${name}.png`),
        fullPage: name !== "06-mobile-services", timeout: 10_000 });
    };
    await page.goto(launchUrl);
    await page.getByRole('heading',{name:'Works',exact:true}).waitFor();
    await page.locator('[data-action=open-work]').filter({hasText:'笔记工作'}).click();
    await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('notes');
    assert.equal(await page.getByRole('combobox',{name:'Declared Web port'}).inputValue(), '80');
    await page.frameLocator('iframe').getByRole('heading',{name:'Notes app'}).waitFor();
    await page.locator('[data-action-status]').filter({hasText:'Loading Work'}).waitFor({state:'detached'});
    await page.frameLocator('iframe').locator('body[data-ready="yes"]').waitFor();
    await page.frameLocator('iframe').locator('body').evaluate(() => { document.body.dataset.feedbackFrame = 'same'; });
    await page.frameLocator('iframe').getByRole('button',{name:'Sign in app'}).click();
    await page.frameLocator('iframe').getByText('App signed in').waitFor();
    assert.equal(await page.frameLocator('iframe').locator('body').getAttribute('data-feedback-frame'), 'same', 'Feedback must preserve the live application document');
    await capture('service-signed-in');
    assert(upstream.every(value => value === ''), 'Service received platform Authorization');
    await page.frameLocator('iframe').locator('body').evaluate(() => localStorage.setItem('service-state','notes'));
    const liveProtocols = await page.frameLocator("iframe").locator("body").evaluate(async () => {
      const sse = new Promise<string>((done, fail) => {
        const source = new EventSource("/events");
        const timeout = setTimeout(() => { source.close(); fail(new Error("Service SSE timed out")); }, 4000);
        source.onmessage = (event) => { clearTimeout(timeout); source.close(); done(event.data); };
        source.onerror = () => { clearTimeout(timeout); source.close(); fail(new Error("Service SSE failed")); };
      });
      const ws = new Promise<string>((done, fail) => {
        const socket = new WebSocket(`ws://${(globalThis as unknown as { location: { host: string } }).location.host}/socket`);
        const timeout = setTimeout(() => { socket.close(); fail(new Error("Service WebSocket timed out")); }, 4000);
        socket.onmessage = (event) => { clearTimeout(timeout); socket.close(); done(String(event.data)); };
        socket.onerror = () => { clearTimeout(timeout); socket.close(); fail(new Error("Service WebSocket failed")); };
      });
      return Promise.allSettled([sse, ws]);
    });
    assert.deepEqual(liveProtocols.map((result) => result.status === "fulfilled" ? result.value : String(result.reason)),
      ["service-event-ready", "service-socket-ready"]);
    assert.deepEqual(await page.frameLocator("iframe").locator("body").evaluate(async () =>
      await (await fetch("/api/data")).json()), { record: serviceRecord });

    await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('boards');
    await page.frameLocator('iframe').getByRole('heading',{name:'Boards app'}).waitFor();
    assert.equal(await page.frameLocator('iframe').locator('body').evaluate(() => localStorage.getItem('service-state')), null);
    assert.equal(await page.frameLocator('iframe').locator('body').evaluate(() => { try { return !!parent.document; } catch { return false; } }), false);
    await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('notes');
    await page.frameLocator('iframe').getByRole('heading',{name:'Notes app'}).waitFor();
    assert.equal(await page.frameLocator('iframe').locator('body').evaluate(() => localStorage.getItem('service-state')), 'notes');
    await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('blocked');
    await page.getByRole('heading',{name:'This app opens in its own tab'}).waitFor();
    const opening = context.waitForEvent('page'); await page.getByRole('button',{name:'Open application tab',exact:true}).click();
    const separate = await opening; await separate.getByRole('heading',{name:'Blocked app'}).waitFor();
    await capture('service-embedding-denied');
    assert.match(new URL(separate.url()).hostname, /^s-[a-f0-9]+\.desktop\.localhost$/); await separate.close();
    await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('notes');
    await page.frameLocator('iframe').getByRole('heading',{name:'Notes app'}).waitFor();
    await page.getByRole('button',{name:'Files',exact:true}).click();
    await page.getByRole('button',{name:/^note.txt/}).click();
    await page.getByLabel('Edit note.txt').fill('saved through delivered UI');
    await page.getByRole('button',{name:'Save file',exact:true}).click();
    await page.getByText('File saved.',{exact:true}).waitFor(); assert.equal(workspaceText, 'saved through delivered UI');
    await page.getByRole('button',{name:'Back to files'}).click();
    await page.getByRole('button',{name:'Services',exact:true}).click();
    await page.frameLocator('iframe').getByRole('heading',{name:'Notes app'}).waitFor();
    assert.equal(await page.frameLocator('iframe').locator('body').evaluate(() => localStorage.getItem('service-state')), 'notes');
    await page.locator('#composer').fill('Read shared workspace /note.txt and Notes Service API /api/data; summarize both and cite each source.');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByText(/Notes analyzed. Source: workspace/).waitFor();
    const roots = appRootLoads;
    await page.getByRole('button',{name:'Cancel run',exact:true}).click();
    releaseFinalRun();
    await page.locator('.run-strip').filter({hasText:'succeeded'}).waitFor();
    assert.equal(appRootLoads, roots, 'Run updates reloaded the Service iframe');
    assert.equal(submittedPrompt, 'Read shared workspace /note.txt and Notes Service API /api/data; summarize both and cite each source.');
    for (const width of [1440,390]) { await page.setViewportSize({width,height:900}); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  } finally {
    releaseFinalRun();
    releaseFailedApply();
    if (davProxy && davProxy.exitCode === null) {
      const stopped = new Promise<void>((done) => davProxy!.once("exit", () => done()));
      davProxy.kill("SIGINT"); await stopped;
    }
    await browser?.close();
    if (child.exitCode === null) { const exited = new Promise<void>((done) => child.once("exit", () => done())); child.kill("SIGINT"); await exited; }
    for (const socket of upgradedSockets) socket.destroy();
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
