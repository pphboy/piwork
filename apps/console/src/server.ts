import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { InputError, uploadBrowserPackage } from "./package-inputs.js";
import { BrowserMutationProtector, browserSessionCookie } from "./browser-security.js";

export interface ConsoleConfig {
  readonly coreUrl: string;
  readonly listenHost: string;
  readonly listenPort: number;
  readonly publicOrigin: string;
  readonly dataDir: string;
  readonly cert: Buffer;
  readonly key: Buffer;
}
interface Session { token: string; user: { id: string; account: string; role: "admin" }; expiresAt: number; csrf: string; }
interface Challenge { csrf: string; expiresAt: number; }
class ConsoleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterMs?: number) { super(message); }
}
const sessionCookie = "__Host-piwork-console";
const loginCookie = "__Host-piwork-login";
const random = () => randomBytes(32).toString("base64url");
const shellPaths = new Set(["/", "/login", "/users", "/runtime", "/default-work", "/skills", "/packages", "/operations"]);
const adminMethods = new Map<string, ReadonlySet<string>>([
  ["/status", new Set(["GET"])], ["/users", new Set(["GET", "POST"])], ["/runtime", new Set(["GET", "PUT"])],
  ["/default-work", new Set(["GET", "PATCH"])], ["/skills", new Set(["GET", "POST"])],
  ["/packages", new Set(["GET", "POST"])],
]);
const shutdownSignals = new WeakMap<Server, AbortController>();
export function requestConsoleShutdown(server: Server): void {
  shutdownSignals.get(server)?.abort();
}

