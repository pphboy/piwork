import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { CoreStore } from "@piwork/core-store";
import { status as grpcStatus } from "@grpc/grpc-js";
import { IdentityService } from "../identity/sessions.js";
import { bootstrapAdministrator } from "../identity/bootstrap-admin.js";
import { UserAdministrationService } from "../identity/user-administration.js";
import type { UserPrincipal } from "../work-access/policy.js";
import { WorkLifecycleService, type WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import type { CorePaths, ListenAddress } from "./paths.js";
import { RuntimeProfileStore, validateRuntimeProfileInput, type RuntimeProfile } from "../configuration/runtime-profile.js";
import { WorkConfigurationService } from "../configuration/work-config.js";
import type { WorkConfig } from "@piwork/contracts";
import { DockerWorkRuntimeAdapter, ensureInstallationId, type ConversationGateway } from "../runtime/docker-work-runtime.js";
import { ensureOperatorCredential, verifyOperatorCredential } from "./operator-credential.js";
import { assertValidPassword } from "../identity/password.js";
import { InputValidationError } from "../input-validation.js";
import { WorkConfigurationValidator } from "../configuration/validation.js";
import { registerRuntimeProfileCatalog, resolveRuntimeProfileFromWorkConfig, runtimeImageCatalogId, runtimeModelCatalogId } from "../configuration/runtime-catalog.js";

export type ReadinessReason = "STORE_OPEN" | "LISTENING" | "ADMIN_REQUIRED" | "RUNTIME_NOT_CONFIGURED" | "RUNTIME_UNAVAILABLE" | "RECOVERING" | "READY" | "SHUTTING_DOWN";

export interface FirstRunInitialization {
  readonly administrator?: { readonly account: string; readonly password: string };
  readonly runtime?: {
    readonly agentImage: string;
    readonly provider: string;
    readonly model: string;
    readonly baseUrl?: string;
    readonly credential: string;
  };
}

export interface CoreApplicationOptions {
  readonly paths: CorePaths;
  readonly runtimeFactory?: (application: CoreApplication) => Promise<WorkRuntimeAdapter>;
  readonly dependencyCheck?: () => Promise<void>;
  readonly initialization?: FirstRunInitialization;
}

export class CoreApplication {
  readonly store: CoreStore;
  readonly identity: IdentityService;
  readonly lifecycle: WorkLifecycleService;
  readonly users: UserAdministrationService;
  readonly workConfigurations: WorkConfigurationService;
  readonly runtimeProfiles: RuntimeProfileStore;
  private runtime?: WorkRuntimeAdapter & Partial<ConversationGateway> & { close?: () => void };
  private server?: Server;
  private state: ReadinessReason = "STORE_OPEN";
  private closed = false;
  private constructor(
    readonly paths: CorePaths,
    store: CoreStore,
    identity: IdentityService,
    lifecycle: WorkLifecycleService,
    private readonly options: CoreApplicationOptions,
  ) {
    this.store = store;
    this.identity = identity;
    this.lifecycle = lifecycle;
    this.users = new UserAdministrationService(store);
    this.workConfigurations = new WorkConfigurationService(store);
    this.runtimeProfiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory);
  }

  static async create(options: CoreApplicationOptions): Promise<CoreApplication> {
    if (options.initialization?.administrator !== undefined) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(options.initialization.administrator.account)) {
        throw new InputValidationError("account must be a valid identifier");
      }
      assertValidPassword(options.initialization.administrator.password);
    }
    if (options.initialization?.runtime !== undefined) validateRuntimeProfileInput(options.initialization.runtime);
    const store = CoreStore.open({ databasePath: options.paths.databasePath });
    try {
      ensureOperatorCredential(store, options.paths.operatorCredentialPath);
      if (!store.hasEnabledAdministrator() && options.initialization?.administrator !== undefined) {
        await bootstrapAdministrator({ store, ...options.initialization.administrator });
      }
      const profiles = new RuntimeProfileStore(options.paths.runtimeProfilePath, options.paths.secretsDirectory);
      if (!profiles.inspect().configured && options.initialization?.runtime !== undefined) {
        profiles.configure(options.initialization.runtime);
      }
      if (profiles.inspect().configured) {
        const profile = profiles.load();
        registerRuntimeProfileCatalog(store, profile);
        store.backfillWorkRuntimeProfiles(JSON.stringify(profile), profile.revision, new Date().toISOString());
      }
      const identity = await IdentityService.create({ store });
      let application!: CoreApplication;
      let runtime: WorkRuntimeAdapter = unavailableRuntime("runtime is not initialized");
      const lifecycle = new WorkLifecycleService(store, proxyRuntime(() => application?.runtime ?? runtime));
      application = new CoreApplication(options.paths, store, identity, lifecycle, options);
      if (!store.hasEnabledAdministrator()) application.state = "ADMIN_REQUIRED";
      else if (!profiles.inspect().configured) application.state = "RUNTIME_NOT_CONFIGURED";
      else application.state = "STORE_OPEN";
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
    if (this.state === "STORE_OPEN") this.state = "LISTENING";
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(address.port, address.host, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    const actual = this.server.address();
    if (actual === null || typeof actual === "string") throw new Error("Core HTTP listener has no TCP address");
    await this.refreshRuntime();
    return { host: address.host, port: actual.port };
  }

  status(): { readonly state: ReadinessReason; readonly ready: boolean; readonly checks: Record<string, boolean> } {
    const runtimeConfigured = this.runtimeProfiles.inspect().configured;
    return {
      state: this.state,
      ready: this.state === "READY",
      checks: {
        administrator: this.store.hasEnabledAdministrator(),
        runtimeConfigured,
        runtimeAvailable: this.runtime !== undefined,
      },
    };
  }

  async refreshRuntime(force = false): Promise<void> {
    if (!this.store.hasEnabledAdministrator()) { this.state = "ADMIN_REQUIRED"; return; }
    if (!this.runtimeProfiles.inspect().configured) { this.state = "RUNTIME_NOT_CONFIGURED"; return; }
    if (this.runtime !== undefined && !force && this.state !== "RUNTIME_UNAVAILABLE") { this.state = "READY"; return; }
    const previous = this.runtime;
    let runtime: WorkRuntimeAdapter = unavailableRuntime("runtime is not initialized");
    try {
      await this.options.dependencyCheck?.();
      runtime = this.options.runtimeFactory === undefined
        ? new DockerWorkRuntimeAdapter(this.paths, ensureInstallationId(this.paths))
        : await this.options.runtimeFactory(this);
      if (runtime instanceof DockerWorkRuntimeAdapter) await runtime.verifyDependency();
      this.runtime = runtime;
      this.state = "RECOVERING";
      await this.lifecycle.recover();
      if (previous !== undefined && previous !== runtime) previous.close?.();
      this.state = "READY";
    } catch {
      if (runtime !== previous) (runtime as WorkRuntimeAdapter & { close?: () => void }).close?.();
      this.runtime = previous;
      this.state = "RUNTIME_UNAVAILABLE";
    }
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
        return send(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", reason: this.state, ...this.status() });
      }
      if (request.method === "GET" && url.pathname === "/control/status") {
        if (this.state === "RUNTIME_UNAVAILABLE") await this.refreshRuntime();
        return send(response, 200, this.status());
      }
      if (url.pathname.startsWith("/control/")) {
        requireOperator(request, this.store);
        const control = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const actor = { userId: "operator", role: "admin" as const };
        if (request.method === "POST" && url.pathname === "/control/admin/bootstrap") {
          const body = await readJson<{ account?: unknown; password?: unknown }>(request);
          if (typeof body.account !== "string" || typeof body.password !== "string") throw api(400, "INVALID_REQUEST", "account and password are required");
          const created = await bootstrapAdministrator({ store: this.store, account: body.account, password: body.password });
          await this.refreshRuntime();
          return send(response, 201, created);
        }
        if (request.method === "GET" && url.pathname === "/control/users") return send(response, 200, { users: this.users.listUsers(actor) });
        if (request.method === "POST" && url.pathname === "/control/users") {
          const body = await readJson<{ account?: unknown; password?: unknown; role?: unknown }>(request);
          if (typeof body.account !== "string" || typeof body.password !== "string" || (body.role !== undefined && body.role !== "admin" && body.role !== "user")) throw api(400, "INVALID_REQUEST", "account and password are required");
          return send(response, 201, await this.users.createUser(actor, { account: body.account, password: body.password, ...(body.role === undefined ? {} : { role: body.role }) }));
        }
        if (control[0] === "control" && control[1] === "users" && control.length === 4 && request.method === "POST") {
          const userId = control[2]!;
          if (control[3] === "enable") { this.users.setEnabled(actor, userId, true); return send(response, 200, { userId, enabled: true }); }
          if (control[3] === "disable") { this.users.setEnabled(actor, userId, false); return send(response, 200, { userId, enabled: false }); }
          if (control[3] === "reset-credential") {
            const body = await readJson<{ password?: unknown }>(request);
            if (typeof body.password !== "string") throw api(400, "INVALID_REQUEST", "password is required");
            await this.users.resetPassword(actor, userId, body.password);
            return send(response, 200, { userId, credentialReset: true });
          }
        }
        if (request.method === "GET" && url.pathname === "/control/runtime") return send(response, 200, this.runtimeProfiles.inspect());
        if (request.method === "PUT" && url.pathname === "/control/runtime") {
          const body = await readJson<{ agentImage?: unknown; provider?: unknown; model?: unknown; baseUrl?: unknown; credential?: unknown }>(request);
          if (typeof body.agentImage !== "string" || typeof body.provider !== "string" || typeof body.model !== "string" || typeof body.credential !== "string" || (body.baseUrl !== undefined && typeof body.baseUrl !== "string")) throw api(400, "INVALID_REQUEST", "agentImage, provider, model, and credential are required");
          const configured = this.runtimeProfiles.configure({ agentImage: body.agentImage, provider: body.provider, model: body.model, credential: body.credential, ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }) });
          registerRuntimeProfileCatalog(this.store, this.runtimeProfiles.load());
          await this.refreshRuntime(true);
          if (this.state !== "READY") throw api(503, "RUNTIME_UNAVAILABLE", "the configured runtime is unavailable");
          return send(response, 200, configured);
        }
        throw api(404, "NOT_FOUND", "route not found");
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
        if (typeof body.name !== "string" || typeof body.idempotencyKey !== "string" || (body.configuration !== undefined && (body.configuration === null || typeof body.configuration !== "object"))) throw api(400, "INVALID_REQUEST", "name and idempotencyKey are required");
        const profile = this.runtimeProfiles.load();
        const configuration = body.configuration === undefined ? defaultWorkConfiguration(profile) : body.configuration as WorkConfig;
        return send(response, 202, this.lifecycle.create(principal, {
          name: body.name,
          configuration,
          idempotencyKey: body.idempotencyKey,
          runtimeProfileJson: JSON.stringify(profile),
          sourceRuntimeRevision: profile.revision,
        }));
      }
      if (parts[2] === "works" && parts.length === 4 && request.method === "GET") return send(response, 200, this.lifecycle.show(principal, parts[3]!));
      if (parts[2] === "works" && parts.length === 5 && parts[4] === "configuration" && request.method === "GET") {
        return send(response, 200, this.workConfigurations.get(principal, parts[3]!));
      }
      if (parts[2] === "works" && parts.length === 5 && parts[4] === "configuration" && request.method === "PUT") {
        const body = await readJson<{ expectedRevision?: unknown; configuration?: unknown }>(request);
        if (!Number.isInteger(body.expectedRevision) || body.configuration === null || typeof body.configuration !== "object") throw api(400, "INVALID_REQUEST", "expectedRevision and configuration are required");
        const work = this.lifecycle.show(principal, parts[3]!);
        const configuration = new WorkConfigurationValidator(this.store).validate({
          workOwnerUserId: work.ownerUserId,
          configuration: body.configuration,
          availableServiceIds: new Set(this.store.listServices(work.id).map((service) => service.serviceId)),
        });
        const resolved = resolveRuntimeProfileFromWorkConfig(this.store, configuration);
        const result = this.workConfigurations.update(principal, parts[3]!, body.expectedRevision as number, configuration, {
          runtimeProfileJson: JSON.stringify(resolved.profile),
          sourceRuntimeRevision: resolved.sourceRuntimeRevision,
        });
        return send(response, 200, result);
      }
      if (parts[2] === "works" && parts.length === 6 && parts[4] === "configuration" && parts[5] === "apply" && request.method === "POST") {
        requireRuntime(this.state);
        const body = await readJson<{ expectedRevision?: unknown }>(request);
        if (!Number.isInteger(body.expectedRevision)) throw api(400, "INVALID_REQUEST", "expectedRevision is required");
        await this.lifecycle.applyConfiguration(principal, parts[3]!, body.expectedRevision as number);
        return send(response, 200, this.workConfigurations.get(principal, parts[3]!));
      }
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
    prepare: (work, configuration) => current().prepare(work, configuration), start: (work, generation, configuration) => current().start(work, generation, configuration),
    inspect: (workId) => current().inspect(workId), drain: (workId, timeout) => current().drain(workId, timeout),
    stop: (workId, timeout) => current().stop(workId, timeout), remove: (workId) => current().remove(workId),
    listManagedInstances: () => current().listManagedInstances?.() ?? Promise.resolve([]),
  };
}
function unavailableRuntime(message: string): WorkRuntimeAdapter { const fail = async (): Promise<never> => { throw new Error(message); }; return { prepare: fail, start: fail, inspect: fail, drain: fail, stop: fail, remove: fail }; }
function requireRuntime(state: ReadinessReason): void {
  if (state === "READY") return;
  if (state === "ADMIN_REQUIRED") throw api(503, "ADMIN_REQUIRED", "an administrator must be bootstrapped first");
  if (state === "RUNTIME_NOT_CONFIGURED") throw api(503, "RUNTIME_NOT_CONFIGURED", "the global runtime default is not configured");
  throw api(503, "RUNTIME_UNAVAILABLE", `Core runtime is not ready: ${state}`);
}
function bearer(request: IncomingMessage): string { const value = request.headers.authorization; if (value === undefined || !value.startsWith("Bearer ") || value.length <= 7) throw api(401, "AUTHENTICATION_REQUIRED", "authentication is required"); return value.slice(7); }
function requireOperator(request: IncomingMessage, store: CoreStore): void {
  const value = request.headers.authorization;
  if (value === undefined || !value.startsWith("Operator ") || !verifyOperatorCredential(store, value.slice(9))) {
    throw api(401, "OPERATOR_AUTHENTICATION_REQUIRED", "operator authentication is required");
  }
}
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
  if (item.name === "ConfigurationRevisionConflictError" || item.name === "InitialAdministratorExistsError" || item.name === "DuplicateAccountError") return { status: 409, code: "CONFLICT", message: "request conflicts with current state" };
  if (item.name === "AdministrationPermissionError") return { status: 403, code: "PERMISSION_DENIED", message: "permission denied" };
  if (item.name === "LastEnabledAdministratorError") return { status: 409, code: "LAST_ADMINISTRATOR", message: "cannot disable the last enabled administrator" };
  if (item.name === "UserNotFoundError") return { status: 404, code: "NOT_FOUND", message: "resource was not found" };
  if (item.name === "InputValidationError" || item.name === "InvalidWorkConfigurationError") return { status: 400, code: "INVALID_REQUEST", message: item.message ?? "request input is invalid" };
  if (item.name === "ConfigurationValidationError") return { status: 400, code: "INVALID_CONFIGURATION", message: item.message ?? "Work configuration is invalid" };
  if (typeof item.status === "number") return { status: item.status, code: typeof item.code === "string" ? item.code : "REQUEST_FAILED", message: item.message ?? "request failed" };
  if (typeof item.code === "number") {
    const mapped = mapGrpcStatus(item.code);
    return mapped;
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "internal server error" };
}

function defaultWorkConfiguration(profile: RuntimeProfile): WorkConfig {
  return {
    revision: 1,
    agentImage: { catalogId: runtimeImageCatalogId(profile.revision) },
    skills: [],
    modelRef: runtimeModelCatalogId(profile.revision),
    mcpServers: [],
    resources: { cpuMillis: 1_000, memoryBytes: 768 * 1_024 * 1_024, maxServices: 0, maxRetainedVolumes: 1 },
    tools: { allowed: [], denied: [] },
  };
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
