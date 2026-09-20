import assert from "node:assert/strict";
import test from "node:test";
import { status as grpcStatus } from "@grpc/grpc-js";
import { mapError } from "./core-application.js";

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
