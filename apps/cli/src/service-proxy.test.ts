import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import type { PiworkClient } from "@piwork/client-sdk";
import { PiworkClient as RealPiworkClient } from "@piwork/client-sdk";
import { FILE_LIMITS } from "@piwork/contracts";
import { parseProxyPort, runServiceProxy, validateProxyCoreUrl } from "./service-proxy.js";

const hostname = "notes.w-a1b2c3d4.work";

test("proxy syntax and remote Core transport are checked before listening", () => {
  assert.equal(parseProxyPort([]), 17890);
  assert.equal(parseProxyPort(["--port", "65535"]), 65535);
  for (const args of [["--port"], ["--port", "0"], ["--port", "abc"], ["--port", "1", "--port", "2"]]) {
    assert.throws(() => parseProxyPort(args), (error) => (error as { exitCode?: number }).exitCode === 2);
  }
  assert.doesNotThrow(() => validateProxyCoreUrl("http://127.0.0.1:7171"));
  assert.doesNotThrow(() => validateProxyCoreUrl("https://core.example"));
  assert.throws(() => validateProxyCoreUrl("http://core.example"));
});

test("local proxy sends only registered HTTP service traffic and serves a scoped PAC", async () => {
  const upgradedSockets = new Set<import("node:stream").Duplex>();
  const app = createServer({ maxHeaderSize: 32 * 1024 }, (request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(`${request.method} ${request.url} ${request.headers.authorization}`);
  });
  app.on("upgrade", (request, socket) => {
    const denied = /^\/reject(401|403|404)$/.exec(request.url ?? "");
    if (denied) {
      const body = `app denied ${denied[1]}`;
      socket.end(`HTTP/1.1 ${denied[1]} App Denied\r\ncontent-type: text/plain\r\nset-cookie: app=denied\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
      return;
    }
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\nset-cookie: session=one; Path=/\r\nset-cookie: theme=two; Path=/\r\nx-app-handshake: accepted\r\nx-app-path: ${request.url}\r\n\r\n`);
    socket.on("data", (chunk) => socket.write(chunk));
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const appAddress = app.address(); assert.ok(appAddress && typeof appAddress !== "string");
  const free = createServer();
  await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
  const freeAddress = free.address(); assert.ok(freeAddress && typeof freeAddress !== "string");
  const port = freeAddress.port;
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const client = {
    async gatewayCapability() { return { version: 1, protocols: ["http", "sse", "websocket"] }; },
    async resolveService(host: string, requestedPort: number) {
      if (host !== hostname || requestedPort !== 80) throw Object.assign(new Error("not found"), { status: 404, code: "NOT_FOUND" });
      return { hostname: host, port: appAddress.port, workId: "work", serviceId: "service" };
    },
    gatewayRequest(input: { path: string; method: string; headers: Record<string, string> }, onResponse?: (response: IncomingMessage) => void) {
      return httpRequest({ host: "127.0.0.1", port: appAddress.port, path: input.path, method: input.method, headers: input.headers }, onResponse);
    },
  } as unknown as PiworkClient;
  await assert.rejects(runServiceProxy(client, appAddress.port, () => {}),
    (error) => (error as { exitCode?: number }).exitCode === 6);
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const running = runServiceProxy(client, port, () => ready());
  await started;
  const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
    request.end();
  });
  try {
    const response = await get(`http://${hostname}/hello?q=1`, { authorization: "Bearer app" });
    assert.deepEqual(response, { status: 200, body: "GET /hello?q=1 Bearer app" });
    const encodedPath = "/%2e%2e/raw/%252e?x=%2f&x=%252e";
    assert.equal((await get(`http://${hostname}${encodedPath}`)).body, `GET ${encodedPath} undefined`);
    assert.equal((await get(`http://${hostname}./health`)).status, 200);
    assert.equal((await get("http://example.com/")).status, 403);
    assert.equal((await get("https://notes.w-a1b2c3d4.work/")).status, 403);
    const pac = await get("/proxy.pac");
    assert.equal(pac.status, 200);
    assert.match(pac.body, /DIRECT/);
    assert.match(pac.body, new RegExp(`PROXY 127.0.0.1:${port}`));
    const ws = await new Promise<string>((resolve, reject) => {
      const request = httpRequest({ host: "127.0.0.1", port, path: `ws://${hostname}${encodedPath}`,
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "aGVsbG8=", "sec-websocket-version": "13", "x-test": "x".repeat(20 * 1024) } });
      request.on("upgrade", (response, socket) => {
        assert.deepEqual(response.headers["set-cookie"], ["session=one; Path=/", "theme=two; Path=/"]);
        assert.equal(response.headers["x-app-handshake"], "accepted");
        assert.equal(response.headers["x-app-path"], encodedPath);
        socket.once("data", (data) => { resolve(data.toString()); socket.destroy(); }); socket.write("echo");
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(ws, "echo");
    for (const status of [401, 403, 404]) {
      const rejected = await new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
        const request = httpRequest({ host: "127.0.0.1", port, path: `ws://${hostname}/reject${status}`,
          headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "aGVsbG8=", "sec-websocket-version": "13" } }, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString(), headers: response.headers }));
        });
        request.on("error", reject); request.end();
      });
      assert.equal(rejected.status, status);
      assert.equal(rejected.body, `app denied ${status}`);
      assert.deepEqual(rejected.headers["set-cookie"], ["app=denied"]);
      assert.equal((await get(`http://${hostname}/after-reject`)).status, 200, "application rejection leaves proxy running");
    }
    assert.equal((await get(`http://${hostname}/large`, { "x-test": "x".repeat(20 * 1024) })).status, 200);
    const rawRequest = (raw: string) => new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let output = "";
      socket.on("data", (chunk) => { output += chunk.toString(); });
      socket.once("close", () => resolve(output));
      socket.once("error", reject);
      socket.once("connect", () => socket.write(raw));
    });
    const huge = `X-Test: ${"x".repeat(33 * 1024)}\r\n`;
    for (const raw of [
      `GET http://${hostname}/ HTTP/1.1\r\nHost: ${hostname}\r\n${huge}\r\n`,
      `GET ws://${hostname}/socket HTTP/1.1\r\nHost: ${hostname}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${huge}\r\n`,
      `CONNECT ${hostname}:80 HTTP/1.1\r\nHost: ${hostname}:80\r\n${huge}\r\n`,
    ]) {
      const result = await rawRequest(raw);
      assert.match(result, /^HTTP\/1\.1 431/);
      assert.equal((result.match(/HTTP\/1\.1 /g) ?? []).length, 1, "oversized request receives one response");
      assert.match(result, /x-piwork-gateway-error: 1/i);
      assert.match(result, /HEADERS_TOO_LARGE/);
    }
    const oversizedTunnel = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let output = "", connected = false;
      socket.on("data", (chunk) => {
        output += chunk.toString();
        if (!connected && output.includes("\r\n\r\n")) {
          connected = true; output = "";
          socket.write(`GET /socket HTTP/1.1\r\nHost: ${hostname}:80\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${huge}\r\n`);
        }
      });
      socket.once("close", () => resolve(output));
      socket.once("error", reject);
      socket.write(`CONNECT ${hostname}:80 HTTP/1.1\r\nHost: ${hostname}:80\r\n\r\n`);
    });
    assert.match(oversizedTunnel, /^HTTP\/1\.1 431/);
    assert.match(oversizedTunnel, /x-piwork-gateway-error: 1/i);
    const pipelinedFrame = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let output = "", connected = false;
      socket.on("data", (chunk) => {
        output += chunk.toString();
        if (!connected && output.includes("\r\n\r\n")) {
          connected = true; output = "";
          socket.write(`GET /socket HTTP/1.1\r\nHost: ${hostname}:80\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n${"z".repeat(33 * 1024)}`);
        } else if (connected && output.includes("\r\n\r\n")) { resolve(output); socket.destroy(); }
      });
      socket.once("error", reject);
      socket.write(`CONNECT ${hostname}:80 HTTP/1.1\r\nHost: ${hostname}:80\r\n\r\n`);
    });
    assert.match(pipelinedFrame, /^HTTP\/1\.1 101/);
    const tunneled = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let buffer = "", phase = 0;
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        if (phase === 0 && buffer.includes("\r\n\r\n")) {
          assert.match(buffer, /^HTTP\/1\.1 200/);
          phase = 1; buffer = "";
          socket.write(`GET ${encodedPath} HTTP/1.1\r\nHost: ${hostname}:80\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: aGVsbG8=\r\nSec-WebSocket-Version: 13\r\nX-Test: ${"x".repeat(20 * 1024)}\r\n\r\n`);
        } else if (phase === 1 && buffer.includes("\r\n\r\n")) {
          assert.match(buffer, /^HTTP\/1\.1 101/);
          assert.equal((buffer.match(/^set-cookie:/gim) ?? []).length, 2);
          assert.match(buffer, /x-app-handshake: accepted/i);
          assert.match(buffer, /x-app-path: \/%2e%2e\/raw\/%252e\?x=%2f&x=%252e/i);
          phase = 2; buffer = ""; socket.write("through");
        } else if (phase === 2 && buffer.includes("through")) { resolve(buffer); socket.destroy(); }
      });
      socket.on("error", reject);
      socket.write(`CONNECT ${hostname}:80 HTTP/1.1\r\nHost: ${hostname}:80\r\n\r\n`);
    });
    assert.equal(tunneled, "through");
    const rejectedTunnel = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let output = "", connected = false;
      socket.on("data", (chunk) => {
        output += chunk.toString();
        if (!connected && output.includes("\r\n\r\n")) {
          connected = true; output = "";
          socket.write(`GET /reject403 HTTP/1.1\r\nHost: ${hostname}:80\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
        }
      });
      socket.once("close", () => resolve(output));
      socket.once("error", reject);
      socket.write(`CONNECT ${hostname}:80 HTTP/1.1\r\nHost: ${hostname}:80\r\n\r\n`);
    });
    assert.match(rejectedTunnel, /^HTTP\/1\.1 403/);
    assert.match(rejectedTunnel, /app denied 403$/);
    assert.equal((await get(`http://${hostname}/after-tunnel-reject`)).status, 200);
    const closedBareTunnel = await new Promise<boolean>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("data", () => socket.write("raw tcp payload"));
      socket.once("close", () => resolve(true));
      socket.once("error", reject);
      socket.write(`CONNECT ${hostname}:80 HTTP/1.1\r\nHost: ${hostname}:80\r\n\r\n`);
    });
    assert.equal(closedBareTunnel, true);
    const mismatchedHost = await new Promise<boolean>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("data", () => socket.write("GET /socket HTTP/1.1\r\nHost: other.w-a1b2c3d4.work\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"));
      socket.once("close", () => resolve(true));
      socket.once("error", reject);
      socket.write(`CONNECT ${hostname}:80 HTTP/1.1\r\nHost: ${hostname}:80\r\n\r\n`);
    });
    assert.equal(mismatchedHost, true);
    const secureConnect = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("data", (chunk) => { resolve(chunk.toString()); socket.destroy(); });
      socket.once("error", reject);
      socket.write(`CONNECT ${hostname}:443 HTTP/1.1\r\nHost: ${hostname}:443\r\n\r\n`);
    });
    assert.match(secureConnect, /^HTTP\/1\.1 403/);
  } finally {
    process.emit("SIGINT");
    assert.equal(await running, 130);
    for (const socket of upgradedSockets) socket.destroy();
    await new Promise<void>((resolve) => app.close(() => resolve()));
  }
});

