import { posix } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { IdentifierSchema, ResourceIdSchema, TimestampSchema } from "../common.js";

export const SERVICE_REQUEST_MAX_BYTES = 1_048_576;
export const SERVICE_WORKSPACE_PATH = "/var/data/workspace";
export const WORK_SERVICE_MCP_SERVER_ID = "work-services";
export const WORK_SERVICE_MCP_TOOL_NAMES = [
  "deployment_context",
  "service_create",
  "service_list",
  "service_get",
  "service_update",
  "service_start",
  "service_stop",
  "service_restart",
  "service_remove",
  "service_retry",
  "operation_get",
  "service_logs",
] as const;

export const ServiceImageSchema = Type.Object({
  reference: Type.String({ minLength: 1, maxLength: 2_048 }),
}, { additionalProperties: false });

export const ServiceMountSchema = Type.Object({
  source: Type.Literal("workspace"),
  target: Type.Literal(SERVICE_WORKSPACE_PATH),
  readOnly: Type.Boolean(),
}, { additionalProperties: false });

export const ServicePortSchema = Type.Object({
  name: IdentifierSchema,
  containerPort: Type.Integer({ minimum: 1, maximum: 65_535 }),
  protocol: Type.Union([Type.Literal("tcp"), Type.Literal("udp")]),
}, { additionalProperties: false });

export const ReadinessProbeSchema = Type.Object({
  kind: Type.Union([Type.Literal("tcp"), Type.Literal("http"), Type.Literal("exec")]),
  portName: Type.Optional(IdentifierSchema),
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  command: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), { minItems: 1, maxItems: 128 })),
  deadlineMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 300_000 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })),
}, { additionalProperties: false });

const ServiceDefinitionFields = {
  name: Type.String({ pattern: "^[a-z][a-z0-9-]{0,47}$", minLength: 1, maxLength: 48 }),
  image: ServiceImageSchema,
  command: Type.String({ minLength: 1, maxLength: 4_096 }),
  args: Type.Array(Type.String({ maxLength: 4_096 }), { maxItems: 128 }),
  environment: Type.Record(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 128 }), Type.String({ maxLength: 16_384 }), { maxProperties: 128 }),
  secretRefs: Type.Array(Type.Never(), { maxItems: 0 }),
  workingDirectory: Type.String({ minLength: 1, maxLength: 4_096 }),
  mounts: Type.Array(ServiceMountSchema, { maxItems: 1 }),
  ports: Type.Array(ServicePortSchema, { maxItems: 64 }),
  cpuMillis: Type.Integer({ minimum: 10, maximum: 128_000 }),
  memoryBytes: Type.Integer({ minimum: 16 * 1_024 * 1_024 }),
  enabled: Type.Boolean(),
  required: Type.Boolean(),
  readiness: Type.Optional(ReadinessProbeSchema),
  restartPolicy: Type.Union([Type.Literal("never"), Type.Literal("bounded")]),
} as const;

export const ServiceDefinitionSchema = Type.Object({
  serviceId: ResourceIdSchema,
  revision: Type.Integer({ minimum: 1 }),
  ...ServiceDefinitionFields,
}, { additionalProperties: false });

export const ServiceDefinitionInputSchema = Type.Object({
  name: ServiceDefinitionFields.name,
  image: ServiceDefinitionFields.image,
  command: ServiceDefinitionFields.command,
  args: Type.Optional(ServiceDefinitionFields.args),
  environment: Type.Optional(ServiceDefinitionFields.environment),
  secretRefs: Type.Optional(ServiceDefinitionFields.secretRefs),
  workingDirectory: Type.Optional(ServiceDefinitionFields.workingDirectory),
  mounts: Type.Optional(ServiceDefinitionFields.mounts),
  ports: Type.Optional(ServiceDefinitionFields.ports),
  cpuMillis: Type.Optional(ServiceDefinitionFields.cpuMillis),
  memoryBytes: Type.Optional(ServiceDefinitionFields.memoryBytes),
  enabled: Type.Optional(ServiceDefinitionFields.enabled),
  required: Type.Optional(ServiceDefinitionFields.required),
  readiness: ServiceDefinitionFields.readiness,
  restartPolicy: Type.Optional(ServiceDefinitionFields.restartPolicy),
}, { additionalProperties: false });