export async function createConsoleServer(config: ConsoleConfig): Promise<Server> {
  const shell = await readFile(fileURLToPath(new URL("./public/index.html", import.meta.url)));
  const css = await readFile(fileURLToPath(new URL("./public/style.css", import.meta.url)));
  const script = await readFile(fileURLToPath(new URL("./browser/app.js", import.meta.url)));
  const sessions = new Map<string, Session>();
  const challenges = new Map<string, Challenge>();
  const failures = new Map<string, { started: number; count: number }>();
  const mutationProtector = new BrowserMutationProtector([config.publicOrigin]);
  const shutdown = new AbortController();
  let packageInputsActive = 0;
  const prune = () => { const now = Date.now();
    for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
    for (const [id, challenge] of challenges) if (challenge.expiresAt <= now) challenges.delete(id);
    for (const [key, bucket] of failures) if (now - bucket.started >= 60_000) failures.delete(key);
  };
  const timer = setInterval(prune, 60_000); timer.unref();
  const server = createServer({ cert: config.cert, key: config.key }, (request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (response.headersSent) { if (!response.writableEnded) response.destroy(); return; }
      const known = error instanceof ConsoleError ? error : new ConsoleError(500, "CONSOLE_INTERNAL_ERROR", "面板请求失败");
      sendJson(response, known.status, { code: known.code, message: known.message,
        ...(known.retryAfterMs === undefined ? {} : { retryAfterMs: known.retryAfterMs }) });
    });
  });
  shutdownSignals.set(server, shutdown);
  server.requestTimeout = 31 * 60_000;
  server.on("close", () => { shutdown.abort(); clearInterval(timer); sessions.clear(); challenges.clear(); });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (shutdown.signal.aborted) throw new ConsoleError(503, "CONSOLE_SHUTTING_DOWN", "面板正在关闭");
    secureHeaders(response);
    const origin = new URL(config.publicOrigin);
    if (request.headers.host !== origin.host) throw new ConsoleError(400, "INVALID_HOST", "请求主机名无效");
    const url = new URL(request.url ?? "/", origin);
    if (url.search || url.hash) throw new ConsoleError(404, "NOT_FOUND", "页面不存在");
    if (request.method === "GET" && url.pathname === "/healthz") return sendJson(response, 200, { status: "healthy" });
    if (request.method === "GET" && url.pathname === "/style.css") return sendBytes(response, 200, "text/css; charset=utf-8", css);
    if (request.method === "GET" && url.pathname === "/browser/app.js") return sendBytes(response, 200, "text/javascript; charset=utf-8", script);
    if (request.method === "GET" && isShellPath(url.pathname)) return sendBytes(response, 200, "text/html; charset=utf-8", shell);
    if (request.method === "GET" && url.pathname === "/console/api/availability") {
      try {
        const core = await coreFetch("/readyz", "GET", undefined, undefined, 5000);
        const body = await core.json() as { checks?: { administrator?: boolean } };
        return sendJson(response, 200, { reachable: true, administratorInitialized: body.checks?.administrator === true });
      } catch { return sendJson(response, 200, { reachable: false, administratorInitialized: null }); }
    }
    const cookies = parseCookies(request.headers.cookie ?? "");
    if (request.method === "GET" && url.pathname === "/console/api/session") {
      const current = await activeSession(cookies.get(sessionCookie), response);
      if (current) return sendJson(response, 200, { authenticated: true, user: current.user,
        expiresAt: new Date(current.expiresAt).toISOString(), csrfToken: current.csrf });
      prune();
      if (challenges.size >= 2048) throw new ConsoleError(429, "CONSOLE_CHALLENGE_CAPACITY", "登录请求过多，请稍后重试", 1000);
      const id = random(), csrf = mutationProtector.issueCsrfToken(id);
      challenges.set(id, { csrf, expiresAt: Date.now() + 10 * 60_000 });
      setCookie(response, loginCookie, id, 600);
      return sendJson(response, 200, { authenticated: false, csrfToken: csrf });
    }
    if (request.method === "POST" && url.pathname === "/console/api/login") {
      requireOrigin(request);
      const id = cookies.get(loginCookie), challenge = id === undefined ? undefined : challenges.get(id);
      if (!challenge || challenge.expiresAt <= Date.now()) throw new ConsoleError(403, "CSRF_INVALID", "登录验证已失效，请刷新页面");
      requireCsrf(request, id!, challenge.csrf);
      const input = await readJsonBody(request);
      if (typeof input.account !== "string" || typeof input.password !== "string") throw new ConsoleError(400, "INVALID_REQUEST", "账号或密码无效");
      const source = request.socket.remoteAddress ?? "unknown";
      const keys = [`source:${source}`, `account:${input.account.toLowerCase()}`];
      const buckets = keys.map((key) => failures.get(key));
      const blocked = buckets.filter((bucket) => bucket && Date.now() - bucket.started < 60_000 && bucket.count >= 5);
      if (blocked.length) throw new ConsoleError(429, "RATE_LIMITED", "登录过于频繁",
        Math.max(...blocked.map((bucket) => 60_000 - (Date.now() - bucket!.started))));
      let credentials: { token: string; expiresAt: string; user: { id: string; account: string; role: "admin" | "user" } };
      try {
        const core = await coreFetch("/api/v1/login", "POST", JSON.stringify({ account: input.account, password: input.password }));
        if (!core.ok) {
          const failure = await core.json().catch(() => ({})) as { retryAfterMs?: number };
          throw new ConsoleError(core.status === 429 ? 429 : 401, core.status === 429 ? "RATE_LIMITED" : "AUTHENTICATION_FAILED",
            core.status === 429 ? "登录过于频繁" : "账号或密码无效", failure.retryAfterMs);
        }
        credentials = await core.json() as typeof credentials;
      } catch (error) {
        if (error instanceof ConsoleError && error.status !== 401) throw error;
        keys.forEach((key, index) => { const bucket = buckets[index]; const active = bucket && Date.now() - bucket.started < 60_000;
          failures.set(key, { started: active ? bucket.started : Date.now(), count: (active ? bucket.count : 0) + 1 }); });
        throw new ConsoleError(401, "AUTHENTICATION_FAILED", "账号或密码无效");
      }
      if (credentials.user.role !== "admin") {
        await coreFetch("/api/v1/logout", "POST", undefined, credentials.token).catch(() => undefined);
        throw new ConsoleError(403, "ADMIN_ONLY", "仅管理员可访问，请使用 piwork-cli");
      }
      const status = await coreFetch("/api/v1/admin/status", "GET", undefined, credentials.token);
      const version = await status.json().catch(() => null) as { adminApiVersion?: number } | null;
      if (!status.ok || version?.adminApiVersion !== 1) {
        await coreFetch("/api/v1/logout", "POST", undefined, credentials.token).catch(() => undefined);
        throw new ConsoleError(503, "CORE_ADMIN_API_UNAVAILABLE", "Core 管理接口版本不兼容");
      }
      prune();
      if (sessions.size >= 1024) {
        await coreFetch("/api/v1/logout", "POST", undefined, credentials.token).catch(() => undefined);
        throw new ConsoleError(503, "CONSOLE_SESSION_CAPACITY", "面板会话已满");
      }
      const expiry = Date.parse(credentials.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new ConsoleError(502, "CORE_INVALID_RESPONSE", "Core 登录响应无效");
      const sessionId = random(), session: Session = { token: credentials.token,
        user: { ...credentials.user, role: "admin" }, expiresAt: expiry, csrf: mutationProtector.issueCsrfToken(sessionId) };
      sessions.set(sessionId, session);
      challenges.delete(id!);
      clearCookie(response, loginCookie);
      setCookie(response, sessionCookie, sessionId, Math.max(1, Math.floor((expiry - Date.now()) / 1000)));
      for (const key of keys) failures.delete(key);
      return sendJson(response, 200, { authenticated: true, user: session.user, expiresAt: credentials.expiresAt, csrfToken: session.csrf });
    }
    if (url.pathname.startsWith("/console/api/")) {
      const session = await activeSession(cookies.get(sessionCookie), response);
      if (!session) throw new ConsoleError(401, "AUTHENTICATION_REQUIRED", "请先登录");
      if (request.method !== "GET") requireCsrf(request, cookies.get(sessionCookie)!, session.csrf);
      if (request.method === "POST" && url.pathname === "/console/api/logout") {
        const upstream = await coreFetch("/api/v1/logout", "POST", undefined, session.token);
        if (!upstream.ok && upstream.status !== 401) throw new ConsoleError(502, "CORE_UNAVAILABLE", "Core 注销未完成，请重试");
        sessions.delete(cookies.get(sessionCookie)!); clearCookie(response, sessionCookie);
        return sendJson(response, 200, { loggedOut: true });
      }
      if (request.method === "GET" && url.pathname === "/console/api/health") {
        const upstream = await coreFetch("/healthz", "GET", undefined, undefined, 5000);
        return sendJson(response, upstream.ok ? 200 : 502, { healthy: upstream.ok });
      }
      if (request.method === "POST" && (url.pathname === "/console/api/package-inputs/directory" || url.pathname === "/console/api/package-inputs/zip")) {
        if (packageInputsActive >= 2) throw new ConsoleError(429, "CONSOLE_UPLOAD_BUSY", "上传队列已满", 1000);
        packageInputsActive += 1;
        try {
          const result = await uploadBrowserPackage({ request, kind: url.pathname.endsWith("/zip") ? "zip" : "directory",
            dataDir: config.dataDir, coreUrl: config.coreUrl, token: session.token,
            signal: shutdown.signal,
            onTimeout: (error) => { if (response.headersSent) { request.destroy(error); return; }
              response.once("finish", () => request.destroy(error));
              response.setHeader("connection", "close");
              sendJson(response, 408, { code: "CONSOLE_UPLOAD_TIMEOUT", message: "Package upload timed out" }); },
            beforeUpload: async () => { if (!await activeSession(cookies.get(sessionCookie), response)) throw new ConsoleError(401, "AUTHENTICATION_REQUIRED", "会话已失效"); } });
          return sendJson(response, 201, result);
        } catch (error) {
          if (error instanceof InputError) throw new ConsoleError(error.status, error.code, error.message);
          throw error;
        } finally { packageInputsActive -= 1; }
      }
      if (url.pathname.startsWith("/console/api/admin/")) {
        const path = url.pathname.slice("/console/api/admin".length);
        if (!allowedAdminRoute(request.method ?? "", path)) throw new ConsoleError(404, "NOT_FOUND", "接口不存在");
        const isMultipart = path === "/skills" && request.method === "POST" || /^\/skills\/[^/]+$/.test(path) && request.method === "PUT";
        const body = request.method === "GET" || request.method === "DELETE" ? undefined
          : isMultipart ? request : await readBody(request);
        const upstream = await coreFetch(`/api/v1/admin${path}`, request.method ?? "GET", body, session.token,
          isMultipart ? 30 * 60_000 : 120_000, request.headers["content-type"]);
        if (upstream.status === 401 || upstream.status === 403) {
          sessions.delete(cookies.get(sessionCookie)!); clearCookie(response, sessionCookie);
        }
        const raw = await boundedCoreResponse(upstream);
        if (upstream.status === 204) { response.writeHead(204); response.end(); return; }
        return sendBytes(response, upstream.status, "application/json; charset=utf-8", raw);
      }
    }
    throw new ConsoleError(404, "NOT_FOUND", "页面不存在");
  }

  function requireOrigin(request: IncomingMessage) {
    if (request.headers.origin !== config.publicOrigin) throw new ConsoleError(403, "ORIGIN_INVALID", "请求来源无效");
  }
  function requireCsrf(request: IncomingMessage, sessionId: string, csrf: string) {
    try { mutationProtector.authorize({ origin: request.headers.origin, sessionId,
      csrfToken: typeof request.headers["x-csrf-token"] === "string" ? request.headers["x-csrf-token"] : undefined }); }
    catch { throw new ConsoleError(403, "CSRF_INVALID", "页面验证已失效，请刷新"); }
    if (request.headers["x-csrf-token"] !== csrf) throw new ConsoleError(403, "CSRF_INVALID", "页面验证已失效，请刷新");
  }
  async function activeSession(id: string | undefined, response: ServerResponse): Promise<Session | undefined> {
    const session = id === undefined ? undefined : sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) { sessions.delete(id!); clearCookie(response, sessionCookie); return undefined; }
    let upstream: Response;
    try { upstream = await coreFetch("/api/v1/me", "GET", undefined, session.token, 5000); }
    catch (error) { if (error instanceof ConsoleError) throw error;
      throw new ConsoleError(502, "CORE_UNAVAILABLE", "Core 暂时不可达"); }
    if (upstream.status === 401 || upstream.status === 403) { sessions.delete(id!); clearCookie(response, sessionCookie); return undefined; }
    if (!upstream.ok) throw new ConsoleError(502, "CORE_UNAVAILABLE", "Core 暂时不可达");
    const identity = await upstream.json() as { id?: string; role?: string };
    if (identity.id !== session.user.id || identity.role !== "admin") { sessions.delete(id!); clearCookie(response, sessionCookie); return undefined; }
    return session;
  }
  async function coreFetch(path: string, method: string, body?: string | Buffer | IncomingMessage, token?: string,
    timeoutMs = 120_000, contentType?: string): Promise<Response> {
    try {
      return await fetch(new URL(path, config.coreUrl), { method, redirect: "error",
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeoutMs)]),
        headers: { accept: "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(body === undefined ? {} : { "content-type": contentType ?? "application/json" }) },
        body, ...(body instanceof IncomingMessage ? { duplex: "half" } : {}) } as RequestInit);
    } catch (error) {
      if (shutdown.signal.aborted) throw new ConsoleError(503, "CONSOLE_SHUTTING_DOWN", "面板正在关闭");
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ConsoleError(504, "CORE_TIMEOUT", "Core 响应超时");
      }
      throw new ConsoleError(502, "CORE_UNAVAILABLE", "Core 暂时不可达");
    }
  }
  return server;
}