test("platform WebSocket 401 ends the proxy with login exit code", async () => {
  const app = createServer((_request, response) => {
    response.writeHead(401, { "x-piwork-gateway-error": "1", "content-type": "application/json" });
    response.end('{"code":"AUTH_REQUIRED"}');
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address(); assert.ok(address && typeof address !== "string");
  const free = createServer();
  await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
  const freeAddress = free.address(); assert.ok(freeAddress && typeof freeAddress !== "string");
  const port = freeAddress.port;
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const client = {
    async gatewayCapability() { return { version: 1 }; },
    async resolveService() { return { hostname, port: 80, workId: "work", serviceId: "service" }; },
    gatewayRequest(input: { path: string; method: string; headers: Record<string, string> }, callback?: (response: IncomingMessage) => void) {
      return httpRequest({ host: "127.0.0.1", port: address.port, path: input.path, method: input.method, headers: input.headers }, callback);
    },
  } as unknown as PiworkClient;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const running = runServiceProxy(client, port, () => ready());
  await started;
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => {});
  socket.write(`GET ws://${hostname}/socket HTTP/1.1\r\nHost: ${hostname}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  assert.equal(await running, 3);
  socket.destroy();
  await new Promise<void>((resolve) => app.close(() => resolve()));
});

test("one proxy streams Work files with local Basic while service application credentials remain separate", async () => {
  const work = "work-test-12345678";
  const coreRoot = `/api/v1/works/${work}/files/`;
  const localRoot = `/works/${work}/files/`;
  let fileCalls = 0;
  let serviceCalls = 0;
  let lastServiceCookie: string | undefined;
  let failedUploads = 0;
  let lastDestination: string | undefined;
  let uploaded = Buffer.alloc(0);
  const core = createServer((request, response) => {
    if (request.url === "/api/v1/service-access") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ version: 1, protocols: ["http"] }));
      return;
    }
    if (request.url === "/api/v1/file-access") {
      assert.equal(request.headers.authorization, "Bearer platform-token");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ version: 1, protocol: "webdav", profile: "workspace-transfer-v1",
        available: true, reason: null, rootTemplate: "/api/v1/works/{workId}/files/", limits: FILE_LIMITS }));
      return;
    }
    if (request.url?.startsWith(coreRoot)) {
      fileCalls++;
      assert.equal(request.headers.authorization, "Bearer platform-token");
      assert.equal(request.headers.cookie, undefined);
      assert.equal(request.headers["proxy-authorization"], undefined);
      assert.equal(request.headers["x-piwork-spoof"], undefined);
      if (request.url === `${coreRoot}fail.bin` && request.method === "PUT") {
        failedUploads++;
        request.resume(); request.on("end", () => response.destroy());
      } else if (request.url === coreRoot && request.method === "GET") {
        response.writeHead(308, { location: coreRoot }); response.end();
      } else if (request.method === "PUT") {
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => { uploaded = Buffer.concat(chunks); response.writeHead(204); response.end(); });
      } else if (request.method === "COPY") {
        lastDestination = String(request.headers.destination);
        response.writeHead(201); response.end();
      } else if (request.method === "PROPFIND") {
        request.resume();
        request.on("end", () => {
          response.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
          response.end(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${coreRoot}hello%20world</d:href></d:response></d:multistatus>`);
        });
      } else {
        response.setHeader("content-type", "application/octet-stream");
        response.end(uploaded.length ? uploaded : Buffer.from("initial"));
      }
      return;
    }
    if (request.url === `/api/v1/service-gateway/${hostname}/80${localRoot}hello`) {
      serviceCalls++;
      lastServiceCookie = request.headers.cookie;
      response.end(`application:${request.headers.authorization}`);
      return;
    }
    if (request.url?.startsWith("/api/v1/service-access/resolve")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ hostname, port: 80, workId: work, serviceId: "service" }));
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => core.listen(0, "127.0.0.1", resolve));
  const address = core.address(); assert.ok(address && typeof address !== "string");
  const free = createServer();
  await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
  const freeAddress = free.address(); assert.ok(freeAddress && typeof freeAddress !== "string");
  const port = freeAddress.port;
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const client = new RealPiworkClient({ coreUrl: `http://127.0.0.1:${address.port}`, token: "platform-token" });
  let output = "";
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const running = runServiceProxy(client, port, (message) => { output = message; ready(); });
  await started;
  const password = /WebDAV password: ([A-Za-z0-9_-]+)/.exec(output)?.[1];
  assert.ok(password);
  const basic = `Basic ${Buffer.from(`piwork:${password}`).toString("base64")}`;
  const send = (path: string, method = "GET", headers: Record<string, string> = {}, body?: Buffer | string) =>
    new Promise<{ status: number; headers: IncomingMessage["headers"]; body: Buffer }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers,
          body: Buffer.concat(chunks) }));
      });
      req.on("error", reject); req.end(body);
    });
  try {
    assert.equal((await send(`${localRoot}hello`)).status, 401);
    assert.equal((await send(`${localRoot}hello`, "GET", { authorization: "Basic wrong" })).status, 401);
    assert.equal(fileCalls, 0);
    const read = await send(`${localRoot}hello`, "GET", { authorization: basic,
      cookie: "should=stay-local", "proxy-authorization": "secret", "x-piwork-spoof": "value" });
    assert.equal(read.status, 200);
    assert.equal(read.body.toString(), "initial");
    assert.equal((await send(`${localRoot}hello`, "GET", { authorization: `basic ${basic.slice(6)}` })).status, 200);
    assert.equal((await send(`${localRoot}hello`, "PUT", { authorization: basic }, "uploaded")).status, 204);
    assert.equal((await send(`${localRoot}hello`, "GET", { authorization: basic })).body.toString(), "uploaded");
    const redirect = await send(localRoot, "GET", { authorization: basic });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.location, localRoot);
    const listed = await send(`${localRoot}`, "PROPFIND", { authorization: basic, depth: "1" });
    assert.equal(listed.status, 207);
    assert.match(listed.body.toString(), new RegExp(`${localRoot}hello%20world`));
    assert.doesNotMatch(listed.body.toString(), /\/api\/v1\/works/);
    const copied = await send(`${localRoot}hello`, "COPY", { authorization: basic,
      destination: `http://127.0.0.1:${port}${localRoot}copy` });
    assert.equal(copied.status, 201);
    assert.equal(lastDestination, `${coreRoot}copy`);
    const failed = await send(`${localRoot}fail.bin`, "PUT", { authorization: basic }, "once");
    assert.equal(failed.status, 502);
    assert.equal(failedUploads, 1);
    const before = fileCalls;
    assert.equal((await send(`${localRoot}hello`, "COPY", { authorization: basic,
      destination: `http://evil.example/${localRoot}copy` })).status, 403);
    assert.equal(fileCalls, before);
    assert.equal((await send(`${localRoot}hello`, "GET", { authorization: basic, origin: "http://evil.example" })).status, 403);
    assert.equal((await send(`${localRoot}hello`, "GET", { authorization: basic, host: "evil.example" })).status, 403);
    assert.equal(fileCalls, before);
    const app = await send(`http://${hostname}${localRoot}hello`, "GET", { authorization: "Basic application", cookie: "app=session" });
    assert.equal(app.status, 200);
    assert.equal(app.body.toString(), "application:Basic application");
    assert.equal(lastServiceCookie, "app=session");
    assert.equal(serviceCalls, 1);
    for (const authorization of [basic, `basic ${basic.slice(6)}`, `bAsIc ${basic.slice(6)}`,
      `Basic ${basic.slice(6).replace(/=+$/, "")}`])
      assert.equal((await send(`http://${hostname}${localRoot}hello`, "GET", { authorization })).status, 403);
    assert.equal(serviceCalls, 1, "the temporary password never reaches the application");
    assert.equal((await send(`ws://${hostname}/socket`, "GET", { authorization: basic,
      connection: "Upgrade", upgrade: "websocket" })).status, 403);
  } finally {
    process.emit("SIGINT");
    assert.equal(await running, 130);
    await new Promise<void>((resolve) => core.close(() => resolve()));
  }
});

