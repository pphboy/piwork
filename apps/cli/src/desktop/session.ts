import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const bootstrapLifetimeMs = 5 * 60_000;
const sessionLifetimeMs = 12 * 60 * 60_000;
const jsonLimit = 1024;

export interface LocalSession {
  readonly id: string;
  readonly csrf: string;
  readonly expiresAt: number;
}

function secret(): string { return randomBytes(32).toString("base64url"); }
function equals(a: string, b: string): boolean {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export class DesktopSessions {
  readonly bootstrapTicket = secret();
  readonly bootstrapExpiresAt: number;
  readonly origin: string;
  readonly cookieName: string;
  private usedBootstrap = false;
  private readonly sessions = new Map<string, LocalSession>();

  constructor(readonly port: number, private readonly now: () => number = Date.now) {
    this.origin = `http://desktop.localhost:${port}`;
    this.cookieName = `__Host-piwork-desktop-${port}`;
    this.bootstrapExpiresAt = this.now() + bootstrapLifetimeMs;
  }

  get launchUrl(): string { return `${this.origin}/#ticket=${this.bootstrapTicket}`; }

  authorizeRequest(request: IncomingMessage, requireCsrf: boolean): LocalSession | undefined {
    if (!this.sameOriginRequest(request)) return undefined;
    const cookies = request.headers.cookie?.split(";").map((part) => part.trim()) ?? [];
    const matches = cookies.filter((part) => part.startsWith(`${this.cookieName}=`));
    if (matches.length !== 1) return undefined;
    const value = matches[0]!.slice(this.cookieName.length + 1);
    const session = this.sessions.get(value);
    if (!session) return undefined;
    if (session.expiresAt <= this.now()) { this.sessions.delete(value); return undefined; }
    if (requireCsrf && !equals(String(request.headers["x-piwork-csrf"] ?? ""), session.csrf)) return undefined;
    return session;
  }

  sameOriginRequest(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    return (origin === undefined || origin === this.origin)
      && (site === undefined || site === "same-origin" || site === "none")
      && request.headers.host === `desktop.localhost:${this.port}`;
  }

  async bootstrap(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.headers.origin !== this.origin || !this.sameOriginRequest(request)
      || request.headers["content-type"] !== "application/json") return sendError(response, 403, "LOCAL_BOOTSTRAP_DENIED");
    let body = "";
    try {
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > jsonLimit) return sendError(response, 413, "REQUEST_TOO_LARGE");
      }
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !equals(String((parsed as { ticket?: unknown }).ticket ?? ""), this.bootstrapTicket)
        || this.usedBootstrap || this.now() > this.bootstrapExpiresAt) return sendError(response, 403, "LOCAL_BOOTSTRAP_DENIED");
    } catch { return sendError(response, 400, "INVALID_JSON"); }
    this.usedBootstrap = true;
    const session: LocalSession = { id: secret(), csrf: secret(), expiresAt: this.now() + sessionLifetimeMs };
    this.sessions.set(session.id, session);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
      "referrer-policy": "no-referrer", "set-cookie": `${this.cookieName}=${session.id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}` });
    response.end(JSON.stringify({ authorized: true, csrf: session.csrf }));
  }

  sendSession(request: IncomingMessage, response: ServerResponse): void {
    const session = this.authorizeRequest(request, false);
    if (!session) return sendError(response, 401, "LOCAL_AUTH_REQUIRED");
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ authorized: true, csrf: session.csrf }));
  }

  clear(): void { this.sessions.clear(); }

  live(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.expiresAt <= this.now()) { this.sessions.delete(id); return false; }
    return true;
  }
}

export function sendError(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  response.end(JSON.stringify({ code, message: code }));
}
