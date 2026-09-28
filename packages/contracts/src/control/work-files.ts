import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { ResourceIdSchema } from "../common.js";

export const FILE_ACCESS_VERSION = 1 as const;
export const FILE_ACCESS_PROFILE = "workspace-transfer-v1" as const;
export const FILE_ROOT_TEMPLATE = "/api/v1/works/{workId}/files/" as const;

export const FILE_LIMITS = {
  maxHeaderBytes: 32_768,
  maxXmlBytes: 65_536,
  maxXmlDepth: 32,
  maxProperties: 128,
  maxMetadataBytes: 16_777_216,
  maxDirectoryEntries: 10_000,
  maxTreeEntries: 10_000,
  maxFileBytes: 10_737_418_240,
  maxTreeBytes: 10_737_418_240,
  maxSegmentBytes: 255,
  maxPathBytes: 4_096,
  maxPathDepth: 128,
  maxCoreRequests: 16,
  maxUserRequests: 8,
  maxWorkRequests: 4,
  maxWorkMutations: 1,
  connectTimeoutMs: 10_000,
  helperTimeoutMs: 10_000,
  idleTimeoutMs: 60_000,
  requestTimeoutMs: 1_800_000,
  authorizationRecheckMs: 2_000,
} as const;

export const FileAccessLimitsSchema = Type.Object(
  Object.fromEntries(Object.entries(FILE_LIMITS).map(([key, value]) => [key, Type.Literal(value)])) as {
    [K in keyof typeof FILE_LIMITS]: ReturnType<typeof Type.Literal<(typeof FILE_LIMITS)[K]>>;
  },
  { additionalProperties: false },
);

const FileAccessCapabilityCommon = {
  version: Type.Literal(FILE_ACCESS_VERSION),
  protocol: Type.Literal("webdav"),
  profile: Type.Literal(FILE_ACCESS_PROFILE),
  rootTemplate: Type.Literal(FILE_ROOT_TEMPLATE),
  limits: FileAccessLimitsSchema,
} as const;

export const FileAccessCapabilitySchema = Type.Union([
  Type.Object({ ...FileAccessCapabilityCommon, available: Type.Literal(true), reason: Type.Null() }, { additionalProperties: false }),
  Type.Object({ ...FileAccessCapabilityCommon, available: Type.Literal(false), reason: Type.Literal("FILE_HELPER_UNAVAILABLE") }, { additionalProperties: false }),
]);

export type FileAccessCapability = Static<typeof FileAccessCapabilitySchema>;

export const FILE_METHODS = ["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "MKCOL", "COPY", "MOVE", "DELETE", "PROPPATCH"] as const;
export type FileMethod = (typeof FILE_METHODS)[number];

export const FILE_ERROR_STATUS = {
  FILE_PATH_INVALID: 400,
  FILE_XML_INVALID: 400,
  FILE_REQUEST_INVALID: 400,
  FILE_CONDITION_UNSUPPORTED: 400,
  LOCAL_AUTH_REQUIRED: 401,
  AUTH_REQUIRED: 401,
  FILE_ROOT_PROTECTED: 403,
  FILE_PERMISSION_DENIED: 403,
  FILE_DESTINATION_DENIED: 403,
  FILE_DEPTH_UNSUPPORTED: 403,
  FILE_REQUEST_DENIED: 403,
  LOCAL_CREDENTIAL_TARGET_DENIED: 403,
  NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  FILE_METHOD_NOT_ALLOWED: 405,
  WORK_FILES_UNAVAILABLE: 409,
  WORK_SNAPSHOT_BUSY: 409,
  FILE_CONFLICT: 409,
  FILE_TYPE_UNSUPPORTED: 409,
  FILE_NAME_UNSUPPORTED: 409,
  FILE_CLEANUP_REQUIRED: 409,
  FILE_PRECONDITION_FAILED: 412,
  FILE_LIMIT_EXCEEDED: 413,
  FILE_PATH_TOO_LONG: 414,
  FILE_MEDIA_UNSUPPORTED: 415,
  FILE_RANGE_UNSATISFIABLE: 416,
  FILE_ACCESS_BUSY: 429,
  HEADERS_TOO_LARGE: 431,
  FILE_ACCESS_UNSUPPORTED: 501,
  FILE_BACKEND_PROTOCOL_ERROR: 502,
  CORE_UNAVAILABLE: 502,
  FILE_HELPER_UNAVAILABLE: 503,
  FILE_RUNTIME_UNAVAILABLE: 503,
  FILE_TRANSFER_TIMEOUT: 504,
  FILE_STORAGE_FULL: 507,
} as const;
export type FileErrorCode = keyof typeof FILE_ERROR_STATUS;

export const FILE_HELPER_PROTOCOL_VERSION = 1 as const;
export const FILE_HELPER_MAX_DATA_BYTES = 1_048_576;
export const FILE_HELPER_MAX_CONTROL_BYTES = 65_536;
export const FILE_HELPER_FRAME_HEADER_BYTES = 5;

export const FILE_HELPER_FRAME_KIND = {
  REQUEST: 1,
  DATA_TO_HELPER: 2,
  END: 3,
  ACK: 4,
  CANCEL: 5,
  META: 17,
  DATA_FROM_HELPER: 18,
  PREPARED: 19,
  RESULT: 20,
  ERROR: 21,
} as const;
export type FileHelperFrameKind = (typeof FILE_HELPER_FRAME_KIND)[keyof typeof FILE_HELPER_FRAME_KIND];

const FilePathSegmentsSchema = Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: FILE_LIMITS.maxPathDepth });
const FileConditionSchema = Type.Object({
  ifMatch: Type.Union([Type.Null(), Type.String({ maxLength: 8_192 })]),
  ifNoneMatch: Type.Union([Type.Null(), Type.String({ maxLength: 8_192 })]),
  ifModifiedSince: Type.Union([Type.Null(), Type.String({ maxLength: 128 })]),
  ifUnmodifiedSince: Type.Union([Type.Null(), Type.String({ maxLength: 128 })]),
}, { additionalProperties: false });