test("old Core leaves service proxy usable and file capability is rechecked", async () => {
  const work = "work-test-12345678";
  const free = createServer();
  await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
  const address = free.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => free.close(() => resolve()));
  let available = false;
  let fileCalls = 0;
  const core = createServer((request, response) => {
    if (request.url === "/health") response.end("service-ok");
    else { fileCalls++; response.end("file-ok"); }
  });
  await new Promise<void>((resolve) => core.listen(0, "127.0.0.1", resolve));
  const coreAddress = core.address(); assert.ok(coreAddress && typeof coreAddress !== "string");
  const client = {
    async gatewayCapability() { return { version: 1 }; },
    async fileAccessCapability() {
      if (!available) throw Object.assign(new Error("old Core"), { status: 404 });
      return { version: 1, protocol: "webdav", profile: "workspace-transfer-v1", available: true,
        reason: null, rootTemplate: "/api/v1/works/{workId}/files/", limits: FILE_LIMITS };
    },
    async resolveService() { return { hostname, port: 80, workId: work, serviceId: "service" }; },
    gatewayRequest(input: { path: string; method: string; headers: Record<string, string> }, callback?: (response: IncomingMessage) => void) {
      return httpRequest({ host: "127.0.0.1", port: coreAddress.port, path: input.path,
        method: input.method, headers: input.headers }, callback);
    },
    fileRequest(input: { path: string; method: string; headers: Record<string, string> }, callback?: (response: IncomingMessage) => void) {
      return httpRequest({ host: "127.0.0.1", port: coreAddress.port, path: input.path,
        method: input.method, headers: input.headers }, callback);
    },
  } as unknown as PiworkClient;
  let output = "";
  let ready!: () => void;
  const running = runServiceProxy(client, port, (message) => { output = message; ready(); });
  await new Promise<void>((resolve) => { ready = resolve; });
  const password = /WebDAV password: ([A-Za-z0-9_-]+)/.exec(output)?.[1];
  assert.ok(password);
  const request = (path: string, basic?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path,
      headers: basic ? { authorization: basic } : {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
    });
    req.once("error", reject); req.end();
  });
  try {
    const basic = `Basic ${Buffer.from(`piwork:${password}`).toString("base64")}`;
    assert.equal((await request(`/works/${work}/files/a`, basic)).status, 501);
    assert.equal((await request(`http://${hostname}/health`)).body, "service-ok");
    assert.equal(fileCalls, 0);
    available = true;
    assert.equal((await request(`/works/${work}/files/a`, basic)).body, "file-ok");
    assert.equal(fileCalls, 1);
  } finally {
    process.emit("SIGINT");
    assert.equal(await running, 130);
    await new Promise<void>((resolve) => core.close(() => resolve()));
  }
});

