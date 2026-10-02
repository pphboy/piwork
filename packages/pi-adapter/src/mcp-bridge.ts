import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash } from "node:crypto";

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
  readonly modelName: string;
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
  private readonly configurations = new Map<string, McpBridgeServer>();
  private readonly reconnecting = new Map<string, Promise<ConnectedServer>>();
  private readonly pendingClients = new Set<Client>();
  private readonly closingClients = new Set<Promise<void>>();
  private closing = false;

  async initialize(servers: readonly McpBridgeServer[]): Promise<void> {
    this.closing = false;
    const ids = new Set<string>();
    for (const server of servers) {
      if (ids.has(server.serverId)) throw new Error(`duplicate MCP server_id ${server.serverId}`);
      ids.add(server.serverId);
      this.configurations.set(server.serverId, server);
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
    const tools = [...this.connected.values()].flatMap((server) => server.tools);
    const modelNames = new Set<string>();
    for (const tool of tools) {
      if (modelNames.has(tool.modelName)) throw new Error(`MCP model tool name collision for ${tool.namespacedName}`);
      modelNames.add(tool.modelName);
    }
    return tools;
  }

  unavailableServerIds(): string[] {
    return [...this.unavailable].sort();
  }

  async callTool(namespacedName: string, args: unknown): Promise<unknown> {
    const separator = namespacedName.indexOf(".");
    if (separator <= 0) throw new Error("MCP tool name must use server_id.tool namespace");
    const serverId = namespacedName.slice(0, separator);
    const toolName = namespacedName.slice(separator + 1);
    let server = this.connected.get(serverId);
    if (server === undefined) {
      const config = this.configurations.get(serverId);
      if (config === undefined || this.closing) throw new Error(`MCP server ${serverId} is unavailable`);
      server = await this.reconnect(config);
    }
    const tool = server.tools.find((item) => item.name === toolName);
    if (tool === undefined) throw new Error(`MCP tool ${namespacedName} was not discovered`);
    validateArguments(tool.inputSchema, args);
    try {
      return await server.client.callTool(
        { name: toolName, arguments: isRecord(args) ? args : undefined },
        undefined,
        { timeout: server.config.timeoutMs ?? 30_000, maxTotalTimeout: server.config.timeoutMs ?? 30_000 },
      );
    } catch (error) {
      // The failed call may have reached the server. Never replay it here.
      // A later explicit call may reconnect and supplies its original key.
      if (this.connected.get(serverId) === server) this.connected.delete(serverId);
      this.unavailable.add(serverId);
      // Closing a stdio transport can wait for the timed-out tool to finish.
      // Return the call error at its deadline while retaining the cleanup for drain.
      const closing = server.client.close().catch(() => undefined);
      this.closingClients.add(closing);
      void closing.then(() => this.closingClients.delete(closing));
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    const clients = [...new Set([
      ...[...this.connected.values()].map((server) => server.client),
      ...this.pendingClients,
    ])];
    this.connected.clear();
    this.reconnecting.clear();
    await Promise.allSettled([...clients.map((client) => client.close()), ...this.closingClients]);
  }

  private reconnect(config: McpBridgeServer): Promise<ConnectedServer> {
    const pending = this.reconnecting.get(config.serverId);
    if (pending !== undefined) return pending;
    const reconnect = this.connectWithRetry(config).then(async (server) => {
      if (this.closing) {
        await server.client.close().catch(() => undefined);
        throw new Error(`MCP server ${config.serverId} is closing`);
      }
      this.connected.set(config.serverId, server);
      this.unavailable.delete(config.serverId);
      return server;
    }).finally(() => {
      if (this.reconnecting.get(config.serverId) === reconnect) this.reconnecting.delete(config.serverId);
    });
    this.reconnecting.set(config.serverId, reconnect);
    return reconnect;
  }

  private async connectWithRetry(config: McpBridgeServer): Promise<ConnectedServer> {
    const attempts = config.reconnectAttempts ?? 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const client = new Client({ name: `piwork-${config.serverId}`, version: "0.1.0" });
      this.pendingClients.add(client);
      try {
        const transport = config.transport === "stdio"
          ? new StdioClientTransport({
            command: config.command,
            args: [...(config.args ?? [])],
            env: { ...definedEnvironment(process.env), ...(config.environment ?? {}) },
            // The reserved Work service adapter emits only fixed structured
            // diagnostics; inherit those so agent container logs retain the
            // actual failing stage. Other MCP stderr remains isolated.
            stderr: config.serverId === "work-services" ? "inherit" : "pipe",
          })
          : new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers: config.headers },
          });
        await client.connect(transport);
        const tools = await client.listTools(undefined, { timeout: config.timeoutMs ?? 30_000 });
        this.pendingClients.delete(client);
        return {
          config,
          client,
          tools: tools.tools.map((tool) => ({
            serverId: config.serverId,
            name: tool.name,
            namespacedName: `${config.serverId}.${tool.name}`,
            modelName: modelMcpToolName(config.serverId, tool.name),
            ...(tool.description === undefined ? {} : { description: tool.description }),
            inputSchema: tool.inputSchema,
          })),
        };
      } catch (error) {
        lastError = error;
        this.pendingClients.delete(client);
        await client.close().catch(() => undefined);
      }
    }
    throw lastError;
  }
}

/**
 * MCP uses a dotted canonical namespace for policy and routing. Model APIs
 * accept a smaller identifier alphabet, so the SDK receives a deterministic
 * projection while calls continue to use the canonical name internally.
 */
export function modelMcpToolName(serverId: string, toolName: string): string {
  const normalized = `${serverId.replace(/[^a-zA-Z0-9_-]/g, "_")}__${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (normalized.length <= 64) return normalized;
  const suffix = createHash("sha256").update(`${serverId}.${toolName}`).digest("hex").slice(0, 16);
  return `${normalized.slice(0, 46)}__${suffix}`;
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