export const FileHelperRequestSchema = Type.Object({
  version: Type.Literal(FILE_HELPER_PROTOCOL_VERSION),
  jobId: ResourceIdSchema,
  workId: ResourceIdSchema,
  epoch: Type.Integer({ minimum: 0 }),
  action: Type.Union([...FILE_METHODS.filter((method) => method !== "OPTIONS" && method !== "PROPPATCH").map((method) => Type.Literal(method)), Type.Literal("CLEANUP")]),
  pathSegments: FilePathSegmentsSchema,
  destinationSegments: Type.Union([Type.Null(), FilePathSegmentsSchema]),
  depth: Type.Union([Type.Null(), Type.Literal(0), Type.Literal(1), Type.Literal("infinity")]),
  overwrite: Type.Union([Type.Null(), Type.Boolean()]),
  conditions: FileConditionSchema,
  range: Type.Union([
    Type.Null(),
    Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Union([Type.Null(), Type.Integer({ minimum: 0 })]) }, { additionalProperties: false }),
    Type.Object({ suffix: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  ]),
  expectedLength: Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: FILE_LIMITS.maxFileBytes })]),
  temporaries: Type.Optional(Type.Array(Type.Object({
    temporaryId: ResourceIdSchema,
    parentSegments: FilePathSegmentsSchema,
    name: Type.String({ minLength: 1, maxLength: 255 }),
    device: Type.String({ pattern: "^[0-9]+$" }),
    inode: Type.String({ pattern: "^[0-9]+$" }),
  }, { additionalProperties: false }), { maxItems: FILE_LIMITS.maxTreeEntries })),
}, { additionalProperties: false });

export const FileHelperAckSchema = Type.Object({
  epoch: Type.Integer({ minimum: 0 }),
  phase: Type.Union([Type.Literal("temporary"), Type.Literal("commit")]),
  temporaryId: Type.Union([Type.Null(), ResourceIdSchema]),
}, { additionalProperties: false });

export const FileHelperPreparedSchema = Type.Object({
  epoch: Type.Integer({ minimum: 0 }),
  phase: Type.Union([Type.Literal("temporary"), Type.Literal("commit")]),
  temporaryId: Type.Union([Type.Null(), ResourceIdSchema]),
  parentSegments: FilePathSegmentsSchema,
  name: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 255 })]),
  device: Type.Union([Type.Null(), Type.String({ pattern: "^[0-9]+$" })]),
  inode: Type.Union([Type.Null(), Type.String({ pattern: "^[0-9]+$" })]),
}, { additionalProperties: false });

