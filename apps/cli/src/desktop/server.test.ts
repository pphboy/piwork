import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { connect as netConnect } from "node:net";
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FileCredentialStore } from "@piwork/client-sdk";
import { FILE_ACCESS_PROFILE, FILE_LIMITS, FILE_ROOT_TEMPLATE, WORK_PACKAGE_MIME } from "@piwork/contracts";
import { packPiPackageDirectory } from "@piwork/pi-package";
import { DesktopSessions } from "./session.js";
import { parseDesktopOptions } from "./server.js";
import { DesktopTransfers } from "./transfers.js";

const cli = fileURLToPath(new URL("../main.js", import.meta.url));
const launchUrls = new WeakMap<ChildProcessWithoutNullStreams, string>();

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000,
    env: { ...process.env, PIWORK_CONFIG_PATH: "/tmp/piwork-desktop-no-credential-test.json" } });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function launch(port: number, extra: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [cli, "desktop", "--port", String(port), ...extra], {
    env: { ...env, PIWORK_CONFIG_PATH: "/tmp/piwork-desktop-no-credential-test.json" },
  });
  await new Promise<void>((done, fail) => {
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.stdout.on("data", (data: Buffer) => {
      const address = data.toString().match(new RegExp(`http://desktop\\.localhost:${port}/#ticket=[A-Za-z0-9_-]+`));
      if (address) { launchUrls.set(child, address[0]); done(); }
    });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}: ${stderr}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  return child;
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  const completed = new Promise<number | null>((done) => child.once("exit", done));
  child.kill("SIGINT");
  const timer = setTimeout(() => child.kill("SIGKILL"), 4_000);
  timer.unref();
  try { return await completed; }
  finally { clearTimeout(timer); }
}

async function localGet(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return localRequest(port, path, host);
}

async function localRequest(port: number, path: string, host: string, options: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {})
  : Promise<{ status: number; body: string; bytes: Buffer; headers: import("node:http").IncomingHttpHeaders }> {
  return new Promise((done, fail) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET", agent: false,
      headers: { Host: host, ...options.headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => { const bytes = Buffer.concat(chunks); done({ status: response.statusCode ?? 0, body: bytes.toString(), bytes, headers: response.headers }); });
    });
    request.once("error", fail);
    request.end(options.body);
  });
}

