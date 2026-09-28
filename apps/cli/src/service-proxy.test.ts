import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import type { PiworkClient } from "@piwork/client-sdk";
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