export const FileHelperMetaSchema = Type.Object({
  pathSegments: FilePathSegmentsSchema,
  kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("symlink"), Type.Literal("unsupported")]),
  size: Type.Union([Type.Null(), Type.Integer({ minimum: 0 })]),
  modifiedMs: Type.Union([Type.Null(), Type.Integer({ minimum: 0 })]),
}, { additionalProperties: false });

export const FileHelperResultSchema = Type.Object({
  status: Type.Integer({ minimum: 200, maximum: 599 }),
  bytes: Type.Integer({ minimum: 0 }),
  entries: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const FileHelperErrorSchema = Type.Object({
  code: Type.Union(Object.keys(FILE_ERROR_STATUS).map((code) => Type.Literal(code))),
  pathSegments: Type.Union([Type.Null(), FilePathSegmentsSchema]),
}, { additionalProperties: false });

export class FileHelperFrameError extends Error {
  constructor() { super("Invalid file helper frame"); this.name = "FileHelperFrameError"; }
}

const controlSchemas = new Map<number, typeof FileHelperRequestSchema | typeof FileHelperAckSchema | typeof FileHelperPreparedSchema | typeof FileHelperMetaSchema | typeof FileHelperResultSchema | typeof FileHelperErrorSchema | ReturnType<typeof Type.Object>>([
  [FILE_HELPER_FRAME_KIND.REQUEST, FileHelperRequestSchema],
  [FILE_HELPER_FRAME_KIND.END, Type.Object({}, { additionalProperties: false })],
  [FILE_HELPER_FRAME_KIND.ACK, FileHelperAckSchema],
  [FILE_HELPER_FRAME_KIND.CANCEL, Type.Object({}, { additionalProperties: false })],
  [FILE_HELPER_FRAME_KIND.META, FileHelperMetaSchema],
  [FILE_HELPER_FRAME_KIND.PREPARED, FileHelperPreparedSchema],
  [FILE_HELPER_FRAME_KIND.RESULT, FileHelperResultSchema],
  [FILE_HELPER_FRAME_KIND.ERROR, FileHelperErrorSchema],
]);

function isDataKind(kind: number): boolean {
  return kind === FILE_HELPER_FRAME_KIND.DATA_TO_HELPER || kind === FILE_HELPER_FRAME_KIND.DATA_FROM_HELPER;
}

export function encodeFileHelperFrame(kind: FileHelperFrameKind, payload: unknown): Buffer {
  const schema = controlSchemas.get(kind);
  let bytes: Buffer;
  if (isDataKind(kind)) {
    if (!Buffer.isBuffer(payload)) throw new FileHelperFrameError();
    bytes = payload;
  } else {
    if (schema === undefined || !Check(schema, payload)) throw new FileHelperFrameError();
    bytes = Buffer.from(JSON.stringify(payload), "utf8");
  }
  if (bytes.length > (isDataKind(kind) ? FILE_HELPER_MAX_DATA_BYTES : FILE_HELPER_MAX_CONTROL_BYTES)) throw new FileHelperFrameError();
  const header = Buffer.alloc(FILE_HELPER_FRAME_HEADER_BYTES);
  header.writeUInt8(kind, 0);
  header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}

export function decodeFileHelperFrame(frame: Buffer): { kind: FileHelperFrameKind; payload: unknown } {
  if (frame.length < FILE_HELPER_FRAME_HEADER_BYTES) throw new FileHelperFrameError();
  const kind = frame.readUInt8(0);
  const size = frame.readUInt32BE(1);
  const schema = controlSchemas.get(kind);
  if (!isDataKind(kind) && schema === undefined) throw new FileHelperFrameError();
  if (size > (isDataKind(kind) ? FILE_HELPER_MAX_DATA_BYTES : FILE_HELPER_MAX_CONTROL_BYTES)
    || frame.length !== FILE_HELPER_FRAME_HEADER_BYTES + size) throw new FileHelperFrameError();
  const bytes = frame.subarray(FILE_HELPER_FRAME_HEADER_BYTES);
  if (isDataKind(kind)) return { kind: kind as FileHelperFrameKind, payload: bytes };
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new FileHelperFrameError(); }
  if (!Check(schema!, payload)) throw new FileHelperFrameError();
  return { kind: kind as FileHelperFrameKind, payload };
}