export const ServiceEndpointSchema = Type.Object({
  name: IdentifierSchema,
  protocol: Type.Union([Type.Literal("tcp"), Type.Literal("udp")]),
  host: Type.String({ minLength: 1, maxLength: 64 }),
  port: Type.Integer({ minimum: 1, maximum: 65_535 }),
  url: Type.Optional(Type.String({ maxLength: 2_048 })),
}, { additionalProperties: false });

export class ServiceDefinitionValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
    readonly code: "INVALID_SERVICE_DEFINITION" | "UNSUPPORTED_SERVICE_OPTION" = "INVALID_SERVICE_DEFINITION",
  ) {
    super(message);
    this.name = "ServiceDefinitionValidationError";
  }
}

export function normalizeServiceDefinitionInput(value: unknown): NormalizedServiceDefinitionInput {
  let encoded: string;
  try { encoded = JSON.stringify(value); }
  catch { throw new ServiceDefinitionValidationError("request", "service request is not JSON serializable"); }
  if (typeof encoded !== "string") throw new ServiceDefinitionValidationError("definition", "service definition is required");
  if (Buffer.byteLength(encoded, "utf8") > SERVICE_REQUEST_MAX_BYTES) {
    throw new ServiceDefinitionValidationError("request", "service request exceeds 1 MiB");
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const supported = new Set(Object.keys(ServiceDefinitionInputSchema.properties));
    const unknown = Object.keys(value).find((key) => !supported.has(key));
    if (unknown !== undefined) throw new ServiceDefinitionValidationError(unknown, `${unknown} is not a supported service option`, "UNSUPPORTED_SERVICE_OPTION");
    const secretRefs = (value as { secretRefs?: unknown }).secretRefs;
    if (Array.isArray(secretRefs) && secretRefs.length > 0) {
      throw new ServiceDefinitionValidationError("secretRefs", "service secret references are unsupported in this version", "UNSUPPORTED_SERVICE_OPTION");
    }
  }
  if (!Check(ServiceDefinitionInputSchema, value)) {
    throw new ServiceDefinitionValidationError("definition", "service definition does not match the exact schema");
  }
  const input = value as ServiceDefinitionInput;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input.image.reference)
    || /\/\/[^/]*@/.test(input.image.reference)
    || /^[^/@]+:[^/@]+@/.test(input.image.reference)) {
    throw new ServiceDefinitionValidationError("image.reference", "image reference must not contain a URL scheme or embedded credentials");
  }
  if (input.command.includes("\0")) throw new ServiceDefinitionValidationError("command", "command contains NUL");
  if (Buffer.byteLength(input.command, "utf8") > 4_096) throw new ServiceDefinitionValidationError("command", "command exceeds 4096 bytes");
  if ((input.args ?? []).some((argument) => Buffer.byteLength(argument, "utf8") > 4_096 || argument.includes("\0"))) {
    throw new ServiceDefinitionValidationError("args", "an argument exceeds 4096 bytes or contains NUL");
  }
  if (Object.entries(input.environment ?? {}).some(([name, environmentValue]) => name.includes("\0") || environmentValue.includes("\0") || Buffer.byteLength(environmentValue, "utf8") > 16_384)) {
    throw new ServiceDefinitionValidationError("environment", "an environment entry exceeds its byte limit or contains NUL");
  }
  if (input.name === "agentd" || input.name === "piwork-core") {
    throw new ServiceDefinitionValidationError("name", "service name is reserved by the Work runtime");
  }
  const mounts = input.mounts ?? [];
  const workingDirectory = input.workingDirectory ?? SERVICE_WORKSPACE_PATH;
  if (workingDirectory.includes("\0") || !workingDirectory.startsWith("/") || posix.normalize(workingDirectory) !== workingDirectory) {
    throw new ServiceDefinitionValidationError("workingDirectory", "working directory must be a canonical absolute path");
  }
  if (mounts.length === 0 && workingDirectory !== "/") {
    throw new ServiceDefinitionValidationError("workingDirectory", "a workspace working directory requires an explicit workspace mount");
  }
  if (mounts.length === 1 && workingDirectory !== SERVICE_WORKSPACE_PATH && !workingDirectory.startsWith(`${SERVICE_WORKSPACE_PATH}/`)) {
    throw new ServiceDefinitionValidationError("workingDirectory", "working directory must remain inside the granted workspace");
  }
  const ports = input.ports ?? [];
  if (new Set(ports.map((port) => port.name)).size !== ports.length) throw new ServiceDefinitionValidationError("ports", "port names must be unique");
  if (new Set(ports.map((port) => `${port.protocol}:${port.containerPort}`)).size !== ports.length) throw new ServiceDefinitionValidationError("ports", "protocol and port pairs must be unique");
  const readiness = normalizeReadiness(input.readiness, ports);
  return {
    name: input.name,
    image: { reference: input.image.reference },
    command: input.command,
    args: [...(input.args ?? [])],
    environment: { ...(input.environment ?? {}) },
    secretRefs: [],
    workingDirectory,
    mounts: mounts.map((mount) => ({ ...mount })),
    ports: ports.map((port) => ({ ...port })),
    cpuMillis: input.cpuMillis ?? 250,
    memoryBytes: input.memoryBytes ?? 128 * 1_024 * 1_024,
    enabled: input.enabled ?? true,
    required: input.required ?? false,
    ...(readiness === undefined ? {} : { readiness }),
    restartPolicy: input.restartPolicy ?? "bounded",
  };
}