test("local WebDAV password changes on proxy restart", async () => {
  const free = createServer();
  await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
  const address = free.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const client = { async gatewayCapability() { return { version: 1 }; },
    async fileAccessCapability() { return { version: 1, protocol: "webdav", profile: "workspace-transfer-v1",
      available: true, reason: null, rootTemplate: "/api/v1/works/{workId}/files/", limits: FILE_LIMITS }; } } as unknown as PiworkClient;
  const start = async () => {
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    let output = "";
    const running = runServiceProxy(client, port, (message) => { output = message; ready(); });
    await started;
    return { running, password: /WebDAV password: ([A-Za-z0-9_-]+)/.exec(output)?.[1] };
  };
  const first = await start();
  assert.ok(first.password);
  process.emit("SIGINT");
  assert.equal(await first.running, 130);
  const second = await start();
  try {
    assert.ok(second.password);
    assert.notEqual(first.password, second.password);
    const response = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port,
        path: "/works/work-test-12345678/files/a", headers: {
          authorization: `Basic ${Buffer.from(`piwork:${first.password}`).toString("base64")}` } }, (incoming) => {
          incoming.resume(); incoming.on("end", () => resolve(incoming.statusCode!));
        });
      req.once("error", reject); req.end();
    });
    assert.equal(response, 401);
  } finally { process.emit("SIGINT"); assert.equal(await second.running, 130); }
});