async function authorize(port: number, child: ChildProcessWithoutNullStreams): Promise<{ cookie: string; csrf: string }> {
  const ticket = new URL(launchUrls.get(child)!).hash.slice("#ticket=".length);
  const response = await localRequest(port, "/_desktop/api/bootstrap", `desktop.localhost:${port}`, { method: "POST",
    headers: { Origin: `http://desktop.localhost:${port}`, "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) });
  assert.equal(response.status, 200);
  const cookie = String(response.headers["set-cookie"]?.[0]).split(";", 1)[0]!;
  const csrf = (JSON.parse(response.body) as { csrf: string }).csrf;
  return { cookie, csrf };
}

async function localApi(port: number, path: string, authorization: { cookie: string; csrf: string }, method = "GET", input?: unknown) {
  return localRequest(port, `/_desktop/api/${path}`, `desktop.localhost:${port}`, { method,
    headers: { Origin: `http://desktop.localhost:${port}`, Cookie: authorization.cookie,
      "Sec-Fetch-Site": "same-origin", "X-Piwork-Csrf": authorization.csrf,
      ...(input === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
}

test("desktop parses one valid port and optional browser control", () => {
  assert.deepEqual(parseDesktopOptions([]), { port: 17891, open: true });
  assert.deepEqual(parseDesktopOptions(["--no-open", "--port", "19001"]), { port: 19001, open: false });
  for (const args of [["--port", "0"], ["--port", "65536"], ["--port", "abc"],
    ["--port", "19001", "--port", "19002"], ["--no-open", "--no-open"], ["--bogus"]]) {
    assert.throws(() => parseDesktopOptions(args));
    assert.equal(run(["desktop", ...args]).status, 2);
  }
  assert.equal(run(["--json", "desktop"]).status, 2);
  const help = run(["desktop", "--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: piwork-cli desktop/);
  assert.doesNotMatch(help.stderr, /not logged in|ECONNREFUSED/);
});

test("one-time browser bootstrap rejects replay and cross-origin access", async () => {
  const port = await freePort();
  const child = await launch(port, ["--no-open"]);
  try {
    const origin = `http://desktop.localhost:${port}`;
    const ticket = new URL(launchUrls.get(child)!).hash.slice("#ticket=".length);
    const body = JSON.stringify({ ticket });
    const bootstrap = "/_desktop/api/bootstrap";
    assert.equal((await localGet(port, "/_desktop/api/session", `desktop.localhost:${port}`)).status, 401);
    assert.equal((await localRequest(port, bootstrap, `desktop.localhost:${port}`, { method: "POST",
      headers: { Origin: "http://evil.example", "Content-Type": "application/json" }, body })).status, 403);
    assert.equal((await localRequest(port, bootstrap, `desktop.localhost:${port}`, { method: "POST",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-site", "Content-Type": "application/json" }, body })).status, 403);
    const accepted = await localRequest(port, bootstrap, `desktop.localhost:${port}`, { method: "POST",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body });
    assert.equal(accepted.status, 200);
    assert.match(String(accepted.headers["set-cookie"]), /__Host-piwork-desktop-.*HttpOnly; Secure; SameSite=Strict/);
    assert(!accepted.body.includes(ticket));
    const cookie = String(accepted.headers["set-cookie"]?.[0]).split(";", 1)[0]!;
    assert.equal((await localRequest(port, bootstrap, `desktop.localhost:${port}`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body })).status, 403);
    assert.equal((await localRequest(port, "/_desktop/api/session", `desktop.localhost:${port}`, {
      headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" } })).status, 200);
    assert.equal((await localRequest(port, "/_desktop/api/session", `desktop.localhost:${port}`, {
      headers: { Cookie: cookie, "Sec-Fetch-Site": "same-site" } })).status, 403);
    assert.equal((await localRequest(port, "/_desktop/api/session", `desktop.localhost:${port}`, {
      headers: { Cookie: cookie, Origin: "http://s-fake.desktop.localhost:17891" } })).status, 403);
    assert.equal((await localRequest(port, "/_desktop/api/session", `attacker.localhost:${port}`, {
      headers: { Cookie: cookie } })).status, 403);
  } finally { assert.equal(await stop(child), 130); }
});

test("bootstrap ticket and local session expire on their own clocks", async () => {
  let now = 1000;
  const sessions = new DesktopSessions(18123, () => now);
  const server = createServer((request, response) => { void sessions.bootstrap(request, response); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert(address && typeof address !== "string");
  now += 5 * 60_000 + 1;
  try {
    const response = await localRequest(address.port, "/_desktop/api/bootstrap", "desktop.localhost:18123", {
      method: "POST", headers: { Origin: sessions.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: sessions.bootstrapTicket }),
    });
    assert.equal(response.status, 403);
  } finally { await new Promise<void>((done) => server.close(() => done())); }
});

test("browser login, csrf, logout and Core ownership keep platform token on the server", async () => {
  const coreCalls: { path: string; authorization?: string }[] = [];
  let reachable = true;
  const core = createServer(async (request, response) => {
    coreCalls.push({ path: request.url ?? "", ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) });
    if (!reachable) { response.destroy(); return; }
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/login") {
      response.end(JSON.stringify({ token: "private-core-token", expiresAt: "2099-01-01T00:00:00.000Z",
        user: { id: "user-a", account: "owner", role: "user" } }));
    } else if (request.url === "/api/v1/me") {
      if (request.headers.authorization !== "Bearer private-core-token") { response.writeHead(401); response.end(JSON.stringify({ code: "AUTH_REQUIRED" })); }
      else response.end(JSON.stringify({ id: "user-a", account: "owner", role: "user", expiresAt: "2099-01-01T00:00:00.000Z" }));
    } else if (request.url === "/api/v1/logout") response.end("{}");
    else { response.writeHead(404); response.end("{}"); }
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-identity-"));
  const credentialPath = join(directory, "client.json");
  const port = await freePort();
  const child = spawn(process.execPath, [cli, "--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { env: { ...process.env, PIWORK_CONFIG_PATH: credentialPath } });
  await new Promise<void>((done, fail) => {
    child.stdout.on("data", (data: Buffer) => { const url = data.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
      if (url) { launchUrls.set(child, url[0]); done(); } });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  try {
    const auth = await authorize(port, child);
    const invalid = await localRequest(port, "/_desktop/api/login", `desktop.localhost:${port}`, { method: "POST",
      headers: { Origin: `http://desktop.localhost:${port}`, Cookie: auth.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ account: "owner", password: "password" }) });
    assert.equal(invalid.status, 403);
    assert.equal(coreCalls.length, 0);
    const login = await localApi(port, "login", auth, "POST", { account: "owner", password: "password" });
    assert.equal(login.status, 200);
    assert.equal((JSON.parse(login.body) as { state: string }).state, "authenticated");
    assert(!login.body.includes("private-core-token"));
    assert(!login.body.includes("password"));
    assert.equal((await new FileCredentialStore(credentialPath).load())?.token, "private-core-token");
    const session = await localApi(port, "session", auth);
    assert.equal((JSON.parse(session.body) as { user: { id: string } }).user.id, "user-a");
    assert(!session.body.includes("private-core-token"));
    reachable = false;
    const logout = await localApi(port, "logout", auth, "POST");
    assert.equal(logout.status, 200);
    assert.equal((JSON.parse(logout.body) as { remoteRevocationConfirmed: boolean }).remoteRevocationConfirmed, false);
    assert.equal((await new FileCredentialStore(credentialPath).load()), undefined);
    assert.equal((JSON.parse((await localApi(port, "session", auth)).body) as { state: string }).state, "signed-out");
  } finally {
    assert.equal(await stop(child), 130);
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser Service entry binds an owned Service and forwards app HTTP without platform credentials", async () => {
  const workId = "work-a", serviceId = "notes", hostname = "notes.w-a1b2c3d4.work";
  const boardServiceId = "boards", boardHostname = "boards.w-a1b2c3d4.work";
  const calls: { path: string; headers: import("node:http").IncomingHttpHeaders; body: string }[] = [];
  const upgradeEvents: string[] = [];
  const coreSockets = new Set<import("node:stream").Duplex>();
  const coreConnections = new Set<import("node:net").Socket>();
  let serviceAvailable = true;
  const core = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/me") return response.end(JSON.stringify({ id: "user-a", account: "owner", role: "user" }));
    if (request.url === `/api/v1/works/${workId}/services/${serviceId}`) return response.end(JSON.stringify({
      workId, serviceId, name: "Notes", enabled: true, observedState: "running", desiredRevision: 1, appliedRevision: 1,
      lastError: null, endpoints: [], access: { hostname, defaultUrl: `http://${hostname}/`, defaultPortName: "web",
        status: "available", ports: [{ name: "web", port: 80, url: `http://${hostname}/` },
          { name: "alternate", port: 8080, url: `http://${hostname}:8080/` }] }, createdAt: "2026-01-01T00:00:00Z",
    }));
    if (request.url === `/api/v1/works/${workId}/services/${boardServiceId}`) return response.end(JSON.stringify({
      workId, serviceId: boardServiceId, name: "Boards", enabled: true, observedState: "running", desiredRevision: 1, appliedRevision: 1,
      lastError: null, endpoints: [], access: { hostname: boardHostname, defaultUrl: `http://${boardHostname}/`, defaultPortName: "web",
        status: "available", ports: [{ name: "web", port: 80, url: `http://${boardHostname}/` }] }, createdAt: "2026-01-01T00:00:00Z",
    }));
    if (request.url === `/api/v1/service-access/resolve?hostname=${hostname}&port=80`)
      return serviceAvailable ? response.end(JSON.stringify({ hostname, port: 80, workId, serviceId }))
        : (response.writeHead(503), response.end(JSON.stringify({ code: "SERVICE_UNAVAILABLE" })));
    if (request.url === `/api/v1/service-access/resolve?hostname=${hostname}&port=8080`)
      return response.end(JSON.stringify({ hostname, port: 8080, workId, serviceId }));
    if (request.url === `/api/v1/service-access/resolve?hostname=${boardHostname}&port=80`)
      return response.end(JSON.stringify({ hostname: boardHostname, port: 80, workId, serviceId: boardServiceId }));
    if (request.url?.startsWith(`/api/v1/service-gateway/${hostname}/80/`)) {
      if (request.url.endsWith("/events-abort")) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: first\n\n");
        setTimeout(() => response.destroy(), 100);
        return;
      }
      if (request.url.endsWith("/events")) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: first\n\n");
        return;
      }
      if (request.url.endsWith("/app401")) { response.writeHead(401); return response.end("app says sign in"); }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      calls.push({ path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
      response.setHeader("content-type", "text/plain");
      response.setHeader("location", request.url.endsWith("/external") ? "https://example.test/next" : `http://${hostname}/next`);
      response.setHeader("set-cookie", ["sid=app; Domain=.work; Path=/", "theme=light; Domain=.work; Path=/",
        "__Host-piwork-route=forged; Path=/"]);
      return response.end("app response");
    }
    response.writeHead(404); response.end("{}");
  });
  core.on("connection", (socket) => { coreConnections.add(socket); socket.once("close", () => coreConnections.delete(socket)); });
  core.on("upgrade", (request, socket) => {
    upgradeEvents.push("core upgrade");
    coreSockets.add(socket);
    socket.once("close", () => coreSockets.delete(socket));
    assert([`/api/v1/service-gateway/${hostname}/80/socket`, `/api/v1/service-gateway/${hostname}/80/socket-head`,
      `/api/v1/service-gateway/${hostname}/80/reject`].includes(request.url ?? ""));
    assert.equal(request.headers.origin, `http://${hostname}`);
    assert(!request.headers.cookie?.includes("__Host-piwork-route"));
    if (request.url?.endsWith("/reject")) {
      socket.end("HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
      return;
    }
    const key = String(request.headers["sec-websocket-key"]);
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-accept: ${accept}\r\n\r\n${request.url?.endsWith("/socket-head") ? "server-head" : ""}`);
    socket.on("data", (chunk) => socket.write(chunk));
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const coreAddress = core.address(); assert(coreAddress && typeof coreAddress !== "string");
  const coreUrl = `http://127.0.0.1:${coreAddress.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-service-"));
  const credentialPath = join(directory, "client.json");
  await new FileCredentialStore(credentialPath).save({ version: 1, coreUrl, token: "owner-token",
    expiresAt: "2099-01-01T00:00:00Z", user: { id: "user-a", account: "owner", role: "user" } });
  const port = await freePort();
  const child = spawn(process.execPath, [cli, "--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { env: { ...process.env, PIWORK_CONFIG_PATH: credentialPath } });
  await new Promise<void>((done, fail) => {
    child.stdout.on("data", (data: Buffer) => { const match = data.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
      if (match) { launchUrls.set(child, match[0]); done(); } });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  try {
    const auth = await authorize(port, child);
    assert.equal((await localApi(port, "service-entries", auth, "POST", { workId, serviceId, targetUrl: "http://evil.test" })).status, 400);
    const created = await localApi(port, "service-entries", auth, "POST", { workId, serviceId });
    assert.equal(created.status, 200, created.body);
    const entry = JSON.parse(created.body) as { origin: string; entryUrl: string; entryId: string };
    const host = new URL(entry.origin).host;
    const ticket = new URL(entry.entryUrl).hash.slice("#ticket=".length);
    assert.equal((await localRequest(port, "/", host)).status, 401);
    assert.equal((await localRequest(port, "/", `s-unknown.desktop.localhost:${port}`)).status, 403);
    assert.equal((await localApi(port, "service-entries", { cookie: "", csrf: "" }, "POST", { workId, serviceId })).status, 403);
    const boardCreated = await localApi(port, "service-entries", auth, "POST", { workId, serviceId: boardServiceId });
    assert.equal(boardCreated.status, 200);
    const board = JSON.parse(boardCreated.body) as { origin: string; entryUrl: string };
    const boardHost = new URL(board.origin).host;
    const alternateCreated = await localApi(port, "service-entries", auth, "POST", { workId, serviceId, port: 8080 });
    assert.equal(alternateCreated.status, 200);
    const alternate = JSON.parse(alternateCreated.body) as { origin: string; entryUrl: string };
    const alternateHost = new URL(alternate.origin).host;
    const wrongTicket = (targetHost: string, targetOrigin: string) => localRequest(port, "/.well-known/piwork-local/redeem", targetHost,
      { method: "POST", headers: { Origin: targetOrigin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ ticket }) });
    assert.equal((await wrongTicket(boardHost, board.origin)).status, 403);
    assert.equal((await wrongTicket(alternateHost, alternate.origin)).status, 403);
    const redemption = () => localRequest(port, "/.well-known/piwork-local/redeem", host, { method: "POST",
      headers: { Origin: entry.origin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ ticket }) });
    const redeemed = await redemption();
    assert.equal(redeemed.status, 200);
    assert.equal((await redemption()).status, 403);
    const routeCookie = String(redeemed.headers["set-cookie"]?.[0]).split(";", 1)[0]!;
    assert.equal((await localRequest(port, "/", boardHost, { headers: { Cookie: routeCookie } })).status, 401);
    assert.equal((await localRequest(port, "/", alternateHost, { headers: { Cookie: routeCookie } })).status, 401);
    const app = await localRequest(port, "/assets/logo?q=1", host, { method: "POST",
      headers: { Cookie: `${routeCookie}; sid=app; ${auth.cookie}`, Origin: entry.origin,
        Referer: `${entry.origin}/page?q=2`, Authorization: "Basic app-only", "Content-Type": "text/plain" }, body: "hello" });
    assert.equal(app.status, 200, app.body);
    assert.equal(app.body, "app response");
    assert.equal(app.headers.location, `${entry.origin}/next`);
    assert.deepEqual(app.headers["set-cookie"], ["sid=app; Path=/", "theme=light; Path=/"]);
    assert.equal(calls.at(-1)?.path, `/api/v1/service-gateway/${hostname}/80/assets/logo?q=1`);
    assert.equal(calls.at(-1)?.body, "hello");
    assert.equal(calls.at(-1)?.headers.authorization, "Basic app-only");
    assert.equal(calls.at(-1)?.headers.cookie, "sid=app");
    assert.equal(calls.at(-1)?.headers.origin, `http://${hostname}`);
    assert.equal(calls.at(-1)?.headers.referer, `http://${hostname}/page?q=2`);
    const rootResource = await localRequest(port, "/", host, { headers: { Cookie: routeCookie } });
    assert.equal(rootResource.status, 200);
    assert.equal(calls.at(-1)?.path, `/api/v1/service-gateway/${hostname}/80/`);
    const sameNamedPath = await localRequest(port, "/_desktop/api/session", host,
      { headers: { Cookie: routeCookie, Authorization: "Bearer app-only" } });
    assert.equal(sameNamedPath.status, 200);
    assert.equal(calls.at(-1)?.path, `/api/v1/service-gateway/${hostname}/80/_desktop/api/session`);
    assert.equal(calls.at(-1)?.headers.authorization, "Bearer app-only");
    const externalRedirect = await localRequest(port, "/external", host, { headers: { Cookie: routeCookie } });
    assert.equal(externalRedirect.headers.location, "https://example.test/next");
    assert.equal((await localRequest(port, "/assets", host, { headers: { Cookie: routeCookie, Referer: "https://example.test/page" } })).status, 403);
    const appUnauthorized = await localRequest(port, "/app401", host, { headers: { Cookie: routeCookie } });
    assert.equal(appUnauthorized.status, 401);
    assert.equal(appUnauthorized.body, "app says sign in");
    assert.equal((await localApi(port, "session", auth)).status, 200);
    const deniedUpgrade = await new Promise<number>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path: "/socket", headers: {
        Host: host, Connection: "Upgrade", Upgrade: "websocket", Origin: "https://evil.test", Cookie: routeCookie,
        "Sec-WebSocket-Key": Buffer.from("denied-key").toString("base64"), "Sec-WebSocket-Version": "13",
      } });
      request.once("response", (incoming) => { incoming.resume(); done(incoming.statusCode ?? 0); });
      request.once("upgrade", (_incoming, socket) => { socket.destroy(); fail(new Error("Cross-origin Upgrade succeeded")); });
      request.once("error", fail); request.end();
    });
    assert.equal(deniedUpgrade, 403);
    const connectStatus = await new Promise<number>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, method: "CONNECT", path: "evil.test:443", headers: { Host: host } });
      request.once("connect", (incoming, socket) => { socket.destroy(); done(incoming.statusCode ?? 0); });
      request.once("response", (incoming) => { incoming.resume(); done(incoming.statusCode ?? 0); });
      request.once("error", fail); request.end();
    });
    assert.equal(connectStatus, 403);
    const rejectedByApp = await new Promise<number>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path: "/reject", headers: {
        Host: host, Connection: "Upgrade", Upgrade: "websocket", Origin: entry.origin, Cookie: routeCookie,
        "Sec-WebSocket-Key": Buffer.from("app-reject-key").toString("base64"), "Sec-WebSocket-Version": "13",
      } });
      request.once("response", (incoming) => { incoming.resume(); done(incoming.statusCode ?? 0); });
      request.once("upgrade", (_incoming, socket) => { socket.destroy(); fail(new Error("Rejected app Upgrade succeeded")); });
      request.once("error", fail); request.end();
    });
    assert.equal(rejectedByApp, 404);
    assert.equal((await localRequest(port, "/assets", host, { headers: { Cookie: routeCookie } })).status, 200,
      "an application Upgrade error must not stop Desktop");
    const upgrade = await new Promise<{ status: number; echoed: string }>((done, fail) => {
      const key = Buffer.from("browser-test-key").toString("base64");
      const request = httpRequest({ hostname: "127.0.0.1", port, path: "/socket", headers: {
        Host: host, Connection: "Upgrade", Upgrade: "websocket", Origin: entry.origin, Cookie: routeCookie,
        "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13",
      } });
      let upgradedSocket: import("node:stream").Duplex | undefined;
      const timer = setTimeout(() => { upgradedSocket?.destroy(); request.destroy(); fail(new Error(`WebSocket timed out: ${upgradeEvents.join(", ")}`)); }, 4000);
      request.once("upgrade", (response, socket) => {
        upgradedSocket = socket;
        upgradeEvents.push("client upgrade");
        socket.once("data", (chunk: Buffer) => { clearTimeout(timer); done({ status: response.statusCode ?? 0, echoed: chunk.toString() }); socket.destroy(); });
        socket.write("hello-websocket");
      });
      request.once("response", (response) => { clearTimeout(timer); fail(new Error(`Upgrade rejected: ${response.statusCode}`)); });
      request.once("error", (error) => { clearTimeout(timer); fail(error); });
      request.end();
    });
    assert.deepEqual(upgrade, { status: 101, echoed: "hello-websocket" });
    const headRoundtrip = await new Promise<string>((done, fail) => {
      const socket = netConnect(port, "127.0.0.1");
      let received = "";
      const timer = setTimeout(() => { socket.destroy(); fail(new Error("Upgrade head bytes did not roundtrip")); }, 4_000);
      socket.once("connect", () => socket.write(`GET /socket-head HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: ${entry.origin}\r\nCookie: ${routeCookie}\r\nSec-WebSocket-Key: ${Buffer.from("head-test-key").toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\nclient-head`));
      socket.on("data", (data) => {
        received += data.toString();
        if (received.includes("server-head") && received.includes("client-head")) {
          clearTimeout(timer); socket.destroy(); done(received);
        }
      });
      socket.once("error", (error) => { clearTimeout(timer); fail(error); });
    });
    assert.match(headRoundtrip, /101 Switching Protocols/);
    const persistentSocket = await new Promise<import("node:stream").Duplex>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path: "/socket", headers: {
        Host: host, Connection: "Upgrade", Upgrade: "websocket", Origin: entry.origin, Cookie: routeCookie,
        "Sec-WebSocket-Key": Buffer.from("browser-stopped-key").toString("base64"), "Sec-WebSocket-Version": "13",
      } });
      request.once("upgrade", (_response, socket) => done(socket));
      request.once("response", (incoming) => fail(new Error(`Upgrade rejected: ${incoming.statusCode}`)));
      request.once("error", fail); request.end();
    });
    const socketClosed = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => { persistentSocket.destroy(); fail(new Error("WebSocket stayed open after Service stopped")); }, 1_900);
      persistentSocket.once("close", () => { clearTimeout(timer); done(); });
    });
    serviceAvailable = false;
    await socketClosed;
    const unavailableNavigation = await localRequest(port, "/", host,
      { headers: { Cookie: routeCookie, Accept: "text/html", "Sec-Fetch-Mode": "navigate" } });
    assert.equal(unavailableNavigation.status, 503);
    assert.match(unavailableNavigation.body, new RegExp(`Work ${workId} · Service ${serviceId}`));
    assert.match(unavailableNavigation.body, new RegExp(`href="http://desktop\\.localhost:${port}/works/${workId}"`));
    const unavailableApi = await localRequest(port, "/api", host, { headers: { Cookie: routeCookie, Accept: "application/json" } });
    assert.equal(unavailableApi.status, 503);
    assert.match(unavailableApi.headers["content-type"] ?? "", /application\/json/);
    serviceAvailable = true;
    await new Promise((done) => setTimeout(done, 30_100));
    const expiredBoardTicket = await localRequest(port, "/.well-known/piwork-local/redeem", boardHost,
      { method: "POST", headers: { Origin: board.origin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ ticket: new URL(board.entryUrl).hash.slice("#ticket=".length) }) });
    assert.equal(expiredBoardTicket.status, 403, "an unredeemed Service ticket expires after 30 seconds");
    const capacityStreams: import("node:http").IncomingMessage[] = [];
    try {
      for (let index = 0; index < 64; index++) {
        const stream = await new Promise<import("node:http").IncomingMessage>((done, fail) => {
          const request = httpRequest({ hostname: "127.0.0.1", port, path: "/events", headers: { Host: host, Cookie: routeCookie } }, done);
          request.once("error", fail); request.end();
        });
        capacityStreams.push(stream);
      }
      assert.equal((await localRequest(port, "/assets", host, { headers: { Cookie: routeCookie } })).status, 429);
      capacityStreams.pop()!.destroy();
      await new Promise((done) => setTimeout(done, 80));
      assert.equal((await localRequest(port, "/assets", host, { headers: { Cookie: routeCookie } })).status, 200,
        "closing a Service connection must release its quota");
    } finally { for (const stream of capacityStreams) stream.destroy(); }
    await new Promise((done) => setTimeout(done, 80));
    const stoppedStream = await new Promise<import("node:http").IncomingMessage>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path: "/events",
        headers: { Host: host, Cookie: routeCookie } }, done);
      request.once("error", fail); request.end();
    });
    await new Promise<void>((done) => stoppedStream.once("data", () => done()));
    const stoppedStreamClosed = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error("SSE stayed open after Service stopped")), 1_900);
      stoppedStream.once("close", () => { clearTimeout(timer); done(); });
    });
    serviceAvailable = false;
    await stoppedStreamClosed;
    serviceAvailable = true;
    const abortedStream = await new Promise<import("node:http").IncomingMessage>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path: "/events-abort",
        headers: { Host: host, Cookie: routeCookie } }, done);
      request.once("error", fail); request.end();
    });
    const abortedStreamClosed = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error("browser SSE remained open after Core terminated its stream")), 1_000);
      abortedStream.once("close", () => { clearTimeout(timer); done(); });
    });
    await abortedStreamClosed;
    assert.equal(abortedStream.complete, false);
    const longStream = await new Promise<import("node:http").IncomingMessage>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path: "/events",
        headers: { Host: host, Cookie: routeCookie } }, done);
      request.once("error", fail); request.end();
    });
    const streamStarted = new Promise<void>((done) => longStream.once("data", () => done()));
    await streamStarted;
    const streamClosed = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error("Service stream remained open after logout")), 1800);
      longStream.once("close", () => { clearTimeout(timer); done(); });
    });
    assert.equal((await localRequest(port, "/", host, { headers: { Cookie: routeCookie, Origin: "http://evil.test" } })).status, 403);
    assert.equal((await localApi(port, `service-entries/${entry.entryId}`, auth)).status, 200);
    await localApi(port, "logout", auth, "POST");
    await streamClosed;
    assert.equal((await localRequest(port, "/", host, { headers: { Cookie: routeCookie } })).status, 401);
  } finally {
    const stopCode = await stop(child);
    for (const socket of coreSockets) socket.destroy();
    for (const socket of coreConnections) socket.destroy();
    core.closeAllConnections();
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
    assert.equal(stopCode, 130, "Desktop must exit cleanly with active Service streams");
  }
});

