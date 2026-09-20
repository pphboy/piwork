import { resolve } from "node:path";
import { parseLogLevel, type LogLevel } from "./logger.js";

export const DEFAULT_HOST = "127.0.0.1";
/** Matches the port used by every container in the piwork design sketches. */
export const DEFAULT_PORT = 8083;
export const DEFAULT_PROVIDER = "anthropic";

export interface DaemonConfig {
  host: string;
  port: number;
  provider: string;
  /**
   * Overrides the provider's built-in base url. pi itself never reads
   * ANTHROPIC_BASE_URL, so this is the only way to point it at a proxy.
   */
  baseUrl: string | undefined;
  apiKey: string | undefined;
  agentDir: string;
  workspace: string;
  /** e.g. "anthropic/claude-opus-4-5:high"; undefined means "first authenticated model". */
  model: string | undefined;
  /** Empty means the agent runs with no tools at all. */
  tools: string[];
  logLevel: LogLevel;
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === undefined || result === "" ? undefined : result;
}

export function parsePort(value: string | undefined): number {
  const raw = trimmed(value);
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PIWORK_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

/**
 * Tools a session gets when PIWORK_TOOLS is unset.
 *
 * bash and edit give the agent real shell and file-write access, so the session
 * cwd (PIWORK_WORKSPACE, or --cwd for a single session) is what bounds it.
 */
export const DEFAULT_TOOLS: readonly string[] = ["read", "bash", "edit", "find", "ls"];

/**
 * Unset keeps the default tool set. An explicitly empty value or "none" disables
 * every tool, which turns the agent back into a pure Q&A loop that cannot reach
 * the filesystem.
 */
export function parseTools(value: string | undefined): string[] {
  if (value === undefined) return [...DEFAULT_TOOLS];
  const raw = value.trim();
  if (raw === "" || raw.toLowerCase() === "none") return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/**
 * Resolves the API key to hand to the runtime.
 *
 * ANTHROPIC_AUTH_TOKEN is deliberately not mapped here: pi reads that variable
 * natively and sends it as "Authorization: Bearer", which is what token-based
 * proxies expect. Routing it through setRuntimeApiKey would switch the request
 * to the x-api-key header and break those proxies.
 */
export function resolveApiKey(env: NodeJS.ProcessEnv, provider: string): string | undefined {
  const providerVar = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  return trimmed(env["PIWORK_API_KEY"]) ?? trimmed(env[providerVar]);
}

export function loadDaemonConfig(env: NodeJS.ProcessEnv, demoRoot: string): DaemonConfig {
  const provider = trimmed(env["PIWORK_PROVIDER"]) ?? DEFAULT_PROVIDER;
  return {
    host: trimmed(env["PIWORK_HOST"]) ?? DEFAULT_HOST,
    port: parsePort(env["PIWORK_PORT"]),
    provider,
    baseUrl:
      trimmed(env["PIWORK_BASE_URL"]) ??
      (provider === DEFAULT_PROVIDER ? trimmed(env["ANTHROPIC_BASE_URL"]) : undefined),
    apiKey: resolveApiKey(env, provider),
    agentDir: resolve(demoRoot, trimmed(env["PIWORK_AGENT_DIR"]) ?? ".piwork/agent"),
    workspace: resolve(demoRoot, trimmed(env["PIWORK_WORKSPACE"]) ?? ".piwork/workspaces/default"),
    model: trimmed(env["PIWORK_MODEL"]),
    tools: parseTools(env["PIWORK_TOOLS"]),
    logLevel: parseLogLevel(trimmed(env["PIWORK_LOG_LEVEL"]), "info"),
  };
}
