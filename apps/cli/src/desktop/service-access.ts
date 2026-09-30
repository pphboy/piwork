import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { ClientRequest } from "node:http";
import type { Duplex } from "node:stream";
import { PiworkApiError } from "@piwork/client-sdk";
import { DesktopIdentity } from "./identity.js";
import { DesktopSessions, type LocalSession, sendError } from "./session.js";

type Entry = { id: string; workId: string; serviceId: string; port: number; hostname: string;
  sessionId: string; generation: number; ticket: string; ticketExpiresAt: number;
  grant?: string; embed?: "unknown" | "allowed" | "blocked" };
const prefix = "s-";
const reserved = "/.well-known/piwork-local/";
const maxJson = 2048;
const hopHeaders = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authenticate", "proxy-authorization"]);
const reservedCookie = /^__(?:Host|Secure)-piwork-|^piwork-(?:desktop|route)/i;

function cleanRequestHeaders(request: IncomingMessage, entry: Entry, localOrigin: string): IncomingHttpHeaders {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET") && request.headers.origin !== localOrigin)
    throw new PiworkApiError(403, "SERVICE_ORIGIN_DENIED", "Service origin denied");
  const headers: IncomingHttpHeaders = {};
  const connected = String(request.headers.connection ?? "").toLowerCase().split(",").map((name) => name.trim());
  const excluded = new Set([...hopHeaders, ...connected, "host", "x-piwork-csrf"]);
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || excluded.has(name) || name.startsWith("x-piwork-gateway-") || name.startsWith("proxy-")) continue;
    if (name === "cookie") {
      const cookies = String(value).split(";").map((part) => part.trim()).filter((part) => part && !reservedCookie.test(part.split("=", 1)[0]!));
      if (cookies.length) headers.cookie = cookies.join("; ");
      continue;
    }
    if (name === "origin" || name === "referer") {
      const incoming = Array.isArray(value) ? value[0] : value;
      if (!incoming) continue;
      let source: URL;
      try { source = new URL(incoming); }
      catch { throw new PiworkApiError(403, "SERVICE_ORIGIN_DENIED", "Service origin denied"); }
      if (source.origin !== localOrigin) throw new PiworkApiError(403, "SERVICE_ORIGIN_DENIED", "Service origin denied");
      headers[name] = `http://${entry.hostname}${entry.port === 80 ? "" : `:${entry.port}`}${name === "referer" ? source.pathname + source.search : ""}`;
      continue;
    }
    headers[name] = value;
  }
  return headers;
}

function cleanSetCookie(value: string, entry: Entry): string | undefined {
  const name = value.split("=", 1)[0]?.trim();
  if (!name || reservedCookie.test(name)) return undefined;
  const parts = value.split(";");
  return [parts[0], ...parts.slice(1).filter((part) => !/^\s*domain\s*=/i.test(part))].join(";");
}

function cleanResponseHeaders(headers: IncomingHttpHeaders, entry: Entry, localOrigin: string): IncomingHttpHeaders {
  const returned: IncomingHttpHeaders = {};
  const connected = String(headers.connection ?? "").toLowerCase().split(",").map((name) => name.trim());
  const excluded = new Set([...hopHeaders, ...connected]);
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || excluded.has(name) || name.startsWith("x-piwork-gateway-") || name.startsWith("proxy-")) continue;
    if (name === "set-cookie") {
      const cookies = (Array.isArray(value) ? value : [value]).map((item) => cleanSetCookie(item, entry)).filter((item): item is string => !!item);
      if (cookies.length) returned[name] = cookies;
      continue;
    }
    if (name === "location" && typeof value === "string") {
      try {
        const url = new URL(value);
        const logical = `http://${entry.hostname}${entry.port === 80 ? "" : `:${entry.port}`}`;
        returned.location = url.origin === logical ? `${localOrigin}${url.pathname}${url.search}${url.hash}` : value;
      } catch { returned.location = value; }
      continue;
    }
    returned[name] = value;
  }
  return returned;
}

