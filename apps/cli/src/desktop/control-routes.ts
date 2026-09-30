import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { PiworkApiError, type PiworkClient } from "@piwork/client-sdk";
import { PiPackageSelectionSchema, PiPackageSourceSchema, type PiPackageSource } from "@piwork/contracts";
import { Check } from "typebox/value";

const prefix = "/_desktop/api/";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const namePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const maxJson = 1_048_576;

function invalid(message: string): never { throw new PiworkApiError(400, "INVALID_INPUT", message); }
function segment(raw: string, pattern: RegExp): string {
  let value: string;
  try { value = decodeURIComponent(raw); } catch { return invalid("Invalid URL encoding"); }
  if (!pattern.test(value) || value.includes("\\") || value.includes("\0")) return invalid("Invalid resource identifier");
  return value;
}
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Expected a JSON object");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !allowed.includes(key))) return invalid("Unknown field");
  return item;
}
function string(value: unknown, name: string, limit = 4096): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > limit || value.includes("\0")) return invalid(`Invalid ${name}`);
  return value;
}
function id(value: unknown): string { return segment(string(value, "identifier", 128), idPattern); }
function packageSource(value: unknown): PiPackageSource {
  if (!Check(PiPackageSourceSchema, value)) return invalid("Invalid package source");
  return value as PiPackageSource;
}

async function input(request: IncomingMessage, allowed: readonly string[]): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json") throw new PiworkApiError(415, "JSON_REQUIRED", "Use application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxJson) throw new PiworkApiError(413, "REQUEST_TOO_LARGE", "Request is too large");
    chunks.push(chunk as Buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PiworkApiError(400, "INVALID_JSON", "Invalid JSON"); }
  return object(value, allowed);
}

export interface ControlResult { readonly status: number; readonly value: unknown; }

