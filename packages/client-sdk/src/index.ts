import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parsePiPackageSource, stagePiPackageUpload } from "@piwork/pi-package";
import { WORK_PACKAGE_MIME, type AcceptedWorkExport, type AcceptedWorkImport, type ImportWorkRequest, type UploadedWorkPackage,
  type WorkImportProvenance, type WorkSnapshot, type PiPackageSource, type PiPackageOperationAcceptance,
  type PiPackageUploadResult, type PiPackageSelectionEntry, encodeAdminPathSegment,
  type AdminStatus, type AdminRuntimeView, type AdminRuntimeInput, type AdminRuntimeResult,
  type AdminDefaultWorkView, type AdminDefaultWorkPatch, type AdminPackageSource,
  type AdminPackageOperationAcceptance, type AdminPackageOperation, type ManagedSkill,
  type User, type PiPackageCatalogEntry } from "@piwork/contracts";

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
export interface AdminSkillFile {
  readonly relativePath: string;
  readonly content: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
}
export interface PiPackageWaitProgress {
  readonly kind: "phase" | "heartbeat" | "retry" | "recovered" | "terminal";
  readonly elapsedMs: number;
  readonly packagePhase?: string;
  readonly retryMs?: number;
  readonly state?: string;
  readonly stage?: string;
  readonly code?: string;
}
export function formatPiPackageWaitProgress(operationId: string, progress: PiPackageWaitProgress): string {
  const seconds = Math.floor(progress.elapsedMs / 1_000);
  const phase = progress.packagePhase === undefined ? "" : ` phase=${progress.packagePhase}`;
  if (progress.kind === "retry") return `Package Operation ${operationId}: observation unavailable; retry in ${progress.retryMs}ms (${seconds}s elapsed)\n`;
  if (progress.kind === "recovered") return `Package Operation ${operationId}: observation restored (${seconds}s elapsed)\n`;
  if (progress.kind === "terminal") return `Package Operation ${operationId}: ${progress.state}${phase}${progress.stage ? ` stage=${progress.stage}` : ""}${progress.code ? ` code=${progress.code}` : ""} (${seconds}s elapsed)\n`;
  if (progress.kind === "phase") return `Package Operation ${operationId}: package${phase} (${seconds}s elapsed)\n`;
  return `Package Operation ${operationId}: ${progress.kind}${phase} (${seconds}s elapsed)\n`;
}