function allowedAdminRoute(method: string, path: string): boolean {
  if (adminMethods.get(path)?.has(method)) return true;
  if (/^\/users\/[^/]+\/(?:enable|disable|reset-credential)$/.test(path)) return method === "POST";
  if (/^\/skills\/[^/]+$/.test(path)) return ["GET", "PUT", "DELETE"].includes(method);
  if (/^\/skills\/[^/]+\/(?:enable|disable)$/.test(path)) return method === "POST";
  if (/^\/packages\/[^/]+$/.test(path)) return ["GET", "DELETE"].includes(method);
  if (/^\/packages\/[^/]+\/(?:enable|disable|update)$/.test(path)) return method === "POST";
  if (/^\/operations\/[^/]+$/.test(path)) return method === "GET";
  return false;
}
function isShellPath(path: string): boolean { return shellPaths.has(path) || /^\/(?:skills|packages|operations)\/[^/]+$/.test(path); }
function parseCookies(header: string): Map<string, string> { return new Map(header.split(";").map((item) => item.trim().split("=", 2) as [string, string]).filter((parts) => parts.length === 2)); }
function setCookie(response: ServerResponse, name: string, value: string, seconds: number) {
  appendCookie(response, browserSessionCookie(value, { name, maxAgeSeconds: seconds }));
}
function clearCookie(response: ServerResponse, name: string) { appendCookie(response, browserSessionCookie("", { name, maxAgeSeconds: 0 })); }
function appendCookie(response: ServerResponse, value: string) { const previous = response.getHeader("set-cookie");
  response.setHeader("set-cookie", [...(Array.isArray(previous) ? previous.map(String) : previous === undefined ? [] : [String(previous)]), value]); }
