import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packPiPackageDirectory } from "@piwork/pi-package";
import { createConsoleServer, readBody } from "./server.js";

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const address = listener.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((done) => listener.close(() => done()));
  return address.port;
}
test("ordinary console JSON intake has an absolute deadline despite slow input", async () => {
  const input = new PassThrough();
  input.write("{");
  await assert.rejects(readBody(input as unknown as import("node:http").IncomingMessage, 25), (error: { code?: string; status?: number }) =>
    error.code === "CONSOLE_REQUEST_TIMEOUT" && error.status === 408);
  assert.equal(input.destroyed, true);
});
test("console CLI help and argument errors require no Core or certificate", () => {
  const cli = new URL("./cli.js", import.meta.url).pathname;
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0); assert.match(help.stdout, /piwork-console serve/);
  const invalid = spawnSync(process.execPath, [cli, "serve"], { encoding: "utf8" });
  assert.equal(invalid.status, 2); assert.match(invalid.stderr, /public-origin/);
});

test("console CLI enforces loopback, TLS, and exclusive data directory without requiring Core", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-console-cli-"));
  const certPath = join(root, "cert.pem"), keyPath = join(root, "key.pem"), dataDir = join(root, "data");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const port = await freePort(), cli = new URL("./cli.js", import.meta.url).pathname;
  const args = ["serve", "--core", "http://127.0.0.1:1", "--listen", `127.0.0.1:${port}`,
    "--public-origin", `https://127.0.0.1:${port}`, "--tls-cert", certPath, "--tls-key", keyPath, "--data-dir", dataDir];
  const invalidCore = spawnSync(process.execPath, [cli, ...args.map((part) => part === "http://127.0.0.1:1" ? "http://192.0.2.1:1" : part)], { encoding: "utf8" });
  assert.equal(invalidCore.status, 2);
  const invalidOrigin = spawnSync(process.execPath, [cli, ...args.map((part) => part === `https://127.0.0.1:${port}` ? `http://127.0.0.1:${port}` : part)], { encoding: "utf8" });
  assert.equal(invalidOrigin.status, 2);
  await mkdir(dataDir, { mode: 0o700 });
  await mkdir(join(dataDir, "staging", "orphan"), { recursive: true });
  await writeFile(join(dataDir, "staging", "orphan", "part"), "partial");
  const first = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      first.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.includes("listening at")) resolve(); });
      first.once("exit", (code) => reject(new Error(`console exited before listen: ${code}`)));
      setTimeout(() => reject(new Error("console did not listen")), 5000).unref();
    });
    assert.deepEqual(await readdir(join(dataDir, "staging")), []);
    const second = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.deepEqual(await readdir(join(dataDir, "staging")), [], "second process cannot clean active staging");
  } finally {
    if (first.exitCode === null) { first.kill("SIGTERM");
      await new Promise<void>((resolve) => first.once("exit", () => resolve())); }
    await rm(root, { recursive: true, force: true });
  }
});