function secret(bytes = 24): string { return randomBytes(bytes).toString("base64url"); }
function send(response: ServerResponse, status: number, value: unknown, cookie?: string): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", ...(cookie ? { "set-cookie": cookie } : {}) });
  response.end(JSON.stringify(value));
}

function sendUnavailablePage(response: ServerResponse, entry: Entry, shellOrigin: string, code: string): void {
  const reason = code === "SERVICE_UNAVAILABLE" ? "This Service or its Work is stopped."
    : code === "SERVICE_UPSTREAM_UNAVAILABLE" ? "This Service cannot be reached right now."
      : code === "AUTH_REQUIRED" ? "Sign in to the original Core account to use this Service."
        : "This Service is unavailable. Check its current state in the Work.";
  const back = `${shellOrigin}/works/${encodeURIComponent(entry.workId)}`;
  response.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors ${shellOrigin}` });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Service unavailable</title></head><body style="font:16px system-ui,sans-serif;max-width:38rem;margin:10vh auto;padding:1rem;color:#1b2634"><h1>Service unavailable</h1><p>${reason}</p><p>Work ${entry.workId} · Service ${entry.serviceId}</p><p><a href="${back}">Back to Work</a></p></body></html>`);
}

function navigationRequest(request: IncomingMessage): boolean {
  return request.method === "GET" && (request.headers["sec-fetch-mode"] === "navigate"
    || /(?:^|,)\s*text\/html(?:\s*;|\s*,|$)/i.test(String(request.headers.accept ?? "")));
}

export class BrowserServiceAccess {
  private readonly entries = new Map<string, Entry>();
  private readonly grants = new Map<string, Entry>();
  private readonly active = new Map<Entry, Set<() => void>>();
  private readonly activeSockets = new Set<Duplex>();
  private readonly connections = new Map<string, number>();

  private async stillEligible(entry: Entry): Promise<boolean> {
    try {
      if (!this.sessions.live(entry.sessionId) || entry.generation !== this.identity.currentGeneration) return false;
      const resolved = await this.identity.client().resolveService(entry.hostname, entry.port);
      return resolved.workId === entry.workId && resolved.serviceId === entry.serviceId
        && resolved.hostname === entry.hostname && resolved.port === entry.port
        && this.sessions.live(entry.sessionId) && entry.generation === this.identity.currentGeneration;
    } catch { return false; }
  }

  constructor(private readonly port: number, private readonly sessions: DesktopSessions, private readonly identity: DesktopIdentity) {
    identity.onRevoked(() => this.revoke());
  }