/** Parse and upload a local snapshot; Core receives only an opaque upload ID. */
export async function resolvePiPackageSource(client: PiworkClient, argument: string,
  scope: { readonly kind: "core" } | { readonly kind: "work"; readonly workId: string }, options: RequestOptions = {}): Promise<PiPackageSource> {
  const source = parsePiPackageSource(argument);
  if (source.kind === "npm" || source.kind === "git") return { kind: source.kind, spec: source.spec };
  const scratch = await mkdtemp(join(tmpdir(), "piwork-pi-package-"));
  try {
    const staged = await stagePiPackageUpload(source, scratch);
    try {
      const uploaded = await client.uploadPiPackage(createReadStream(staged.path), staged.sha256, staged.bytes,
        staged.displayName, staged.sourceKind, scope, options);
      return { kind: "upload", uploadId: uploaded.uploadId };
    } finally { await staged.cleanup(); }
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export async function waitPiPackageOperation(client: PiworkClient, accepted: PiPackageOperationAcceptance,
  options: { readonly now?: () => number; readonly sleep?: (milliseconds: number) => Promise<void>; readonly deadlineMs?: number;
    readonly signal?: AbortSignal; readonly onProgress?: (progress: PiPackageWaitProgress) => void } = {}): Promise<Record<string, unknown>> {
  const now = options.now ?? Date.now, sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const started = now(), deadline = options.deadlineMs === undefined ? undefined : started + options.deadlineMs;
  let lastPhase: string | undefined, lastHeartbeat = started, retryMs = 250, observingFailure = false;
  const progress = (event: Omit<PiPackageWaitProgress, "elapsedMs">) => options.onProgress?.({ ...event, elapsedMs: now() - started });
  const interrupted = () => new PiworkApiError(0, "OPERATION_WAIT_INTERRUPTED", `Stopped waiting for package Operation ${accepted.operationId}.`);
  const pause = async (milliseconds: number) => {
    if (options.signal?.aborted) throw interrupted();
    if (options.sleep) { await sleep(milliseconds); }
    else await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { options.signal?.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
      const onAbort = () => { clearTimeout(timer); reject(interrupted()); };
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    if (options.signal?.aborted) throw interrupted();
  };
  for (;;) {
    if (options.signal?.aborted) throw interrupted();
    const remaining = deadline === undefined ? undefined : deadline - now();
    if (remaining !== undefined && remaining <= 0) throw new PiworkApiError(0, "OPERATION_WAIT_TIMEOUT", `Timed out waiting for package Operation ${accepted.operationId}; inspect it with operation show ${accepted.operationId}.`);
    const signal = AbortSignal.any([AbortSignal.timeout(Math.min(30_000, remaining ?? 30_000)), ...(options.signal ? [options.signal] : [])]);
    let operation: Record<string, unknown>;
    try {
      operation = accepted.scope === "core"
        ? await client.managedOperation(accepted.operationId, { signal })
        : await client.operation(accepted.operationId, { signal });
    } catch (error) {
      if (options.signal?.aborted) throw interrupted();
      if (deadline !== undefined && now() >= deadline) throw new PiworkApiError(0, "OPERATION_WAIT_TIMEOUT", `Timed out waiting for package Operation ${accepted.operationId}.`);
      const temporary = signal.aborted || (error instanceof PiworkApiError &&
        (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504));
      if (!temporary) throw error;
      progress({ kind: "retry", retryMs });
      observingFailure = true;
      await pause(retryMs);
      retryMs = Math.min(retryMs * 2, 5_000);
      continue;
    }
    if (observingFailure) { progress({ kind: "recovered" }); observingFailure = false; }
    retryMs = 250;
    const phase = typeof operation.packagePhase === "string" &&
      ["queued", "source", "prepare", "validate", "publish", "cleanup-pending", "succeeded", "failed", "superseded"].includes(operation.packagePhase)
      ? operation.packagePhase : undefined;
    if (phase !== undefined && phase !== lastPhase) { progress({ kind: "phase", packagePhase: phase }); lastPhase = phase; lastHeartbeat = now(); }
    else if (now() - lastHeartbeat >= 30_000) { progress({ kind: "heartbeat", packagePhase: phase }); lastHeartbeat = now(); }
    const state = String(operation.state);
    if (state === "succeeded" || state === "failed" || state === "superseded") {
      const error = operation.error && typeof operation.error === "object" ? operation.error as Record<string, unknown> : null;
      progress({ kind: "terminal", state, packagePhase: phase,
        ...(typeof error?.stage === "string" && /^[a-z-]+$/.test(error.stage) ? { stage: error.stage } : {}),
        ...(typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? { code: error.code } : {}) });
      return operation;
    }
    await pause(Math.min(250, Math.max(0, deadline === undefined ? 250 : deadline - now())));
  }
}

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
  private async adminRequest<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    this.requireAdminBearer();
    return this.request<T>(method, `/api/v1/admin${path}`, body, options);
  }
  private requireAdminBearer(): void {
    if (this.options.token === undefined || this.options.operatorToken !== undefined) {
      throw new TypeError("admin API requires a bearer token and no operator credential");
    }
  }
  adminStatus(options?: RequestOptions) { return this.adminRequest<AdminStatus>("GET", "/status", undefined, options); }
  adminUsers(options?: RequestOptions) { return this.adminRequest<{ users: User[] }>("GET", "/users", undefined, options); }
  adminCreateUser(input: { account: string; password: string; role?: "admin" | "user" }, options?: RequestOptions) {
    return this.adminRequest<User>("POST", "/users", input, options);
  }
  adminSetUserEnabled(userId: string, enabled: boolean, options?: RequestOptions) {
    return this.adminRequest<{ userId: string; enabled: boolean }>("POST", `/users/${encodeAdminPathSegment(userId)}/${enabled ? "enable" : "disable"}`, {}, options);
  }
  adminResetUserCredential(userId: string, password: string, options?: RequestOptions) {
    return this.adminRequest<{ userId: string; credentialReset: true }>("POST", `/users/${encodeAdminPathSegment(userId)}/reset-credential`, { password }, options);
  }
  adminRuntime(options?: RequestOptions) { return this.adminRequest<AdminRuntimeView>("GET", "/runtime", undefined, options); }
  adminConfigureRuntime(input: AdminRuntimeInput, options?: RequestOptions) {
    return this.adminRequest<AdminRuntimeResult>("PUT", "/runtime", input, options);
  }
  adminDefaultWork(options?: RequestOptions) { return this.adminRequest<AdminDefaultWorkView>("GET", "/default-work", undefined, options); }
  adminPatchDefaultWork(patch: AdminDefaultWorkPatch, options?: RequestOptions) {
    return this.adminRequest<AdminDefaultWorkView>("PATCH", "/default-work", patch, options);
  }
  adminSkills(options?: RequestOptions) { return this.adminRequest<{ skills: ManagedSkill[] }>("GET", "/skills", undefined, options); }
  adminSkill(name: string, options?: RequestOptions) {
    return this.adminRequest<ManagedSkill>("GET", `/skills/${encodeAdminPathSegment(name)}`, undefined, options);
  }
  adminSetSkillEnabled(name: string, enabled: boolean, options?: RequestOptions) {
    return this.adminRequest<ManagedSkill>("POST", `/skills/${encodeAdminPathSegment(name)}/${enabled ? "enable" : "disable"}`, {}, options);
  }
  adminRemoveSkill(name: string, options?: RequestOptions) {
    return this.adminRequest<void>("DELETE", `/skills/${encodeAdminPathSegment(name)}`, undefined, options);
  }
  adminPackages(options?: RequestOptions) { return this.adminRequest<{ packages: PiPackageCatalogEntry[] }>("GET", "/packages", undefined, options); }
  adminPackage(name: string, options?: RequestOptions) {
    return this.adminRequest<PiPackageCatalogEntry & { resolvedSource: string }>("GET", `/packages/${encodeAdminPathSegment(name)}`, undefined, options);
  }
  adminInstallPackage(source: AdminPackageSource, idempotencyKey: string, addToDefaults = false, options?: RequestOptions) {
    return this.adminRequest<AdminPackageOperationAcceptance>("POST", "/packages", { source, idempotencyKey, addToDefaults }, options);
  }
  adminUpdatePackage(name: string, source: AdminPackageSource, idempotencyKey: string, options?: RequestOptions) {
    return this.adminRequest<AdminPackageOperationAcceptance>("POST", `/packages/${encodeAdminPathSegment(name)}/update`, { source, idempotencyKey }, options);
  }
  adminSetPackageEnabled(name: string, enabled: boolean, options?: RequestOptions) {
    return this.adminRequest<PiPackageCatalogEntry>("POST", `/packages/${encodeAdminPathSegment(name)}/${enabled ? "enable" : "disable"}`, {}, options);
  }
  adminRemovePackage(name: string, options?: RequestOptions) {
    return this.adminRequest<void>("DELETE", `/packages/${encodeAdminPathSegment(name)}`, undefined, options);
  }
  adminOperation(operationId: string, options?: RequestOptions) {
    return this.adminRequest<AdminPackageOperation>("GET", `/operations/${encodeAdminPathSegment(operationId)}`, undefined, options);
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
  patchDefaultWorkPackages(packages: readonly PiPackageSelectionEntry[]) { return this.request<Record<string, unknown>>("PUT", "/control/default-work", { patch: { packages } }); }
  configureDefaultWorkConfiguration(configuration: unknown, overrides?: { readonly baseImage?: string }) { return this.request<Record<string, unknown>>("PUT", "/control/default-work", { configuration, ...(overrides?.baseImage === undefined ? {} : { baseImage: overrides.baseImage }) }); }
  managedSkills() { return this.request<{ skills: unknown[] }>("GET", "/control/skills"); }
  managedSkill(name: string) { return this.request<Record<string, unknown>>("GET", `/control/skills/${encodeURIComponent(name)}`); }
  addManagedSkill(path: string) { return this.request<Record<string, unknown>>("POST", "/control/skills", { path }); }
  updateManagedSkill(name: string, path: string) { return this.request<Record<string, unknown>>("PUT", `/control/skills/${encodeURIComponent(name)}`, { path }); }
  setManagedSkillEnabled(name: string, enabled: boolean) { return this.request<Record<string, unknown>>("POST", `/control/skills/${encodeURIComponent(name)}/${enabled ? "enable" : "disable"}`); }
  removeManagedSkill(name: string) { return this.request<void>("DELETE", `/control/skills/${encodeURIComponent(name)}`); }
  managedPackages() { return this.request<{ packages: unknown[] }>("GET", "/control/packages"); }
  managedPackage(name: string) { return this.request<Record<string, unknown>>("GET", `/control/packages/${encodeURIComponent(name)}`); }
  installManagedPackage(source: PiPackageSource, idempotencyKey: string, addToDefaults = false) {
    return this.request<PiPackageOperationAcceptance>("POST", "/control/packages", { source, idempotencyKey, addToDefaults });
  }
  updateManagedPackage(name: string, source: PiPackageSource, idempotencyKey: string) {
    return this.request<PiPackageOperationAcceptance>("POST", `/control/packages/${encodeURIComponent(name)}/update`, { source, idempotencyKey });
  }
  setManagedPackageEnabled(name: string, enabled: boolean) {
    return this.request<Record<string, unknown>>("POST", `/control/packages/${encodeURIComponent(name)}/${enabled ? "enable" : "disable"}`);
  }
  removeManagedPackage(name: string) { return this.request<void>("DELETE", `/control/packages/${encodeURIComponent(name)}`); }
  managedOperation(operationId: string, options?: RequestOptions) { return this.request<Record<string, unknown>>("GET", `/control/operations/${encodeURIComponent(operationId)}`, undefined, options); }
  skills() { return this.request<{ skills: unknown[] }>("GET", "/api/v1/skills"); }
  skill(name: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/skills/${encodeURIComponent(name)}`); }
  packages() { return this.request<{ packages: unknown[] }>("GET", "/api/v1/packages"); }
  package(name: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/packages/${encodeURIComponent(name)}`); }
  workPackages(workId: string) { return this.request<{ packages: unknown[] }>("GET", `/api/v1/works/${encodeURIComponent(workId)}/packages`); }
  workPackage(workId: string, name: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}/packages/${encodeURIComponent(name)}`); }
  installWorkPackage(workId: string, source: PiPackageSource, idempotencyKey: string) {
    return this.request<PiPackageOperationAcceptance>("POST", `/api/v1/works/${encodeURIComponent(workId)}/packages`, { source, idempotencyKey });
  }
  updateWorkPackage(workId: string, name: string, source: PiPackageSource, idempotencyKey: string) {
    return this.request<PiPackageOperationAcceptance>("POST", `/api/v1/works/${encodeURIComponent(workId)}/packages/${encodeURIComponent(name)}/update`, { source, idempotencyKey });
  }
  setWorkPackageEnabled(workId: string, name: string, enabled: boolean) {
    return this.request<Record<string, unknown>>("POST", `/api/v1/works/${encodeURIComponent(workId)}/packages/${encodeURIComponent(name)}/${enabled ? "enable" : "disable"}`);
  }
  removeWorkPackage(workId: string, name: string) { return this.request<Record<string, unknown>>("DELETE", `/api/v1/works/${encodeURIComponent(workId)}/packages/${encodeURIComponent(name)}`); }
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
  async uploadPiPackage(source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, digest: string, size: number,
    displayName: string, sourceKind: "local" | "zip", scope: { readonly kind: "core" } | { readonly kind: "work"; readonly workId: string },
    options: RequestOptions = {}): Promise<PiPackageUploadResult> {
    const path = scope.kind === "core" ? "/control/package-uploads" : `/api/v1/works/${encodeURIComponent(scope.workId)}/package-uploads`;
    return this.uploadPiPackageToPath(path, source, digest, size, displayName, sourceKind, options);
  }
  adminUploadPiPackage(source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, digest: string, size: number,
    displayName: string, sourceKind: "local" | "zip", options: RequestOptions = {}): Promise<PiPackageUploadResult> {
    this.requireAdminBearer();
    return this.uploadPiPackageToPath("/api/v1/admin/package-uploads", source, digest, size, displayName, sourceKind, options);
  }
  private async uploadPiPackageToPath(path: string, source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, digest: string, size: number,
    displayName: string, sourceKind: "local" | "zip", options: RequestOptions): Promise<PiPackageUploadResult> {
    if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(size) || size <= 0 || !displayName || displayName.includes("/") || displayName.includes("\\")) throw new TypeError("Invalid Pi package upload metadata");
    const body = source instanceof ReadableStream ? source : iterableStream(source, options.signal);
    const response = await this.binaryFetch(path, { method: "POST", headers: {
      accept: "application/json", ...authorization(this.options), "content-type": "application/zip",
      "content-length": String(size), "x-piwork-sha256": digest, "x-piwork-package-source": sourceKind,
      "x-piwork-package-name": encodeURIComponent(displayName),
    }, body, signal: options.signal, duplex: "half" } as RequestInit & { duplex: "half" });
    if (!response.ok) throw await binaryError(response, options.signal);
    const payload = await boundedText(response, 1_048_576, options.signal);
    try { return JSON.parse(payload) as PiPackageUploadResult; }
    catch { throw new PiworkApiError(response.status, "MALFORMED_RESPONSE", "Core returned malformed Pi package upload metadata"); }
  }
  async adminUploadSkill(directoryName: string, files: AsyncIterable<AdminSkillFile>, targetName?: string,
    options: RequestOptions = {}): Promise<ManagedSkill> {
    this.requireAdminBearer();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(directoryName)) throw new TypeError("Invalid Skill directory name");
    const boundary = `piwork-${randomBytes(18).toString("hex")}`;
    const body = iterableStream(skillMultipart(boundary, directoryName, files, options.signal), options.signal);
    const path = `/api/v1/admin/skills${targetName === undefined ? "" : `/${encodeAdminPathSegment(targetName)}`}`;
    const response = await this.binaryFetch(path, { method: targetName === undefined ? "POST" : "PUT", headers: {
      accept: "application/json", ...authorization(this.options), "content-type": `multipart/form-data; boundary=${boundary}`,
    }, body, signal: options.signal, duplex: "half" } as RequestInit & { duplex: "half" });
    if (!response.ok) throw await binaryError(response, options.signal);
    const payload = await boundedText(response, 1_048_576, options.signal);
    try { return JSON.parse(payload) as ManagedSkill; }
    catch { throw new PiworkApiError(response.status, "MALFORMED_RESPONSE", "Core returned malformed Skill metadata"); }
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
  workPackageSelection(workId: string) { return this.request<Record<string, unknown>>("GET", `/api/v1/works/${encodeURIComponent(workId)}/configuration/packages`); }
  updateWorkPackageSelection(workId: string, packages: readonly PiPackageSelectionEntry[]) { return this.request<Record<string, unknown>>("PUT", `/api/v1/works/${encodeURIComponent(workId)}/configuration/packages`, { packages }); }
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

async function* skillMultipart(boundary: string, directoryName: string, files: AsyncIterable<AdminSkillFile>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const bytes = (value: string) => Buffer.from(value, "utf8");
  yield bytes(`--${boundary}\r\nContent-Disposition: form-data; name="directoryName"\r\n\r\n${directoryName}\r\n`);
  for await (const file of files) {
    signal?.throwIfAborted();
    if (!file.relativePath || file.relativePath.startsWith("/") || file.relativePath.includes("\\") || file.relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new TypeError("Invalid Skill relative path");
    }
    yield bytes(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${encodeURIComponent(file.relativePath)}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    for await (const chunk of file.content) { signal?.throwIfAborted(); yield chunk; }
    yield bytes("\r\n");
  }
  yield bytes(`--${boundary}--\r\n`);
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
    typeof item.message === "string" ? item.message : `HTTP ${response.status}`,
    item !== null && typeof item === "object" ? item as Record<string, unknown> : undefined);
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
