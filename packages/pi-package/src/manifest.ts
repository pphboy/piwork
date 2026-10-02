import { Check } from "typebox/value";
import { satisfies, valid, validRange } from "semver";
import { PiPackageNameSchema } from "@piwork/contracts";

export class PiPackageInputError extends Error {
  constructor(readonly code: "PI_PACKAGE_INVALID_SOURCE" | "PI_PACKAGE_INVALID_MANIFEST" | "PI_PACKAGE_UNSAFE_ARCHIVE" | "PI_PACKAGE_LIMIT_EXCEEDED" | "PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE" | "PI_PACKAGE_SDK_VERSION_UNSUPPORTED", message: string) {
    super(message);
    this.name = "PiPackageInputError";
  }
}

export interface PiPackageManifest {
  readonly name: string;
  readonly version: string | null;
  readonly pi: Partial<Record<"extensions" | "skills" | "prompts" | "themes", readonly string[]>> | null;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
}

export const PI_HOST_MODULES = new Set(["@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]);

export function parsePiPackageManifest(bytes: Buffer): PiPackageManifest {
  if (bytes.length > 1024 * 1024) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "package manifest exceeds 1 MiB");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "package.json is not valid JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "package.json must be an object");
  const manifest = value as Record<string, unknown>;
  if (!Check(PiPackageNameSchema, manifest.name)) throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "package.json.name is invalid");
  if (manifest.version !== undefined && (typeof manifest.version !== "string" || manifest.version.length === 0 || manifest.version.length > 256)) {
    throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "package.json.version is invalid");
  }
  const pi = manifest.pi;
  if (pi !== undefined && (pi === null || typeof pi !== "object" || Array.isArray(pi))) throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "package.json.pi must be an object");
  const declarations: Record<string, readonly string[]> = {};
  if (pi !== undefined) for (const kind of ["extensions", "skills", "prompts", "themes"] as const) {
    const declaration = (pi as Record<string, unknown>)[kind];
    if (declaration === undefined) continue;
    if (!Array.isArray(declaration) || declaration.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.length > 4096 ||
        entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes("..") || entry.includes("\0"))) {
      throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", `package.json.pi.${kind} is invalid`);
    }
    declarations[kind] = declaration;
  }
  const dependencies = manifest.dependencies ?? {};
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies) ||
      Object.entries(dependencies).some(([name, version]) => !Check(PiPackageNameSchema, name) || typeof version !== "string" || !version)) {
    throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "package.json.dependencies is invalid");
  }
  const peerDependencies = manifest.peerDependencies === undefined ? {} : manifest.peerDependencies;
  if (peerDependencies === null || typeof peerDependencies !== "object" || Array.isArray(peerDependencies) ||
      Object.entries(peerDependencies).some(([name, range]) => !Check(PiPackageNameSchema, name) || typeof range !== "string" ||
        !range.trim() || (PI_HOST_MODULES.has(name) && validRange(range) === null))) {
    throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "package.json.peerDependencies is invalid");
  }
  return { name: manifest.name as string, version: (manifest.version as string | undefined) ?? null,
    pi: pi === undefined ? null : declarations, dependencies: dependencies as Record<string, string>,
    peerDependencies: peerDependencies as Record<string, string> };
}

/** Evaluate peers against the versions in the immutable preparation image, never Core's SDK. */
export function assertPiPackageHostPeers(manifest: PiPackageManifest, hostVersions: Readonly<Record<string, string>>): void {
  for (const name of PI_HOST_MODULES) {
    const version = hostVersions[name];
    if (!version || valid(version) === null) {
      throw new PiPackageInputError("PI_PACKAGE_SDK_VERSION_UNSUPPORTED", "selected agent image has an invalid Pi host version");
    }
    const range = manifest.peerDependencies[name];
    if (range !== undefined && !satisfies(version, range, { includePrerelease: false })) {
      throw new PiPackageInputError("PI_PACKAGE_SDK_VERSION_UNSUPPORTED", "selected agent image does not satisfy package Pi peer requirements");
    }
  }
}
