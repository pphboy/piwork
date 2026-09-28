import assert from "node:assert/strict";
import test from "node:test";
import { status as grpcStatus } from "@grpc/grpc-js";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreApplication, mapError } from "./core-application.js";
import { ensureCorePaths } from "./paths.js";

test("Core maps authentication, gRPC dependency, conflict, busy, and cursor errors without internal detail", () => {
  assert.deepEqual(mapError(Object.assign(new Error("password=secret"), { name: "AuthenticationFailedError" })), {
    status: 401, code: "AUTHENTICATION_FAILED", message: "authentication failed",
  });
  assert.deepEqual(mapError({ code: grpcStatus.UNAVAILABLE, message: "docker socket secret" }), {
    status: 503, code: "RUNTIME_UNAVAILABLE", message: "runtime dependency is unavailable",
  });
  assert.deepEqual(mapError(Object.assign(new Error("raw conflict details"), { name: "WorkBusyError" })), {
    status: 409, code: "WORK_BUSY", message: "Work is busy",
  });
  assert.deepEqual(mapError({ code: grpcStatus.OUT_OF_RANGE, message: "cursor internals" }), {
    status: 416, code: "CURSOR_EXPIRED", message: "Run cursor has expired; query durable Run status or Session history",
  });
  assert.deepEqual(mapError(new Error("provider api-key-secret")), {
    status: 500, code: "INTERNAL_ERROR", message: "internal server error",
  });
  assert.deepEqual(mapError(Object.assign(new Error("model base URL is invalid"), { name: "InputValidationError" })), {
    status: 400, code: "INVALID_REQUEST", message: "model base URL is invalid",
  });
  assert.deepEqual(mapError(Object.assign(new Error("schema mismatch"), { name: "InvalidWorkConfigurationError" })), {
    status: 400, code: "INVALID_REQUEST", message: "schema mismatch",
  });
});

test("Core listener accepts 20 KiB request headers and marks requests over 32 KiB", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-core-header-limit-"));
  const app = await CoreApplication.create({ paths: ensureCorePaths(root) });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const raw = (request: string) => new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, "127.0.0.1");
      let response = "";
      socket.on("data", (chunk) => { response += chunk.toString(); });
      socket.once("close", () => resolve(response));
      socket.once("error", reject);
      socket.once("connect", () => socket.write(request));
    });
    for (const [method, target, upgrade] of [
      ["GET", "/api/v1/service-gateway/notes.w-a1b2c3d4.work/80/", ""],
      ["GET", "/api/v1/service-gateway/notes.w-a1b2c3d4.work/80/socket", "Connection: Upgrade\r\nUpgrade: websocket\r\n"],
      ["CONNECT", "notes.w-a1b2c3d4.work:80", ""],
    ]) {
      const prefix = `${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\n${upgrade}X-Test: `;
      const allowed = await raw(`${prefix}${"x".repeat(20 * 1024)}\r\n\r\n`);
      assert.doesNotMatch(allowed, /^HTTP\/1\.1 431/);
      const denied = await raw(`${prefix}${"x".repeat(33 * 1024)}\r\n\r\n`);
      assert.match(denied, /^HTTP\/1\.1 431/);
      assert.match(denied, /x-piwork-gateway-error: 1/i);
      assert.match(denied, /HEADERS_TOO_LARGE/);
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
