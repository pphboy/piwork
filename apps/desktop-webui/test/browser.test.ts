import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
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
    await page.getByRole("heading", { name: "Sign in to Piwork" }).waitFor();
    await page.getByRole("button", { name: "Check Core capabilities" }).click();
    await page.getByText(/Core reachable · Runtime unavailable · Service sign in to check · Files sign in to check/).waitFor();
    const beforeOfflineInspect = corePaths.length;
    await page.getByRole("button", { name: "Inspect .work package" }).click();
    await page.getByLabel("Select .work package").setInputFiles(workPackagePath);
    await page.getByRole("button", { name: "Inspect package" }).click();
    await page.getByText(/Package verified/).waitFor();
    assert.equal(corePaths.length, beforeOfflineInspect, "offline Inspect must not contact Core");
    await page.getByRole("button", { name: "Close review" }).click();
    assert.equal(new URL(page.url()).hash, "");
    await page.getByRole("textbox", { name: "Account" }).fill("owner");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Your Works" }).waitFor();
    await page.getByRole("button", { name: "Check Core capabilities" }).click();
    await page.getByText(/Core reachable · Runtime unavailable · Service available · Files File helper unavailable/).waitFor();
    assert.match(await page.locator(".desktop-main").innerText(), /Signed in as owner/);
    assert.equal(await page.evaluate(() => (globalThis as unknown as { document: { cookie: string } }).document.cookie), "");
    assert(!JSON.stringify(await page.evaluate(() => ({ ...(globalThis as unknown as { localStorage: Record<string, string> }).localStorage }))).includes("browser-private-core-token"));
    await page.getByRole("button", { name: "Import .work" }).click();
    await page.getByLabel("Select .work package").setInputFiles(workPackagePath);
    await page.getByRole("button", { name: "Inspect package" }).click();
    await page.getByText(/Package verified/).waitFor();
    await page.getByRole("textbox", { name: "Imported Work name (optional)" }).fill("taken");
    await page.getByRole("button", { name: "Import inspected package" }).click();
    await page.getByText(/This Work name is already in use/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open Work" }).count(), 0);
    await page.getByRole("textbox", { name: "Imported Work name (optional)" }).fill("chosen");
    await page.getByRole("button", { name: "Import inspected package" }).click();
    await page.locator(".import-outcome").getByText(/chosen imported · stopped/).waitFor();
    assert.equal(corePaths.filter((path) => path === "/api/v1/works/work-import-browser-1234/start").length, 0);
    await page.getByRole("button", { name: "Close review" }).click();
    // Expiry after durable acceptance must recover the known ID, including in
    // another window, without re-uploading or re-submitting Import.
    await page.getByRole("button", { name: "Import .work" }).click();
    await page.getByLabel("Select .work package").setInputFiles(workPackagePath);
    await page.getByRole("button", { name: "Inspect package" }).click();
    await page.getByText(/Package verified/).waitFor();
    await page.getByRole("textbox", { name: "Imported Work name (optional)" }).fill("expires-after-acceptance");
    const importsBeforeExpiry = importRequests;
    await page.getByRole("button", { name: "Import inspected package" }).click();
    await page.getByRole("heading", { name: "Sign in to Piwork" }).waitFor();
    assert.equal(importRequests, importsBeforeExpiry + 1);
    await page.getByRole("textbox", { name: "Account" }).fill("owner");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.locator(".known-row").filter({ hasText: "operation-expiring-import-1234" }).getByText(/succeeded/).waitFor();
    const recoveryWindow = await context.newPage();
    await recoveryWindow.goto(new URL("/", page.url()).href);
    await recoveryWindow.locator(".known-row").filter({ hasText: "operation-expiring-import-1234" }).getByText(/succeeded/).waitFor();
    await recoveryWindow.locator(".known-row").filter({ hasText: "operation-expiring-import-1234" }).getByRole("button", { name: "Check", exact: true }).click();
    assert.equal(importRequests, importsBeforeExpiry + 1, "re-login and second observer must not repeat accepted Import");
    await recoveryWindow.close();
    await page.getByRole("button", { name: "Import .work" }).click();
    await page.getByLabel("Select .work package").setInputFiles(workPackagePath);
    await page.getByRole("button", { name: "Inspect package" }).click();
    await page.getByText(/Package verified/).waitFor();
    await page.getByRole("textbox", { name: "Imported Work name (optional)" }).fill("denied");
    await page.getByRole("button", { name: "Import inspected package" }).click();
    await page.getByText(/Import permission denied/).waitFor();
    assert.equal(await page.locator(".import-outcome").getByRole("button", { name: "Open Work" }).count(), 0);
    await page.getByRole("button", { name: "Inspect package" }).click();
    await page.getByText(/Package verified/).waitFor();
    await page.getByRole("textbox", { name: "Imported Work name (optional)" }).fill("requires-model");
    await page.getByRole("button", { name: "Import inspected package" }).click();
    await page.getByText(/Model binding is required/).waitFor();
    assert.equal(await page.locator(".import-outcome").getByRole("button", { name: "Open Work" }).count(), 0);
    await page.getByRole("button", { name: "Close review" }).click();
    await page.getByRole("button", { name: "New Work" }).click();
    await page.getByRole("textbox", { name: "Work name" }).press("Escape");
    assert.equal(await page.getByRole("textbox", { name: "Work name" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "New Work" }).evaluate((node) => node ===
      (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement), true);
    await page.getByRole("button", { name: "New Work" }).click();
    await page.getByRole("textbox", { name: "Work name" }).fill("Default Work");
    await page.getByRole("button", { name: "Create Work" }).click();
    await page.getByText(/Create Work Default Work/).waitFor();
    assert.equal(createPayloads[0]?.name, "Default Work");
    assert.equal("skills" in createPayloads[0]!, false);
    assert.equal("packages" in createPayloads[0]!, false);
    await page.getByText(/pending · Operation operation-browser-create/).waitFor();
    assert.match(await page.locator(".operation-notice").innerText(), /pending/);
    await page.getByRole("button", { name: "Stop checking" }).click();
    await page.getByText(/Core operation continues/).waitFor();
    const stoppedReads = corePaths.filter((path) => path === "/api/v1/operations/operation-browser-create-1234").length;
    await page.waitForTimeout(1200);
    assert.equal(corePaths.filter((path) => path === "/api/v1/operations/operation-browser-create-1234").length, stoppedReads);
    assert.equal(createPayloads.filter((item) => item.name === "Default Work").length, 1);
    await page.getByRole("button", { name: "New Work" }).click();
    await page.getByRole("textbox", { name: "Work name" }).fill("Explicit Empty Work");
    await page.getByRole("textbox", { name: "Base image catalog ID (optional)" }).fill("image-test");
    await page.locator(".create-work summary").click();
    await page.getByLabel("Select no Skills").check();
    await page.getByLabel("Select no Pi Packages").check();
    await page.getByRole("textbox", { name: "AGENTS.md content" }).fill("Help with this Work.");
    await page.getByRole("textbox", { name: "Full configuration JSON" }).fill('{"resources":{"cpuMillis":1000}}');
    await page.getByRole("button", { name: "Create Work" }).click();
    await page.getByText(/Create Work Explicit Empty Work/).waitFor();
    assert.deepEqual(createPayloads[1]?.skills, []);
    assert.deepEqual(createPayloads[1]?.packages, []);
    assert.equal(createPayloads[1]?.baseImage, "image-test");
    assert.equal(createPayloads[1]?.agentsMd, "Help with this Work.");
    assert.deepEqual(createPayloads[1]?.configuration, { resources: { cpuMillis: 1000 } });
    await page.getByRole("button", { name: "New Work" }).click();
    await page.getByRole("textbox", { name: "Work name" }).fill("Missing Operation");
    await page.getByRole("button", { name: "Create Work" }).click();
    await page.getByText(/Core no longer has this Operation/).waitFor();
    assert.equal(missingOperationReads, 1);
    assert.equal(await page.getByRole("button", { name: "Stop checking" }).count(), 0);
    await page.getByRole("button", { name: "New Work" }).click();
    await page.getByRole("textbox", { name: "Work name" }).fill("Superseded Work");
    await page.getByRole("button", { name: "Create Work" }).click();
    await page.getByText(/superseded · Operation operation-browser-superseded/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Stop checking" }).count(), 0);
    await page.getByRole("button", { name: "New Work" }).click();
    await page.getByRole("textbox", { name: "Work name" }).fill("Flaky Work");
    await page.getByRole("button", { name: "Create Work" }).click();
    await page.getByText(/status unavailable for Operation operation-browser-flaky/).waitFor();
    await page.getByText(/succeeded · Operation operation-browser-flaky/).waitFor();
    assert.equal(flakyOperationReads, 2, "the observer must only retry reads");
    await page.getByRole("button", { name: "New Work" }).click();
    await page.getByRole("textbox", { name: "Work name" }).fill("No ID Work");
    await page.getByRole("button", { name: "Create Work" }).click();
    await page.getByText(/did not include a usable Operation ID/).waitFor();
    assert.equal(createPayloads.filter((item) => item.name === "No ID Work").length, 1);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("heading", { name: "Sign in to Piwork" }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Sign in to Piwork" }).waitFor();
    await page.getByRole("textbox", { name: "Account" }).fill("slow");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await slowLogin;
    const otherUrl = `http://127.0.0.1:${otherAddress.port}`;
    await page.getByRole("textbox", { name: "Core address" }).fill(otherUrl);
    await page.getByRole("button", { name: "Use Core" }).click();
    await page.getByRole("heading", { name: "Sign in to Piwork" }).waitFor();
    await page.waitForTimeout(650);
    assert.doesNotMatch(await page.locator(".desktop-main").innerText(), /Signed in as owner|Your Works/);
    assert.equal(await page.getByRole("textbox", { name: "Core address" }).inputValue(), otherUrl);
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
    if (request.url?.startsWith(`/api/v1/works/${workId}/`)) submitted.push(request.url.slice(request.url.lastIndexOf("/") + 1));
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
    await page.getByRole("heading", { name: "Your Works" }).waitFor();
    const startColor = await page.getByRole("button", { name: "New Work" }).evaluate((node) =>
      (globalThis as unknown as { getComputedStyle: (value: unknown) => { backgroundColor: string } }).getComputedStyle(node).backgroundColor);
    await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { style: { setProperty: (key: string, value: string) => void } } } })
      .document.documentElement.style.setProperty("--accent", "#006b50"));
    assert.notEqual(await page.getByRole("button", { name: "New Work" }).evaluate((node) =>
      (globalThis as unknown as { getComputedStyle: (value: unknown) => { backgroundColor: string } }).getComputedStyle(node).backgroundColor), startColor);
    await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { style: { removeProperty: (key: string) => void } } } })
      .document.documentElement.style.removeProperty("--accent"));
    const colors = await page.evaluate(() => {
      const web = globalThis as unknown as { document: { querySelector: (selector: string) => unknown };
        getComputedStyle: (node: unknown) => { color: string; backgroundColor: string } };
      return { muted: web.getComputedStyle(web.document.querySelector(".muted")).color,
        surface: web.getComputedStyle(web.document.querySelector(".desktop-main")).backgroundColor,
        buttonText: web.getComputedStyle(web.document.querySelector(".primary")).color,
        button: web.getComputedStyle(web.document.querySelector(".primary")).backgroundColor };
    });
    const luminance = (css: string) => {
      const channels = [...css.matchAll(/\d+(?:\.\d+)?/g)].slice(0, 3).map((match) => Number(match[0]) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const contrast = (a: string, b: string) => {
      const first = luminance(a), second = luminance(b);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    assert(contrast(colors.muted, colors.surface) >= 4.5);
    assert(contrast(colors.buttonText, colors.button) >= 4.5);
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "New Work" }).focus();
    assert.equal(await page.getByRole("button", { name: "New Work" }).evaluate((node) =>
      (globalThis as unknown as { getComputedStyle: (value: unknown) => { outlineWidth: string } }).getComputedStyle(node).outlineWidth), "2px");
    await page.getByRole("button", { name: "Lifecycle Work" }).click();
    await page.getByRole("button", { name: "Prepare .work package" }).click();
    await page.getByText(/Snapshot lock is held by a writer/).waitFor();
    assert.equal(exportCalls, 1);
    await page.getByRole("button", { name: "Prepare .work package" }).click();
    await page.getByRole("link", { name: "Download .work package" }).waitFor();
    assert.equal(exportCalls, 2);
    const downloadReady = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download .work package" }).click();
    const download = await downloadReady;
    assert.equal(createHash("sha256").update(await readFile(await download.path())).digest("hex"), workPackageDigest);
    await page.getByText(/Download started/).waitFor();
    await page.getByRole("button", { name: "Prepare original Snapshot again" }).click();
    await page.getByRole("link", { name: "Download .work package" }).waitFor();
    assert.equal(exportCalls, 2, "retrying download must retain the original snapshot");
    assert.equal(snapshotDownloads, 2);
    await page.getByRole("button", { name: "All Works" }).click();
    submitted.length = 0;
    await page.getByRole("textbox", { name: "Snapshot ID" }).fill("snapshot-export-browser-1234");
    await page.getByRole("button", { name: "Prepare original Snapshot", exact: true }).click();
    await page.getByRole("link", { name: "Download .work package" }).waitFor();
    assert.equal(exportCalls, 2, "a saved Snapshot ID recovers the original package");
    await page.getByRole("textbox", { name: "Snapshot ID" }).fill("expired-snapshot-1234");
    await page.getByRole("button", { name: "Prepare original Snapshot", exact: true }).click();
    await page.getByText(/has expired or is unavailable/).waitFor();
    assert.equal(exportCalls, 2);
    await page.getByRole("textbox", { name: "Snapshot ID" }).fill("bad-snapshot-1234");
    await page.getByRole("button", { name: "Prepare original Snapshot", exact: true }).click();
    await page.getByText(/could not be prepared: Snapshot content changed/).waitFor();
    assert.equal(await page.getByRole("link", { name: "Download .work package" }).count(), 0);
    await page.getByRole("textbox", { name: "Snapshot ID" }).fill("full-snapshot-1234");
    await page.getByRole("button", { name: "Prepare original Snapshot", exact: true }).click();
    await page.getByText(/another local destination/).waitFor();
    assert.equal(exportCalls, 2);
    await page.getByRole("button", { name: "Start Work" }).click();
    await page.getByText(/start Lifecycle Work · pending · Operation start-superseded-1234/).waitFor();
    assert.deepEqual(submitted, ["start"]);
    await page.reload();
    await page.getByText("starting · target running").waitFor();
    const actionMenu = page.locator(".work-row details");
    await actionMenu.locator("summary").click();
    await page.keyboard.press("Escape");
    assert.equal(await actionMenu.evaluate((node) => (node as unknown as { open: boolean }).open), false);
    assert.equal(await actionMenu.locator("summary").evaluate((node) => node === (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement), true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.getByRole("button", { name: "Stop Work" }).evaluate((node) => parseFloat(
      (globalThis as unknown as { getComputedStyle: (value: unknown) => { transitionDuration: string } }).getComputedStyle(node).transitionDuration) < 0.001), true);
    const stop = page.getByRole("button", { name: "Stop Work" });
    await stop.waitFor();
    page.once("dialog", (dialog) => dialog.dismiss());
    await stop.click();
    assert.deepEqual(submitted, ["start"]);
    page.once("dialog", (dialog) => dialog.accept());
    await stop.click();
    await page.getByText(/Stop failed/).waitFor();
    assert.deepEqual(submitted, ["start", "stop"]);
    await page.reload();
    await page.locator(".known-operations").getByText(/start-superseded-1234 · superseded/).waitFor();
    await page.getByText("failed · target stopped").waitFor();
    await page.getByRole("button", { name: "Open Work" }).waitFor();
    await page.locator(".work-row summary").click();
    assert.equal(await page.getByRole("button", { name: "Retry Work" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Start Work" }).isDisabled(), true);
    await page.getByRole("button", { name: "Lifecycle Work" }).click();
    await page.getByRole("heading", { name: "Stop was not confirmed" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Prepare .work package" }).count(), 0);
    await page.locator(".work-panel-header summary").click();
    assert.equal(await page.getByRole("button", { name: "Delete Work" }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Retry Work" }).isDisabled(), true);
    await page.getByRole("button", { name: "All Works" }).click();
    await page.locator(".work-row summary").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Work" }).click();
    await page.getByText(/delete Lifecycle Work · succeeded · Operation delete-succeeded-1234/).waitFor();
    await page.getByText(/No Works visible/).waitFor();
    assert.deepEqual(submitted, ["start", "stop", "services", "delete"]);
    await page.reload();
    await page.getByText("No Works yet. Create one to start a task.").waitFor();
    await page.locator(".known-operations").getByText(/delete-succeeded-1234 · succeeded/).waitFor();
    await page.getByRole("textbox", { name: "Operation ID" }).fill("delete-succeeded-1234");
    await page.getByRole("button", { name: "Check Operation" }).click();
    await page.locator(".operation-result").getByText(/Operation delete-succeeded-1234/).waitFor();
    showLong = true;
    await page.setViewportSize({ width: 360, height: 780 });
    await page.reload();
    await page.getByRole("button", { name: longWork.name }).waitFor();
    assert.equal(await page.evaluate(() => {
      const web = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number };
      return web.document.documentElement.scrollWidth <= web.innerWidth;
    }), true, "long Work names must not overflow at 360px");
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
      return response.end(JSON.stringify({ messages: [] }));
    if (request.url === `/api/v1/works/${workId}/sessions/session-new-1234`)
      return response.end(JSON.stringify({ messages: [] }));
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
      return response.end(`${JSON.stringify({ sequence: "1", kind: { $case: "text", text: { delta: runAnswer } } })}\n${JSON.stringify({ sequence: "2", kind: { $case: "state", state: { state: 3 } } })}\n`);
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
      return response.end(JSON.stringify({ state: finalRunResolved ? 4 : 3, finalText: runAnswer }));
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
    await page.getByRole("heading", { name: "Your Works" }).waitFor();
    await capture("01-work-list");
    await page.getByRole("button", { name: "笔记工作" }).click();
    await page.getByRole("heading", { name: "笔记工作" }).waitFor();
    await page.getByRole("combobox", { name: "Choose Service" }).selectOption("notes");
    assert.equal(await page.getByRole("combobox", { name: "Web port" }).inputValue(), "80",
      "Core defaultPortName must select the Web port even when defaultUrl omits the explicit port");
    try { await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor({ timeout: 5000 }); }
    catch (error) {
      const frames = await Promise.all(page.frames().map(async (frame) => ({ url: frame.url(), body: await frame.locator("body").innerText().catch(() => "unreadable") })));
      throw new Error(`${String(error)}; frames=${JSON.stringify(frames)}; page=${await page.locator("body").innerText()}`);
    }
    assert(upstream.length > 0);
    assert(upstream.every((value) => value === ""), "Service upstream must not receive platform Authorization");
    await page.getByText(/Preview loading is not proof/).waitFor();
    await page.frameLocator("iframe").locator("body[data-ready='yes']").waitFor();
    await page.frameLocator("iframe").getByRole("button", { name: "Sign in app" }).click();
    try { await page.frameLocator("iframe").getByText("App signed in").waitFor({ timeout: 10000 }); }
    catch (error) { throw new Error(`${String(error)}; app=${await page.frameLocator("iframe").locator("body").innerText()}; requests=${appLoginRequests}; roots=${appRootLoads}; frame=${JSON.stringify(await page.frameLocator("iframe").locator("body").evaluate(() => {
      const browser = globalThis as unknown as { location: { href: string }; document: { body: { dataset: { ready?: string } };
        getElementById: (id: string) => { onclick?: unknown } | null } };
      return { url: browser.location.href, ready: browser.document.body.dataset.ready,
        handler: !!browser.document.getElementById("app-login")?.onclick };
    }))}`); }
    assert.match(await page.frameLocator("iframe").locator("body").evaluate(() =>
      (globalThis as unknown as { document: { cookie: string } }).document.cookie), /sid=notes/);
    await capture("02-service-workspace");
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
    await page.getByRole("combobox", { name: "Web port" }).selectOption("8080");
    await page.frameLocator("iframe").getByRole("heading", { name: "Alternate app" }).waitFor();
    const alternateOpening = context.waitForEvent("page");
    await page.getByRole("button", { name: "Open in new tab" }).click();
    const alternateTab = await alternateOpening;
    await alternateTab.frameLocator("iframe").getByRole("heading", { name: "Alternate app" }).waitFor();
    assert.equal(await alternateTab.getByRole("combobox", { name: "Web port" }).inputValue(), "8080");
    await alternateTab.close();
    await page.getByRole("combobox", { name: "Web port" }).selectOption("80");
    await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor();
    await page.frameLocator("iframe").locator("body").evaluate(() => localStorage.setItem("service-state", "notes"));
    assert.match(await page.frameLocator("iframe").locator("body").evaluate(() => (globalThis as unknown as { document: { cookie: string } }).document.cookie), /sid=notes/);
    await page.getByRole("combobox", { name: "Choose Service" }).selectOption("boards");
    await page.frameLocator("iframe").getByRole("heading", { name: "Boards app" }).waitFor({ timeout: 10000 });
    assert.equal(await page.frameLocator("iframe").locator("body").evaluate(() => localStorage.getItem("service-state")), null);
    assert.match(await page.frameLocator("iframe").locator("body").evaluate(() => (globalThis as unknown as { document: { cookie: string } }).document.cookie), /sid=boards/);
    assert.equal(await page.frameLocator("iframe").locator("body").evaluate(() => {
      try { return (globalThis as unknown as { parent: { document: { body: { textContent: string | null } } } }).parent.document.body.textContent !== null; } catch { return false; }
    }), false);
    const shellOrigin = new URL(page.url()).origin;
    const applicationBoundary = await page.frameLocator("iframe").locator("body").evaluate(async (origin) => {
      const web = globalThis as unknown as {
        parent: { localStorage: unknown; postMessage: (message: unknown, targetOrigin: string) => void };
        navigator: { serviceWorker?: { register: (url: string, options: { scope: string }) => Promise<unknown> } };
      };
      const probe = async (path: string) => {
        try { const response = await fetch(`${origin}${path}`, { credentials: "include" }); return response.status; }
        catch { return "blocked"; }
      };
      let parentStorage = false;
      try { void web.parent.localStorage; parentStorage = true; } catch { /* cross-origin */ }
      let workerInstalled = false;
      try { await web.navigator.serviceWorker?.register(`${origin}/_desktop/app.js`, { scope: `${origin}/` }); workerInstalled = true; }
      catch { /* cross-origin script and scope */ }
      web.parent.postMessage({ type: "piwork-authorize", workId: "evil" }, "*");
      return { control: await probe("/_desktop/api/session"), files: await probe("/_desktop/files/works/evil/files/"),
        parentStorage, workerInstalled };
    }, shellOrigin);
    assert.notEqual(applicationBoundary.control, 200);
    assert.notEqual(applicationBoundary.files, 200);
    assert.equal(applicationBoundary.parentStorage, false);
    assert.equal(applicationBoundary.workerInstalled, false);
    await page.getByRole("heading", { name: "笔记工作" }).waitFor();
    await page.getByRole("combobox", { name: "Choose Service" }).selectOption("notes");
    await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor({ timeout: 10000 });
    assert.equal(await page.frameLocator("iframe").locator("body").evaluate(() => localStorage.getItem("service-state")), "notes");
    await page.getByRole("combobox", { name: "Choose Service" }).selectOption("blocked");
    await page.getByText(/This Service prevents embedding/).waitFor({ timeout: 5_000 });
    const directAppOpening = context.waitForEvent("page");
    await page.getByRole("button", { name: "Open application tab" }).click();
    const directApp = await directAppOpening;
    await directApp.getByRole("heading", { name: "Blocked app" }).waitFor();
    const appHeaders = await directApp.evaluate(async () => {
      const response = await fetch("/");
      return { xfo: response.headers.get("x-frame-options"), csp: response.headers.get("content-security-policy") };
    });
    assert.equal(appHeaders.xfo, "DENY");
    assert.equal(appHeaders.csp, "frame-ancestors 'none'");
    await directApp.close();
    await page.getByRole("combobox", { name: "Choose Service" }).selectOption("notes");
    await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor();
    await page.locator(".service-row").filter({ hasText: "Notes" }).getByRole("button", { name: "Details" }).click();
    await page.getByRole("button", { name: "Refresh logs" }).click();
    await page.getByText(/Logs truncated · collected .*truncated to recent content.*snapshot, not a live terminal/).waitFor();
    await page.getByText("recent output").waitFor();
    await page.getByRole("button", { name: "Back to Services" }).click();
    await page.getByRole("heading", { name: "Manage Services" }).waitFor();
    await page.locator(".service-row").filter({ hasText: "Worker" }).getByRole("button", { name: "Details" }).click();
    await page.getByText(/No declared Web port/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Start Service", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Restart Service" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Retry Service" }).isDisabled(), true);
    await page.getByRole("button", { name: "Refresh logs" }).click();
    await page.getByText(/Logs unavailable · collected .*service instance is unavailable.*snapshot, not a live terminal/).waitFor();
    await page.getByRole("button", { name: "Start Service", exact: true }).click();
    await page.getByText(/start Worker · succeeded · Operation worker-start-operation/).waitFor();
    assert.deepEqual(workerActions, ["start"]);
    await page.getByRole("button", { name: "Refresh Service" }).click();
    await page.locator(".detail-panel").getByText("failed · enabled").waitFor();
    assert.equal(await page.getByRole("button", { name: "Stop Service" }).isEnabled(), true);
    const stopWorkerDialog = page.waitForEvent("dialog");
    const stopWorker = page.getByRole("button", { name: "Stop Service" }).click();
    await (await stopWorkerDialog).accept(); await stopWorker;
    await page.getByText(/stop Worker · succeeded · Operation worker-stop-operation/).waitFor();
    await page.getByRole("button", { name: "Refresh Service" }).click();
    await page.locator(".detail-panel").getByText("failed · disabled").waitFor();
    assert.equal(await page.getByRole("button", { name: "Start Service", exact: true }).isEnabled(), true);
    const removeWorkerDialog = page.waitForEvent("dialog");
    const removeWorker = page.getByRole("button", { name: "Remove Service" }).click();
    await (await removeWorkerDialog).accept(); await removeWorker;
    await page.getByText(/remove Worker · succeeded · Operation worker-remove-operation/).waitFor();
    await page.getByRole("button", { name: "Back to Services" }).click();
    await page.getByRole("heading", { name: "Manage Services" }).waitFor();
    assert.equal(await page.locator(".service-row").filter({ hasText: "Worker" }).count(), 0);
    assert.deepEqual(workerActions, ["start", "stop", "remove"]);
    assert.equal(workspaceText, "\ufeffhello\r\n", "removing a Service must leave shared Workspace files available");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: "File · note.txt" }).waitFor();
    await capture("03-files-workspace");
    await page.getByRole("button", { name: "Folder · docs" }).click();
    await page.getByText("This folder is empty.").waitFor();
    await page.getByRole("button", { name: "Up one folder" }).click();
    await page.getByRole("button", { name: "File · note.txt" }).waitFor();
    await page.getByRole("button", { name: "Special · shortcut" }).click();
    await page.getByText(/special item cannot be edited/).waitFor();
    await page.getByRole("button", { name: "File · binary.bin" }).click();
    await page.getByText(/binary control bytes/).waitFor();
    await page.getByRole("button", { name: "File · large.txt" }).click();
    await page.getByText(/larger than the 1 MiB/).waitFor();
    await page.getByRole("button", { name: "File · note.txt" }).click();
    await page.getByRole("textbox", { name: "Edit note.txt" }).fill("unsaved draft");
    const keepDialog = page.waitForEvent("dialog");
    const keepClick = page.getByRole("button", { name: "Discard" }).click();
    await (await keepDialog).dismiss(); await keepClick;
    assert.equal(await page.getByRole("textbox", { name: "Edit note.txt" }).inputValue(), "unsaved draft");
    const discardDialog = page.waitForEvent("dialog");
    const discardClick = page.getByRole("button", { name: "Discard" }).click();
    await (await discardDialog).accept(); await discardClick;
    assert.equal(await page.getByRole("textbox", { name: "Edit note.txt" }).count(), 0);
    await page.getByRole("button", { name: "File · note.txt" }).click();
    await page.getByRole("textbox", { name: "Edit note.txt" }).fill("updated\nin browser");
    await page.getByRole("button", { name: "Save file" }).click();
    await new Promise<void>((done, fail) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (workspaceText === "\ufeffupdated\r\nin browser") { clearInterval(timer); done(); }
        else if (Date.now() - started > 3000) { clearInterval(timer); fail(new Error("Browser file save did not reach Core")); }
      }, 20);
    });
    assert.equal(workspaceText, "\ufeffupdated\r\nin browser");
    rejectNextNoteSave = true;
    await page.getByRole("button", { name: "File · note.txt" }).click();
    await page.getByRole("textbox", { name: "Edit note.txt" }).fill("conflicting local draft");
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByText(/Save file: PUT failed \(412\)/).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Edit note.txt" }).inputValue(), "conflicting local draft");
    assert.equal(workspaceText, "\ufeffupdated\r\nin browser", "a conditional conflict must not overwrite the file");
    const discardConflict = page.waitForEvent("dialog");
    const discardConflictClick = page.getByRole("button", { name: "Discard" }).click();
    await (await discardConflict).accept(); await discardConflictClick;
    disconnectNextNoteSave = true;
    await page.getByRole("button", { name: "File · note.txt" }).click();
    await page.getByRole("textbox", { name: "Edit note.txt" }).fill("uncertain local draft");
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByText(/Save file: .*Refresh to confirm/).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Edit note.txt" }).inputValue(), "uncertain local draft");
    const submittedNotePuts = notePutCalls;
    await page.waitForTimeout(400);
    assert.equal(notePutCalls, submittedNotePuts, "an uncertain PUT must not be replayed automatically");
    const discardUnknown = page.waitForEvent("dialog");
    const discardUnknownClick = page.getByRole("button", { name: "Discard" }).click();
    await (await discardUnknown).accept(); await discardUnknownClick;
    const davListener = createServer();
    await new Promise<void>((done) => davListener.listen(0, "127.0.0.1", done));
    const davAddress = davListener.address(); assert(davAddress && typeof davAddress !== "string");
    const davPort = davAddress.port;
    await new Promise<void>((done) => davListener.close(() => done()));
    const startDavProxy = async () => {
      const running = spawnClient(["--core", coreUrl, "proxy", "--port", String(davPort)],
        { ...process.env, PIWORK_CONFIG_PATH: join(directory, "client.json") });
      davProxy = running;
      return new Promise<string>((done, fail) => {
        let output = "";
        running.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          const password = /WebDAV password: ([A-Za-z0-9_-]+)/.exec(output)?.[1];
          if (password) done(password);
        });
        running.once("exit", (code) => fail(new Error(`WebDAV proxy exited before starting: ${code}`)));
        setTimeout(() => fail(new Error("WebDAV proxy did not start")), 4000).unref();
      });
    };
    const stopDavProxy = async () => {
      if (!davProxy || davProxy.exitCode !== null) return;
      const running = davProxy;
      const stopped = new Promise<void>((done) => running.once("exit", () => done()));
      running.kill("SIGINT"); await stopped;
      davProxy = undefined;
    };
    const davUrl = `http://127.0.0.1:${davPort}/works/${workId}/files/note.txt`;
    const firstPassword = await startDavProxy();
    const firstBasic = `Basic ${Buffer.from(`piwork:${firstPassword}`).toString("base64")}`;
    assert.equal(await (await fetch(`http://127.0.0.1:${davPort}/works/${workId}/files/`, {
      method: "PROPFIND", headers: { Authorization: firstBasic, Depth: "1" } })).status, 207);
    assert.equal(await (await fetch(davUrl, { method: "PUT", headers: { Authorization: firstBasic }, body: "written by WebDAV" })).status, 204);
    await page.getByRole("button", { name: "Refresh files" }).click();
    await page.getByRole("button", { name: "File · note.txt" }).click();
    assert.equal(await page.getByRole("textbox", { name: "Edit note.txt" }).inputValue(), "written by WebDAV");
    await page.getByRole("textbox", { name: "Edit note.txt" }).fill("written by browser Files");
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByText(/note.txt saved/).waitFor();
    assert.equal(await (await fetch(davUrl, { headers: { Authorization: firstBasic } })).text(), "written by browser Files");
    assert.equal((await page.locator("body").innerText()).includes(firstPassword), false,
      "the proxy's temporary WebDAV password must not appear in Desktop");
    await stopDavProxy();
    const secondPassword = await startDavProxy();
    assert.notEqual(secondPassword, firstPassword);
    assert.equal((await fetch(davUrl, { headers: { Authorization: firstBasic } })).status, 401);
    const secondBasic = `Basic ${Buffer.from(`piwork:${secondPassword}`).toString("base64")}`;
    assert.equal((await fetch(davUrl, { headers: { Authorization: secondBasic } })).status, 200);
    await stopDavProxy();
    await page.getByRole("button", { name: "File · note.txt" }).click();
    await page.getByRole("textbox", { name: "Edit note.txt" }).fill("keep this draft");
    const keepTabDialog = page.waitForEvent("dialog");
    const keepTabClick = page.getByRole("button", { name: "Services", exact: true }).click();
    await (await keepTabDialog).dismiss(); await keepTabClick;
    assert.equal(await page.getByRole("textbox", { name: "Edit note.txt" }).inputValue(), "keep this draft");
    const discardTabDialog = page.waitForEvent("dialog");
    const discardTabClick = page.getByRole("button", { name: "Services", exact: true }).click();
    await (await discardTabDialog).accept(); await discardTabClick;
    await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: "File · note.txt" }).waitFor();
    const downloading = page.waitForEvent("download");
    await page.locator(".file-row").filter({ hasText: "note.txt" }).getByRole("link", { name: "Download" }).click();
    const downloadedFile = await downloading;
    assert.deepEqual(await readFile(await downloadedFile.path()), Buffer.from(workspaceText));
    await page.locator(".new-folder summary").click();
    await page.getByRole("textbox", { name: "New folder name" }).fill("new folder");
    await page.getByRole("button", { name: "Create folder" }).click();
    await page.getByRole("button", { name: "Folder · new folder" }).waitFor();
    const operationRow = () => page.locator(".file-row").filter({ hasText: "ops.txt" });
    await operationRow().locator("summary").click();
    await operationRow().getByRole("button", { name: "Cancel" }).click();
    assert.equal(actionFiles.has("ops.txt"), true, "Cancel must not write files");
    await operationRow().locator("summary").click();
    await operationRow().getByRole("textbox", { name: "Destination for ops.txt" }).fill("moved.txt");
    await operationRow().getByRole("button", { name: "Rename" }).click();
    await page.getByRole("button", { name: "File · moved.txt" }).waitFor();
    assert.equal(actionFiles.has("ops.txt"), false);
    const movedRow = () => page.locator(".file-row").filter({ hasText: "moved.txt" });
    await movedRow().locator("summary").click();
    await movedRow().getByRole("combobox", { name: "Action for moved.txt" }).selectOption("copy");
    await movedRow().getByRole("textbox", { name: "Destination for moved.txt" }).fill("copy.txt");
    await movedRow().getByRole("button", { name: "Copy" }).click();
    await page.getByRole("button", { name: "File · copy.txt" }).waitFor();
    assert.equal(actionFiles.get("copy.txt"), "ops");
    await movedRow().locator("summary").click();
    await movedRow().getByRole("combobox", { name: "Action for moved.txt" }).selectOption("copy");
    await movedRow().getByRole("textbox", { name: "Destination for moved.txt" }).fill("copy.txt");
    const overwrite = page.waitForEvent("dialog");
    const overwriteClick = movedRow().getByRole("button", { name: "Copy" }).click();
    await (await overwrite).dismiss(); await overwriteClick;
    assert.equal(copyMutations, 1, "Cancelling overwrite must not send COPY");
    const copyRow = () => page.locator(".file-row").filter({ hasText: "copy.txt" });
    await copyRow().locator("summary").click();
    await copyRow().getByRole("combobox", { name: "Action for copy.txt" }).selectOption("delete");
    const deleting = page.waitForEvent("dialog");
    const deleteClick = copyRow().getByRole("button", { name: "Delete" }).click();
    await (await deleting).accept(); await deleteClick;
    await page.getByRole("button", { name: "File · copy.txt" }).waitFor({ state: "detached" });
    assert.equal(actionFiles.has("copy.txt"), false);
    const partialRow = () => page.locator(".file-row").filter({ hasText: "partial.txt" });
    await partialRow().locator("summary").click();
    await partialRow().getByRole("combobox", { name: "Action for partial.txt" }).selectOption("delete");
    const partialDialog = page.waitForEvent("dialog");
    const partialClick = partialRow().getByRole("button", { name: "Delete" }).click();
    await (await partialDialog).accept(); await partialClick;
    await page.getByText(/1 succeeded.*1 failed.*423 Locked/).waitFor();
    assert.equal(actionFiles.has("partial.txt"), true, "partial failure must not be shown as a complete deletion");
    await page.getByRole("button", { name: "Services", exact: true }).click();
    await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await page.getByLabel("Select Skill review-skill").waitFor();
    assert((await page.getByLabel("Select Skill review-skill").evaluate((node) =>
      (node as unknown as { getBoundingClientRect: () => { width: number } }).getBoundingClientRect().width)) <= 20,
    "Skill checkbox must retain its normal width");
    await capture("04-settings-workspace");
    await page.getByRole("textbox", { name: "Selected Skill names, one per line" }).fill("missing-skill");
    await page.getByRole("button", { name: "Save Skills" }).click();
    await page.getByText(/Unknown Skill missing-skill/).waitFor();
    await page.getByRole("textbox", { name: "Selected Skill names, one per line" }).fill("");
    await page.getByLabel("Select Skill review-skill").check();
    await page.getByRole("button", { name: "Save Skills" }).click();
    await page.getByText(/Skills saved. Apply changes/).waitFor();
    assert.deepEqual(settingsWrites.at(-1)?.body.skills, ["review-skill"]);
    await page.getByRole("button", { name: "Clear selection" }).click();
    await page.getByRole("button", { name: "Save Skills" }).click();
    await page.getByText(/Skills explicitly cleared/).waitFor();
    assert.deepEqual(settingsWrites.at(-1)?.body.skills, []);
    await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
    await page.locator("details").filter({ hasText: "Currently active instructions" }).locator("summary").click();
    await page.getByText("Active instructions", { exact: true }).waitFor();
    await page.getByLabel("Import AGENTS.md text").setInputFiles({ name: "AGENTS.md",
      mimeType: "text/markdown", buffer: Buffer.alloc(1_048_577, 0x61) });
    await page.getByText(/AGENTS.md must be at most 1 MiB/).waitFor();
    await page.getByLabel("Import AGENTS.md text").setInputFiles({ name: "AGENTS.md",
      mimeType: "text/markdown", buffer: Buffer.from("New Work instructions") });
    await page.getByText(/Imported into the editor/).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "AGENTS.md content" }).inputValue(), "New Work instructions");
    const keepSettings = page.waitForEvent("dialog");
    const leaveSettings = page.getByRole("button", { name: "Advanced", exact: true }).click();
    await (await keepSettings).dismiss(); await leaveSettings;
    assert.equal(await page.getByRole("textbox", { name: "AGENTS.md content" }).inputValue(), "New Work instructions");
    await page.getByRole("button", { name: "Save AGENTS.md" }).click();
    await page.getByText(/AGENTS.md saved. Apply changes/).waitFor();
    assert.equal(settingsWrites.at(-1)?.body.agentsMd, "New Work instructions");
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    const configurationEditor = page.getByRole("textbox", { name: "Complete configuration JSON" });
    const fullConfiguration = JSON.parse(await configurationEditor.inputValue()) as Record<string, unknown>;
    assert.equal(fullConfiguration.modelRef, "runtime-model-00000001");
    assert("agentImage" in fullConfiguration && "mcpServers" in fullConfiguration && "resources" in fullConfiguration && "tools" in fullConfiguration);
    assert.equal("revision" in fullConfiguration || "secret" in fullConfiguration, false);
    await page.getByLabel("Import configuration JSON").setInputFiles({ name: "work-config.json",
      mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fullConfiguration)) });
    await page.getByText(/Imported into the editor. Save to validate/).waitFor();
    await configurationEditor.fill(JSON.stringify({ ...fullConfiguration, modelRef: "invalid-model" }));
    await page.getByRole("button", { name: "Save configuration" }).click();
    await page.getByText(/configuration.modelRef is invalid/).waitFor();
    await configurationEditor.fill(JSON.stringify(fullConfiguration));
    await page.getByRole("button", { name: "Save configuration" }).click();
    await page.getByText(/Configuration saved. Apply changes/).waitFor();
    await page.getByRole("button", { name: "Apply changes" }).click();
    await page.getByText(/Agent is busy/).waitFor();
    assert.equal(runCancelRequests, 0, "a busy Apply must not cancel an Agent Run");
    await page.getByRole("button", { name: "Apply changes" }).click();
    await page.getByText(/Apply 笔记工作 · succeeded · Operation settings-apply-operation/).waitFor();
    assert.equal(applyAttempts, 2);
    await page.getByRole("button", { name: "Pi Packages", exact: true }).click();
    await page.getByRole("heading", { name: "Available from Core" }).waitFor();
    assert.equal(await page.locator(".package-list").getByText(/catalog-only/).count(), 0,
      "a catalog package must not appear as installed in the Work");
    const installedRow = page.locator(".package-row").filter({ hasText: "@example/tools" });
    await installedRow.getByRole("button", { name: "Details" }).click();
    try { await page.getByText(/"name": "@example\/tools"/).waitFor({ timeout: 3000 }); }
    catch (error) { throw new Error(`${String(error)}; notice=${await page.locator(".settings-notice").innerText()}`); }
    await installedRow.getByRole("button", { name: "Disable" }).click();
    await page.getByText(/disabled in saved configuration/).waitFor();
    assert.equal(installedPackage.desired.enabled, false);
    assert.equal(installedPackage.active.enabled, true, "package edits must leave active state intact until Apply");
    await installedRow.getByRole("button", { name: "Enable" }).click();
    await page.getByText(/enabled in saved configuration/).waitFor();
    assert.equal(installedPackage.desired.enabled, true);
    page.once("dialog", (dialog) => dialog.accept("git:https://example.test/tools.git"));
    await installedRow.getByRole("button", { name: "Update" }).click();
    await page.getByText(/package-update-operation/).waitFor();
    assert(packageActions.includes("update"));
    const selectedPackages = page.getByRole("textbox", { name: "Selected Pi Packages, one per line" });
    await selectedPackages.fill("missing-package");
    await page.getByRole("button", { name: "Save selection" }).click();
    await page.getByText(/Unknown Pi Package missing-package/).waitFor();
    await selectedPackages.fill("@example/tools (disabled)");
    await page.getByRole("button", { name: "Save selection" }).click();
    await page.getByText(/Package selection saved/).waitFor();
    assert.deepEqual(settingsWrites.at(-1)?.body.packages, [{ name: "@example/tools", enabled: false }]);
    const installSource = async (kind: string, value: string, expected: Record<string, unknown>) => {
      const before = packageSources.length;
      await page.getByRole("combobox", { name: "Package source" }).selectOption(kind);
      await page.getByRole("textbox", { name: "Package name or source" }).fill(value);
      await page.getByRole("button", { name: "Install Pi Package" }).click();
      for (let attempt = 0; attempt < 100 && packageSources.length === before; attempt++)
        await new Promise((done) => setTimeout(done, 20));
      assert.deepEqual(packageSources.at(-1), expected);
    };
    const rejectSource = async (kind: string, value: string) => {
      await page.getByRole("combobox", { name: "Package source" }).selectOption(kind);
      await page.getByRole("textbox", { name: "Package name or source" }).fill(value);
      await page.getByRole("button", { name: "Install Pi Package" }).click();
      await page.getByText(new RegExp(`Cannot resolve ${kind} package source`)).waitFor();
    };
    await rejectSource("core", "@example/broken-source");
    await installSource("core", "@example/catalog-only", { kind: "core", name: "@example/catalog-only" });
    await rejectSource("npm", "@example/broken-source@1.0.0");
    await installSource("npm", "@example/npm-tools@1.2.0", { kind: "npm", spec: "@example/npm-tools@1.2.0" });
    await rejectSource("git", "https://broken-source.test/tools.git");
    await installSource("git", "https://example.test/tools.git", { kind: "git", spec: "https://example.test/tools.git" });
    await page.getByRole("combobox", { name: "Package source" }).selectOption("zip");
    const packagesBeforeBadZip = packageSources.length;
    await page.getByLabel("Select Pi Package ZIP or local directory").setInputFiles({ name: "broken.zip",
      mimeType: "application/zip", buffer: Buffer.from("not a ZIP") });
    await page.getByRole("button", { name: "Install Pi Package" }).click();
    let zipError = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      zipError = await page.locator(".settings-notice").innerText();
      if (zipError && !zipError.includes("Uploading and validating")) break;
      await new Promise((done) => setTimeout(done, 20));
    }
    assert(zipError && !zipError.includes("Uploading and validating"), "invalid ZIP must show a validation error");
    assert.equal(packageSources.length, packagesBeforeBadZip, "invalid ZIP must not be submitted to Core");
    const packageSource = join(directory, "package-source"); await mkdir(packageSource);
    await writeFile(join(packageSource, "package.json"), '{"name":"browser-tools","version":"1.0.0"}');
    const zipPath = join(directory, "browser-tools.zip");
    execFileSync("zip", ["-q", "-r", zipPath, "."], { cwd: packageSource });
    await page.getByLabel("Select Pi Package ZIP or local directory").setInputFiles(zipPath);
    await page.getByRole("button", { name: "Install Pi Package" }).click();
    try { await page.getByText(/browser-package-operation/).waitFor({ timeout: 5_000 }); }
    catch (error) { throw new Error(`${String(error)}; page=${await page.locator("body").innerText()}; uploaded=${uploadedPackage}; installed=${installedUploadId}`); }
    for (let attempt = 0; attempt < 100 && !uploadedPackage; attempt++) await new Promise((done) => setTimeout(done, 20));
    assert.equal(uploadedPackage, true);
    for (let attempt = 0; attempt < 100 && !installedUploadId; attempt++) await new Promise((done) => setTimeout(done, 20));
    assert.equal(installedUploadId, "browser-upload-12345678");
    await page.getByRole("combobox", { name: "Package source" }).selectOption("local");
    await page.getByRole("button", { name: "Install Pi Package" }).click();
    await page.getByText(/Select one ZIP or one local directory/).waitFor();
    await page.getByLabel("Select Pi Package ZIP or local directory").setInputFiles(packageSource);
    const beforeLocal = packageSources.length;
    await page.getByRole("button", { name: "Install Pi Package" }).click();
    for (let attempt = 0; attempt < 100 && packageSources.length === beforeLocal; attempt++) await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(packageSources.at(-1), { kind: "upload", uploadId: "browser-upload-12345678" });
    const removePackage = page.waitForEvent("dialog");
    const removeClick = installedRow.getByRole("button", { name: "Remove" }).click();
    await (await removePackage).accept(); await removeClick;
    await page.getByText(/removal saved. Apply changes if required/).waitFor();
    await page.getByRole("button", { name: "Services", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Pi Packages", exact: true }).click();
    await page.locator(".package-row").getByText(/not selected · active/).waitFor();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await capture("05-chat-workspace");
    await page.getByRole("textbox", { name: "Message Agent" }).fill("Read shared workspace /note.txt and Notes Service API /api/data; summarize both and cite each source.");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(/Notes analyzed. Source: workspace \/note.txt/).waitFor();
    assert.match(await page.locator(".run-output").innerText(), /written by browser Files.*service-record-42/);
    await page.getByRole("button", { name: "Cancel run" }).click();
    await page.getByText(/Cancel requested for Run/).waitFor();
    assert.equal(runCancelRequests, 1);
    releaseFinalRun();
    try { await page.getByText(/Run run-12345678 · succeeded/).waitFor({ timeout: 3000 }); }
    catch (error) { throw new Error(`${String(error)}; eventReads=${runEventReads}; stateReads=${runStateReads}; status=${await page.locator(".run-status").innerText()}`); }
    await page.getByText(/Read file: complete/).waitFor();
    assert.equal(runEventReads, 2, "a disconnected event stream must resume the same Run by cursor");
    assert.equal(runSubmissions, 1);
    assert.equal(submittedPrompt, "Read shared workspace /note.txt and Notes Service API /api/data; summarize both and cite each source.");
    assert.equal(submittedPrompt.includes("service-state"), false, "page storage must not be collected into Agent prompts");
    await page.getByLabel("Include selected Service identity").check();
    await page.getByRole("button", { name: "New session" }).click();
    await page.getByRole("combobox", { name: "Session" }).selectOption("session-new-1234");
    assert.equal(sessionCreates, 1);
    assert.match(await page.getByRole("combobox", { name: "Session" }).innerText(), /Fresh analysis/);
    await page.getByText("No messages in this Session yet.").waitFor();
    assert.equal(await page.getByLabel("Include selected Service identity").isChecked(), false,
      "a new Session must not inherit the previous message context toggle");
    await page.getByRole("textbox", { name: "Message Agent" }).fill("Busy draft");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(/Agent is busy/).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Message Agent" }).inputValue(), "Busy draft");
    await page.waitForTimeout(400);
    assert.equal(runSubmissions, 2, "a busy Run must not become an automatic queue");
    await page.getByRole("combobox", { name: "Session" }).selectOption("session-12345678");
    assert.equal(await page.getByRole("textbox", { name: "Message Agent" }).inputValue(), "");
    await page.getByRole("textbox", { name: "Message Agent" }).fill("Original session draft");
    await page.getByRole("combobox", { name: "Session" }).selectOption("session-new-1234");
    assert.equal(await page.getByRole("textbox", { name: "Message Agent" }).inputValue(), "Busy draft");
    await page.getByRole("combobox", { name: "Session" }).selectOption("session-12345678");
    assert.equal(await page.getByRole("textbox", { name: "Message Agent" }).inputValue(), "Original session draft");
    await page.getByRole("textbox", { name: "Message Agent" }).fill("Expired cursor");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(/event history expired; current state 4/).waitFor();
    assert.equal(runSubmissions, 3, "an expired event cursor must inspect the original Run, not resubmit");
    await page.getByRole("textbox", { name: "Message Agent" }).fill("Read inaccessible /private");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(/Cannot read \/private: the path is not accessible/).waitFor();
    assert.equal(runSubmissions, 4);
    await page.getByRole("button", { name: "Services", exact: true }).click();
    await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor({ timeout: 10000 });
    const pop = context.waitForEvent("page");
    await page.getByRole("button", { name: "Open in new tab" }).click();
    const separate = await pop;
    await separate.getByRole("heading", { name: "笔记工作" }).waitFor();
    await separate.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor({ timeout: 10000 });
    assert.match(await separate.frameLocator("iframe").locator("body").evaluate(() =>
      (globalThis as unknown as { document: { cookie: string } }).document.cookie), /sid=notes/);
    assert.equal(await separate.frameLocator("iframe").locator("body").evaluate(() => localStorage.getItem("service-state")), "notes");
    await page.bringToFront();
    await page.setViewportSize({ width: 360, height: 780 });
    for (const tab of ["Files", "Chat", "Settings", "Services"] as const) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      if (tab === "Files") await page.getByRole("button", { name: "File · note.txt" }).waitFor();
      if (tab === "Chat") await page.getByRole("textbox", { name: "Message Agent" }).waitFor();
      if (tab === "Settings") await page.getByRole("heading", { name: "Settings" }).waitFor();
      if (tab === "Services") {
        await page.getByRole("button", { name: "Open in new tab" }).waitFor();
        await page.frameLocator("iframe").getByRole("heading", { name: "Notes app" }).waitFor({ timeout: 10000 });
      }
      if (tab === "Services" || tab === "Files") await capture(`06-mobile-${tab.toLowerCase()}`);
      assert.equal(await page.evaluate(() => {
        const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number };
        return browser.document.documentElement.scrollWidth <= browser.innerWidth;
      }), true,
        `${tab} must not cause horizontal overflow at 360px`);
    }
    await page.locator("iframe").waitFor();
    assert.equal(await page.locator(".agent-aside").isVisible(), false,
      "at 360px Chat has its own tab instead of appearing below Service");
    servicesAvailable = false;
    await page.getByRole("button", { name: "Refresh Work" }).click();
    await page.getByRole("heading", { name: "No Web Service is available" }).waitFor();
    await page.locator(".chat-focus").getByRole("textbox", { name: "Message Agent" }).fill("Keep this draft");
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Message Agent" }).inputValue(), "Keep this draft");
    await page.getByRole("button", { name: "Services", exact: true }).click();
    await page.getByRole("heading", { name: "No Web Service is available" }).waitFor();
    assert.equal(await page.locator(".chat-focus").getByRole("textbox", { name: "Message Agent" }).inputValue(), "Keep this draft");
    const sessionsBeforeStop = sessionFetches;
    servicesAvailable = true;
    board.enabled = false;
    work.desiredState = "stopped"; work.observedState = "stopped";
    await separate.getByRole("heading", { name: "Work is stopped" }).waitFor({ timeout: 3_000 });
    await page.getByRole("button", { name: "Refresh Work" }).click();
    await page.getByRole("heading", { name: "Saved Services" }).waitFor();
    await page.locator(".service-row").filter({ hasText: "Notes" }).getByRole("button", { name: "Details" }).click();
    assert.equal(await page.getByRole("button", { name: "Restart Service" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Start Service", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Back to Services" }).click();
    await page.getByRole("heading", { name: "Saved Services" }).waitFor();
    await page.locator(".service-row").filter({ hasText: "Boards" }).getByRole("button", { name: "Details" }).click();
    assert.equal(await page.getByRole("button", { name: "Start Service", exact: true }).isEnabled(), true);
    await page.getByRole("button", { name: "Start Service", exact: true }).click();
    await page.getByText(/start Boards · succeeded · Operation board-enable-operation/).waitFor();
    assert.deepEqual(boardActions, ["enable"]);
    assert.equal(work.desiredState, "stopped", "enabling a Service must not start its stopped Work");
    await page.getByRole("button", { name: "Back to Services" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("heading", { name: "Work is stopped" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "File · note.txt" }).count(), 0);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.getByRole("heading", { name: "Work is stopped" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Message Agent" }).count(), 0);
    assert.equal(runSubmissions, 4, "a stopped Work must not submit another Run");
    assert.equal(sessionFetches, sessionsBeforeStop, "a stopped Work must not fetch Sessions");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
    await page.getByRole("textbox", { name: "AGENTS.md content" }).fill("Candidate that will fail");
    await page.getByRole("button", { name: "Save AGENTS.md" }).click();
    await page.getByText(/AGENTS.md saved. Apply changes/).waitFor();
    await page.getByRole("button", { name: "Apply changes" }).click();
    await page.getByText(/Apply 笔记工作 accepted/).waitFor();
    await page.getByRole("textbox", { name: "AGENTS.md content" }).fill("Newer change remains pending");
    await page.getByRole("button", { name: "Save AGENTS.md" }).click();
    await page.getByText(/AGENTS.md saved. Apply changes/).waitFor();
    releaseFailedApply();
    await page.getByText(/rollback failed/).waitFor();
    await page.getByRole("button", { name: "Refresh configuration status" }).click();
    await page.getByText(/Saved changes are waiting to be applied/).waitFor();
    await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
    await page.locator("details").filter({ hasText: "Currently active instructions" }).locator("summary").click();
    await page.getByText("New Work instructions", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "AGENTS.md content" }).inputValue(), "Newer change remains pending");
    assert.equal(work.desiredState, "stopped", "Apply to a stopped Work must not start it");
    work.desiredState = "running"; work.observedState = "ready";
    await page.getByRole("button", { name: "Refresh Work" }).click();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.getByRole("textbox", { name: "Message Agent" }).fill("Private draft from owner");
    coreSessionRevoked = true;
    await page.reload();
    await page.getByRole("heading", { name: "Sign in to Piwork" }).waitFor();
    await separate.getByRole("heading", { name: "Sign in to Piwork" }).waitFor({ timeout: 5_000 });
    await page.getByRole("textbox", { name: "Account" }).fill("second-user");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Your Works" }).waitFor();
    await separate.getByRole("heading", { name: "Your Works" }).waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: "笔记工作" }).click();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Message Agent" }).inputValue(), "");
    assert.equal(await page.getByText("Private draft from owner").count(), 0);
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
