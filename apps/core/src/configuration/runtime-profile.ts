import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { InputValidationError } from "../input-validation.js";

export interface RuntimeProfile {
  readonly version: 1;
  readonly revision: number;
  readonly agentImage: string;
  readonly model: {
    readonly provider: string;
    readonly id: string;
    readonly baseUrl?: string;
    readonly credentialRef: string;
  };
  readonly updatedAt: string;
}

export interface PublicRuntimeProfile {
  readonly configured: true;
  readonly version: 1;
  readonly revision: number;
  readonly agentImage: string;
  readonly model: {
    readonly provider: string;
    readonly id: string;
    readonly baseUrl?: string;
    readonly credentialAvailable: boolean;
  };
  readonly updatedAt: string;
}

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;

export class RuntimeProfileStore {
  constructor(
    private readonly profilePath: string,
    private readonly secretsDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  configure(input: {
    readonly agentImage: string;
    readonly provider: string;
    readonly model: string;
    readonly baseUrl?: string;
    readonly credential: string;
  }): PublicRuntimeProfile {
    validateRuntimeProfileInput(input);
    assertSafeTarget(this.profilePath, true);
    assertSafeTarget(this.secretsDirectory, false, "directory");
    const current = this.loadOptional();
    // Each global revision receives a new immutable secret reference so Works
    // created from an older default keep using the credential they captured.
    const credentialRef = `model-${randomUUID()}.secret`;
    const credentialPath = join(this.secretsDirectory, credentialRef);
    assertSafeTarget(credentialPath, true);

    atomicWrite(credentialPath, `${input.credential}\n`, 0o600);
    const profile: RuntimeProfile = {
      version: 1,
      revision: (current?.revision ?? 0) + 1,
      agentImage: input.agentImage,
      model: {
        provider: input.provider,
        id: input.model,
        ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
        credentialRef,
      },
      updatedAt: this.now().toISOString(),
    };
    try {
      atomicWrite(this.profilePath, `${JSON.stringify(profile, null, 2)}\n`, 0o600);
    } catch (error) {
      rmSync(credentialPath, { force: true });
      throw error;
    }
    return this.publicView(profile);
  }

  load(): RuntimeProfile {
    const profile = this.loadOptional();
    if (profile === undefined) throw new Error("runtime profile is not configured; run piwork-serve config set");
    return profile;
  }

  inspect(): PublicRuntimeProfile | { readonly configured: false } {
    const profile = this.loadOptional();
    return profile === undefined ? { configured: false } : this.publicView(profile);
  }

  resolveCredential(profile = this.load()): string {
    const path = join(this.secretsDirectory, safeBasename(profile.model.credentialRef));
    assertSafeTarget(path, false);
    return readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
  }

  credentialPath(profile = this.load()): string {
    const path = join(this.secretsDirectory, safeBasename(profile.model.credentialRef));
    assertSafeTarget(path, false);
    return path;
  }

  private loadOptional(): RuntimeProfile | undefined {
    if (!existsSync(this.profilePath)) return undefined;
    assertSafeTarget(this.profilePath, false);
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(this.profilePath, "utf8"));
    } catch (error) {
      throw new Error("runtime profile is malformed", { cause: error });
    }
    if (!isRuntimeProfile(value)) throw new Error("runtime profile has an unsupported shape or version");
    safeBasename(value.model.credentialRef);
    return value;
  }

  private publicView(profile: RuntimeProfile): PublicRuntimeProfile {
    const credentialPath = join(this.secretsDirectory, safeBasename(profile.model.credentialRef));
    const available = existsSync(credentialPath) && (() => {
      try {
        assertSafeTarget(credentialPath, false);
        return true;
      } catch {
        return false;
      }
    })();
    return {
      configured: true,
      version: profile.version,
      revision: profile.revision,
      agentImage: profile.agentImage,
      model: {
        provider: profile.model.provider,
        id: profile.model.id,
        ...(profile.model.baseUrl === undefined ? {} : { baseUrl: profile.model.baseUrl }),
        credentialAvailable: available,
      },
      updatedAt: profile.updatedAt,
    };
  }
}

export function validateRuntimeProfileInput(input: {
  readonly agentImage: string;
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credential: string;
}): void {
  if (input.agentImage.trim() === "" || input.agentImage.length > 4_096) throw new InputValidationError("agent image is invalid");
  if (!IDENTIFIER.test(input.provider)) throw new InputValidationError("model provider is invalid");
  if (input.model.trim() === "" || input.model.length > 512) throw new InputValidationError("model identifier is invalid");
  if (input.credential.length === 0 || input.credential.length > 64 * 1_024) throw new InputValidationError("model credential is invalid");
  if (input.baseUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(input.baseUrl);
    } catch {
      throw new InputValidationError("model base URL is invalid");
    }
    if (url.protocol !== "https:" && !isLoopbackUrl(url)) throw new InputValidationError("model base URL must use HTTPS unless it is loopback");
  }
}

function isLoopbackUrl(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

function isRuntimeProfile(value: unknown): value is RuntimeProfile {
  if (value === null || typeof value !== "object") return false;
  const profile = value as Partial<RuntimeProfile>;
  return profile.version === 1
    && Number.isInteger(profile.revision) && (profile.revision ?? 0) >= 1
    && typeof profile.agentImage === "string" && profile.agentImage.length > 0
    && typeof profile.updatedAt === "string"
    && profile.model !== undefined
    && typeof profile.model.provider === "string"
    && typeof profile.model.id === "string"
    && typeof profile.model.credentialRef === "string"
    && (profile.model.baseUrl === undefined || typeof profile.model.baseUrl === "string");
}

function safeBasename(value: string): string {
  if (basename(value) !== value || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(value)) {
    throw new Error("runtime credential reference is invalid");
  }
  return value;
}

function assertSafeTarget(path: string, allowMissing: boolean, kind: "file" | "directory" = "file"): void {
  try {
    const information = lstatSync(path);
    const supported = kind === "directory" ? information.isDirectory() : information.isFile();
    if (information.isSymbolicLink() || !supported) throw new Error(`${path} is not a safe ${kind} target`);
  } catch (error) {
    if (allowMissing && error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

function atomicWrite(path: string, contents: string, mode: number): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", mode);
    writeFileSync(descriptor, contents, "utf8");
    chmodSync(temporary, mode);
    closeSync(descriptor);
    descriptor = undefined;
    assertSafeTarget(path, true);
    renameSync(temporary, path);
    chmodSync(path, mode);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
