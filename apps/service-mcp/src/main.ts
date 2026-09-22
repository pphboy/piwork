#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ChannelCredentials, Metadata, type ClientUnaryCall, type ServiceError } from "@grpc/grpc-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { WORK_SERVICE_MCP_TOOL_NAMES, WorkServicesClient, type RpcServiceDefinition } from "@piwork/contracts";

interface AgentConfig {
  readonly serviceControl: {
    readonly endpoint: string; readonly serverName: string; readonly caCertificatePath: string;
    readonly clientCertificatePath: string; readonly clientPrivateKeyPath: string;
  };
}

const id = z.string().min(1).max(256);
const key = z.string().min(1).max(256);
const definitionSchema = {
  name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  image: z.object({ reference: z.string().min(1).max(2_048) }).strict(),
  command: z.string().min(1).max(4_096),
  args: z.array(z.string().max(4_096)).max(128).default([]),
  environment: z.record(z.string(), z.string().max(16_384)).default({}),
  secretRefs: z.array(z.never()).max(0).default([]),
  workingDirectory: z.string().default("/var/data/workspace"),
  mounts: z.array(z.object({ source: z.literal("workspace"), target: z.literal("/var/data/workspace"), readOnly: z.boolean() }).strict()).max(1).default([]),
  ports: z.array(z.object({ name: z.string(), containerPort: z.number().int().min(1).max(65_535), protocol: z.enum(["tcp", "udp"]) }).strict()).max(64).default([]),
  cpuMillis: z.number().int().min(10).max(128_000).default(250),
  memoryBytes: z.number().int().min(16 * 1_024 * 1_024).default(128 * 1_024 * 1_024),
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  readiness: z.object({
    kind: z.enum(["tcp", "http", "exec"]), portName: z.string().optional(), path: z.string().optional(),
    command: z.array(z.string()).max(128).optional(), deadlineMs: z.number().int().min(1_000).max(300_000).default(120_000),
    timeoutMs: z.number().int().min(1).max(2_000).default(2_000),
  }).strict().optional(),
  restartPolicy: z.enum(["never", "bounded"]).default("bounded"),
};

export function createServiceMcpServer(client: WorkServicesClient): McpServer {
const server = new McpServer({ name: "piwork-work-services", version: "0.1.0" });
server.registerTool(WORK_SERVICE_MCP_TOOL_NAMES[0], { description: "Read the current Work deployment scope and capacity", inputSchema: {} }, async () => result(await call((done) => client.getDeploymentContext({}, done))));
server.registerTool(WORK_SERVICE_MCP_TOOL_NAMES[1], { description: "Create a durable service from an existing image", inputSchema: { definition: z.object(definitionSchema).strict(), idempotencyKey: key } }, async ({ definition, idempotencyKey }) => result(await call((done) => client.createService({ definition: rpcDefinition(definition), idempotencyKey }, new Metadata(), deadline(10_000), done))));
server.registerTool(WORK_SERVICE_MCP_TOOL_NAMES[2], { description: "List services in this Work", inputSchema: {} }, async () => result(await call((done) => client.listServices({}, new Metadata(), deadline(5_000), done))));
server.registerTool(WORK_SERVICE_MCP_TOOL_NAMES[3], { description: "Inspect one service", inputSchema: { serviceId: id } }, async ({ serviceId }) => result(await call((done) => client.getService({ serviceId }, new Metadata(), deadline(5_000), done))));
server.registerTool(WORK_SERVICE_MCP_TOOL_NAMES[4], { description: "Replace a service definition", inputSchema: { serviceId: id, expectedRevision: z.number().int().min(1), definition: z.object(definitionSchema).strict(), idempotencyKey: key } }, async ({ serviceId, expectedRevision, definition, idempotencyKey }) => result(await call((done) => client.updateService({ serviceId, expectedRevision, definition: rpcDefinition(definition), idempotencyKey }, new Metadata(), deadline(10_000), done))));
registerMutation(WORK_SERVICE_MCP_TOOL_NAMES[5], "Enable and start a service", (request, metadata, options, done) => client.startService(request, metadata, options, done));
registerMutation(WORK_SERVICE_MCP_TOOL_NAMES[6], "Disable and stop a service", (request, metadata, options, done) => client.stopService(request, metadata, options, done));
registerMutation(WORK_SERVICE_MCP_TOOL_NAMES[7], "Restart an enabled service", (request, metadata, options, done) => client.restartService(request, metadata, options, done));
registerMutation(WORK_SERVICE_MCP_TOOL_NAMES[8], "Remove a service while retaining shared workspace data", (request, metadata, options, done) => client.removeService(request, metadata, options, done));
registerMutation(WORK_SERVICE_MCP_TOOL_NAMES[9], "Retry the current desired service revision", (request, metadata, options, done) => client.retryService(request, metadata, options, done));
server.registerTool(WORK_SERVICE_MCP_TOOL_NAMES[10], { description: "Inspect a durable service operation", inputSchema: { operationId: id } }, async ({ operationId }) => result(await call((done) => client.getOperation({ operationId }, new Metadata(), deadline(5_000), done))));
server.registerTool(WORK_SERVICE_MCP_TOOL_NAMES[11], { description: "Read bounded stdout/stderr from the bound service container", inputSchema: { serviceId: id, tailLines: z.number().int().min(1).max(200).default(100) } }, async ({ serviceId, tailLines }) => result(await call((done) => client.readServiceLogs({ serviceId, tailLines }, new Metadata(), deadline(2_000), done))));

function registerMutation(name: string, description: string, invoke: (request: { serviceId: string; idempotencyKey: string }, metadata: Metadata, options: { deadline: Date }, done: (error: ServiceError | null, response: any) => void) => ClientUnaryCall): void {
  server.registerTool(name, { description, inputSchema: { serviceId: id, idempotencyKey: key } }, async ({ serviceId, idempotencyKey }) => result(await call((done) => invoke({ serviceId, idempotencyKey }, new Metadata(), deadline(10_000), done))));
}
return server;
}

