import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ServiceDefinitionInput, WorkConfig } from "@piwork/contracts";
import type { UserPrincipal } from "../work-access/policy.js";
import type { WorkServiceManagementService } from "../work-services/service-management.js";
import { WorkLifecycleService } from "./lifecycle.js";

export interface WorkApiAuthentication {
  authenticate(token: string): UserPrincipal;
}

export function createWorkHttpServer(
  lifecycle: WorkLifecycleService,
  authentication: WorkApiAuthentication,
  services?: WorkServiceManagementService,
): Server {
  return createServer(async (request, response) => {
    try {
      await route(request, response, lifecycle, authentication, services);
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : /not found/i.test(error instanceof Error ? error.message : "") ? 404 : 409;
      json(response, status, { code: status === 404 ? "NOT_FOUND" : "CONFLICT", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  lifecycle: WorkLifecycleService,
  authentication: WorkApiAuthentication,
  services?: WorkServiceManagementService,
): Promise<void> {
  const principal = authentication.authenticate(bearer(request));
  const url = new URL(request.url ?? "/", "http://core.invalid");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "v1") return json(response, 404, { code: "NOT_FOUND", message: "route not found" });

  if (segments[2] === "works" && segments.length === 3 && request.method === "GET") {
    return json(response, 200, { works: lifecycle.list(principal) });
  }
  if (segments[2] === "works" && segments.length === 3 && request.method === "POST") {
    const body = await bodyJson<{ name: string; configuration: WorkConfig; idempotencyKey: string }>(request);
    return json(response, 202, lifecycle.create(principal, body));
  }
  if (segments[2] === "works" && segments.length === 4 && request.method === "GET") {
    return json(response, 200, lifecycle.show(principal, segments[3]!));
  }
  if (segments[2] === "works" && segments[4] === "services" && segments.length === 5 && request.method === "GET") {
    if (services === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    return json(response, 200, { services: services.list(principal, segments[3]!) });
  }
  if (segments[2] === "works" && segments[4] === "services" && segments.length === 5 && request.method === "POST") {
    if (services === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    const body = await bodyJson<{ definition: ServiceDefinitionInput; idempotencyKey: string }>(request);
    return json(response, 202, services.create(principal, segments[3]!, body));
  }
  if (segments[2] === "works" && segments[4] === "services" && segments.length === 7 && segments[6] === "revisions" && request.method === "GET") {
    if (services === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    return json(response, 200, { revisions: services.revisions(principal, segments[3]!, segments[5]!) });
  }
  if (segments[2] === "works" && segments[4] === "services" && segments.length === 6 && request.method === "GET") {
    if (services === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    return json(response, 200, services.show(principal, segments[3]!, segments[5]!));
  }
  if (segments[2] === "works" && segments[4] === "services" && segments.length === 6 && request.method === "PATCH") {
    if (services === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    const body = await bodyJson<{ expectedRevision: number; definition: ServiceDefinitionInput; idempotencyKey: string }>(request);
    return json(response, 202, services.update(principal, segments[3]!, segments[5]!, body.expectedRevision, body.definition, body.idempotencyKey));
  }
  if (segments[2] === "works" && segments[4] === "services" && segments.length === 7 && request.method === "POST") {
    if (services === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    const body = await bodyJson<{ idempotencyKey: string; purgeData?: boolean }>(request);
    const workId = segments[3]!;
    const serviceId = segments[5]!;
    const action = segments[6];
    const result = action === "restart" ? services.restart(principal, workId, serviceId, body.idempotencyKey)
      : action === "enable" ? services.enable(principal, workId, serviceId, body.idempotencyKey)
      : action === "disable" ? services.disable(principal, workId, serviceId, body.idempotencyKey)
      : action === "remove" ? services.remove(principal, workId, serviceId, body.idempotencyKey, body.purgeData ?? false)
      : undefined;
    if (result === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    return json(response, 202, result);
  }
  if (segments[2] === "works" && segments.length === 5 && request.method === "POST") {
    const body = await bodyJson<{ idempotencyKey: string }>(request);
    const workId = segments[3]!;
    const action = segments[4];
    const result = action === "start" ? lifecycle.start(principal, workId, body.idempotencyKey)
      : action === "stop" ? lifecycle.stop(principal, workId, body.idempotencyKey)
      : action === "retry" ? lifecycle.retry(principal, workId, body.idempotencyKey)
      : action === "delete" ? lifecycle.delete(principal, workId, body.idempotencyKey)
      : undefined;
    if (result === undefined) return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
    return json(response, 202, result);
  }
  if (segments[2] === "operations" && segments.length === 4 && request.method === "GET") {
    return json(response, 200, lifecycle.operation(principal, segments[3]!));
  }
  return json(response, 404, { code: "NOT_FOUND", message: "route not found" });
}

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (value === undefined || !value.startsWith("Bearer ")) throw new Error("authentication required");
  return value.slice("Bearer ".length);
}

async function bodyJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1_048_576) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}
