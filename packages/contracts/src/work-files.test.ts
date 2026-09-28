import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  decodeFileHelperFrame,
  encodeFileHelperFrame,
  FILE_ACCESS_PROFILE,
  FILE_ERROR_STATUS,
  FILE_HELPER_FRAME_KIND,
  FILE_HELPER_MAX_CONTROL_BYTES,
  FILE_HELPER_MAX_DATA_BYTES,
  FILE_LIMITS,
  FILE_ROOT_TEMPLATE,
  FileAccessCapabilitySchema,
  FileHelperErrorSchema,
  FileHelperFrameError,
  FileHelperRequestSchema,
} from "./index.js";

test("file capability has exact fixed fields and rejects inconsistent availability", () => {
  const capability = {
    version: 1, protocol: "webdav", profile: FILE_ACCESS_PROFILE,
    available: true, reason: null, rootTemplate: FILE_ROOT_TEMPLATE, limits: FILE_LIMITS,
  };
  assert.equal(Check(FileAccessCapabilitySchema, capability), true);
  assert.equal(Check(FileAccessCapabilitySchema, { ...capability, available: false, reason: "FILE_HELPER_UNAVAILABLE" }), true);
  for (const malformed of [
    { ...capability, version: 2 },
    { ...capability, token: "secret" },
    { ...capability, limits: { ...FILE_LIMITS, maxFileBytes: 1 } },
    { ...capability, limits: { ...FILE_LIMITS, extra: 1 } },
    { ...capability, limits: Object.fromEntries(Object.entries(FILE_LIMITS).filter(([key]) => key !== "maxXmlBytes")) },
    { ...capability, reason: "FILE_HELPER_UNAVAILABLE" },
    { ...capability, available: false },
  ]) assert.equal(Check(FileAccessCapabilitySchema, malformed), false);
});

test("file error table covers every publicly specified code with one status", () => {
  const expected = {
    400: ["FILE_PATH_INVALID", "FILE_XML_INVALID", "FILE_REQUEST_INVALID", "FILE_CONDITION_UNSUPPORTED"],
    401: ["LOCAL_AUTH_REQUIRED", "AUTH_REQUIRED"],
    403: ["FILE_ROOT_PROTECTED", "FILE_PERMISSION_DENIED", "FILE_DESTINATION_DENIED", "FILE_DEPTH_UNSUPPORTED", "FILE_REQUEST_DENIED", "LOCAL_CREDENTIAL_TARGET_DENIED"],
    404: ["NOT_FOUND", "FILE_NOT_FOUND"],
    405: ["FILE_METHOD_NOT_ALLOWED"],
    409: ["WORK_FILES_UNAVAILABLE", "WORK_SNAPSHOT_BUSY", "FILE_CONFLICT", "FILE_TYPE_UNSUPPORTED", "FILE_NAME_UNSUPPORTED", "FILE_CLEANUP_REQUIRED"],
    412: ["FILE_PRECONDITION_FAILED"],
    413: ["FILE_LIMIT_EXCEEDED"],
    414: ["FILE_PATH_TOO_LONG"],
    415: ["FILE_MEDIA_UNSUPPORTED"],
    416: ["FILE_RANGE_UNSATISFIABLE"],
    429: ["FILE_ACCESS_BUSY"],
    431: ["HEADERS_TOO_LARGE"],
    501: ["FILE_ACCESS_UNSUPPORTED"],
    502: ["FILE_BACKEND_PROTOCOL_ERROR", "CORE_UNAVAILABLE"],
    503: ["FILE_HELPER_UNAVAILABLE", "FILE_RUNTIME_UNAVAILABLE"],
    504: ["FILE_TRANSFER_TIMEOUT"],
    507: ["FILE_STORAGE_FULL"],
  };
  assert.deepEqual(Object.entries(FILE_ERROR_STATUS).sort(), Object.entries(expected).flatMap(([status, codes]) => codes.map((code) => [code, Number(status)])).sort());
  for (const code of Object.keys(FILE_ERROR_STATUS)) assert.equal(Check(FileHelperErrorSchema, { code, pathSegments: null }), true);
  assert.equal(Check(FileHelperErrorSchema, { code: "INTERNAL", pathSegments: null }), false);
});

test("helper request is exact and requires core identity, epoch and typed operation fields", () => {
  const request = {
    version: 1, jobId: "filejob-0199e6d8abcd", workId: "work-0199e6d8abcd", epoch: 0,
    action: "PUT", pathSegments: ["文档", "note.txt"], destinationSegments: null,
    depth: null, overwrite: null,
    conditions: { ifMatch: null, ifNoneMatch: "*", ifModifiedSince: null, ifUnmodifiedSince: null },
    range: null, expectedLength: 3,
  };
  assert.equal(Check(FileHelperRequestSchema, request), true);
  for (const malformed of [
    { ...request, version: 2 }, { ...request, epoch: -1 }, { ...request, action: "EXEC" },
    { ...request, token: "secret" }, { ...request, conditions: {} },
    { ...request, expectedLength: FILE_LIMITS.maxFileBytes + 1 },
  ]) assert.equal(Check(FileHelperRequestSchema, malformed), false);
  const encoded = encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.REQUEST, request);
  assert.deepEqual(decodeFileHelperFrame(encoded), { kind: FILE_HELPER_FRAME_KIND.REQUEST, payload: request });
});

test("helper frames enforce 1 MiB data and 64 KiB control boundaries without JSON-encoding file bytes", () => {
  const binary = Buffer.alloc(FILE_HELPER_MAX_DATA_BYTES, 0xff);
  const frame = encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_TO_HELPER, binary);
  assert.equal(frame.readUInt32BE(1), binary.length);
  assert.deepEqual(decodeFileHelperFrame(frame), { kind: FILE_HELPER_FRAME_KIND.DATA_TO_HELPER, payload: binary });
  assert.throws(() => encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_TO_HELPER, Buffer.alloc(FILE_HELPER_MAX_DATA_BYTES + 1)), FileHelperFrameError);
  assert.throws(() => encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_TO_HELPER, "hello"), FileHelperFrameError);
  assert.throws(() => decodeFileHelperFrame(frame.subarray(0, -1)), FileHelperFrameError);
  const oversized = Buffer.alloc(5);
  oversized[0] = FILE_HELPER_FRAME_KIND.ERROR;
  oversized.writeUInt32BE(FILE_HELPER_MAX_CONTROL_BYTES + 1, 1);
  assert.throws(() => decodeFileHelperFrame(oversized), FileHelperFrameError);
  const invalidUtf8 = Buffer.from([FILE_HELPER_FRAME_KIND.ERROR, 0, 0, 0, 1, 0xff]);
  assert.throws(() => decodeFileHelperFrame(invalidUtf8), FileHelperFrameError);
  assert.throws(() => decodeFileHelperFrame(Buffer.from([0xff, 0, 0, 0, 0])), FileHelperFrameError);
  assert.deepEqual(decodeFileHelperFrame(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.END, {})), { kind: FILE_HELPER_FRAME_KIND.END, payload: {} });
  assert.throws(() => encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.END, { extra: true }), FileHelperFrameError);
});
