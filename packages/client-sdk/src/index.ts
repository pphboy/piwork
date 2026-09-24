import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WORK_PACKAGE_MIME, type AcceptedWorkExport, type AcceptedWorkImport, type ImportWorkRequest, type UploadedWorkPackage,
  type WorkImportProvenance, type WorkSnapshot } from "@piwork/contracts";

export interface ClientOptions { readonly coreUrl: string; readonly fetch?: typeof globalThis.fetch; readonly token?: string; readonly operatorToken?: string; }
export interface PublicIdentity { readonly id: string; readonly account: string; readonly role: "admin" | "user"; }
export interface CredentialRecord { readonly version: 1; readonly coreUrl: string; readonly token: string; readonly expiresAt: string; readonly user: PublicIdentity; }

export type WorkServiceAction = "enable" | "disable" | "restart" | "retry" | "remove";
export interface AcceptedServiceOperation {
  readonly workId: string;
  readonly serviceId: string;
  readonly operationId: string;
  readonly correlationId: string;
  readonly reused: boolean;
}
export interface WorkServiceSummary {
  readonly workId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly observedState: string;
  readonly desiredRevision: number;
  readonly appliedRevision: number | null;
  readonly lastError: { readonly code?: string; readonly message?: string; readonly retryable?: boolean } | null;
  readonly endpoints: readonly { readonly name: string; readonly protocol: string; readonly host: string; readonly port: number; readonly url?: string }[];
  readonly createdAt: string;
}
export interface WorkServiceLogs {
  readonly serviceId: string;
  readonly status: "available" | "truncated" | "unavailable";
  readonly text: string;
  readonly truncated: boolean;
  readonly collectedAt: string;
  readonly reason?: string;
}
export interface RequestOptions { readonly signal?: AbortSignal; }

export function resolveCoreEndpoint(options: {
  readonly explicit?: string;
  readonly environment?: string;
  readonly saved?: string;
  readonly fallback?: string;
}): string {
  return options.explicit ?? options.environment ?? options.saved ?? options.fallback ?? "http://127.0.0.1:7171";
}

export function safeErrorMessage(error: unknown): string {
  const original = error instanceof Error ? error.message : String(error);
  return original
    .replace(/\b(Bearer|Operator)\s+[A-Za-z0-9._~+\/-]+/gi, "$1 [REDACTED]")
    .replace(/\b(password|passphrase|api[-_ ]?key|token|credential|secret)\s*([=:])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/([?&](?:password|api[-_]?key|token|credential|secret)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/(?:\/[^\s/:]+)*\/(?:secrets?\/[^\s:]+|[^\s/:]*\.secret|operator\.credential)\b/g, "[REDACTED_PATH]");
}

export class PiworkApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Readonly<Record<string, unknown>>) { super(message); this.name = "PiworkApiError"; }
}

export interface ClientCredentialStore { load(): Promise<CredentialRecord | undefined>; save(record: CredentialRecord): Promise<void>; clear(): Promise<void>; }

export function defaultCredentialPath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.PIWORK_CONFIG_PATH) return environment.PIWORK_CONFIG_PATH;
  if (environment.XDG_CONFIG_HOME) return join(environment.XDG_CONFIG_HOME, "piwork", "client.json");
  if (environment.HOME) return join(environment.HOME, ".config", "piwork", "client.json");
  throw new Error("HOME, XDG_CONFIG_HOME, or PIWORK_CONFIG_PATH is required for credential storage");
}

