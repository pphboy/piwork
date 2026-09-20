import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { CoreStore, type StoredLoginSession } from "@piwork/core-store";

export class AuthenticationFailedError extends Error {
  constructor() {
    super("invalid account or password");
    this.name = "AuthenticationFailedError";
  }
}

export class LoginRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("too many failed login attempts");
    this.name = "LoginRateLimitedError";
  }
}

export class InvalidLoginSessionError extends Error {
  constructor() {
    super("login session is invalid, expired, or revoked");
    this.name = "InvalidLoginSessionError";
  }
}

export interface LoginSessionConfig {
  readonly sessionTtlMs: number;
  readonly failureWindowMs: number;
  readonly maxFailures: number;
}

export interface LoginResult {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: {
    readonly id: string;
    readonly account: string;
    readonly role: "admin" | "user";
  };
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly user: LoginResult["user"];
}

export interface IdentityServiceOptions {
  readonly store: CoreStore;
  readonly now?: () => Date;
  readonly config?: Partial<LoginSessionConfig>;
}

interface FailureBucket {
  windowStartedAt: number;
  failures: number;
}

const DEFAULT_CONFIG: LoginSessionConfig = {
  sessionTtlMs: 24 * 60 * 60 * 1_000,
  failureWindowMs: 60 * 1_000,
  maxFailures: 5,
};

export class IdentityService {
  private readonly failures = new Map<string, FailureBucket>();

  private constructor(
    private readonly store: CoreStore,
    private readonly dummyDigest: string,
    private readonly now: () => Date,
    private readonly config: LoginSessionConfig,
  ) {}

  static async create(options: IdentityServiceOptions): Promise<IdentityService> {
    const dummyDigest = await hash(randomBytes(32), {
      algorithm: 2,
      memoryCost: 4_096,
      timeCost: 1,
      parallelism: 1,
      outputLen: 32,
    });
    return new IdentityService(
      options.store,
      dummyDigest,
      options.now ?? (() => new Date()),
      { ...DEFAULT_CONFIG, ...options.config },
    );
  }

  async login(account: string, password: string, source: string): Promise<LoginResult> {
    const now = this.now();
    const accountKey = `account:${account.toLowerCase()}`;
    const sourceKey = `source:${source}`;
    this.assertWithinRateLimit([accountKey, sourceKey], now.getTime());

    const user = this.store.getAuthenticationUserByAccount(account);
    const passwordMatches = await verify(user?.passwordDigest ?? this.dummyDigest, password).catch(() => false);
    if (user === undefined || !user.enabled || !passwordMatches) {
      this.recordFailure([accountKey, sourceKey], now.getTime());
      throw new AuthenticationFailedError();
    }

    this.clearFailures([accountKey, sourceKey]);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs).toISOString();
    this.store.createLoginSession({
      id: `login-${randomUUID()}`,
      userId: user.id,
      tokenDigest: digestToken(token),
      expiresAt,
      createdAt: now.toISOString(),
    });
    return {
      token,
      expiresAt,
      user: { id: user.id, account: user.account, role: user.role },
    };
  }

  authenticate(token: string): AuthenticatedSession {
    const stored = this.store.getLoginSessionByTokenDigest(digestToken(token));
    if (!isSessionValid(stored, this.now())) throw new InvalidLoginSessionError();
    return {
      sessionId: stored.id,
      expiresAt: stored.expiresAt,
      user: { id: stored.userId, account: stored.account, role: stored.role },
    };
  }

  logout(token: string): void {
    const session = this.authenticate(token);
    this.store.revokeLoginSession(session.sessionId, this.now().toISOString());
  }

  private assertWithinRateLimit(keys: readonly string[], now: number): void {
    let retryAfterMs = 0;
    for (const key of keys) {
      const bucket = this.currentBucket(key, now);
      if (bucket.failures >= this.config.maxFailures) {
        retryAfterMs = Math.max(retryAfterMs, this.config.failureWindowMs - (now - bucket.windowStartedAt));
      }
    }
    if (retryAfterMs > 0) throw new LoginRateLimitedError(retryAfterMs);
  }

  private recordFailure(keys: readonly string[], now: number): void {
    for (const key of keys) {
      const bucket = this.currentBucket(key, now);
      bucket.failures += 1;
      this.failures.set(key, bucket);
    }
  }

  private clearFailures(keys: readonly string[]): void {
    for (const key of keys) this.failures.delete(key);
  }

  private currentBucket(key: string, now: number): FailureBucket {
    const existing = this.failures.get(key);
    if (existing === undefined || now - existing.windowStartedAt >= this.config.failureWindowMs) {
      return { windowStartedAt: now, failures: 0 };
    }
    return existing;
  }
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isSessionValid(session: StoredLoginSession | undefined, now: Date): session is StoredLoginSession {
  return session !== undefined
    && session.userEnabled
    && session.revokedAt === null
    && new Date(session.expiresAt).getTime() > now.getTime();
}