function rpcDefinition(value: z.output<z.ZodObject<typeof definitionSchema>>): RpcServiceDefinition {
  return {
    ...value,
    memoryBytes: BigInt(value.memoryBytes),
    readiness: value.readiness === undefined ? undefined : {
      kind: value.readiness.kind, portName: value.readiness.portName ?? "", path: value.readiness.path ?? "",
      command: value.readiness.command ?? [], deadlineMs: value.readiness.deadlineMs, timeoutMs: value.readiness.timeoutMs,
    },
  };
}

function call<T>(invoke: (done: (error: ServiceError | null, response: T) => void) => ClientUnaryCall): Promise<T> {
  return new Promise((resolve, reject) => invoke((error, response) => error === null ? resolve(response) : reject(error)));
}
function deadline(ms: number) { return { deadline: new Date(Date.now() + ms) }; }
function result(value: unknown) {
  const text = JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
  return {
    content: [{ type: "text" as const, text }],
    // grpc-js/ts-proto represents uint64 fields as bigint. MCP
    // structuredContent must contain JSON values, so return the normalized
    // value used by the textual response rather than leaking bigint.
    structuredContent: JSON.parse(text) as Record<string, unknown>,
  };
}
function readConfig(path: string): AgentConfig {
  const value = JSON.parse(readSecret(path).toString("utf8")) as Partial<AgentConfig>;
  if (value.serviceControl === undefined || typeof value.serviceControl.endpoint !== "string" || typeof value.serviceControl.serverName !== "string") throw new Error("private service control configuration is unavailable");
  return value as AgentConfig;
}
function readSecret(path: string): Buffer { const info = lstatSync(path); if (info.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > 1_048_576) throw new Error("private service control file is invalid"); return readFileSync(path); }

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = readConfig("/etc/piwork/service-control.json");
    const client = new WorkServicesClient(config.serviceControl.endpoint, ChannelCredentials.createSsl(
      readSecret(config.serviceControl.caCertificatePath),
      readSecret(config.serviceControl.clientPrivateKeyPath),
      readSecret(config.serviceControl.clientCertificatePath),
    ), {
      "grpc.ssl_target_name_override": config.serviceControl.serverName,
      "grpc.default_authority": config.serviceControl.serverName,
      "grpc.max_receive_message_length": 1_048_576,
    });
    await createServiceMcpServer(client).connect(new StdioServerTransport());
  } catch {
    process.stderr.write(`${JSON.stringify({
      component: "service-mcp", stage: "mcp-initialize", outcome: "failed",
      code: "MCP_INITIALIZATION_FAILED", message: "The Work service MCP adapter could not initialize.",
    })}\n`);
    process.exitCode = 1;
  }
}
