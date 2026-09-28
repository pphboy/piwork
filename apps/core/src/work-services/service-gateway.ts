import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { CoreStore } from "@piwork/core-store";
import type { IdentityService } from "../identity/sessions.js";
import type { ServiceRuntimeAdapter } from "./service-management.js";
import { normalizeServiceHostname, ServiceAccessError, ServiceDomainResolver } from "./service-domain-resolver.js";

const marker = "x-piwork-gateway-error";
const credential = "x-piwork-gateway-token";
const maxHeaders = 32 * 1024;
const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

type Target = { hostname: string; workId: string; serviceId: string; port: number; address: string; userId: string; token: string };

export class ServiceGateway {
  private active = 0;
  private readonly byUser = new Map<string, number>();

  constructor(private readonly store: CoreStore, private readonly identity: IdentityService,
    private readonly resolver: ServiceDomainResolver, private readonly runtime: () => ServiceRuntimeAdapter | undefined,
    private readonly accepting: () => boolean,
    private readonly limits: { readonly perUser: number; readonly total: number } = { perUser: 64, total: 256 }) {}

  async resolve(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    try {
      const target = await this.authorize(request, url.searchParams.get("hostname") ?? "", Number(url.searchParams.get("port")));
      this.send(response, 200, { hostname: target.hostname, workId: target.workId, serviceId: target.serviceId, port: target.port });
    } catch (error) { this.fail(response, error); }
  }

  async http(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let release: (() => void) | undefined;
    try {
      const path = gatewayPath(request.url ?? "");
      if (!path) throw new ServiceAccessError("NOT_FOUND");
      const target = await this.authorize(request, path.hostname, path.port);
      release = this.reserve(target.userId);
      const headers = filteredHeaders(request.headers);
      headers.host = target.hostname + (path.port === 80 ? "" : `:${path.port}`);
      const upstream = httpRequest({ host: target.address, port: target.port, path: path.rawPath,
        method: request.method, headers, agent: false }, (incoming) => {
        const responseHeaders = filteredHeaders(incoming.headers);
        response.writeHead(incoming.statusCode ?? 502, incoming.statusMessage, responseHeaders);
        incoming.pipe(response);
      });
      connectionTimeout(upstream);
      let finished = false;
      const done = () => { if (finished) return; finished = true; stopReview(); release?.(); upstream.destroy(); };
      const stopReview = this.reviewConnection(target, () => { upstream.destroy(); response.destroy(); });
      response.once("close", done);
      upstream.once("error", () => { if (!response.headersSent) this.fail(response, new ServiceAccessError("SERVICE_UPSTREAM_UNAVAILABLE")); else response.destroy(); done(); });
      request.once("aborted", () => upstream.destroy());
      request.pipe(upstream);
    } catch (error) { release?.(); this.fail(response, error); }
  }

