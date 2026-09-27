import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class OriginRejectedError extends Error {
  constructor() {
    super("request origin is not allowed");
    this.name = "OriginRejectedError";
  }
}

export class CsrfRejectedError extends Error {
  constructor() {
    super("valid CSRF proof is required");
    this.name = "CsrfRejectedError";
  }
}

export interface BrowserCookieOptions {
  readonly name?: string;
  readonly maxAgeSeconds: number;
}

export function browserSessionCookie(token: string, options: BrowserCookieOptions): string {
  const name = options.name ?? "piwork_session";
  return `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${options.maxAgeSeconds}; Secure; HttpOnly; SameSite=Strict`;
}

export class BrowserMutationProtector {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    allowedOrigins: readonly string[],
    private readonly secret = randomBytes(32),
  ) {
    this.allowedOrigins = new Set(allowedOrigins.map(normalizeOrigin));
  }

  issueCsrfToken(sessionId: string): string {
    const nonce = randomBytes(24).toString("base64url");
    return `${nonce}.${this.signature(sessionId, nonce)}`;
  }

  authorize(input: { readonly origin?: string; readonly sessionId: string; readonly csrfToken?: string }): void {
    const origin = input.origin === undefined ? undefined : safeOrigin(input.origin);
    if (origin === undefined || !this.allowedOrigins.has(origin)) throw new OriginRejectedError();
    if (input.csrfToken === undefined || !this.verifyCsrfToken(input.sessionId, input.csrfToken)) {
      throw new CsrfRejectedError();
    }
  }

  verifyCsrfToken(sessionId: string, token: string): boolean {
    const separator = token.indexOf(".");
    if (separator <= 0 || separator === token.length - 1) return false;
    const nonce = token.slice(0, separator);
    const supplied = token.slice(separator + 1);
    const expected = this.signature(sessionId, nonce);
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
  }

  private signature(sessionId: string, nonce: string): string {
    return createHmac("sha256", this.secret).update(sessionId).update("\0").update(nonce).digest("base64url");
  }
}

const SENSITIVE_KEY = /(?:password|passwd|secret|token|authorization|api[_-]?key|credential|cookie|csrf)/i;

export function redactDiagnostics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnostics);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactDiagnostics(child)]),
    );
  }
  return value;
}

export function redactUrl(input: string): string {
  try {
    const url = new URL(input, "https://piwork.invalid");
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return /^[a-z][a-z0-9+.-]*:/i.test(input)
      ? url.toString()
      : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "[INVALID_URL]";
  }
}

function safeOrigin(value: string): string | undefined {
  try {
    return normalizeOrigin(value);
  } catch {
    return undefined;
  }
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}
