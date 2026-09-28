import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { ServiceDomainResolver } from "./service-domain-resolver.js";
import { ServiceGateway } from "./service-gateway.js";

test("gateway streams application HTTP and preserves application authentication without exposing Core token", async () => {
  const upgradedSockets = new Set<import("node:stream").Duplex>();
  const upstream = createServer((request, response) => {
    if (request.url === "/events") { response.writeHead(200, { "content-type": "text/event-stream" }); response.write("data: first\n\n"); setTimeout(() => response.end("data: second\n\n"), 60); return; }
    if (request.url === "/hold") { response.writeHead(200, { "content-type": "text/event-stream" }); response.write("data: hold\n\n"); return; }
    if (request.url === "/app-error") { response.writeHead(401, { "set-cookie": "app=expired" }); response.end("login required"); return; }
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/octet-stream", "set-cookie": "app=ok" });
      response.end(JSON.stringify({ path: request.url, host: request.headers.host, authorization: request.headers.authorization,
        cookie: request.headers.cookie, gatewayToken: request.headers["x-piwork-gateway-token"], body: Buffer.concat(chunks).toString("hex") }));
    });
  });
  upstream.on("upgrade", (request, socket) => {
    const denied = /^\/reject(401|403|404)$/.exec(request.url ?? "");
    if (denied) {
      const body = `app denied ${denied[1]}`;
      socket.end(`HTTP/1.1 ${denied[1]} App Denied\r\ncontent-type: text/plain\r\nset-cookie: app=denied\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
      return;
    }
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    socket.write("HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\nset-cookie: session=one; Path=/\r\nset-cookie: theme=two; Path=/\r\nx-piwork-gateway-error: 1\r\n\r\n");
    socket.on("data", (chunk) => socket.write(chunk));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const root = mkdtempSync(join(tmpdir(), "piwork-gateway-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const now = "2026-09-20T00:00:00Z", workId = "work-a1b2c3d4-0000-4000-8000-000000000001", serviceId = "service-1";
  const hostname = "notes.w-a1b2c3d4.work";
  try {
    store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${now}','${now}');
      INSERT INTO users VALUES ('other','other','digest','admin',1,'${now}','${now}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${workId}','owner','笔记','running','ready',1,1,'${now}','${now}');
      INSERT INTO service_heads VALUES ('${workId}','${serviceId}','notes',1,1,1,'ready',NULL,NULL)`);
    const definition = JSON.stringify({ name: "notes", ports: [{ name: "web", protocol: "tcp", containerPort: address.port }],
      readiness: { kind: "http", portName: "web", path: "/health" } });
    store.exec(`INSERT INTO service_revisions VALUES ('${workId}','${serviceId}',1,'${definition}',NULL,'${now}')`);
    store.assignWorkNetworkName(workId, now);
    store.assignServiceDomainLabel(workId, serviceId, "notes", now);
    let revoked = false;
    const identity = { authenticate(token: string) {
      if (revoked) throw new Error("revoked");
      if (token === "owner-token") return { user: { id: "owner" } };
      if (token === "other-token") return { user: { id: "other" } };
      throw new Error("revoked");
    } };
    let dockerUnknown = false, dockerDelayMs = 0;
    const resolver = new ServiceDomainResolver(store, async () => {
      if (dockerDelayMs) await new Promise((resolve) => { const timer = setTimeout(resolve, dockerDelayMs); timer.unref(); });
      if (dockerUnknown) throw new Error("Docker unavailable");
      return { exists: true, running: true };
    });
    let accepting = true;
    const gateway = new ServiceGateway(store, identity as never, resolver,
      () => ({ routeTarget: async () => { if (dockerDelayMs) await new Promise((resolve) => { const timer = setTimeout(resolve, dockerDelayMs); timer.unref(); }); return { address: "127.0.0.1" }; } }) as never, () => accepting,
      { perUser: 2, total: 3 });
    const core = createServer((request, response) => { void gateway.http(request, response); });
    core.on("upgrade", (request, socket, head) => { void gateway.upgrade(request, socket, head); });
    await new Promise<void>((resolve) => core.listen(0, "127.0.0.1", resolve));
    const coreAddress = core.address();
    assert.ok(coreAddress && typeof coreAddress !== "string");
    const send = (token: string, path: string, body = Buffer.alloc(0)) => new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const request = httpRequest({ host: "127.0.0.1", port: coreAddress.port, path, method: body.length ? "POST" : "GET",
        headers: { "x-piwork-gateway-token": token, authorization: "Bearer app-token", cookie: "app=session", "x-piwork-gateway-forged": "secret" } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      });
      request.on("error", reject);
      request.end(body);
    });
    try {
      const result = await send("owner-token", `/api/v1/service-gateway/${hostname}/80/upload?q=1`, Buffer.from([0, 255, 7]));
      assert.equal(result.status, 200);
      assert.deepEqual(result.headers["set-cookie"], ["app=ok"]);
      assert.deepEqual(JSON.parse(result.body), { path: "/upload?q=1", host: hostname, authorization: "Bearer app-token",
        cookie: "app=session", body: "00ff07" });
      const encodedPath = "/%2e%2e/raw/%252e?x=%2f&x=%252e";
      const encoded = await send("owner-token", `/api/v1/service-gateway/${hostname}/80${encodedPath}`);
      assert.equal(JSON.parse(encoded.body).path, encodedPath);
      const appError = await send("owner-token", `/api/v1/service-gateway/${hostname}/80/app-error`);
      assert.equal(appError.status, 401);
      assert.equal(appError.body, "login required");
      assert.equal(appError.headers["x-piwork-gateway-error"], undefined);
      for (const status of [401, 403, 404]) {
        const rejected = await new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
          const request = httpRequest({ host: "127.0.0.1", port: coreAddress.port,
            path: `/api/v1/service-gateway/${hostname}/80/reject${status}`,
            headers: { "x-piwork-gateway-token": "owner-token", connection: "Upgrade", upgrade: "websocket",
              "sec-websocket-key": "aGVsbG8=", "sec-websocket-version": "13" } }, (response) => {
              const chunks: Buffer[] = [];
              response.on("data", (chunk) => chunks.push(chunk));
              response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString() }));
            });
          request.once("error", reject); request.end();
        });
        assert.equal(rejected.status, status);
        assert.equal(rejected.body, `app denied ${status}`);
        assert.deepEqual(rejected.headers["set-cookie"], ["app=denied"]);
        assert.equal(rejected.headers["x-piwork-gateway-error"], undefined);
      }
      const denied = await send("other-token", `/api/v1/service-gateway/${hostname}/80/`);
      const unknown = await send("owner-token", "/api/v1/service-gateway/missing.w-a1b2c3d4.work/80/");
      assert.equal(denied.status, 404);
      assert.equal(unknown.status, 404);
      assert.equal(denied.body, unknown.body);
      assert.equal(denied.headers["x-piwork-gateway-error"], "1");
      const stopped = await send("owner-token", `/api/v1/service-gateway/${hostname}/9999/`);
      assert.equal(stopped.status, 404);
      const ipInjection = await send("owner-token", "/api/v1/service-gateway/127.0.0.1/80/");
      assert.equal(ipInjection.status, 404);
      accepting = false;
      const recovery = await send("owner-token", `/api/v1/service-gateway/${hostname}/80/`);
      assert.equal(recovery.status, 503);
      accepting = true;
      dockerUnknown = true;
      const unknownDocker = await send("owner-token", `/api/v1/service-gateway/${hostname}/80/`);
      assert.equal(unknownDocker.status, 502);
      dockerUnknown = false;
      store.exec(`UPDATE works SET desired_state = 'stopped', observed_state = 'stopped' WHERE id = '${workId}'`);
      assert.equal((await send("owner-token", `/api/v1/service-gateway/${hostname}/80/`)).status, 503);
      store.exec(`UPDATE works SET desired_state = 'running', observed_state = 'ready' WHERE id = '${workId}'`);
      store.exec(`UPDATE service_heads SET tombstoned_at = '${now}' WHERE work_id = '${workId}' AND service_id = '${serviceId}'`);
      assert.equal((await send("owner-token", `/api/v1/service-gateway/${hostname}/80/`)).status, 404);
      store.exec(`UPDATE service_heads SET tombstoned_at = NULL WHERE work_id = '${workId}' AND service_id = '${serviceId}'`);
      let eventStream: import("node:http").IncomingMessage | undefined;
      const firstEvent = await new Promise<string>((resolve, reject) => {
        const request = httpRequest({ host: "127.0.0.1", port: coreAddress.port,
          path: `/api/v1/service-gateway/${hostname}/80/events`, headers: { "x-piwork-gateway-token": "owner-token" } }, (response) => {
          eventStream = response;
          response.once("data", (chunk) => { resolve(chunk.toString()); response.resume(); });
        });
        request.once("error", reject); request.end();
      });
      assert.equal(firstEvent, "data: first\n\n");
      await new Promise<void>((resolve) => eventStream!.once("end", resolve));
      const hold = () => new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
        const request = httpRequest({ host: "127.0.0.1", port: coreAddress.port,
          path: `/api/v1/service-gateway/${hostname}/80/hold`, headers: { "x-piwork-gateway-token": "owner-token" } }, resolve);
        request.once("error", reject); request.end();
      });
      const firstHold = await hold(), secondHold = await hold();
      try {
        const limited = await send("owner-token", `/api/v1/service-gateway/${hostname}/80/`);
        assert.equal(limited.status, 503);
        assert.equal(JSON.parse(limited.body).code, "SERVICE_ACCESS_LIMIT");
      } finally { firstHold.destroy(); secondHold.destroy(); }
      let released = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const result = await send("owner-token", `/api/v1/service-gateway/${hostname}/80/`);
        if (result.status === 200) { released = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(released, true, "closed streams release gateway capacity");
      for (const mutation of [
        `UPDATE works SET desired_state = 'stopped' WHERE id = '${workId}'`,
        `UPDATE service_heads SET enabled = 0 WHERE work_id = '${workId}' AND service_id = '${serviceId}'`,
        `UPDATE service_heads SET tombstoned_at = '${now}' WHERE work_id = '${workId}' AND service_id = '${serviceId}'`,
      ]) {
        const stream = await hold();
        const closed = new Promise<void>((resolve) => stream.once("close", resolve));
        dockerDelayMs = 5_000;
        const started = Date.now();
        store.exec(mutation);
        await closed;
        assert.ok(Date.now() - started < 2_000, "SSE access closes within two seconds despite slow Docker checks");
        store.exec(`UPDATE works SET desired_state = 'running' WHERE id = '${workId}';
          UPDATE service_heads SET enabled = 1, tombstoned_at = NULL WHERE work_id = '${workId}' AND service_id = '${serviceId}'`);
        dockerDelayMs = 0;
      }
      const delayedStream = await hold();
      const delayedClose = new Promise<void>((resolve) => delayedStream.once("close", resolve));
      const dockerStallAt = Date.now();
      dockerDelayMs = 5_000;
      await delayedClose;
      assert.ok(Date.now() - dockerStallAt < 2_000, "a stalled Docker review closes SSE within two seconds");
      dockerDelayMs = 0;
      let revokedAt = 0;
      const closedAfterRevoke = await new Promise<boolean>((resolve, reject) => {
        const request = httpRequest({ host: "127.0.0.1", port: coreAddress.port,
          path: `/api/v1/service-gateway/${hostname}/80/socket`, headers: {
            "x-piwork-gateway-token": "owner-token", connection: "Upgrade", upgrade: "websocket",
            "sec-websocket-key": "aGVsbG8=", "sec-websocket-version": "13",
          } });
        request.once("upgrade", (response, socket) => {
          assert.deepEqual(response.headers["set-cookie"], ["session=one; Path=/", "theme=two; Path=/"]);
          assert.equal(response.headers["x-piwork-gateway-error"], undefined);
          socket.once("data", (chunk) => { if (chunk.toString() !== "ping") reject(new Error("WebSocket echo mismatch")); else { dockerDelayMs = 5_000; revokedAt = Date.now(); revoked = true; } });
          socket.once("close", () => resolve(true));
          socket.write("ping");
        });
        request.once("response", (response) => { response.resume(); reject(new Error(`WebSocket rejected with HTTP ${response.statusCode}`)); });
        request.once("error", reject); request.end();
      });
      assert.equal(closedAfterRevoke, true);
      assert.ok(Date.now() - revokedAt < 2_000, "WebSocket closes within two seconds after session revocation");
    } finally { await new Promise<void>((resolve) => core.close(() => resolve())); }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); for (const socket of upgradedSockets) socket.destroy(); await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