  async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let release: (() => void) | undefined;
    try {
      const path = gatewayPath(request.url ?? "");
      if (!path || request.headers.upgrade?.toLowerCase() !== "websocket") throw new ServiceAccessError("NOT_FOUND");
      const target = await this.authorize(request, path.hostname, path.port);
      release = this.reserve(target.userId);
      const headers = filteredHeaders(request.headers);
      headers.host = target.hostname + (path.port === 80 ? "" : `:${path.port}`);
      headers.connection = "Upgrade";
      headers.upgrade = "websocket";
      const upstream = httpRequest({ host: target.address, port: target.port, path: path.rawPath,
        method: "GET", headers, agent: false });
      connectionTimeout(upstream);
      let remoteSocket: Duplex | undefined;
      let finished = false;
      const done = () => { if (finished) return; finished = true; stopReview(); release?.(); socket.destroy(); remoteSocket?.destroy(); upstream.destroy(); };
      const stopReview = this.reviewConnection(target, done);
      socket.once("close", done);
      upstream.once("error", () => { if (!socket.destroyed) this.failSocket(socket, 502, "SERVICE_UPSTREAM_UNAVAILABLE"); });
      upstream.once("response", (incoming) => {
        socket.write(rawResponseHead(incoming));
        incoming.pipe(socket);
        incoming.once("error", done);
      });
      upstream.once("upgrade", (incoming, remote, remoteHead) => {
        remoteSocket = remote;
        const responseHeaders = filteredHeaders(incoming.headers);
        responseHeaders.connection = "Upgrade";
        responseHeaders.upgrade = "websocket";
        const headerLines = Object.entries(responseHeaders).flatMap(([key, value]) =>
          (Array.isArray(value) ? value : [value]).map((part) => `${key}: ${part}`));
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines.join("\r\n")}\r\n\r\n`);
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        remote.once("close", done);
        socket.pipe(remote).pipe(socket);
      });
      upstream.end();
    } catch (error) { release?.(); this.failSocket(socket, statusCode(error), errorCode(error)); }
  }

  private async authorize(request: IncomingMessage, rawHostname: string, requestedPort: number): Promise<Target> {
    if (!this.accepting()) throw new ServiceAccessError("SERVICE_UNAVAILABLE");
    if (headerBytes(request) > maxHeaders) throw Object.assign(new Error("headers too large"), { code: "HEADERS_TOO_LARGE" });
    const token = request.headers[credential];
    if (typeof token !== "string" || !token) throw Object.assign(new Error("authentication required"), { code: "AUTH_REQUIRED" });
    let userId: string;
    try { userId = this.identity.authenticate(token).user.id; }
    catch { throw Object.assign(new Error("authentication required"), { code: "AUTH_REQUIRED" }); }
    const hostname = normalizeServiceHostname(rawHostname);
    const identity = hostname ? this.store.resolveServiceHostname(hostname) : undefined;
    const work = identity ? this.store.getWork(identity.workId) : undefined;
    if (!identity || !work || work.ownerUserId !== userId) throw new ServiceAccessError("NOT_FOUND");
    const resolved = await this.resolver.resolveTarget(hostname!, requestedPort);
    let route: { address: string } | undefined;
    try { route = await this.runtime()?.routeTarget?.(resolved.work.id, resolved.service.serviceId); }
    catch { throw new ServiceAccessError("SERVICE_UPSTREAM_UNAVAILABLE"); }
    if (!route) throw new ServiceAccessError("SERVICE_UPSTREAM_UNAVAILABLE");
    return { hostname: resolved.hostname, workId: resolved.work.id, serviceId: resolved.service.serviceId,
      port: resolved.port, address: route.address, userId, token };
  }

  private async recheck(target: Target): Promise<boolean> {
    if (!this.quickRecheck(target)) return false;
    try {
      const resolved = await this.resolver.resolveTarget(target.hostname, target.port);
      const route = await this.runtime()?.routeTarget?.(target.workId, target.serviceId);
      return resolved.work.id === target.workId && resolved.service.serviceId === target.serviceId && route?.address === target.address;
    } catch { return false; }
  }

  private quickRecheck(target: Target): boolean {
    if (!this.accepting()) return false;
    try {
      if (this.identity.authenticate(target.token).user.id !== target.userId) return false;
      const work = this.store.getWork(target.workId);
      const service = this.store.getService(target.workId, target.serviceId);
      return !!work && work.ownerUserId === target.userId && work.desiredState === "running"
        && (work.observedState === "ready" || work.observedState === "degraded")
        && !!service && service.enabled && service.observedState === "ready" && service.tombstonedAt === null;
    } catch { return false; }
  }

  private reviewConnection(target: Target, close: () => void): () => void {
    let elapsed = 0, checking = false, stopped = false;
    const timer = setInterval(() => {
      if (stopped) return;
      if (!this.quickRecheck(target)) { close(); return; }
      elapsed += 200;
      if (elapsed < 1_000 || checking) return;
      elapsed = 0;
      checking = true;
      let timeout: NodeJS.Timeout;
      const deadline = new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 750); timeout.unref(); });
      void Promise.race([this.recheck(target), deadline]).then((valid) => {
        clearTimeout(timeout);
        checking = false;
        if (!stopped && !valid) close();
      }).catch(() => { clearTimeout(timeout); checking = false; if (!stopped) close(); });
    }, 200);
    timer.unref();
    return () => { stopped = true; clearInterval(timer); };
  }

  private reserve(userId: string): () => void {
    const userCount = this.byUser.get(userId) ?? 0;
    if (this.active >= this.limits.total || userCount >= this.limits.perUser) throw Object.assign(new Error("service access limit"), { code: "SERVICE_ACCESS_LIMIT" });
    this.active += 1;
    this.byUser.set(userId, userCount + 1);
    return () => { this.active -= 1; const remaining = (this.byUser.get(userId) ?? 1) - 1;
      if (remaining) this.byUser.set(userId, remaining); else this.byUser.delete(userId); };
  }

  private fail(response: ServerResponse, error: unknown): void {
    if (response.headersSent) { response.destroy(); return; }
    this.send(response, statusCode(error), { code: errorCode(error), message: "service access failed" }, true);
  }

  private send(response: ServerResponse, status: number, value: unknown, failure = false): void {
    const body = JSON.stringify(value);
    response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store",
      ...(failure ? { [marker]: "1" } : {}) });
    response.end(body);
  }

  private failSocket(socket: Duplex, status: number, code: string): void {
    if (socket.destroyed) return;
    const body = JSON.stringify({ code, message: "service access failed" });
    socket.end(`HTTP/1.1 ${status} Service Access Failed\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n${marker}: 1\r\nconnection: close\r\n\r\n${body}`);
  }
}

function gatewayPath(raw: string): { hostname: string; port: number; rawPath: string } | undefined {
  const match = /^\/api\/v1\/service-gateway\/([^/?]+)\/([0-9]{1,5})(\/[^?]*)?(\?.*)?$/.exec(raw);
  if (!match) return undefined;
  return { hostname: match[1]!, port: Number(match[2]), rawPath: (match[3] || "/") + (match[4] || "") };
}

function filteredHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const connection = String(headers.connection ?? "").toLowerCase().split(",").map((name) => name.trim());
  const excluded = new Set([...hopHeaders, ...connection]);
  const output: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || excluded.has(name) || name.startsWith("proxy-") || name.startsWith("x-piwork-gateway-")) continue;
    output[name] = value;
  }
  return output;
}

function rawResponseHead(response: IncomingMessage): string {
  const headers = filteredHeaders(response.headers);
  headers.connection = "close";
  const lines = Object.entries(headers).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((part) => `${name}: ${part}`));
  return `HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ""}\r\n${lines.join("\r\n")}\r\n\r\n`;
}

function headerBytes(request: IncomingMessage): number {
  return request.rawHeaders.reduce((sum, part) => sum + Buffer.byteLength(part), 0);
}

function errorCode(error: unknown): string {
  if (error instanceof ServiceAccessError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "SERVICE_UPSTREAM_UNAVAILABLE";
}

function statusCode(error: unknown): number {
  const code = errorCode(error);
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "NOT_FOUND" || code === "PORT_NOT_DECLARED") return 404;
  if (code === "PORT_REQUIRED" || code === "HEADERS_TOO_LARGE") return 400;
  if (code === "SERVICE_UNAVAILABLE" || code === "SERVICE_ACCESS_LIMIT") return 503;
  return 502;
}

function connectionTimeout(request: ReturnType<typeof httpRequest>): void {
  const timer = setTimeout(() => request.destroy(new Error("service connection timed out")), 10_000);
  timer.unref();
  const clear = () => clearTimeout(timer);
  request.once("socket", (socket) => {
    if (!socket.connecting) clear();
    else socket.once("connect", clear);
  });
  request.once("error", clear);
  request.once("response", clear);
  request.once("upgrade", clear);
}
