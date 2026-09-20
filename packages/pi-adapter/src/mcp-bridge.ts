import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type McpBridgeServer = {
  readonly serverId: string;
  readonly required: boolean;
  readonly timeoutMs?: number;
  readonly reconnectAttempts?: number;
} & (
  | { readonly transport: "stdio"; readonly command: string; readonly args?: readonly string[]; readonly environment?: Readonly<Record<string, string>> }
  | { readonly transport: "streamable-http"; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
);

export interface DiscoveredMcpTool {
  readonly serverId: string;
  readonly name: string;
  readonly namespacedName: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}

export class RequiredMcpUnavailableError extends Error {
  constructor(readonly serverId: string, override readonly cause: unknown) {
    super(`required MCP server ${serverId} is unavailable`);
    this.name = "RequiredMcpUnavailableError";
  }
}

interface ConnectedServer {
  readonly config: McpBridgeServer;
  readonly client: Client;
  readonly tools: readonly DiscoveredMcpTool[];
}

export class McpBridge {
  private readonly connected = new Map<string, ConnectedServer>();
  private readonly unavailable = new Set<string>();

  async initialize(servers: readonly McpBridgeServer[]): Promise<void> {
    const ids = new Set<string>();
    for (const server of servers) {
      if (ids.has(server.serverId)) throw new Error(`duplicate MCP server_id ${server.serverId}`);
      ids.add(server.serverId);
      try {
        const connected = await this.connectWithRetry(server);
        this.connected.set(server.serverId, connected);
      } catch (error) {
        this.unavailable.add(server.serverId);
        if (server.required) {
          await this.close();
          throw new RequiredMcpUnavailableError(server.serverId, error);
        }
      }
    }
  }

  listTools(): DiscoveredMcpTool[] {
    return [...this.connected.values()].flatMap((server) => server.tools);
  }

  unavailableServerIds(): string[] {
    return [...this.unavailable].sort();
  }

  async callTool(namespacedName: string, args: unknown): Promise<unknown> {
    const separator = namespacedName.indexOf(".");
    if (separator <= 0) throw new Error("MCP tool name must use server_id.tool namespace");
    const serverId = namespacedName.slice(0, separator);
    const toolName = namespacedName.slice(separator + 1);
    const server = this.connected.get(serverId);
    if (server === undefined) throw new Error(`MCP server ${serverId} is unavailable`);
    const tool = server.tools.find((item) => item.name === toolName);
    if (tool === undefined) throw new Error(`MCP tool ${namespacedName} was not discovered`);
    validateArguments(tool.inputSchema, args);
    return server.client.callTool(
      { name: toolName, arguments: isRecord(args) ? args : undefined },
      undefined,
      { timeout: server.config.timeoutMs ?? 30_000, maxTotalTimeout: server.config.timeoutMs ?? 30_000 },
    );
  }

  async close(): Promise<void> {
    const clients = [...this.connected.values()].map((server) => server.client);
    this.connected.clear();
    await Promise.allSettled(clients.map((client) => client.close()));
  }

  private async connectWithRetry(config: McpBridgeServer): Promise<ConnectedServer> {
    const attempts = config.reconnectAttempts ?? 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const client = new Client({ name: `piwork-${config.serverId}`, version: "0.1.0" });
      try {
        const transport = config.transport === "stdio"
          ? new StdioClientTransport({
            command: config.command,
            args: [...(config.args ?? [])],
            env: { ...definedEnvironment(process.env), ...(config.environment ?? {}) },
            stderr: "pipe",
          })
          : new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers: config.headers },
          });
        await client.connect(transport);
        const tools = await client.listTools(undefined, { timeout: config.timeoutMs ?? 30_000 });
        return {
          config,
          client,
          tools: tools.tools.map((tool) => ({
            serverId: config.serverId,
            name: tool.name,
            namespacedName: `${config.serverId}.${tool.name}`,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            inputSchema: tool.inputSchema,
          })),
        };
      } catch (error) {
        lastError = error;
        await client.close().catch(() => undefined);
      }
    }
    throw lastError;
  }
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateArguments(schema: unknown, value: unknown): void {
  if (!isRecord(schema) || schema.type !== "object") return;
  if (!isRecord(value)) throw new Error("MCP tool arguments must be an object");
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
  for (const key of required) if (!(key in value)) throw new Error(`missing required MCP argument ${key}`);
  if (isRecord(schema.properties)) {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (!(key in value) || !isRecord(propertySchema) || typeof propertySchema.type !== "string") continue;
      const actual = value[key];
      const valid = propertySchema.type === "string" ? typeof actual === "string"
        : propertySchema.type === "number" || propertySchema.type === "integer" ? typeof actual === "number"
        : propertySchema.type === "boolean" ? typeof actual === "boolean"
        : propertySchema.type === "array" ? Array.isArray(actual)
        : propertySchema.type === "object" ? isRecord(actual)
        : true;
      if (!valid) throw new Error(`invalid MCP argument ${key}: expected ${propertySchema.type}`);
    }
  }
}
