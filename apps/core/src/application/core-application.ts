import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { CoreStore } from "@piwork/core-store";
import { status as grpcStatus } from "@grpc/grpc-js";
import { IdentityService } from "../identity/sessions.js";
import type { UserPrincipal } from "../work-access/policy.js";
import { WorkLifecycleService, type WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import type { CorePaths, ListenAddress } from "./paths.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { DockerWorkRuntimeAdapter, ensureInstallationId, type ConversationGateway } from "../runtime/docker-work-runtime.js";

export type ReadinessReason = "STARTING" | "RUNTIME_NOT_CONFIGURED" | "RUNTIME_UNAVAILABLE" | "RECOVERING" | "READY" | "SHUTTING_DOWN";

export interface CoreApplicationOptions {
  readonly paths: CorePaths;
  readonly runtimeFactory?: (application: CoreApplication) => Promise<WorkRuntimeAdapter>;
  readonly dependencyCheck?: () => Promise<void>;
}

export class CoreApplication {
  readonly store: CoreStore;
  readonly identity: IdentityService;
  readonly lifecycle: WorkLifecycleService;
  private runtime?: WorkRuntimeAdapter & Partial<ConversationGateway> & { close?: () => void };
  private server?: Server;
  private state: ReadinessReason = "STARTING";
  private closed = false;
  private constructor(readonly paths: CorePaths, store: CoreStore, identity: IdentityService, lifecycle: WorkLifecycleService) {
    this.store = store;
    this.identity = identity;
    this.lifecycle = lifecycle;
  }

  static async create(options: CoreApplicationOptions): Promise<CoreApplication> {
    const store = CoreStore.open({ databasePath: options.paths.databasePath });
    try {
      const admin = store.get<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1");
      if ((admin?.count ?? 0) === 0) throw new Error("Core is not bootstrapped; run piwork-core bootstrap-admin first");
      const identity = await IdentityService.create({ store });
      let application!: CoreApplication;
      let runtime: WorkRuntimeAdapter = unavailableRuntime("runtime is not initialized");
      const lifecycle = new WorkLifecycleService(store, proxyRuntime(() => runtime));
      application = new CoreApplication(options.paths, store, identity, lifecycle);
      const profiles = new RuntimeProfileStore(options.paths.runtimeProfilePath, options.paths.secretsDirectory);
      if (!profiles.inspect().configured) {
        application.state = "RUNTIME_NOT_CONFIGURED";
      } else {
        try {
          await options.dependencyCheck?.();
          runtime = options.runtimeFactory === undefined
            ? new DockerWorkRuntimeAdapter(options.paths, ensureInstallationId(options.paths))
            : await options.runtimeFactory(application);
          if (runtime instanceof DockerWorkRuntimeAdapter) await runtime.verifyDependency();
          application.runtime = runtime;
          application.state = "RECOVERING";
          await lifecycle.recover();
          application.state = "READY";
        } catch {
          (runtime as WorkRuntimeAdapter & { close?: () => void }).close?.();
          application.runtime = undefined;
          application.state = "RUNTIME_UNAVAILABLE";
        }
      }
      return application;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  async listen(address: ListenAddress): Promise<ListenAddress> {
    if (this.closed) throw new Error("CoreApplication is closed");
    if (this.server !== undefined) throw new Error("CoreApplication is already listening");
    this.server = createServer((request, response) => void this.route(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(address.port, address.host, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    const actual = this.server.address();
    if (actual === null || typeof actual === "string") throw new Error("Core HTTP listener has no TCP address");
    return { host: address.host, port: actual.port };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.state = "SHUTTING_DOWN";
    try {
      await closeServer(this.server);
      await this.lifecycle.shutdown();
      this.runtime?.close?.();
    } finally {
      this.store.close();
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://core.invalid");
      if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { status: "healthy" });
      if (request.method === "GET" && url.pathname === "/readyz") {
        const ready = this.state === "READY";
        return send(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", reason: this.state });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/login") {
        const body = await readJson<{ account?: unknown; password?: unknown }>(request);
        if (typeof body.account !== "string" || typeof body.password !== "string") throw api(400, "INVALID_REQUEST", "account and password are required");
        return send(response, 200, await this.identity.login(body.account, body.password, request.socket.remoteAddress ?? "unknown"));
      }
      if (!url.pathname.startsWith("/api/v1/")) throw api(404, "NOT_FOUND", "route not found");
      const token = bearer(request);
      const session = this.identity.authenticate(token);
      const principal: UserPrincipal = { userId: session.user.id, role: session.user.role };
      if (request.method === "GET" && url.pathname === "/api/v1/me") return send(response, 200, { ...session.user, expiresAt: session.expiresAt });
      if (request.method === "POST" && url.pathname === "/api/v1/logout") { this.identity.logout(token); response.writeHead(204); response.end(); return; }
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[2] === "works" && parts.length === 3 && request.method === "GET") return send(response, 200, { works: this.lifecycle.list(principal) });
      if (parts[2] === "works" && parts.length === 3 && request.method === "POST") {
        requireRuntime(this.state);
        const body = await readJson<{ name?: unknown; configuration?: unknown; idempotencyKey?: unknown }>(request);
        if (typeof body.name !== "string" || typeof body.idempotencyKey !== "string" || body.configuration === null || typeof body.configuration !== "object") throw api(400, "INVALID_REQUEST", "name, configuration, and idempotencyKey are required");
        return send(response, 202, this.lifecycle.create(principal, body as never));
      }
      if (parts[2] === "works" && parts.length === 4 && request.method === "GET") return send(response, 200, this.lifecycle.show(principal, parts[3]!));
      if (parts[2] === "works" && parts.length === 5 && request.method === "POST" && ["start", "stop", "retry", "delete"].includes(parts[4]!)) {
        requireRuntime(this.state);
        const body = await readJson<{ idempotencyKey?: unknown }>(request);
        if (typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
        const result = parts[4] === "start" ? this.lifecycle.start(principal, parts[3]!, body.idempotencyKey)
          : parts[4] === "stop" ? this.lifecycle.stop(principal, parts[3]!, body.idempotencyKey)
          : parts[4] === "retry" ? this.lifecycle.retry(principal, parts[3]!, body.idempotencyKey)
          : parts[4] === "delete" ? this.lifecycle.delete(principal, parts[3]!, body.idempotencyKey) : undefined;
        if (result === undefined) throw api(404, "NOT_FOUND", "route not found");
        return send(response, 202, result);
      }
      if (parts[2] === "operations" && parts.length === 4 && request.method === "GET") return send(response, 200, this.lifecycle.operation(principal, parts[3]!));
      if (parts[2] === "works" && parts.length >= 5) {
        const workId = parts[3]!;
        this.requireConversation(principal, workId);
        const gateway = this.runtime as ConversationGateway;
        if (parts[4] === "sessions" && parts.length === 5 && request.method === "POST") {
          const body = await readJson<{ idempotencyKey?: unknown }>(request);
          if (typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
          return send(response, 201, await gateway.createSession(workId, body.idempotencyKey));
        }
        if (parts[4] === "sessions" && parts.length === 5 && request.method === "GET") return send(response, 200, { sessions: await gateway.listSessions(workId) });
        if (parts[4] === "sessions" && parts.length === 6 && request.method === "GET") return send(response, 200, await gateway.readSession(workId, parts[5]!));
        if (parts[4] === "runs" && parts.length === 5 && request.method === "POST") {
          const body = await readJson<{ sessionId?: unknown; submissionKey?: unknown; prompt?: unknown }>(request);
          if (typeof body.sessionId !== "string" || typeof body.submissionKey !== "string" || typeof body.prompt !== "string") throw api(400, "INVALID_REQUEST", "sessionId, submissionKey, and prompt are required");
          return send(response, 202, await gateway.submitRun(workId, body.sessionId, body.submissionKey, body.prompt));
        }
        if (parts[4] === "runs" && parts.length === 6 && request.method === "GET") return send(response, 200, await gateway.getRun(workId, parts[5]!));
        if (parts[4] === "runs" && parts.length === 7 && parts[6] === "cancel" && request.method === "POST") {
          const body = await readJson<{ idempotencyKey?: unknown }>(request);
          if (typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
          return send(response, 200, await gateway.cancelRun(workId, parts[5]!, body.idempotencyKey));
        }
        if (parts[4] === "runs" && parts.length === 7 && parts[6] === "events" && request.method === "GET") {
          const after = Number(url.searchParams.get("after") ?? "0");
          if (!Number.isSafeInteger(after) || after < 0) throw api(400, "INVALID_CURSOR", "after must be a non-negative integer");
          response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
          await gateway.watchRun(workId, parts[5]!, after, async (event) => {
            if (!response.write(`${safeJson(event)}\n`)) await onceDrain(response);
          });
          response.end();
          return;
        }
      }
      throw api(404, "NOT_FOUND", "route not found");
    } catch (error) {
      const mapped = mapError(error);
      send(response, mapped.status, { code: mapped.code, message: mapped.message, ...(mapped.retryAfterMs === undefined ? {} : { retryAfterMs: mapped.retryAfterMs }) });
    }
  }

  private requireConversation(principal: UserPrincipal, workId: string): void {
    const work = this.lifecycle.show(principal, workId);
    if (work.ownerUserId !== principal.userId) throw api(403, "PERMISSION_DENIED", "conversation content is available only to the Work owner");
    if (work.observedState !== "ready") throw api(503, "WORK_UNAVAILABLE", "Work is not ready");
    if (this.runtime?.createSession === undefined) throw api(503, "RUNTIME_UNAVAILABLE", "conversation gateway is unavailable");
  }
}

function proxyRuntime(current: () => WorkRuntimeAdapter): WorkRuntimeAdapter {
  return {
    prepare: (work) => current().prepare(work), start: (work, generation) => current().start(work, generation),
    inspect: (workId) => current().inspect(workId), drain: (workId, timeout) => current().drain(workId, timeout),
    stop: (workId, timeout) => current().stop(workId, timeout), remove: (workId) => current().remove(workId),
    listManagedInstances: () => current().listManagedInstances?.() ?? Promise.resolve([]),
  };
}
function unavailableRuntime(message: string): WorkRuntimeAdapter { const fail = async (): Promise<never> => { throw new Error(message); }; return { prepare: fail, start: fail, inspect: fail, drain: fail, stop: fail, remove: fail }; }
function requireRuntime(state: ReadinessReason): void { if (state !== "READY") throw api(503, "RUNTIME_UNAVAILABLE", `Core runtime is not ready: ${state}`); }
function bearer(request: IncomingMessage): string { const value = request.headers.authorization; if (value === undefined || !value.startsWith("Bearer ") || value.length <= 7) throw api(401, "AUTHENTICATION_REQUIRED", "authentication is required"); return value.slice(7); }
async function readJson<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let length = 0; for await (const chunk of request) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += value.length; if (length > 1_048_576) throw api(413, "REQUEST_TOO_LARGE", "request body is too large"); chunks.push(value); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; } catch { throw api(400, "INVALID_JSON", "request body must be valid JSON"); } }
function safeJson(value: unknown): string { return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item); }
function send(response: ServerResponse, status: number, value: unknown): void { if (response.headersSent) return; const body = safeJson(value); response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store" }); response.end(body); }
function api(status: number, code: string, message: string): Error { return Object.assign(new Error(message), { status, code }); }
export function mapError(error: unknown): { status: number; code: string; message: string; retryAfterMs?: number } {
  const item = error as { status?: number; code?: number | string; message?: string; retryAfterMs?: number; name?: string };
  if (item.name === "AuthenticationFailedError" || item.name === "InvalidLoginSessionError") return { status: 401, code: "AUTHENTICATION_FAILED", message: "authentication failed" };
  if (item.name === "LoginRateLimitedError") return { status: 429, code: "RATE_LIMITED", message: "rate limited", retryAfterMs: item.retryAfterMs };
  if (item.name === "InvisibleResourceError" || item.name === "WorkNotFoundError") return { status: 404, code: "NOT_FOUND", message: "resource was not found" };
  if (item.name === "ConversationAccessDeniedError") return { status: 403, code: "PERMISSION_DENIED", message: "permission denied" };
  if (item.name === "WorkBusyError") return { status: 409, code: "WORK_BUSY", message: "Work is busy" };
  if (item.name === "CursorExpiredError" || item.name === "WatchCursorExpiredError") return { status: 416, code: "CURSOR_EXPIRED", message: "Run cursor has expired; query durable Run status or Session history" };
  if (item.name === "DockerDependencyError") return { status: 503, code: "RUNTIME_UNAVAILABLE", message: "runtime dependency is unavailable" };
  if (item.name === "IdempotencyConflictError" || item.name === "RevisionConflictError" || item.name === "ServiceNameConflictError" || item.name === "ServiceRevisionConflictError") return { status: 409, code: "CONFLICT", message: "request conflicts with current state" };
  if (typeof item.status === "number") return { status: item.status, code: typeof item.code === "string" ? item.code : "REQUEST_FAILED", message: item.message ?? "request failed" };
  if (typeof item.code === "number") {
    const mapped = mapGrpcStatus(item.code);
    return mapped;
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "internal server error" };
}

function mapGrpcStatus(code: number): { status: number; code: string; message: string } {
  switch (code) {
    case grpcStatus.UNAUTHENTICATED: return { status: 401, code: "AUTHENTICATION_FAILED", message: "agent authentication failed" };
    case grpcStatus.PERMISSION_DENIED: return { status: 403, code: "PERMISSION_DENIED", message: "permission denied" };
    case grpcStatus.NOT_FOUND: return { status: 404, code: "NOT_FOUND", message: "resource was not found" };
    case grpcStatus.ALREADY_EXISTS:
    case grpcStatus.ABORTED: return { status: 409, code: "CONFLICT", message: "request conflicts with current state" };
    case grpcStatus.RESOURCE_EXHAUSTED: return { status: 429, code: "RATE_LIMITED", message: "runtime is busy" };
    case grpcStatus.OUT_OF_RANGE: return { status: 416, code: "CURSOR_EXPIRED", message: "Run cursor has expired; query durable Run status or Session history" };
    case grpcStatus.DEADLINE_EXCEEDED: return { status: 504, code: "TIMEOUT", message: "runtime request timed out" };
    case grpcStatus.UNAVAILABLE: return { status: 503, code: "RUNTIME_UNAVAILABLE", message: "runtime dependency is unavailable" };
    default: return { status: 500, code: "INTERNAL_ERROR", message: "internal server error" };
  }
}
async function closeServer(server?: Server): Promise<void> { if (server === undefined || !server.listening) return; await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
async function onceDrain(response: ServerResponse): Promise<void> { await new Promise<void>((resolve) => response.once("drain", resolve)); }