test("trusted Core file 401 closes both proxy branches with login exit code", async () => {
  const core = createServer((request, response) => {
    if (request.url === "/api/v1/service-access") response.end(JSON.stringify({ version: 1, protocols: ["http"] }));
    else if (request.url === "/api/v1/file-access") response.end(JSON.stringify({ version: 1, protocol: "webdav",
      profile: "workspace-transfer-v1", available: true, reason: null,
      rootTemplate: "/api/v1/works/{workId}/files/", limits: FILE_LIMITS }));
    else { response.writeHead(401, { "content-type": "application/xml", "x-piwork-file-error": "AUTH_REQUIRED" });
      response.end('<d:error xmlns:d="DAV:"/>'); }
  });
  await new Promise<void>((resolve) => core.listen(0, "127.0.0.1", resolve));
  const coreAddress = core.address(); assert.ok(coreAddress && typeof coreAddress !== "string");
  const free = createServer();
  await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
  const freeAddress = free.address(); assert.ok(freeAddress && typeof freeAddress !== "string");
  const port = freeAddress.port;
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const client = new RealPiworkClient({ coreUrl: `http://127.0.0.1:${coreAddress.port}`, token: "expired" });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let output = "";
  const running = runServiceProxy(client, port, (message) => { output = message; ready(); });
  await started;
  const password = /WebDAV password: ([A-Za-z0-9_-]+)/.exec(output)?.[1];
  assert.ok(password);
  const req = httpRequest({ host: "127.0.0.1", port, path: "/works/work-test-12345678/files/a",
    headers: { authorization: `Basic ${Buffer.from(`piwork:${password}`).toString("base64")}` } });
  req.on("error", () => undefined);
  req.end();
  try { assert.equal(await running, 3); }
  finally { req.destroy(); await new Promise<void>((resolve) => core.close(() => resolve())); }
});