test("console stops an active Core upload and clears staging within ten seconds", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-console-stop-upload-"));
  const certPath = join(root, "cert.pem"), keyPath = join(root, "key.pem"), dataDir = join(root, "data");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const source = join(root, "package"); await mkdir(source);
  await writeFile(join(source, "package.json"), '{"name":"stop-tools","version":"1.0.0"}');
  const zip = join(root, "package.zip"); await packPiPackageDirectory(source, zip);
  let uploadStarted!: () => void;
  const started = new Promise<void>((resolve) => { uploadStarted = resolve; });
  const core = createHttpServer(async (incoming, response) => {
    if (incoming.url === "/api/v1/admin/package-uploads") {
      for await (const _chunk of incoming) { /* Keep the response pending after the complete upload. */ }
      uploadStarted(); return;
    }
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk);
    response.setHeader("content-type", "application/json");
    if (incoming.url === "/api/v1/login") response.end(JSON.stringify({ token: "shutdown-token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      user: { id: "user-admin-00000001", account: "admin", role: "admin" } }));
    else if (incoming.url === "/api/v1/me") response.end(JSON.stringify({ id: "user-admin-00000001", account: "admin", role: "admin" }));
    else if (incoming.url === "/api/v1/admin/status") response.end('{"adminApiVersion":1,"state":"READY","ready":true,"checks":{}}');
    else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const coreAddress = core.address(); assert.ok(coreAddress && typeof coreAddress !== "string");
  const port = await freePort(), cli = new URL("./cli.js", import.meta.url).pathname, cert = await readFile(certPath);
  const origin = "https://127.0.0.1:" + port;
  const child = spawn(process.execPath, [cli, "serve", "--core", "http://127.0.0.1:" + coreAddress.port,
    "--listen", "127.0.0.1:" + port, "--public-origin", origin,
    "--tls-cert", certPath, "--tls-key", keyPath, "--data-dir", dataDir], { stdio: ["ignore", "pipe", "pipe"] });
  const send = (path: string, method = "GET", headers: Record<string, string> = {}, body?: Buffer | string) =>
    new Promise<{ body: string; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
      const wire = request({ hostname: "127.0.0.1", port, path, method, ca: cert, headers }, (reply) => {
        const parts: Buffer[] = []; reply.on("data", (chunk: Buffer) => parts.push(chunk));
        reply.on("end", () => resolve({ body: Buffer.concat(parts).toString(), headers: reply.headers }));
      });
      wire.on("error", reject); wire.end(body);
    });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.includes("listening at")) resolve(); });
      child.once("exit", (code) => reject(new Error("console exited before listen: " + code)));
      setTimeout(() => reject(new Error("console did not listen")), 5000).unref();
    });
    const challenge = await send("/console/api/session");
    const challengeCookie = challenge.headers["set-cookie"]?.find((item) => item.startsWith("__Host-piwork-login="))?.split(";", 1)[0];
    assert.ok(challengeCookie);
    const login = await send("/console/api/login", "POST", { cookie: challengeCookie, origin,
      "x-csrf-token": JSON.parse(challenge.body).csrfToken, "content-type": "application/json" },
      JSON.stringify({ account: "admin", password: "correct horse battery" }));
    const sessionCookie = login.headers["set-cookie"]?.find((item) => item.startsWith("__Host-piwork-console="))?.split(";", 1)[0];
    assert.ok(sessionCookie);
    const wire = request({ hostname: "127.0.0.1", port, path: "/console/api/package-inputs/zip",
      method: "POST", ca: cert, headers: { cookie: sessionCookie, origin,
        "x-csrf-token": JSON.parse(login.body).csrfToken, "content-type": "application/zip",
        "x-piwork-package-name": "package.zip" } });
    wire.on("error", () => undefined); wire.end(await readFile(zip));
    await Promise.race([started, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Core upload did not start")), 5000))]);
    const signalAt = Date.now(); child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    assert.ok(Date.now() - signalAt < 10_000, "console must exit before the shutdown deadline");
    assert.deepEqual(await readdir(join(dataDir, "staging")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []; throw error;
    }), []);
  } finally {
    if (child.exitCode === null) { child.kill("SIGKILL"); await new Promise<void>((done) => child.once("exit", () => done())); }
    core.closeAllConnections(); await new Promise<void>((done) => core.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTPS console serves fixed shell and login challenge while Core is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-console-test-"));
  const certPath = join(root, "cert.pem"), keyPath = join(root, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const cert = await readFile(certPath), key = await readFile(keyPath), port = await freePort();
  const server = await createConsoleServer({ coreUrl: "http://127.0.0.1:1", listenHost: "127.0.0.1", listenPort: port,
    publicOrigin: `https://127.0.0.1:${port}`, dataDir: root, cert, key });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const get = (path: string) => new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((done, fail) => {
    const req = request({ hostname: "127.0.0.1", port, path, ca: cert, method: "GET" }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => done({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on("error", fail); req.end();
  });
  try {
    const page = await get("/login"); assert.equal(page.status, 200); assert.match(page.body, /piwork 管理面板/);
    assert.match(String(page.headers["content-security-policy"]), /script-src 'self'/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal((await get("/unknown")).status, 404);
    const challenge = await get("/console/api/session"); assert.equal(challenge.status, 200);
    assert.match(String(challenge.headers["set-cookie"]), /__Host-piwork-login=.*Secure.*HttpOnly.*SameSite=Strict/);
    assert.equal(JSON.parse(challenge.body).authenticated, false);
    const availability = await get("/console/api/availability"); assert.equal(availability.status, 200);
    assert.equal(JSON.parse(availability.body).reachable, false);
    assert.equal((await get("/../private-file")).status, 404);
    assert.equal((await get("/console/api/admin/users")).status, 401);
    assert.equal((await get("/browser/unknown.js")).status, 404);
  } finally { await new Promise<void>((done) => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
});

test("console keeps Core bearer server side and enforces Origin and CSRF", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-console-session-"));
  const certPath = join(root, "cert.pem"), keyPath = join(root, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const cert = await readFile(certPath), key = await readFile(keyPath), port = await freePort();
  const coreCalls: Array<{ path: string; authorization?: string; method?: string; forwardedHost?: string; cookie?: string }> = [];
  let coreOnline = true, revoked = false, adminVersion = 1, meDelayMs = 0, largeResponse = false;
  const core = createHttpServer(async (req, res) => { coreCalls.push({ path: req.url ?? "", authorization: req.headers.authorization,
    method: req.method, forwardedHost: req.headers["x-forwarded-host"] as string | undefined, cookie: req.headers.cookie });
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    if (!coreOnline && req.url === "/api/v1/me") { req.socket.destroy(); return; }
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/login") { const body = JSON.parse(Buffer.concat(chunks).toString()) as { account: string };
      if (["wrong", "missing", "disabled"].includes(body.account)) { res.statusCode = 401; res.end('{"code":"AUTHENTICATION_FAILED"}'); return; }
      res.end(JSON.stringify({ token: "core-private-token", expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        user: { id: "admin-id", account: body.account, role: body.account === "plain" ? "user" : "admin" } })); return; }
    if (req.url === "/api/v1/me") { if (meDelayMs) await new Promise((done) => setTimeout(done, meDelayMs));
      if (revoked) { res.statusCode = 401; res.end("{}"); return; }
      res.end(JSON.stringify({ id: "admin-id", account: "admin", role: "admin" })); return; }
    if (req.url === "/api/v1/admin/status") { res.end(JSON.stringify({ adminApiVersion: adminVersion, state: "READY", ready: true, checks: {} })); return; }
    if (req.url === "/api/v1/admin/users") { res.statusCode = req.method === "POST" ? 201 : 200;
      res.end(JSON.stringify(req.method === "POST" ? { id: "user-id", account: "new" } :
        largeResponse ? { users: [], padding: "x".repeat(2 * 1024 * 1024) } : { users: [] })); return; }
    if (req.url === "/api/v1/logout") { res.end("{}"); return; }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const coreAddress = core.address(); assert.ok(coreAddress && typeof coreAddress !== "string");
  const config = { coreUrl: `http://127.0.0.1:${coreAddress.port}`, listenHost: "127.0.0.1", listenPort: port,
    publicOrigin: `https://127.0.0.1:${port}`, dataDir: root, cert, key };
  let server = await createConsoleServer(config);
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const send = (path: string, method = "GET", headers: Record<string, string> = {}, body?: string) =>
    new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((done, fail) => {
      const req = request({ hostname: "127.0.0.1", port, path, ca: cert, method, headers }, (res) => {
        const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      }); req.on("error", fail); req.end(body);
    });
  try {
    const challenge = await send("/console/api/session");
    const challengeCookie = String(challenge.headers["set-cookie"]?.[0]).split(";", 1)[0]!;
    const loginCsrf = JSON.parse(challenge.body).csrfToken as string;
    const origin = `https://127.0.0.1:${port}`;
    const login = await send("/console/api/login", "POST", { origin, cookie: challengeCookie,
      "x-csrf-token": loginCsrf, "content-type": "application/json" }, JSON.stringify({ account: "admin", password: "valid password" }));
    assert.equal(login.status, 200);
    assert.equal(login.body.includes("core-private-token"), false);
    const sessionCookie = (login.headers["set-cookie"] ?? []).find((item) => item.startsWith("__Host-piwork-console="))?.split(";", 1)[0];
    assert.ok(sessionCookie);
    const csrf = JSON.parse(login.body).csrfToken as string;
    const list = await send("/console/api/admin/users", "GET", { cookie: sessionCookie, authorization: "Bearer forged-browser-token",
      "x-forwarded-host": "attacker.example" });
    assert.equal(list.status, 200); assert.deepEqual(JSON.parse(list.body), { users: [] });
    const blocked = await send("/console/api/admin/users", "POST", { cookie: sessionCookie, origin, "content-type": "application/json" }, "{}");
    assert.equal(blocked.status, 403);
    const created = await send("/console/api/admin/users", "POST", { cookie: sessionCookie, origin,
      "x-csrf-token": csrf, "content-type": "application/json" }, JSON.stringify({ account: "new", password: "long password" }));
    assert.equal(created.status, 201);
    assert.equal(coreCalls.filter((item) => item.path === "/api/v1/admin/users" && item.method === "POST").length, 1);
    assert.ok(coreCalls.filter((item) => item.path.startsWith("/api/v1/admin/")).every((item) => item.authorization === "Bearer core-private-token"));
    assert.ok(coreCalls.filter((item) => item.path.startsWith("/api/v1/admin/")).every((item) => !item.forwardedHost && !item.cookie));
    largeResponse = true;
    const oversizedUpstream = await send("/console/api/admin/users", "GET", { cookie: sessionCookie });
    assert.equal(oversizedUpstream.status, 502);
    assert.equal(JSON.parse(oversizedUpstream.body).code, "CORE_INVALID_RESPONSE");
    largeResponse = false;
    const oversizedRequest = await send("/console/api/admin/users", "POST", { cookie: sessionCookie, origin,
      "x-csrf-token": csrf, "content-type": "application/json" }, "x".repeat(2 * 1024 * 1024 + 1));
    assert.equal(oversizedRequest.status, 413);
    assert.equal((await send("/console/api/admin/unknown", "GET", { cookie: sessionCookie })).status, 404);
    assert.equal((await send("/console/api/admin/users", "POST", { cookie: sessionCookie, origin: "https://evil.example",
      "x-csrf-token": csrf, "content-type": "application/json" }, "{}")).status, 403);
    const boundary = "piwork-slow-upload";
    const slowUpload = () => {
      const wire = request({ hostname: "127.0.0.1", port, path: "/console/api/package-inputs/directory", ca: cert,
        method: "POST", headers: { cookie: sessionCookie, origin, "x-csrf-token": csrf,
          "content-type": `multipart/form-data; boundary=${boundary}` } });
      wire.on("error", () => undefined);
      wire.write(`--${boundary}\r\nContent-Disposition: form-data; name="directoryName"\r\n\r\nslow\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="package.json"\r\n\r\n{"name":"slow"`);
      return wire;
    };
    const firstUpload = slowUpload(), secondUpload = slowUpload();
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        if ((await readdir(join(root, "staging")).catch(() => [])).length === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await readdir(join(root, "staging"))).length, 2);
      const thirdUpload = await send("/console/api/package-inputs/directory", "POST", { cookie: sessionCookie, origin,
        "x-csrf-token": csrf, "content-type": `multipart/form-data; boundary=${boundary}` }, "");
      assert.equal(thirdUpload.status, 429);
      assert.equal(JSON.parse(thirdUpload.body).code, "CONSOLE_UPLOAD_BUSY");
    } finally { firstUpload.destroy(); secondUpload.destroy(); }
    for (let attempt = 0; attempt < 30 && (await readdir(join(root, "staging"))).length > 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(await readdir(join(root, "staging")), []);
    const secondChallenge = await send("/console/api/session");
    const secondChallengeCookie = String(secondChallenge.headers["set-cookie"]?.[0]).split(";", 1)[0]!;
    const secondCsrf = JSON.parse(secondChallenge.body).csrfToken as string;
    const ordinary = await send("/console/api/login", "POST", { origin, cookie: secondChallengeCookie,
      "x-csrf-token": secondCsrf, "content-type": "application/json" }, JSON.stringify({ account: "plain", password: "valid password" }));
    assert.equal(ordinary.status, 403);
    const secondLogin = await send("/console/api/login", "POST", { origin, cookie: secondChallengeCookie,
      "x-csrf-token": secondCsrf, "content-type": "application/json" }, JSON.stringify({ account: "admin", password: "valid password" }));
    assert.equal(secondLogin.status, 200);
    const secondCookie = (secondLogin.headers["set-cookie"] ?? []).find((item) => item.startsWith("__Host-piwork-console="))?.split(";", 1)[0];
    assert.ok(secondCookie);
    const secondSessionCsrf = JSON.parse(secondLogin.body).csrfToken as string;
    assert.equal((await send("/console/api/admin/users", "POST", { cookie: secondCookie, origin,
      "x-csrf-token": csrf, "content-type": "application/json" }, "{}")).status, 403);
    const thirdChallenge = await send("/console/api/session");
    const thirdChallengeCookie = (thirdChallenge.headers["set-cookie"] ?? []).find((item) => item.startsWith("__Host-piwork-login="))?.split(";", 1)[0];
    assert.ok(thirdChallengeCookie);
    const thirdLogin = await send("/console/api/login", "POST", { origin, cookie: thirdChallengeCookie,
      "x-csrf-token": JSON.parse(thirdChallenge.body).csrfToken, "content-type": "application/json" },
    JSON.stringify({ account: "admin", password: "valid password" }));
    assert.equal(thirdLogin.status, 200);
    const thirdCookie = (thirdLogin.headers["set-cookie"] ?? []).find((item) => item.startsWith("__Host-piwork-console="))?.split(";", 1)[0];
    assert.ok(thirdCookie);
    coreOnline = false;
    const offline = await send("/console/api/session", "GET", { cookie: sessionCookie });
    assert.equal(offline.status, 502);
    assert.equal(offline.headers["set-cookie"], undefined, "Core outage does not clear the console session");
    coreOnline = true;
    assert.equal(JSON.parse((await send("/console/api/session", "GET", { cookie: sessionCookie })).body).authenticated, true);
    meDelayMs = 6000;
    const timeout = await send("/console/api/session", "GET", { cookie: sessionCookie });
    assert.equal(timeout.status, 504);
    assert.equal(JSON.parse(timeout.body).code, "CORE_TIMEOUT");
    assert.equal(timeout.headers["set-cookie"], undefined);
    meDelayMs = 0;
    assert.equal(JSON.parse((await send("/console/api/session", "GET", { cookie: sessionCookie })).body).authenticated, true);
    const loggedOut = await send("/console/api/logout", "POST", { cookie: sessionCookie, origin,
      "x-csrf-token": csrf, "content-type": "application/json" }, "{}");
    assert.equal(loggedOut.status, 200);
    assert.equal(JSON.parse((await send("/console/api/session", "GET", { cookie: secondCookie })).body).authenticated, true);
    revoked = true;
    const invalidated = await send("/console/api/session", "GET", { cookie: secondCookie });
    assert.equal(JSON.parse(invalidated.body).authenticated, false);
    assert.match(String(invalidated.headers["set-cookie"]), /__Host-piwork-console=;[^,]*Max-Age=0/);
    assert.equal((await send("/console/api/admin/users", "POST", { cookie: secondCookie, origin,
      "x-csrf-token": secondSessionCsrf, "content-type": "application/json" }, "{}")).status, 401);
    const challengeCookieForRate = (invalidated.headers["set-cookie"] ?? []).find((item) => item.startsWith("__Host-piwork-login="))?.split(";", 1)[0];
    assert.ok(challengeCookieForRate);
    const rateCsrf = JSON.parse(invalidated.body).csrfToken as string;
    adminVersion = 2;
    const incompatible = await send("/console/api/login", "POST", { cookie: challengeCookieForRate, origin,
      "x-csrf-token": rateCsrf, "content-type": "application/json" }, JSON.stringify({ account: "admin", password: "valid password" }));
    assert.equal(incompatible.status, 503);
    assert.equal(JSON.parse(incompatible.body).code, "CORE_ADMIN_API_UNAVAILABLE");
    adminVersion = 1;
    for (const account of ["missing", "disabled", "wrong", "wrong", "wrong"]) {
      const failed = await send("/console/api/login", "POST", { cookie: challengeCookieForRate, origin,
        "x-csrf-token": rateCsrf, "content-type": "application/json" }, JSON.stringify({ account, password: "invalid" }));
      assert.equal(failed.status, 401);
    }
    const limited = await send("/console/api/login", "POST", { cookie: challengeCookieForRate, origin,
      "x-csrf-token": rateCsrf, "content-type": "application/json" }, JSON.stringify({ account: "wrong", password: "invalid" }));
    assert.equal(limited.status, 429);
    assert.ok(JSON.parse(limited.body).retryAfterMs > 0);
    revoked = false;
    await new Promise<void>((done) => server.close(() => done()));
    server = await createConsoleServer(config);
    await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
    const afterRestart = await send("/console/api/session", "GET", { cookie: thirdCookie });
    assert.equal(JSON.parse(afterRestart.body).authenticated, false);
    assert.match(String(afterRestart.headers["set-cookie"]), /__Host-piwork-login=/);
    let firstCapacityCookie: string | undefined;
    for (let index = 0; index < 1025; index++) {
      const challengeForCapacity = await send("/console/api/session");
      const cookieForCapacity = (challengeForCapacity.headers["set-cookie"] ?? []).find((item) => item.startsWith("__Host-piwork-login="))?.split(";", 1)[0];
      assert.ok(cookieForCapacity);
      const admitted = await send("/console/api/login", "POST", { origin, cookie: cookieForCapacity,
        "x-csrf-token": JSON.parse(challengeForCapacity.body).csrfToken, "content-type": "application/json" },
      JSON.stringify({ account: "admin", password: "valid password" }));
      if (index === 1024) {
        assert.equal(admitted.status, 503);
        assert.equal(JSON.parse(admitted.body).code, "CONSOLE_SESSION_CAPACITY");
      } else {
        assert.equal(admitted.status, 200);
        if (index === 0) firstCapacityCookie = (admitted.headers["set-cookie"] ?? []).find((item) => item.startsWith("__Host-piwork-console="))?.split(";", 1)[0];
      }
    }
    assert.ok(firstCapacityCookie);
    assert.equal(JSON.parse((await send("/console/api/session", "GET", { cookie: firstCapacityCookie })).body).authenticated, true,
      "capacity refusal cannot evict a valid session");
    let newChallenges = 0;
    for (let index = 0; index < 2049; index++) {
      const current = await send("/console/api/session");
      if (current.status === 429) break;
      assert.equal(current.status, 200);
      newChallenges += 1;
    }
    assert.ok(newChallenges >= 2046 && newChallenges <= 2048);
    const challengeFull = await send("/console/api/session");
    assert.equal(challengeFull.status, 429);
    assert.equal(JSON.parse(challengeFull.body).code, "CONSOLE_CHALLENGE_CAPACITY");
    assert.equal(JSON.parse((await send("/console/api/session", "GET", { cookie: firstCapacityCookie })).body).authenticated, true);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await new Promise<void>((done) => core.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