function secureHeaders(response: ServerResponse) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer");
}
function sendBytes(response: ServerResponse, status: number, type: string, body: Buffer) {
  response.writeHead(status, { "content-type": type, "content-length": body.byteLength }); response.end(body);
}
function sendJson(response: ServerResponse, status: number, value: unknown) {
  sendBytes(response, status, "application/json; charset=utf-8", Buffer.from(JSON.stringify(value)));
}
export async function readBody(request: IncomingMessage, timeoutMs = 120_000): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  const timeoutError = new ConsoleError(408, "CONSOLE_REQUEST_TIMEOUT", "请求内容接收超时");
  const timer = setTimeout(() => request.destroy(timeoutError), timeoutMs);
  try {
    for await (const raw of request) { const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) throw new ConsoleError(413, "REQUEST_TOO_LARGE", "请求内容过大"); chunks.push(chunk); }
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); }
}
async function boundedCoreResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = []; let size = 0;
  for await (const raw of response.body) { const chunk = Buffer.from(raw); size += chunk.byteLength;
    if (size > 2 * 1024 * 1024) throw new ConsoleError(502, "CORE_INVALID_RESPONSE", "Core 响应过大");
    chunks.push(chunk); }
  return Buffer.concat(chunks, size);
}
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json") throw new ConsoleError(415, "UNSUPPORTED_MEDIA_TYPE", "需要 JSON 请求");
  const body = await readBody(request);
  try { const value = JSON.parse(body.toString("utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new ConsoleError(400, "INVALID_REQUEST", "JSON 请求无效"); }
}