export class FileCredentialStore implements ClientCredentialStore {
  constructor(readonly path = defaultCredentialPath()) {}
  async load(): Promise<CredentialRecord | undefined> {
    let info;
    try { info = await lstat(this.path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("credential path must be a regular file, not a symbolic link");
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("credential file permissions must be 0600");
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, "utf8")); } catch { throw new Error("credential file is malformed"); }
    if (!isCredential(value)) throw new Error("credential file has an unsupported shape or version");
    return value;
  }
  async save(record: CredentialRecord): Promise<void> {
    if (!isCredential(record)) throw new Error("credential record is invalid");
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try { const existing = await lstat(this.path); if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("credential path must be a regular file, not a symbolic link"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = join(directory, `.client.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
    await chmod(this.path, 0o600);
  }
  async clear(): Promise<void> { await rm(this.path, { force: true }); }
}

export class PiworkClient {
  private readonly requestFetch: typeof globalThis.fetch;
  constructor(private readonly options: ClientOptions) { this.requestFetch = options.fetch ?? globalThis.fetch; }
  async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.requestFetch(new URL(path, normalizedUrl(this.options.coreUrl)), {
        method,
        headers: { accept: "application/json", ...authorization(this.options), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal,
      });
    } catch (error) { throw new PiworkApiError(0, "NETWORK_ERROR", error instanceof Error ? error.message : "network request failed"); }
    if (response.status === 204) return undefined as T;
    const text = await boundedText(response, 1_048_576, options.signal);
    let value: unknown;
    try { value = text === "" ? null : JSON.parse(text); } catch { throw new PiworkApiError(response.status, "MALFORMED_RESPONSE", "Core returned malformed JSON"); }
    if (!response.ok) {
      const item = value as { code?: unknown; message?: unknown };
      throw new PiworkApiError(response.status, typeof item?.code === "string" ? item.code : "HTTP_ERROR", typeof item?.message === "string" ? item.message : `HTTP ${response.status}`, value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined);
    }
    return value as T;
  }
  health() { return this.request<{ status: string }>("GET", "/healthz"); }
  readiness() { return this.request<{ status: string; reason?: string }>("GET", "/readyz"); }
  controlStatus() { return this.request<Record<string, unknown>>("GET", "/control/status"); }
  bootstrapAdministrator(account: string, password: string) { return this.request<Record<string, unknown>>("POST", "/control/admin/bootstrap", { account, password }); }
  managedUsers() { return this.request<{ users: unknown[] }>("GET", "/control/users"); }
  createManagedUser(input: { account: string; password: string; role?: "admin" | "user" }) { return this.request<Record<string, unknown>>("POST", "/control/users", input); }
  setManagedUserEnabled(userId: string, enabled: boolean) { return this.request<Record<string, unknown>>("POST", `/control/users/${encodeURIComponent(userId)}/${enabled ? "enable" : "disable"}`); }
  resetManagedUserCredential(userId: string, password: string) { return this.request<Record<string, unknown>>("POST", `/control/users/${encodeURIComponent(userId)}/reset-credential`, { password }); }
  runtimeProfile() { return this.request<Record<string, unknown>>("GET", "/control/runtime"); }
  configureRuntime(input: { agentImage: string; provider: string; model: string; baseUrl?: string; credential: string }) { return this.request<Record<string, unknown>>("PUT", "/control/runtime", input); }
  defaultWorkConfiguration() { return this.request<Record<string, unknown>>("GET", "/control/default-work"); }
  configureDefaultWorkConfiguration(configuration: unknown, overrides?: { readonly baseImage?: string }) { return this.request<Record<string, unknown>>("PUT", "/control/default-work", { configuration, ...(overrides?.baseImage === undefined ? {} : { baseImage: overrides.baseImage }) }); }
  managedSkills() { return this.request<{ skills: unknown[] }>("GET", "/control/skills"); }
  managedSkill(name: string) { return this.request<Record<string, unknown>>("GET", `/control/skills/${encodeURIComponent(name)}`); }
  addManagedSkill(path: string) { return this.request<Record<string, unknown>>("POST", "/control/skills", { path }); }
  updateManagedSkill(name: string, path: string) { return this.request<Record<string, unknown>>("PUT", `/control/skills/${encodeURIComponent(name)}`, { path }); }
  setManagedSkillEnabled(name: string, enabled: boolean) { return this.request<Record<string, unknown>>("POST", `/control/skills/${encodeURIComponent(name)}/${enabled ? "enable" : "disable"}`); }
  removeManagedSkill(name: string) { return this.request<void>("DELETE", `/control/skills/${encodeURIComponent(name)}`); }
  skills() { return this.request<{ skills: unknown[] }>("GET", "/api/v1/skills"); }
  skill(name: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/skills/${encodeURIComponent(name)}`); }
  login(account: string, password: string) { return this.request<{ token: string; expiresAt: string; user: PublicIdentity }>("POST", "/api/v1/login", { account, password }); }
  me() { return this.request<PublicIdentity & { expiresAt: string }>("GET", "/api/v1/me"); }
  logout() { return this.request<void>("POST", "/api/v1/logout"); }
  works() { return this.request<{ works: unknown[] }>("GET", "/api/v1/works"); }
  work(workId: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}`); }
  createWork(input: unknown) { return this.request<{ workId: string; operationId: string }>("POST", "/api/v1/works", input); }
  workAction(workId: string, action: "start" | "stop" | "retry" | "delete", idempotencyKey: string) { return this.request<{ workId: string; operationId: string }>("POST", `/api/v1/works/${encodeURIComponent(workId)}/${action}`, { idempotencyKey }); }
  exportWork(workId: string, idempotencyKey: string, options?: RequestOptions) {
    return this.request<AcceptedWorkExport>("POST", `/api/v1/works/${encodeURIComponent(workId)}/exports`, { idempotencyKey }, options);
  }
  workSnapshot(snapshotId: string, options?: RequestOptions) {
    return this.request<WorkSnapshot>("GET", `/api/v1/work-snapshots/${encodeURIComponent(snapshotId)}`, undefined, options);
  }
  importWork(input: ImportWorkRequest, options?: RequestOptions) {
    return this.request<AcceptedWorkImport>("POST", "/api/v1/work-imports", input, options);
  }
  importProvenance(workId: string, options?: RequestOptions) {
    return this.request<WorkImportProvenance>("GET", `/api/v1/works/${encodeURIComponent(workId)}/import-provenance`, undefined, options);
  }
  async downloadWorkSnapshot(snapshotId: string, options: RequestOptions = {}): Promise<{ stream: ReadableStream<Uint8Array>; digest: string; size: number }> {
    const path = `/api/v1/work-snapshots/${encodeURIComponent(snapshotId)}/content`;
    const response = await this.binaryFetch(path, { method: "GET", headers: { accept: WORK_PACKAGE_MIME, ...authorization(this.options) }, signal: options.signal });
    if (!response.ok) throw await binaryError(response, options.signal);
    const digest = response.headers.get("x-piwork-sha256"), lengthText = response.headers.get("content-length");
    const size = Number(lengthText);
    if (response.headers.get("content-type") !== WORK_PACKAGE_MIME || !digest || !/^[a-f0-9]{64}$/.test(digest)
      || !lengthText || !/^[0-9]+$/.test(lengthText) || !Number.isSafeInteger(size) || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new PiworkApiError(response.status, "MALFORMED_RESPONSE", "Core returned invalid Work package headers");
    }
    return { stream: response.body, digest, size };
  }
  async uploadWorkPackage(source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, digest: string, size: number,
    options: RequestOptions = {}): Promise<UploadedWorkPackage> {
    if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(size) || size <= 0) throw new TypeError("Invalid Work package digest or size");
    const body = source instanceof ReadableStream ? source : iterableStream(source, options.signal);
    const response = await this.binaryFetch("/api/v1/work-packages", { method: "POST", headers: {
      accept: "application/json", ...authorization(this.options), "content-type": WORK_PACKAGE_MIME,
      "content-length": String(size), "x-piwork-sha256": digest,
    }, body, signal: options.signal, duplex: "half" } as RequestInit & { duplex: "half" });
    if (!response.ok) throw await binaryError(response, options.signal);
    const payload = await boundedText(response, 1_048_576, options.signal);
    try { return JSON.parse(payload) as UploadedWorkPackage; }
    catch { throw new PiworkApiError(response.status, "MALFORMED_RESPONSE", "Core returned malformed Work package metadata"); }
  }
  async workServices(workId: string): Promise<{ services: WorkServiceSummary[] }> {
    const result = await this.request<{ services: WorkServiceSummary[] }>("GET", servicePath(workId));
    return { services: result.services.map(serviceSummary).sort((a, b) => compare(a.name, b.name) || compare(a.serviceId, b.serviceId)) };
  }
  async workService(workId: string, serviceId: string): Promise<WorkServiceSummary> {
    return serviceSummary(await this.request<WorkServiceSummary>("GET", servicePath(workId, serviceId)));
  }
  workServiceAction(workId: string, serviceId: string, action: WorkServiceAction, idempotencyKey: string) {
    return this.request<AcceptedServiceOperation>("POST", `${servicePath(workId, serviceId)}/${action}`, { idempotencyKey });
  }
  workServiceLogs(workId: string, serviceId: string, tailLines = 100) {
    return this.request<WorkServiceLogs>("GET", `${servicePath(workId, serviceId)}/logs?tailLines=${tailLines}`);
  }
  workConfiguration(workId: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}/configuration`); }
  updateWorkConfiguration(workId: string, configuration: unknown) { return this.request<Record<string, unknown>>("PUT", `/api/v1/works/${encodeURIComponent(workId)}/configuration`, { configuration }); }
  applyWorkConfiguration(workId: string, idempotencyKey: string) { return this.request<{ workId: string; operationId: string; reused: boolean }>("POST", `/api/v1/works/${encodeURIComponent(workId)}/configuration/apply`, { idempotencyKey }); }
  workSkills(workId: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}/configuration/skills`); }
  updateWorkSkills(workId: string, skills: unknown[]) { return this.request<Record<string, unknown>>("PUT", `/api/v1/works/${encodeURIComponent(workId)}/configuration/skills`, { skills }); }
  workAgents(workId: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}/configuration/agents`); }
  updateWorkAgents(workId: string, agentsMd: string) { return this.request<Record<string, unknown>>("PUT", `/api/v1/works/${encodeURIComponent(workId)}/configuration/agents`, { agentsMd }); }
  operation(operationId: string, options?: RequestOptions) { return this.request<Record<string, unknown>>("GET", `/api/v1/operations/${encodeURIComponent(operationId)}`, undefined, options); }
  createSession(workId: string, idempotencyKey: string) { return this.request<Record<string, unknown>>("POST", `/api/v1/works/${encodeURIComponent(workId)}/sessions`, { idempotencyKey }); }
  sessions(workId: string) { return this.request<{ sessions: unknown[] }>("GET", `/api/v1/works/${encodeURIComponent(workId)}/sessions`); }
  session(workId: string, sessionId: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}`); }
  submitRun(workId: string, input: unknown) { return this.request<{ run?: Record<string, unknown>; reused: boolean }>("POST", `/api/v1/works/${encodeURIComponent(workId)}/runs`, input); }
  getRun(workId: string, runId: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}`); }
  cancelRun(workId: string, runId: string, idempotencyKey: string) { return this.request<Record<string, unknown>>("POST", `/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/cancel`, { idempotencyKey }); }
  async *watchRun(workId: string, runId: string, after = 0, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
    let response: Response;
    try { response = await this.requestFetch(new URL(`/api/v1/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/events?after=${after}`, normalizedUrl(this.options.coreUrl)), { headers: { accept: "application/x-ndjson", ...authorization(this.options) }, signal }); }
    catch (error) { throw new PiworkApiError(0, "NETWORK_ERROR", error instanceof Error ? error.message : "network request failed"); }
    if (!response.ok) { const value = await boundedText(response); let parsed: { code?: string; message?: string } = {}; try { parsed = JSON.parse(value) as typeof parsed; } catch {} throw new PiworkApiError(response.status, parsed.code ?? "HTTP_ERROR", parsed.message ?? `HTTP ${response.status}`); }
    if (response.body === null) throw new PiworkApiError(0, "MALFORMED_RESPONSE", "Core returned no event stream");
    const decoder = new TextDecoder(); let buffer = ""; let bytes = 0; let cursor = after;
    for await (const chunk of response.body) {
      bytes += chunk.length; if (bytes > 16 * 1_024 * 1_024) throw new PiworkApiError(0, "RESPONSE_TOO_LARGE", "Run event stream exceeded the safety limit");
      buffer += decoder.decode(chunk, { stream: true });
      for (;;) { const newline = buffer.indexOf("\n"); if (newline < 0) break; const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line === "") continue; let event: Record<string, unknown>; try { event = JSON.parse(line) as Record<string, unknown>; } catch { throw new PiworkApiError(0, "MALFORMED_RESPONSE", "Run event stream contains malformed JSON"); } const sequence = Number(event.sequence); if (!Number.isSafeInteger(sequence) || sequence <= cursor) throw new PiworkApiError(0, "MALFORMED_RESPONSE", "Run events are out of order"); cursor = sequence; yield event; }
    }
    buffer += decoder.decode(); if (buffer.trim() !== "") throw new PiworkApiError(0, "MALFORMED_RESPONSE", "Run event stream ended with an incomplete record");
  }
  private async binaryFetch(path: string, init: RequestInit): Promise<Response> {
    try { return await this.requestFetch(new URL(path, normalizedUrl(this.options.coreUrl)), init); }
    catch (error) { throw new PiworkApiError(0, "NETWORK_ERROR", error instanceof Error ? error.message : "network request failed"); }
  }
}