function normalizeReadiness(readiness: ServiceDefinitionInput["readiness"], ports: readonly ServicePort[]): NormalizedServiceDefinitionInput["readiness"] {
  if (readiness === undefined) return undefined;
  const common = { deadlineMs: readiness.deadlineMs ?? 120_000, timeoutMs: readiness.timeoutMs ?? 2_000 };
  if (readiness.kind === "exec") {
    if (readiness.command === undefined || readiness.portName !== undefined || readiness.path !== undefined) throw new ServiceDefinitionValidationError("readiness", "exec readiness requires only command");
    if (readiness.command.some((argument) => argument.includes("\0") || Buffer.byteLength(argument, "utf8") > 4_096)) throw new ServiceDefinitionValidationError("readiness.command", "readiness command contains an invalid argument");
    return { kind: "exec", command: [...readiness.command], ...common };
  }
  if (readiness.portName === undefined || readiness.command !== undefined) throw new ServiceDefinitionValidationError("readiness.portName", `${readiness.kind} readiness requires a TCP port name`);
  const port = ports.find((candidate) => candidate.name === readiness.portName);
  if (port === undefined || port.protocol !== "tcp") throw new ServiceDefinitionValidationError("readiness.portName", "readiness must reference a declared TCP port");
  if (readiness.kind === "tcp") {
    if (readiness.path !== undefined) throw new ServiceDefinitionValidationError("readiness.path", "TCP readiness does not accept a path");
    return { kind: "tcp", portName: readiness.portName, ...common };
  }
  if (readiness.path === undefined || !readiness.path.startsWith("/") || readiness.path.includes("\0") || posix.normalize(readiness.path) !== readiness.path) {
    throw new ServiceDefinitionValidationError("readiness.path", "HTTP readiness requires a canonical absolute path");
  }
  if (Buffer.byteLength(readiness.path, "utf8") > 2_048) throw new ServiceDefinitionValidationError("readiness.path", "readiness path exceeds 2048 bytes");
  return { kind: "http", portName: readiness.portName, path: readiness.path, ...common };
}

export type ServiceImage = Type.Static<typeof ServiceImageSchema>;
export type ServiceMount = Type.Static<typeof ServiceMountSchema>;
export type ServicePort = Type.Static<typeof ServicePortSchema>;
export type ReadinessProbe = Type.Static<typeof ReadinessProbeSchema>;
export type ServiceDefinition = Type.Static<typeof ServiceDefinitionSchema>;
export type ServiceDefinitionInput = Type.Static<typeof ServiceDefinitionInputSchema>;
export type NormalizedServiceDefinitionInput = Omit<ServiceDefinition, "serviceId" | "revision">;
export type ServiceEndpoint = Type.Static<typeof ServiceEndpointSchema>;