test("browser Files maps DAV paths and writes through Core without exposing browser credentials", async () => {
  const workId = "work-12345678-1234-1234-1234-123456789012";
  const coreRoot = `/api/v1/works/${workId}/files/`;
  const localRoot = `/_desktop/files/works/${workId}/files/`;
  const fileCalls: { method: string; path: string; headers: import("node:http").IncomingHttpHeaders; body: string }[] = [];
  let releaseHeldPut: (() => void) | undefined;
  let signalHeldPut: (() => void) | undefined;
  let signalSlowPut: (() => void) | undefined;
  const heldPutReached = new Promise<void>((done) => { signalHeldPut = done; });
  const heldPutReleased = new Promise<void>((done) => { releaseHeldPut = done; });
  const slowPutReached = new Promise<void>((done) => { signalSlowPut = done; });
  const core = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/me") return response.end(JSON.stringify({ id: "file-user", account: "owner", role: "user" }));
    if (request.url === "/api/v1/login") return response.end(JSON.stringify({ token: "files-owner-token",
      expiresAt: "2099-01-01T00:00:00Z", user: { id: "file-user", account: "owner", role: "user" } }));
    if (request.url === "/api/v1/logout") return response.end("{}");
    if (request.url === "/api/v1/file-access") return response.end(JSON.stringify({ version: 1, protocol: "webdav",
      profile: FILE_ACCESS_PROFILE, rootTemplate: FILE_ROOT_TEMPLATE, limits: FILE_LIMITS, available: true, reason: null }));
    if (request.url?.startsWith(coreRoot)) {
      if (request.url === `${coreRoot}abort-get.txt` && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.write("partial");
        setTimeout(() => response.destroy(), 100);
        return;
      }
      if (request.url === `${coreRoot}slow.txt` && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("first");
        const timer = setInterval(() => response.write("more"), 20);
        response.once("close", () => clearInterval(timer));
        return;
      }
      if (request.url === `${coreRoot}slow-put.txt` && request.method === "PUT") {
        request.once("data", () => signalSlowPut?.());
        return;
      }
      if (request.url === `${coreRoot}revoke.txt` && request.method === "GET") {
        response.writeHead(401); return response.end(JSON.stringify({ code: "AUTH_REQUIRED" }));
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      fileCalls.push({ method: request.method ?? "", path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
      if (request.method === "PUT" && request.url === `${coreRoot}held.txt`) {
        signalHeldPut?.();
        await heldPutReleased;
      }
      if (request.method === "PROPFIND") {
        response.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
        return response.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${coreRoot}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>${coreRoot}note%20one.txt</d:href><d:propstat><d:prop><d:getcontentlength>5</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
      }
      if (request.method === "GET") { response.writeHead(200, { "content-type": "text/plain" }); return response.end("hello"); }
      response.writeHead(204); return response.end();
    }
    response.writeHead(404); response.end("{}");
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-files-"));
  const credentialPath = join(directory, "client.json");
  await new FileCredentialStore(credentialPath).save({ version: 1, coreUrl, token: "files-owner-token",
    expiresAt: "2099-01-01T00:00:00Z", user: { id: "file-user", account: "owner", role: "user" } });
  const port = await freePort();
  const child = spawn(process.execPath, [cli, "--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { env: { ...process.env, PIWORK_CONFIG_PATH: credentialPath } });
  await new Promise<void>((done, fail) => {
    child.stdout.on("data", (data: Buffer) => { const match = data.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
      if (match) { launchUrls.set(child, match[0]); done(); } });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  try {
    const auth = await authorize(port, child);
    const host = `desktop.localhost:${port}`;
    const headers = { Origin: `http://${host}`, Cookie: auth.cookie, "X-Piwork-Csrf": auth.csrf, "Sec-Fetch-Site": "same-origin" };
    assert.equal((await localRequest(port, localRoot, host, { method: "PROPFIND", headers: { ...headers, Depth: "1" } })).status, 207);
    const listing = await localRequest(port, localRoot, host, { method: "PROPFIND", headers: { ...headers, Depth: "1" } });
    assert.match(listing.body, new RegExp(localRoot.replaceAll("/", "\\/") + "note%20one\\.txt"));
    assert(!listing.body.includes(coreRoot));
    const put = await localRequest(port, `${localRoot}note%20one.txt`, host, { method: "PUT",
      headers: { ...headers, "Content-Type": "application/octet-stream", Authorization: "Basic browser-secret" }, body: "updated" });
    assert.equal(put.status, 204);
    assert.equal(fileCalls.at(-1)?.headers.authorization, "Bearer files-owner-token");
    assert.equal(fileCalls.at(-1)?.headers.cookie, undefined);
    assert.equal(fileCalls.at(-1)?.body, "updated");
    const interrupted = await new Promise<import("node:http").IncomingMessage>((done, fail) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path: `${localRoot}abort-get.txt`,
        headers: { Host: host, Cookie: auth.cookie } }, done);
      request.once("error", fail); request.end();
    });
    await Promise.race([
      new Promise<void>((done) => interrupted.once("close", () => done())),
      new Promise<never>((_, fail) => setTimeout(() => fail(new Error("browser Files GET stayed open after Core aborted")), 1_000)),
    ]);
    assert.equal(interrupted.complete, false);
    assert.equal((await localRequest(port, `${localRoot}new%20folder/`, host, { method: "MKCOL", headers })).status, 204);
    assert.equal(fileCalls.at(-1)?.path, `${coreRoot}new%20folder/`);
    for (const method of ["COPY", "MOVE"] as const) {
      const destination = `${localRoot}new%20folder/renamed.txt`;
      assert.equal((await localRequest(port, `${localRoot}note%20one.txt`, host, { method,
        headers: { ...headers, Destination: `http://${host}${destination}`, Overwrite: "F" } })).status, 204);
      assert.equal(fileCalls.at(-1)?.headers.destination, `${coreRoot}new%20folder/renamed.txt`);
      assert.equal(fileCalls.at(-1)?.headers.overwrite, "F");
    }
    assert.equal((await localRequest(port, `${localRoot}note%20one.txt`, host, { method: "DELETE", headers })).status, 204);
    assert.equal(fileCalls.at(-1)?.method, "DELETE");
    const held = localRequest(port, `${localRoot}held.txt`, host, { method: "PUT", headers, body: "first" });
    await heldPutReached;
    const beforeBusy = fileCalls.length;
    const busy = await localRequest(port, `${localRoot}other.txt`, host, { method: "PUT", headers, body: "second" });
    assert.equal(busy.status, 409);
    assert.match(busy.body, /FILE_MUTATION_BUSY/);
    assert.equal(fileCalls.length, beforeBusy, "the rejected mutation must not reach Core");
    releaseHeldPut?.();
    assert.equal((await held).status, 204);
    assert.equal((await localRequest(port, `${localRoot}other.txt`, host, { method: "PUT", headers, body: "third" })).status, 204);
    assert.equal((await localRequest(port, localRoot, host, { method: "DELETE", headers })).status, 403);
    assert.equal((await localRequest(port, `${localRoot}note%20one.txt`, host, { method: "MOVE",
      headers: { ...headers, Destination: `http://${host}/_desktop/files/works/work-other-12345678/files/leak.txt` } })).status, 403);
    assert.equal((await localRequest(port, `${localRoot}%2e%2e/secret`, host, { headers })).status, 400);
    assert.equal((await localRequest(port, `${localRoot}note.txt`, host, { method: "PUT",
      headers: { Origin: `http://${host}`, Cookie: auth.cookie }, body: "bad" })).status, 403);
    assert.equal((await localRequest(port, `${localRoot}note.txt`, host)).status, 401);
    const startSlowGet = async () => {
      let close!: () => void;
      const closed = new Promise<void>((done) => { close = done; });
      let received = 0;
      const started = new Promise<void>((done, fail) => {
        const outbound = httpRequest({ hostname: "127.0.0.1", port, path: `${localRoot}slow.txt`, agent: false,
          headers: { Host: host, ...headers } }, (incoming) => {
          incoming.on("data", (chunk: Buffer) => { received += chunk.length; done(); });
          incoming.once("close", close);
        });
        outbound.once("error", fail); outbound.end();
      });
      await started;
      return { closed, bytes: () => received };
    };
    const loggedOutGet = await startSlowGet();
    const slowPut = httpRequest({ hostname: "127.0.0.1", port, path: `${localRoot}slow-put.txt`, method: "PUT", agent: false,
      headers: { Host: host, ...headers, "Content-Type": "application/octet-stream" } });
    slowPut.on("error", () => undefined);
    const putClosed = new Promise<void>((done) => slowPut.once("close", done));
    slowPut.write("first chunk");
    await slowPutReached;
    assert.equal((await localApi(port, "logout", auth, "POST")).status, 200);
    await Promise.all([loggedOutGet.closed, putClosed]);
    const afterLogout = loggedOutGet.bytes();
    await new Promise((done) => setTimeout(done, 50));
    assert.equal(loggedOutGet.bytes(), afterLogout, "logout must stop an already streaming File GET");
    assert.equal((await localApi(port, "login", auth, "POST", { account: "owner", password: "password" })).status, 200);
    assert.equal((await localRequest(port, `${localRoot}note.txt`, host, { headers })).status, 200);
    const switchedGet = await startSlowGet();
    assert.equal((await localApi(port, "connection", auth, "PUT", { coreUrl })).status, 200);
    await switchedGet.closed;
    const revokedGet = await startSlowGet();
    assert.equal((await localRequest(port, `${localRoot}revoke.txt`, host, { headers })).status, 401);
    await revokedGet.closed;
    assert.equal((await localApi(port, "login", auth, "POST", { account: "owner", password: "password" })).status, 200);
    assert.equal((await localRequest(port, `${localRoot}note.txt`, host, { headers })).status, 200);
  } finally {
    releaseHeldPut?.();
    assert.equal(await stop(child), 130);
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("Desktop transfer turns a mid-stream ENOSPC into a local storage error and removes the partial file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-enospc-"));
  const probe = await open(join(directory, "probe"), "wx");
  const prototype = Object.getPrototypeOf(probe) as { write: (...args: unknown[]) => Promise<unknown> };
  const original = prototype.write;
  await probe.close();
  const identity = { onRevoked: () => () => undefined } as unknown as ConstructorParameters<typeof DesktopTransfers>[1];
  const transfers = new DesktopTransfers(join(directory, "client.json"), identity);
  try {
    prototype.write = async () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); };
    const request = Object.assign(Readable.from([Buffer.from("some package bytes")]), {
      headers: { "content-type": WORK_PACKAGE_MIME, "content-length": "18" }, setTimeout: () => undefined,
    }) as unknown as import("node:http").IncomingMessage;
    const session = { id: "enospc-session", csrf: "", expiresAt: Date.now() + 1_000 };
    await assert.rejects(transfers.receive(request, {} as import("node:http").ServerResponse, session),
      (error: unknown) => (error as { status?: number; code?: string }).status === 507
        && (error as { code?: string }).code === "TRANSFER_STORAGE_FULL");
    const parent = join(directory, "desktop-transfers");
    const instances = await readdir(parent);
    assert.equal(instances.length, 1);
    assert.deepEqual(await readdir(join(parent, instances[0]!)), []);
  } finally {
    prototype.write = original;
    await transfers.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline .work Inspect validates bytes, then import and original snapshot download stay private", async () => {
  const bytes = await readFile(fileURLToPath(new URL("../../testdata/golden.work", import.meta.url)));
  const digest = createHash("sha256").update(bytes).digest("hex");
  let uploads = 0, imports = 0;
  const importNames: (string | undefined)[] = [];
  const core = createServer(async (request, response) => {
    if (request.url === "/api/v1/login") return response.end(JSON.stringify({ token: "import-owner-token",
      expiresAt: "2099-01-01T00:00:00Z", user: { id: "import-owner", account: "owner", role: "user" } }));
    if (request.url === "/api/v1/me") return response.end(JSON.stringify({ id: "import-owner", account: "owner", role: "user" }));
    if (request.url === "/api/v1/logout") return response.end("{}");
    if (request.url === "/api/v1/work-packages" && request.method === "POST") {
      uploads++;
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      assert.equal(request.headers.authorization, "Bearer import-owner-token");
      assert.equal(request.headers["x-piwork-sha256"], digest);
      assert.deepEqual(Buffer.concat(chunks), bytes);
      response.writeHead(201, { "content-type": "application/json" });
      return response.end(JSON.stringify({ packageId: "package-12345678", digest, size: bytes.length, expiresAt: "2099-01-01T00:00:00Z", bindingRequirements: { models: [], secrets: [] } }));
    }
    if (request.url === "/api/v1/work-imports" && request.method === "POST") {
      imports++;
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      const input = JSON.parse(Buffer.concat(chunks).toString()) as { packageId: string; name?: string };
      assert.equal(input.packageId, "package-12345678"); importNames.push(input.name);
      if (input.name === "taken") { response.writeHead(409, { "content-type": "application/json" });
        return response.end(JSON.stringify({ code: "WORK_NAME_CONFLICT", message: "That Work name is already in use" })); }
      if (input.name === "denied") { response.writeHead(403, { "content-type": "application/json" });
        return response.end(JSON.stringify({ code: "PERMISSION_DENIED", message: "Import is not permitted" })); }
      if (input.name === "unknown") { response.destroy(); return; }
      response.writeHead(202, { "content-type": "application/json" });
      return response.end(JSON.stringify({ workId: "work-new-12345678", name: "golden", operationId: "operation-import", correlationId: "correlation-import", reused: false }));
    }
    if (request.url === "/api/v1/work-snapshots/snapshot-12345678")
      return response.end(JSON.stringify({ workId: "work-new-12345678", snapshotId: "snapshot-12345678", operationId: "operation-export",
        state: "succeeded", digest, size: bytes.length, expiresAt: "2099-01-01T00:00:00Z", error: null }));
    if (request.url === "/api/v1/work-snapshots/snapshot-12345678/content") {
      response.writeHead(200, { "content-type": WORK_PACKAGE_MIME, "content-length": bytes.length, "x-piwork-sha256": digest });
      return response.end(bytes);
    }
    response.writeHead(404); response.end("{}");
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-package-"));
  const staleTransfer = join(directory, "desktop-transfers", "instance-99999999-orphan");
  await mkdir(staleTransfer, { recursive: true, mode: 0o700 });
  await writeFile(join(staleTransfer, "private-package"), "stale");
  const liveTransfer = join(directory, "desktop-transfers", `instance-${process.pid}-another`);
  await mkdir(liveTransfer, { recursive: true, mode: 0o700 });
  await writeFile(join(liveTransfer, "other-instance-package"), "keep");
  const port = await freePort();
  const child = spawn(process.execPath, [cli, "--core", `http://127.0.0.1:${address.port}`, "desktop", "--port", String(port), "--no-open"],
    { env: { ...process.env, PIWORK_CONFIG_PATH: join(directory, "client.json") } });
  let childStderr = "";
  child.stderr.on("data", (chunk: Buffer) => { childStderr += chunk.toString(); });
  await new Promise<void>((done, fail) => {
    child.stdout.on("data", (data: Buffer) => { const match = data.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
      if (match) { launchUrls.set(child, match[0]); done(); } });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  try {
    const auth = await authorize(port, child), host = `desktop.localhost:${port}`;
    const receive = (body: Buffer) => localRequest(port, "/_desktop/api/work-packages", host, { method: "POST",
      headers: { Origin: `http://${host}`, Cookie: auth.cookie, "Sec-Fetch-Site": "same-origin", "X-Piwork-Csrf": auth.csrf,
        "Content-Type": WORK_PACKAGE_MIME }, body });
    const inspected = await receive(bytes);
    assert.equal(inspected.status, 200, inspected.body);
    await assert.rejects(readdir(staleTransfer), { code: "ENOENT" }, "only a known exited instance is cleaned");
    assert.deepEqual(await readdir(liveTransfer), ["other-instance-package"], "another running instance is preserved");
    const transferId = (JSON.parse(inspected.body) as { transferId: string; summary: { integrityVerified: boolean } }).transferId;
    assert(transferId);
    assert.equal(uploads, 0, "Inspect must not connect to Core");
    const bad = Buffer.from(bytes); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    assert.equal((await receive(bad)).status, 400);
    assert.equal((await receive(Buffer.concat([bytes, Buffer.from("!")]))).status, 400, "trailing bytes cannot be smuggled into a valid package");
    assert.equal((await receive(Buffer.from("../../private/secret"))).status, 400, "package input is content, never a host path");
    assert.equal((await localApi(port, "work-packages/../../private/secret", auth)).status, 401);
    const boundaryHeaders = { Origin: `http://${host}`, Cookie: auth.cookie, "Sec-Fetch-Site": "same-origin",
      "X-Piwork-Csrf": auth.csrf, "Content-Type": WORK_PACKAGE_MIME };
    if (process.platform === "linux" && child.pid) {
      const residentBytes = async () => {
        const status = await readFile(`/proc/${child.pid}/status`, "utf8");
        const match = /^VmRSS:\s+(\d+) kB/m.exec(status);
        assert(match); return Number(match[1]) * 1024;
      };
      const measure = async (chunks: number): Promise<number> => {
        const baseline = await residentBytes();
        let peak = baseline;
        const sample = setInterval(() => { void residentBytes().then((value) => { peak = Math.max(peak, value); }); }, 10);
        try {
          const largeInvalid = await new Promise<number>((done, fail) => {
          const request = httpRequest({ hostname: "127.0.0.1", port, path: "/_desktop/api/work-packages", method: "POST",
            agent: false, headers: { Host: host, ...boundaryHeaders } }, (response) => {
            response.resume(); response.once("end", () => done(response.statusCode ?? 0));
          });
          request.once("error", fail);
          const chunk = Buffer.alloc(64 * 1024, 0x61);
          void (async () => {
            for (let i = 0; i < chunks; i++) if (!request.write(chunk)) await new Promise<void>((resume) => request.once("drain", resume));
            request.end();
          })().catch(fail);
          });
          assert.equal(largeInvalid, 400);
        } finally { clearInterval(sample); }
        return peak - baseline;
      };
      const firstGrowth = await measure(512);
      const secondGrowth = await measure(1536);
      assert(firstGrowth < 64 * 1024 ** 2, `32 MiB streamed package raised Desktop RSS by ${firstGrowth} bytes`);
      assert(secondGrowth < 32 * 1024 ** 2, `tripling stream size added ${secondGrowth} bytes of Desktop RSS`);
    }
    const instancesAfterInspect = await readdir(join(directory, "desktop-transfers"));
    const ownInstance = instancesAfterInspect.find((entry) => entry.startsWith("instance-") && !entry.startsWith(`instance-${process.pid}-`));
    assert(ownInstance);
    const ownPath = join(directory, "desktop-transfers", ownInstance);
    assert.equal((await stat(ownPath)).mode & 0o777, 0o700);
    for (const staged of await readdir(ownPath)) assert.equal((await stat(join(ownPath, staged))).mode & 0o777, 0o600);
    const tooLarge = await localRequest(port, "/_desktop/api/work-packages", host, { method: "POST",
      headers: { ...boundaryHeaders, "Content-Length": String(100 * 1024 ** 3 + 1) } })
      .catch((error: unknown) => { throw new Error(`declared package limit: ${String(error)}`); });
    assert.equal(tooLarge.status, 413);
    const noSpace = await new Promise<number>((done, fail) => {
      const socket = netConnect(port, "127.0.0.1");
      socket.once("connect", () => socket.write(`POST /_desktop/api/work-packages HTTP/1.1\r\nHost: ${host}\r\nOrigin: http://${host}\r\nCookie: ${auth.cookie}\r\nSec-Fetch-Site: same-origin\r\nX-Piwork-Csrf: ${auth.csrf}\r\nContent-Type: ${WORK_PACKAGE_MIME}\r\nContent-Length: ${6 * 1024 ** 3}\r\n\r\n`));
      socket.once("data", (chunk: Buffer) => { const status = /^HTTP\/1\.1 (\d{3})/.exec(chunk.toString());
        socket.destroy(); status ? done(Number(status[1])) : fail(new Error("No HTTP status for space rejection")); });
      socket.once("error", fail);
    });
    assert.equal(noSpace, 507);
    const heldRequests: ReturnType<typeof netConnect>[] = [];
    const heldStatuses: number[] = [];
    const heldIds = [randomUUID(), randomUUID()];
    try {
      const hold = (id: string) => {
        const pending = netConnect(port, "127.0.0.1");
        pending.on("error", () => undefined);
        pending.on("data", (chunk: Buffer) => { const status = /^HTTP\/1\.1 (\d{3})/.exec(chunk.toString());
          if (status) heldStatuses.push(Number(status[1])); });
        pending.once("connect", () => pending.write(`POST /_desktop/api/work-packages HTTP/1.1\r\nHost: ${host}\r\nOrigin: http://${host}\r\nCookie: ${auth.cookie}\r\nSec-Fetch-Site: same-origin\r\nX-Piwork-Csrf: ${auth.csrf}\r\nX-Piwork-Transfer-Id: ${id}\r\nContent-Type: ${WORK_PACKAGE_MIME}\r\nTransfer-Encoding: chunked\r\n\r\ne\r\npartial upload\r\n`));
        heldRequests.push(pending);
      };
      hold(heldIds[0]!); hold(heldIds[1]!);
      let activeFiles = 0;
      for (let attempt = 0; attempt < 50; attempt++) {
        const instances = await readdir(join(directory, "desktop-transfers"));
        const desktopInstance = instances.find((name) => name.startsWith("instance-") && !name.startsWith(`instance-${process.pid}-`));
        activeFiles = desktopInstance ? (await readdir(join(directory, "desktop-transfers", desktopInstance))).length : 0;
        if (activeFiles >= 3) break;
        await new Promise((done) => setTimeout(done, 20));
      }
      const third = await new Promise<number>((done, fail) => {
        const socket = netConnect(port, "127.0.0.1");
        socket.once("connect", () => socket.write(`POST /_desktop/api/work-packages HTTP/1.1\r\nHost: ${host}\r\nOrigin: http://${host}\r\nCookie: ${auth.cookie}\r\nSec-Fetch-Site: same-origin\r\nX-Piwork-Csrf: ${auth.csrf}\r\nContent-Type: ${WORK_PACKAGE_MIME}\r\nContent-Length: 12\r\n\r\nthird upload`));
        socket.once("data", (chunk: Buffer) => { const status = /^HTTP\/1\.1 (\d{3})/.exec(chunk.toString());
          socket.destroy(); status ? done(Number(status[1])) : fail(new Error("No HTTP status for concurrent transfer")); });
        socket.once("error", fail);
      });
      assert.equal(third, 429, `two unfinished uploads should reserve transfer slots; files=${activeFiles}; statuses=${heldStatuses}`);
      for (const id of heldIds) {
        const progress = await localApi(port, `work-packages/${id}`, auth);
        assert.equal(progress.status, 200);
        const state = JSON.parse(progress.body) as { phase: string; transferred: number; total: number | null };
        assert.equal(state.phase, "receiving");
        assert.equal(state.transferred, 14);
        assert.equal(state.total, null);
      }
      assert.equal((await localApi(port, `work-packages/${heldIds[0]}`, auth, "DELETE")).status, 200);
    } finally { for (const pending of heldRequests) pending.destroy(); }
    for (let attempt = 0; attempt < 100; attempt++) {
      const instances = await readdir(join(directory, "desktop-transfers"));
      const desktopInstance = instances.find((name) => name.startsWith("instance-") && !name.startsWith(`instance-${process.pid}-`));
      const files = desktopInstance ? await readdir(join(directory, "desktop-transfers", desktopInstance)) : [];
      if (files.length === 1) break;
      await new Promise((done) => setTimeout(done, 20));
    }
    const cancelled = await receive(bytes).catch((error: unknown) => { throw new Error(`receive after cancellation: ${String(error)}; child exit=${child.exitCode}; stderr=${childStderr}`); });
    const cancelledId = (JSON.parse(cancelled.body) as { transferId: string }).transferId;
    assert.equal((await localApi(port, `work-packages/${cancelledId}`, auth, "DELETE")).status, 200);
    assert.equal((await localApi(port, `work-packages/${cancelledId}`, auth)).status, 404);
    assert.equal((await localApi(port, "work-imports", auth, "POST", { transferId })).status, 401);
    assert.equal((await localApi(port, "login", auth, "POST", { account: "owner", password: "password" })).status, 200);
    const conflict = await receive(bytes);
    assert.equal(conflict.status, 200);
    const conflictId = (JSON.parse(conflict.body) as { transferId: string }).transferId;
    const rejectedName = await localApi(port, "work-imports", auth, "POST", { transferId: conflictId, name: "taken" });
    assert.equal(rejectedName.status, 409);
    assert.match(rejectedName.body, /WORK_NAME_CONFLICT/);
    assert.equal((await localApi(port, "work-imports", auth, "POST", { transferId: conflictId, name: "chosen" })).status, 202);
    const denied = await receive(bytes);
    const deniedId = (JSON.parse(denied.body) as { transferId: string }).transferId;
    assert.equal((await localApi(port, "work-imports", auth, "POST", { transferId: deniedId, name: "denied" })).status, 403);
    assert.equal((JSON.parse((await localApi(port, `work-packages/${deniedId}`, auth)).body) as { phase: string }).phase, "ready");
    assert.equal((await localApi(port, "work-imports", auth, "POST", { transferId: deniedId, name: "chosen" })).status, 202);
    const uncertain = await receive(bytes);
    assert.equal(uncertain.status, 200);
    const uncertainId = (JSON.parse(uncertain.body) as { transferId: string }).transferId;
    const unknownResult = await localApi(port, "work-imports", auth, "POST", { transferId: uncertainId, name: "unknown" });
    assert.notEqual(unknownResult.status, 202);
    const importsAfterUnknown = imports;
    const unknownRetry = await localApi(port, "work-imports", auth, "POST", { transferId: uncertainId, name: "unknown" });
    assert.equal(unknownRetry.status, 409);
    assert.match(unknownRetry.body, /IMPORT_RESULT_UNKNOWN/);
    assert.equal(imports, importsAfterUnknown, "an uncertain Core submission must not be sent again");
    const imported = await localApi(port, "work-imports", auth, "POST", { transferId });
    assert.equal(imported.status, 202, imported.body);
    assert.equal(uploads, 6); assert.equal(imports, 6);
    assert.deepEqual(importNames, ["taken", "chosen", "denied", "chosen", "unknown", undefined]);
    const prepared = await localApi(port, "work-snapshots/snapshot-12345678/downloads", auth, "POST");
    assert.equal(prepared.status, 200, prepared.body);
    const downloadId = (JSON.parse(prepared.body) as { transferId: string }).transferId;
    const downloaded = await localRequest(port, `/_desktop/api/downloads/${downloadId}/content`, host,
      { headers: { Origin: `http://${host}`, Cookie: auth.cookie, "Sec-Fetch-Site": "same-origin" } });
    assert.equal(downloaded.status, 200);
    assert.equal(createHash("sha256").update(downloaded.bytes).digest("hex"), digest);
    assert.match(String(downloaded.headers["content-disposition"]), /attachment/);
    const beforeTamper = new Set(await readdir(ownPath));
    const secondPrepared = await localApi(port, "work-snapshots/snapshot-12345678/downloads", auth, "POST");
    assert.equal(secondPrepared.status, 200);
    const replaced = (await readdir(ownPath)).find((entry) => !beforeTamper.has(entry));
    assert(replaced);
    await rm(join(ownPath, replaced));
    await symlink(fileURLToPath(new URL("../../testdata/golden.work", import.meta.url)), join(ownPath, replaced));
    const replacedId = (JSON.parse(secondPrepared.body) as { transferId: string }).transferId;
    assert.equal((await localRequest(port, `/_desktop/api/downloads/${replacedId}/content`, host,
      { headers: { Origin: `http://${host}`, Cookie: auth.cookie, "Sec-Fetch-Site": "same-origin" } })).status, 409);
    assert.equal((await localApi(port, "logout", auth, "POST")).status, 200);
    assert.notEqual((await localRequest(port, `/_desktop/api/downloads/${downloadId}/content`, host,
      { headers: { Origin: `http://${host}`, Cookie: auth.cookie, "Sec-Fetch-Site": "same-origin" } })).status, 200);
    assert.equal((await localApi(port, `work-packages/${transferId}`, auth)).status, 404,
      "sign out must revoke an inspected package held by the same local browser session");
    assert.deepEqual(await readdir(ownPath), [], "sign out must remove private staged packages");
  } finally {
    const exit = child.exitCode === null ? await stop(child) : child.exitCode;
    const parent = join(directory, "desktop-transfers");
    await rm(liveTransfer, { recursive: true, force: true });
    const remaining = await readdir(parent).catch(() => []);
    core.closeAllConnections();
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
    assert.equal(exit, 130, childStderr);
    assert.deepEqual(remaining, []);
  }
});

test("saved Core A token is never sent to Core B, and revoked or offline Core states recover correctly", async () => {
  let aState: "valid" | "offline" | "revoked" = "valid";
  const aCalls: string[] = [], bCalls: string[] = [];
  const makeCore = (calls: string[], isA: boolean) => createServer((request, response) => {
    calls.push(request.headers.authorization ?? "none");
    response.setHeader("content-type", "application/json");
    if (request.url !== "/api/v1/me") { response.writeHead(404); response.end("{}"); return; }
    if (!isA) { response.writeHead(401); response.end(JSON.stringify({ code: "AUTH_REQUIRED" })); return; }
    if (aState === "offline") { response.destroy(); return; }
    if (aState === "revoked") { response.writeHead(401); response.end(JSON.stringify({ code: "AUTH_REQUIRED" })); return; }
    response.end(JSON.stringify({ id: "user-a", account: "owner", role: "user", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  const a = makeCore(aCalls, true), b = makeCore(bCalls, false);
  await Promise.all([new Promise<void>((done) => a.listen(0, "127.0.0.1", done)),
    new Promise<void>((done) => b.listen(0, "127.0.0.1", done))]);
  const aAddress = a.address(), bAddress = b.address();
  assert(aAddress && typeof aAddress !== "string" && bAddress && typeof bAddress !== "string");
  const aUrl = `http://127.0.0.1:${aAddress.port}`, bUrl = `http://127.0.0.1:${bAddress.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-switch-"));
  const credentialPath = join(directory, "client.json");
  await new FileCredentialStore(credentialPath).save({ version: 1, coreUrl: aUrl, token: "token-a",
    expiresAt: "2099-01-01T00:00:00.000Z", user: { id: "user-a", account: "owner", role: "user" } });
  const port = await freePort();
  const child = spawn(process.execPath, [cli, "--core", bUrl, "desktop", "--port", String(port), "--no-open"],
    { env: { ...process.env, PIWORK_CONFIG_PATH: credentialPath } });
  await new Promise<void>((done, fail) => {
    child.stdout.on("data", (data: Buffer) => { const url = data.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
      if (url) { launchUrls.set(child, url[0]); done(); } });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  try {
    const auth = await authorize(port, child);
    let session = JSON.parse((await localApi(port, "session", auth)).body) as { state: string; coreUrl: string };
    assert.equal(session.state, "signed-out");
    assert.equal(session.coreUrl, bUrl);
    assert.deepEqual(bCalls, []);
    session = JSON.parse((await localApi(port, "connection", auth, "PUT", { coreUrl: aUrl })).body) as typeof session;
    assert.equal(session.state, "authenticated");
    assert.deepEqual(aCalls, ["Bearer token-a"]);
    aState = "offline";
    session = JSON.parse((await localApi(port, "session", auth)).body) as typeof session;
    assert.equal(session.state, "offline");
    assert.equal((await new FileCredentialStore(credentialPath).load())?.token, "token-a");
    aState = "valid";
    session = JSON.parse((await localApi(port, "session", auth)).body) as typeof session;
    assert.equal(session.state, "authenticated");
    aState = "revoked";
    session = JSON.parse((await localApi(port, "session", auth)).body) as typeof session;
    assert.equal(session.state, "signed-out");
    assert.equal((await new FileCredentialStore(credentialPath).load()), undefined);
    assert.equal((await localApi(port, "connection", auth, "PUT", { coreUrl: bUrl })).status, 200);
    assert.deepEqual(bCalls, []);
  } finally {
    assert.equal(await stop(child), 130);
    await Promise.all([new Promise<void>((done) => a.close(() => done())), new Promise<void>((done) => b.close(() => done()))]);
    await rm(directory, { recursive: true, force: true });
  }
});

test("owner API allowlist forwards only named routes with server-side auth and bounded JSON", async () => {
  const forwarded: { path: string; method: string; headers: import("node:http").IncomingHttpHeaders }[] = [];
  const core = createServer((request, response) => {
    forwarded.push({ path: request.url ?? "", method: request.method ?? "", headers: request.headers });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/login") response.end(JSON.stringify({ token: "owner-api-token",
      expiresAt: "2099-01-01T00:00:00.000Z", user: { id: "owner-id", account: "owner", role: "user" } }));
    else if (request.url === "/api/v1/me") response.end(JSON.stringify({ id: "owner-id", account: "owner", role: "user", expiresAt: "2099-01-01T00:00:00.000Z" }));
    else if (request.url === "/api/v1/works" && request.method === "GET") response.end(JSON.stringify({ works: [] }));
    else if (request.url === "/api/v1/works" && request.method === "POST") response.end(JSON.stringify({ workId: "work-1", operationId: "op-1" }));
    else { response.writeHead(404); response.end(JSON.stringify({ code: "NOT_FOUND" })); }
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-routes-"));
  const port = await freePort();
  const child = spawn(process.execPath, [cli, "--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { env: { ...process.env, PIWORK_CONFIG_PATH: join(directory, "client.json") } });
  await new Promise<void>((done, fail) => {
    child.stdout.on("data", (data: Buffer) => { const url = data.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
      if (url) { launchUrls.set(child, url[0]); done(); } });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  try {
    const auth = await authorize(port, child);
    assert.equal((await localApi(port, "login", auth, "POST", { account: "owner", password: "password" })).status, 200);
    const before = forwarded.length;
    assert.equal((await localApi(port, "admin/users", auth)).status, 404);
    assert.equal((await localApi(port, "works/work-1/delete/all", auth, "POST")).status, 404);
    assert.equal((await localApi(port, "works", auth, "POST", { name: "demo", unexpected: "extra" })).status, 400);
    assert.equal((await localApi(port, "works", auth, "POST", { name: "x".repeat(1_048_576) })).status, 413);
    assert(forwarded.slice(before).every((call) => call.path === "/api/v1/me"));
    assert.equal((await localApi(port, "works", auth)).status, 200);
    const created = await localApi(port, "works", auth, "POST", { name: "demo", skills: [], packages: [] });
    assert.equal(created.status, 202);
    const accepted = JSON.parse(created.body) as { operationId: string; localRecordSaved: boolean };
    assert.equal(accepted.localRecordSaved, true);
    const known = await localApi(port, "known-operations", auth);
    assert.equal((JSON.parse(known.body) as { operations: { operationId: string }[] }).operations[0]?.operationId, accepted.operationId);
    const ownerRequest = forwarded.find((call) => call.path === "/api/v1/works" && call.method === "POST");
    assert.equal(ownerRequest?.headers.authorization, "Bearer owner-api-token");
    assert.equal(ownerRequest?.headers["x-piwork-csrf"], undefined);
    assert.equal(ownerRequest?.headers.cookie, undefined);
    assert(forwarded.every((call) => !call.path.startsWith("/control") && !call.path.includes("/admin")));
  } finally {
    assert.equal(await stop(child), 130);
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed system browser opener leaves Desktop available", async () => {
  const port = await freePort();
  const child = await launch(port, [], { ...process.env, PATH: "/no-such-browser-bin" });
  try {
    assert.equal((await localGet(port, "/", `desktop.localhost:${port}`)).status, 200);
  } finally {
    assert.equal(await stop(child), 130);
  }
});

test("desktop serves only exact local Host and releases its port on SIGINT", async () => {
  const port = await freePort();
  const child = await launch(port, ["--no-open"]);
  try {
    const ok = await localGet(port, "/", `desktop.localhost:${port}`);
    assert.equal(ok.status, 200);
    assert.match(ok.body, /Piwork Desktop/);
    const script = await localGet(port, "/desktop/browser/app.js", `desktop.localhost:${port}`);
    assert.equal(script.status, 200);
    assert.match(script.body, /_desktop\/api\/bootstrap/);
    for (const host of [`evil.localhost:${port}`, `desktop.localhost:${port + 1}`, `desktop.localhost.:${port}`]) {
      assert.equal((await localGet(port, "/", host)).status, 403);
    }
    assert.equal((await localGet(port, "/not-found", `desktop.localhost:${port}`)).status, 404);
    assert.equal(run(["desktop", "--port", String(port), "--no-open"]).status, 6);
  } finally {
    assert.equal(await stop(child), 130);
  }
  const server = createServer((_request, response) => response.end("free"));
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  await new Promise<void>((done) => server.close(() => done()));
});

test("Desktop SIGTERM leaves a concurrent proxy and Core work untouched", async () => {
  const calls: string[] = [];
  const core = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    if (request.url === "/api/v1/service-access") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: 1, protocols: ["http", "ws"] }));
    } else { response.writeHead(404, { "content-type": "application/json" }); response.end("{}"); }
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address();
  assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-process-"));
  const credentialPath = join(directory, "client.json");
  await new FileCredentialStore(credentialPath).save({ version: 1, coreUrl, token: "test-token",
    expiresAt: "2099-01-01T00:00:00.000Z", user: { id: "user-test", account: "tester", role: "user" } });
  const env = { ...process.env, PIWORK_CONFIG_PATH: credentialPath };
  const proxyPort = await freePort(), desktopPort = await freePort();
  const proxy = spawn(process.execPath, [cli, "--core", coreUrl, "proxy", "--port", String(proxyPort)], { env });
  let desktop: ChildProcessWithoutNullStreams | undefined;
  try {
    await new Promise<void>((done, fail) => {
      let stderr = "";
      proxy.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
      proxy.stdout.on("data", (data: Buffer) => { if (data.toString().includes(`Proxy: http://127.0.0.1:${proxyPort}`)) done(); });
      proxy.once("exit", (code) => fail(new Error(`Proxy exited ${code}: ${stderr}`)));
      setTimeout(() => fail(new Error("Proxy did not start")), 4000).unref();
    });
    desktop = await launch(desktopPort, ["--no-open"], env);
    const completed = new Promise<number | null>((done) => desktop!.once("exit", done));
    desktop.kill("SIGTERM");
    assert.equal(await completed, 143);
    assert.equal(proxy.exitCode, null);
    assert.equal((await localGet(proxyPort, "/proxy.pac", `127.0.0.1:${proxyPort}`)).status, 200);
    assert(calls.every((call) => call.startsWith("GET ")));
  } finally {
    if (desktop && desktop.exitCode === null) desktop.kill("SIGINT");
    if (proxy.exitCode === null) await stop(proxy);
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("Desktop Pi Package upload accepts a local directory only in its Work scope", async () => {
  const calls: string[] = [];
  const sources: string[] = [];
  let uploaded = Buffer.alloc(0);
  const core = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/me") response.end(JSON.stringify({ id: "owner", account: "owner", role: "user", expiresAt: "2099-01-01T00:00:00.000Z" }));
    else if (request.url === "/api/v1/works/work-a" && request.method === "GET") response.end(JSON.stringify({ id: "work-a", name: "Work A" }));
    else if (request.url === "/api/v1/works/work-a/package-uploads" && request.method === "POST") {
      const pieces: Buffer[] = [];
      for await (const piece of request) pieces.push(piece as Buffer);
      uploaded = Buffer.concat(pieces);
      assert.equal(request.headers["x-piwork-sha256"], createHash("sha256").update(uploaded).digest("hex"));
      assert.equal(Number(request.headers["content-length"]), uploaded.length);
      sources.push(String(request.headers["x-piwork-package-source"]));
      response.end(JSON.stringify({ uploadId: "upload-a", expiresAt: "2099-01-01T00:00:00.000Z" }));
    } else { response.writeHead(404); response.end("{}"); }
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const address = core.address(); assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-desktop-pi-package-"));
  const credentialPath = join(directory, "client.json");
  await new FileCredentialStore(credentialPath).save({ version: 1, coreUrl, token: "owner-token",
    expiresAt: "2099-01-01T00:00:00.000Z", user: { id: "owner", account: "owner", role: "user" } });
  const port = await freePort();
  const child = spawn(process.execPath, [cli, "--core", coreUrl, "desktop", "--port", String(port), "--no-open"],
    { env: { ...process.env, PIWORK_CONFIG_PATH: credentialPath } });
  await new Promise<void>((done, fail) => {
    child.stdout.on("data", (data: Buffer) => { const url = data.toString().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/);
      if (url) { launchUrls.set(child, url[0]); done(); } });
    child.once("exit", (code) => fail(new Error(`Desktop exited ${code}`)));
    setTimeout(() => fail(new Error("Desktop did not start")), 4000).unref();
  });
  try {
    const auth = await authorize(port, child);
    const boundary = "desktop-pi-package-test";
    const multipart = (kind: "local" | "zip", filename: string, content: Buffer) => Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${kind === "zip" ? "zip" : "files"}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const send = (kind: "local" | "zip", filename: string, content: Buffer) => localRequest(port, "/_desktop/api/works/work-a/package-uploads", `desktop.localhost:${port}`, {
      method: "POST", headers: { Origin: `http://desktop.localhost:${port}`, Cookie: auth.cookie,
        "Sec-Fetch-Site": "same-origin", "X-Piwork-Csrf": auth.csrf,
        "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: multipart(kind, filename, content),
    });
    const manifest = Buffer.from('{"name":"tools","version":"1.0.0"}');
    const invalid = await send("local", "folder/../package.json", manifest);
    assert.equal(invalid.status, 400);
    assert(!calls.some((call) => call.includes("package-uploads")));
    const valid = await send("local", "folder/package.json", manifest);
    assert.equal(valid.status, 201, valid.body);
    assert.equal((JSON.parse(valid.body) as { uploadId: string }).uploadId, "upload-a");
    const invalidZip = await send("zip", "broken.zip", Buffer.from("not a ZIP"));
    assert.equal(invalidZip.status, 400);
    const source = join(directory, "source"); await mkdir(source);
    await writeFile(join(source, "package.json"), manifest);
    const zipPath = join(directory, "tools.zip"); await packPiPackageDirectory(source, zipPath);
    const validZip = await send("zip", "tools.zip", await readFile(zipPath));
    assert.equal(validZip.status, 201, validZip.body);
    assert(uploaded.length > 0);
    assert.deepEqual(sources, ["local", "zip"]);
    assert(calls.includes("POST /api/v1/works/work-a/package-uploads"));
    assert(!calls.some((call) => call.includes("/admin/") || call.includes("/control/package-uploads")));
  } finally {
    assert.equal(await stop(child), 130);
    await new Promise<void>((done) => core.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