function iterableStream(source: AsyncIterable<Uint8Array>, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      signal?.throwIfAborted();
      const next = await iterator.next();
      if (next.done) controller.close(); else controller.enqueue(next.value);
    },
    async cancel() { await iterator.return?.(); },
  }, { highWaterMark: 1 });
}
async function binaryError(response: Response, signal?: AbortSignal): Promise<PiworkApiError> {
  const text = await boundedText(response, 1_048_576, signal);
  let item: { code?: unknown; message?: unknown } = {};
  try { item = JSON.parse(text) as typeof item; } catch { /* preserve HTTP status */ }
  return new PiworkApiError(response.status, typeof item.code === "string" ? item.code : "HTTP_ERROR",
    typeof item.message === "string" ? item.message : `HTTP ${response.status}`);
}

function normalizedUrl(value: string): URL { const url = new URL(value); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Core URL must use HTTP or HTTPS"); if (!url.pathname.endsWith("/")) url.pathname += "/"; return url; }
function authorization(options: ClientOptions): Record<string, string> {
  if (options.token !== undefined && options.operatorToken !== undefined) throw new Error("user and operator credentials cannot be used together");
  if (options.operatorToken !== undefined) return { authorization: `Operator ${options.operatorToken}` };
  return options.token === undefined ? {} : { authorization: `Bearer ${options.token}` };
}
async function boundedText(response: Response, maximum = 1_048_576, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return Buffer.concat(chunks).toString("utf8");
      size += value.length;
      if (size > maximum) throw new PiworkApiError(response.status, "RESPONSE_TOO_LARGE", "Core response exceeded the safety limit");
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function servicePath(workId: string, serviceId?: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/services${serviceId === undefined ? "" : `/${encodeURIComponent(serviceId)}`}`;
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function serviceSummary(value: WorkServiceSummary): WorkServiceSummary {
  const error = value.lastError;
  return {
    workId: value.workId, serviceId: value.serviceId, name: value.name,
    enabled: value.enabled, observedState: value.observedState,
    desiredRevision: value.desiredRevision, appliedRevision: value.appliedRevision,
    lastError: error === null ? null : {
      ...(typeof error.code === "string" ? { code: safeErrorMessage(new Error(error.code)) } : {}),
      ...(typeof error.message === "string" ? { message: safeErrorMessage(new Error(error.message)) } : {}),
      ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}),
    },
    endpoints: value.endpoints.map(({ name, protocol, host, port, url }) => ({ name, protocol, host, port, ...(url === undefined ? {} : { url }) })),
    createdAt: value.createdAt,
  };
}
function isCredential(value: unknown): value is CredentialRecord { if (value === null || typeof value !== "object") return false; const item = value as Partial<CredentialRecord>; return item.version === 1 && typeof item.coreUrl === "string" && typeof item.token === "string" && item.token.length > 0 && typeof item.expiresAt === "string" && item.user !== undefined && typeof item.user.id === "string" && typeof item.user.account === "string" && (item.user.role === "admin" || item.user.role === "user"); }