export async function dispatchControl(request: IncomingMessage, client: PiworkClient): Promise<ControlResult | undefined> {
  const original = request.url ?? "";
  if (!original.startsWith(prefix)) return undefined;
  const url = new URL(original, "http://desktop.localhost");
  if (url.pathname !== original.split("?", 1)[0]) return invalid("Invalid request path");
  const parts = url.pathname.slice(prefix.length).split("/");
  if (parts.some((part) => part === "")) return undefined;
  if (url.search && !(parts.length === 5 && parts[0] === "works" && parts[2] === "services" && parts[4] === "logs"))
    return invalid("Unexpected query parameters");
  const method = request.method ?? "GET";
  const result = (value: unknown, status = 200): ControlResult => ({ status, value });

  if (parts[0] === "skills" && method === "GET") {
    if (parts.length === 1) return result(await client.skills());
    if (parts.length === 2) return result(await client.skill(segment(parts[1]!, namePattern)));
  }
  if (parts[0] === "packages" && method === "GET") {
    if (parts.length === 1) return result(await client.packages());
    if (parts.length === 2) return result(await client.package(segment(parts[1]!, namePattern)));
  }
  if (parts[0] === "operations" && parts.length === 2 && method === "GET")
    return result(await client.operation(segment(parts[1]!, idPattern)));
  if (parts[0] === "work-snapshots" && parts.length === 2 && method === "GET")
    return result(await client.workSnapshot(segment(parts[1]!, idPattern)));
  if (parts[0] !== "works") return undefined;
  if (parts.length === 1) {
    if (method === "GET") return result(await client.works());
    if (method === "POST") {
      const data = await input(request, ["name", "configuration", "baseImage", "skills", "packages", "agentsMd"]);
      const name = string(data.name, "Work name", 128);
      if (data.configuration !== undefined) object(data.configuration, Object.keys(data.configuration as Record<string, unknown>));
      if (data.baseImage !== undefined) string(data.baseImage, "base image", 512);
      if (data.agentsMd !== undefined && (typeof data.agentsMd !== "string" || data.agentsMd.length > maxJson)) return invalid("Invalid AGENTS content");
      if (data.skills !== undefined && (!Array.isArray(data.skills) || data.skills.length > 64)) return invalid("Invalid Skills selection");
      if (data.packages !== undefined && !Check(PiPackageSelectionSchema, data.packages)) return invalid("Invalid Packages selection");
      return result(await client.createWork({ ...data, name, idempotencyKey: randomUUID() }), 202);
    }
    return undefined;
  }
  const workId = segment(parts[1]!, idPattern);
  if (parts.length === 2 && method === "GET") return result(await client.work(workId));
  if (parts.length === 3 && method === "POST" && ["start", "stop", "retry", "delete"].includes(parts[2]!))
    return result(await client.workAction(workId, parts[2] as "start" | "stop" | "retry" | "delete", randomUUID()), 202);

  if (parts[2] === "services") {
    if (parts.length === 3 && method === "GET") return result(await client.workServices(workId));
    if (parts.length < 4) return undefined;
    const serviceId = segment(parts[3]!, idPattern);
    if (parts.length === 4 && method === "GET") return result(await client.workService(workId, serviceId));
    if (parts.length === 5 && parts[4] === "logs" && method === "GET") {
      const tailText = url.searchParams.get("tailLines") ?? "100";
      if (url.searchParams.size > (url.searchParams.has("tailLines") ? 1 : 0) || !/^[0-9]+$/.test(tailText)) return invalid("Invalid log tail");
      const tail = Number(tailText);
      if (!Number.isSafeInteger(tail) || tail < 1 || tail > 200) return invalid("Log tail must be 1..200");
      return result(await client.workServiceLogs(workId, serviceId, tail));
    }
    if (parts.length === 5 && method === "POST") {
      const action = { start: "enable", stop: "disable", restart: "restart", retry: "retry", remove: "remove" } as const;
      const actual = action[parts[4] as keyof typeof action];
      if (actual) return result(await client.workServiceAction(workId, serviceId, actual, randomUUID()), 202);
    }
    return undefined;
  }

  if (parts[2] === "configuration") {
    if (parts.length === 3) {
      if (method === "GET") return result(await client.workConfiguration(workId));
      if (method === "PUT") {
        const data = await input(request, ["configuration"]);
        if (data.configuration === undefined) return invalid("Configuration is required");
        object(data.configuration, Object.keys(data.configuration as Record<string, unknown>));
        return result(await client.updateWorkConfiguration(workId, data.configuration));
      }
    }
    if (parts.length === 4) {
      if (parts[3] === "apply" && method === "POST") return result(await client.applyWorkConfiguration(workId, randomUUID()), 202);
      if (parts[3] === "skills") {
        if (method === "GET") return result(await client.workSkills(workId));
        if (method === "PUT") {
          const data = await input(request, ["skills"]);
          if (!Array.isArray(data.skills) || data.skills.length > 64) return invalid("Invalid Skills selection");
          return result(await client.updateWorkSkills(workId, data.skills));
        }
      }
      if (parts[3] === "packages") {
        if (method === "GET") return result(await client.workPackageSelection(workId));
        if (method === "PUT") {
          const data = await input(request, ["packages"]);
          if (!Check(PiPackageSelectionSchema, data.packages)) return invalid("Invalid Packages selection");
          return result(await client.updateWorkPackageSelection(workId, data.packages));
        }
      }
      if (parts[3] === "agents") {
        if (method === "GET") return result(await client.workAgents(workId));
        if (method === "PUT") {
          const data = await input(request, ["agentsMd"]);
          if (typeof data.agentsMd !== "string" || data.agentsMd.length > maxJson) return invalid("Invalid AGENTS content");
          return result(await client.updateWorkAgents(workId, data.agentsMd));
        }
      }
    }
    return undefined;
  }

  if (parts[2] === "packages") {
    if (parts.length === 3) {
      if (method === "GET") return result(await client.workPackages(workId));
      if (method === "POST") {
        const data = await input(request, ["source"]);
        return result(await client.installWorkPackage(workId, packageSource(data.source), randomUUID()), 202);
      }
    }
    if (parts.length < 4) return undefined;
    const name = segment(parts[3]!, namePattern);
    if (parts.length === 4 && method === "GET") return result(await client.workPackage(workId, name));
    if (parts.length === 4 && method === "DELETE") return result(await client.removeWorkPackage(workId, name));
    if (parts.length === 5 && parts[4] === "update" && method === "POST") {
      const data = await input(request, ["source"]);
      return result(await client.updateWorkPackage(workId, name, packageSource(data.source), randomUUID()), 202);
    }
    if (parts.length === 5 && method === "POST" && ["enable", "disable"].includes(parts[4]!))
      return result(await client.setWorkPackageEnabled(workId, name, parts[4] === "enable"));
    return undefined;
  }

  if (parts[2] === "sessions") {
    if (parts.length === 3) {
      if (method === "GET") return result(await client.sessions(workId));
      if (method === "POST") return result(await client.createSession(workId, randomUUID()), 202);
    }
    if (parts.length === 4 && method === "GET") return result(await client.session(workId, segment(parts[3]!, idPattern)));
    return undefined;
  }
  if (parts[2] === "runs") {
    if (parts.length === 3 && method === "POST") {
      const data = await input(request, ["sessionId", "prompt"]);
      return result(await client.submitRun(workId, { sessionId: id(data.sessionId), prompt: string(data.prompt, "message", 65_536), submissionKey: randomUUID() }), 202);
    }
    if (parts.length >= 4) {
      const runId = segment(parts[3]!, idPattern);
      if (parts.length === 4 && method === "GET") return result(await client.getRun(workId, runId));
      if (parts.length === 5 && parts[4] === "cancel" && method === "POST")
        return result(await client.cancelRun(workId, runId, randomUUID()), 202);
    }
    return undefined;
  }
  if (parts[2] === "exports" && parts.length === 3 && method === "POST")
    return result(await client.exportWork(workId, randomUUID()), 202);
  return undefined;
}