  async create(request: IncomingMessage, response: ServerResponse, session: LocalSession): Promise<void> {
    if (request.method !== "POST") return sendError(response, 405, "METHOD_NOT_ALLOWED");
    let text = "";
    try {
      for await (const chunk of request) { text += chunk.toString(); if (Buffer.byteLength(text) > maxJson) return sendError(response, 413, "REQUEST_TOO_LARGE"); }
      if (request.headers["content-type"] !== "application/json") return sendError(response, 415, "JSON_REQUIRED");
      const value = JSON.parse(text) as { workId?: unknown; serviceId?: unknown; port?: unknown };
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["workId", "serviceId", "port"].includes(key))
        || typeof value.workId !== "string" || typeof value.serviceId !== "string"
        || !/^[A-Za-z0-9-]{1,128}$/.test(value.workId) || !/^[A-Za-z0-9-]{1,128}$/.test(value.serviceId))
        return sendError(response, 400, "INVALID_SERVICE_ENTRY");
      const current = await this.identity.view();
      if (current.state !== "authenticated") return sendError(response, 401, "AUTH_REQUIRED");
      const client = this.identity.client();
      const service = await client.workService(value.workId, value.serviceId);
      const hostname = service.access.hostname;
      const selected = value.port === undefined
        ? service.access.defaultUrl === null ? undefined : Number(new URL(service.access.defaultUrl).port || 80)
        : value.port;
      if (!Number.isInteger(selected) || Number(selected) < 1 || Number(selected) > 65_535
        || !service.access.ports.some((candidate) => candidate.port === selected))
        return sendError(response, 400, "WEB_PORT_REQUIRED");
      const port = Number(selected);
      const resolved = await client.resolveService(hostname, port);
      if (resolved.workId !== value.workId || resolved.serviceId !== value.serviceId || resolved.hostname !== hostname || resolved.port !== port)
        return sendError(response, 502, "SERVICE_IDENTITY_MISMATCH");
      if (this.identity.currentGeneration !== current.generation) return sendError(response, 409, "CONNECTION_CHANGED");
      const old = [...this.entries.values()].find((entry) => entry.workId === value.workId && entry.serviceId === value.serviceId
        && entry.port === port && entry.sessionId === session.id && entry.generation === current.generation);
      const entry: Entry = old ?? { id: randomBytes(18).toString("hex"), workId: value.workId, serviceId: value.serviceId,
        port, hostname, sessionId: session.id, generation: current.generation, ticket: "", ticketExpiresAt: 0 };
      entry.ticket = secret(32);
      entry.ticketExpiresAt = Date.now() + 30_000;
      this.entries.set(entry.id, entry);
      const origin = this.origin(entry);
      send(response, 200, { entryId: entry.id, workId: entry.workId, serviceId: entry.serviceId, hostname, port,
        origin, entryUrl: `${origin}${reserved}enter#ticket=${entry.ticket}` });
    } catch (error) {
      if (error instanceof PiworkApiError) return sendError(response, error.status > 0 ? error.status : 503, error.code);
      return sendError(response, 400, "INVALID_SERVICE_ENTRY");
    }
  }

  async status(response: ServerResponse, entryId: string, session: LocalSession): Promise<void> {
    const entry = this.entries.get(entryId);
    if (!entry || entry.sessionId !== session.id || entry.generation !== this.identity.currentGeneration)
      return sendError(response, 404, "NOT_FOUND");
    try {
      const resolved = await this.identity.client().resolveService(entry.hostname, entry.port);
      if (resolved.workId !== entry.workId || resolved.serviceId !== entry.serviceId || resolved.hostname !== entry.hostname || resolved.port !== entry.port)
        return sendError(response, 403, "SERVICE_IDENTITY_CHANGED");
      return send(response, 200, { workId: entry.workId, serviceId: entry.serviceId, hostname: entry.hostname,
        port: entry.port, status: "available", embed: entry.embed ?? "unknown" });
    } catch (error) {
      if (error instanceof PiworkApiError && error.status === 401) this.identity.revokeContent();
      return sendError(response, error instanceof PiworkApiError && error.status > 0 ? error.status : 503,
        error instanceof PiworkApiError ? error.code : "CORE_UNAVAILABLE");
    }
  }

  async handleApp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const entry = this.fromHost(request.headers.host);
    if (!entry) return sendError(response, 403, "LOCAL_HOST_DENIED");
    const raw = request.url ?? "";
    if (raw === `${reserved}enter` && request.method === "GET") {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Opening Service</title></head><body><p>Opening Service…</p><script type="module" src="${reserved}entry.js"></script></body></html>`;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "referrer-policy": "no-referrer", "content-security-policy": `default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors ${this.sessions.origin}` });
      response.end(html);
      return;
    }
    if (raw === `${reserved}entry.js` && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store",
        "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
      response.end(`const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');history.replaceState(null,'',location.pathname);fetch('${reserved}redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})}).then(r=>{if(!r.ok)throw Error('Open this Service from its Work.');location.replace('/')}).catch(e=>{document.body.textContent=e.message});`);
      return;
    }
    if (raw === `${reserved}redeem` && request.method === "POST") {
      const origin = this.origin(entry);
      if (request.headers.origin !== origin || request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin"
        || request.headers["content-type"] !== "application/json") return sendError(response, 403, "LOCAL_ENTRY_DENIED");
      let body = "";
      for await (const chunk of request) { body += chunk.toString(); if (body.length > 1024) return sendError(response, 413, "REQUEST_TOO_LARGE"); }
      let ticket: unknown;
      try { ticket = (JSON.parse(body) as { ticket?: unknown }).ticket; } catch { return sendError(response, 400, "INVALID_JSON"); }
      if (typeof ticket !== "string" || ticket !== entry.ticket || Date.now() > entry.ticketExpiresAt
        || !this.sessions.live(entry.sessionId) || entry.generation !== this.identity.currentGeneration)
        return sendError(response, 403, "LOCAL_ENTRY_DENIED");
      entry.ticket = "";
      entry.grant = secret(32);
      this.grants.set(entry.grant, entry);
      return send(response, 200, { authorized: true }, `__Host-piwork-route=${entry.grant}; Path=/; HttpOnly; Secure; SameSite=Strict`);
    }
    if (raw.startsWith(reserved)) return sendError(response, 404, "NOT_FOUND");
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).filter((part) => part.startsWith("__Host-piwork-route="));
    const grant = cookie?.length === 1 ? cookie[0]!.slice("__Host-piwork-route=".length) : undefined;
    if (!grant || this.grants.get(grant) !== entry || !this.sessions.live(entry.sessionId)
      || entry.generation !== this.identity.currentGeneration) return sendError(response, 401, "LOCAL_SERVICE_AUTH_REQUIRED");
    await this.forwardHttp(request, response, entry);
  }

  private revoke(): void {
    for (const closers of this.active.values()) for (const close of closers) close();
    for (const socket of this.activeSockets) socket.destroy();
    this.activeSockets.clear();
    this.active.clear(); this.grants.clear();
    this.connections.clear();
    for (const entry of this.entries.values()) { entry.ticket = ""; entry.grant = undefined; }
  }

  clear(): void { this.revoke(); this.entries.clear(); }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const deny = (status: number, code: string) => {
      if (socket.destroyed) return;
      const body = JSON.stringify({ code });
      socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
    };
    const entry = this.fromHost(request.headers.host);
    if (!entry || !rawPathAllowed(request.url ?? "") || (request.url ?? "").startsWith(reserved)
      || request.method !== "GET" || request.headers.upgrade?.toLowerCase() !== "websocket"
      || request.headers.origin !== this.origin(entry)) return deny(403, "SERVICE_UPGRADE_DENIED");
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).filter((part) => part.startsWith("__Host-piwork-route="));
    const grant = cookie?.length === 1 ? cookie[0]!.slice("__Host-piwork-route=".length) : undefined;
    if (!grant || this.grants.get(grant) !== entry || !this.sessions.live(entry.sessionId)
      || entry.generation !== this.identity.currentGeneration) return deny(401, "LOCAL_SERVICE_AUTH_REQUIRED");
    if (!this.reserve(entry)) return deny(429, "SERVICE_CONNECTION_LIMIT");
    let socketReserved = true;
    const releaseSlot = () => { if (socketReserved) { socketReserved = false; this.release(entry); } };
    try {
      const view = await this.identity.view();
      if (view.state !== "authenticated" || view.generation !== entry.generation) { releaseSlot(); return deny(401, "AUTH_REQUIRED"); }
      const resolved = await this.identity.client().resolveService(entry.hostname, entry.port);
      if (resolved.workId !== entry.workId || resolved.serviceId !== entry.serviceId || resolved.hostname !== entry.hostname || resolved.port !== entry.port)
        { releaseSlot(); return deny(403, "SERVICE_IDENTITY_CHANGED"); }
      const origin = this.origin(entry);
      const headers = cleanRequestHeaders(request, entry, origin);
      headers.connection = "Upgrade"; headers.upgrade = "websocket";
      const upstream = this.identity.client().gatewayRequest({ hostname: entry.hostname, port: entry.port,
        path: request.url!, method: "GET", headers });
      let remote: Duplex | undefined;
      const close = () => { upstream.destroy(); remote?.destroy(); socket.destroy(); };
      this.activeSockets.add(socket);
      let checkingEligibility = false;
      const monitor = setInterval(() => {
        if (!this.sessions.live(entry.sessionId) || entry.generation !== this.identity.currentGeneration) return close();
        if (checkingEligibility || socket.destroyed) return;
        checkingEligibility = true;
        void this.stillEligible(entry).then((eligible) => { if (!eligible && !socket.destroyed) close(); })
          .finally(() => { checkingEligibility = false; });
      }, 1_000);
      monitor.unref();
      socket.once("close", () => { clearInterval(monitor); this.activeSockets.delete(socket); releaseSlot(); upstream.destroy(); remote?.destroy(); });
      upstream.once("upgrade", (incoming, peer, peerHead) => {
        if (entry.generation !== this.identity.currentGeneration || !this.sessions.live(entry.sessionId)) { peer.destroy(); return close(); }
        remote = peer;
        const returned = cleanResponseHeaders(incoming.headers, entry, origin);
        returned.connection = "Upgrade"; returned.upgrade = "websocket";
        const lines = Object.entries(returned).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((part) => `${key}: ${part}`));
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
        if (peerHead.length) socket.write(peerHead);
        if (head.length) peer.write(head);
        socket.pipe(peer).pipe(socket);
        peer.once("close", () => socket.destroy());
      });
      upstream.once("response", (incoming) => { incoming.resume(); deny(incoming.statusCode ?? 502,
        incoming.headers["x-piwork-gateway-error"] === "1" ? "SERVICE_GATEWAY_DENIED" : "SERVICE_UPGRADE_REJECTED"); });
      upstream.once("error", () => deny(502, "CORE_UNAVAILABLE"));
      upstream.end();
    } catch (error) {
      releaseSlot();
      if (error instanceof PiworkApiError && error.status === 401) this.identity.revokeContent();
      deny(error instanceof PiworkApiError && error.status > 0 ? error.status : 502,
        error instanceof PiworkApiError ? error.code : "CORE_UNAVAILABLE");
    }
  }

  private async forwardHttp(request: IncomingMessage, response: ServerResponse, entry: Entry): Promise<void> {
    let upstream: ClientRequest | undefined;
    let reserved = false;
    try {
      if (!rawPathAllowed(request.url ?? "") || request.method === "CONNECT" || request.headers.upgrade)
        return sendError(response, 403, "SERVICE_REQUEST_DENIED");
      const state = await this.identity.view();
      if (state.state !== "authenticated" || state.generation !== entry.generation) return sendError(response, 401, "AUTH_REQUIRED");
      const resolved = await this.identity.client().resolveService(entry.hostname, entry.port);
      if (resolved.workId !== entry.workId || resolved.serviceId !== entry.serviceId || resolved.hostname !== entry.hostname || resolved.port !== entry.port)
        return sendError(response, 403, "SERVICE_IDENTITY_CHANGED");
      const origin = this.origin(entry);
      const headers = cleanRequestHeaders(request, entry, origin);
      if (!this.reserve(entry)) return sendError(response, 429, "SERVICE_CONNECTION_LIMIT");
      reserved = true;
      const client = this.identity.client();
      upstream = client.gatewayRequest({ hostname: entry.hostname, port: entry.port, path: request.url!, method: request.method ?? "GET", headers }, (incoming) => {
        if (incoming.statusCode === 401 && incoming.headers["x-piwork-gateway-error"] === "1") {
          incoming.resume();
          if (!response.headersSent) sendError(response, 401, "AUTH_REQUIRED"); else response.destroy();
          queueMicrotask(() => this.identity.revokeContent());
          return;
        }
        if (entry.generation !== this.identity.currentGeneration) { incoming.destroy(); response.destroy(); return; }
        if (request.url === "/" && /^text\/html(?:\s*;|$)/i.test(String(incoming.headers["content-type"] ?? "")))
          entry.embed = embedPolicy(incoming.headers, this.sessions.origin);
        response.writeHead(incoming.statusCode ?? 502, cleanResponseHeaders(incoming.headers, entry, origin));
        incoming.once("close", () => {
          if (!incoming.complete && !response.writableEnded) response.destroy();
        });
        incoming.pipe(response);
      });
      const current = upstream;
      const close = () => { current.destroy(); if (!response.writableEnded) response.destroy(); };
      const active = this.active.get(entry) ?? new Set<() => void>();
      active.add(close); this.active.set(entry, active);
      let checkingEligibility = false;
      const monitor = setInterval(() => {
        if (!this.sessions.live(entry.sessionId) || entry.generation !== this.identity.currentGeneration) return close();
        if (checkingEligibility || response.destroyed) return;
        checkingEligibility = true;
        void this.stillEligible(entry).then((eligible) => { if (!eligible && !response.destroyed) close(); })
          .finally(() => { checkingEligibility = false; });
      }, 1_000);
      monitor.unref();
      const release = () => { clearInterval(monitor); active.delete(close); if (!active.size) this.active.delete(entry);
        if (reserved) { reserved = false; this.release(entry); } };
      response.once("close", () => { current.destroy(); release(); });
      current.once("close", release);
      current.once("error", () => { if (!response.headersSent) sendError(response, 502, "CORE_UNAVAILABLE"); else response.destroy(); });
      request.once("aborted", () => current.destroy());
      request.pipe(current);
    } catch (error) {
      upstream?.destroy();
      if (reserved) { reserved = false; this.release(entry); }
      const item = error instanceof PiworkApiError ? error : new PiworkApiError(502, "CORE_UNAVAILABLE", "Core is unavailable");
      if (!response.headersSent) {
        if (navigationRequest(request) && ["SERVICE_UNAVAILABLE", "SERVICE_UPSTREAM_UNAVAILABLE", "NOT_FOUND", "AUTH_REQUIRED", "NETWORK_ERROR"].includes(item.code))
          sendUnavailablePage(response, entry, this.sessions.origin, item.code);
        else sendError(response, item.status > 0 ? item.status : 503, item.code);
      }
      else response.destroy();
      if (item.status === 401) queueMicrotask(() => this.identity.revokeContent());
    }
  }

  private origin(entry: Entry): string { return `http://${prefix}${entry.id}.desktop.localhost:${this.port}`; }

  private reserve(entry: Entry): boolean {
    const key = `${entry.sessionId}:${entry.generation}`;
    const count = this.connections.get(key) ?? 0;
    if (count >= 64) return false;
    this.connections.set(key, count + 1);
    return true;
  }

  private release(entry: Entry): void {
    const key = `${entry.sessionId}:${entry.generation}`;
    const count = this.connections.get(key) ?? 0;
    if (count <= 1) this.connections.delete(key);
    else this.connections.set(key, count - 1);
  }

  private fromHost(host: string | undefined): Entry | undefined {
    const matched = /^s-([A-Za-z0-9_-]+)\.desktop\.localhost:(\d+)$/.exec(host ?? "");
    if (!matched || Number(matched[2]) !== this.port) return undefined;
    const entry = this.entries.get(matched[1]!);
    return entry && this.origin(entry) === `http://${host}` ? entry : undefined;
  }
}

function embedPolicy(headers: IncomingHttpHeaders, shellOrigin: string): "allowed" | "blocked" | "unknown" {
  const xfo = String(headers["x-frame-options"] ?? "").toLowerCase();
  if (/(?:^|,)\s*(?:deny|sameorigin)\s*(?:,|$)/.test(xfo)) return "blocked";
  const policies = Array.isArray(headers["content-security-policy"]) ? headers["content-security-policy"] : [headers["content-security-policy"]];
  for (const policy of policies) {
    if (!policy) continue;
    const directive = policy.split(";").map((part) => part.trim()).find((part) => /^frame-ancestors(?:\s|$)/i.test(part));
    if (directive && (/'none'/i.test(directive) || !directive.includes(shellOrigin))) return "blocked";
  }
  return "allowed";
}

function rawPathAllowed(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !/[\r\n\0]/.test(path);
}
