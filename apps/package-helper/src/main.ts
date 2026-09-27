import { spawn } from "node:child_process";
import { chown, chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { assertPiPackageHostPeers, extractPiPackageZip, packPiPackageDirectory, parsePiPackageManifest, parsePiPackageSource, PI_HOST_MODULES, PI_PACKAGE_LIMITS,
  PiPackageInputError, validatePiPackageArtifact, validatePiPackageSourceTree } from "@piwork/pi-package";
import type { PiPackagePreparedEnvironment, PiPackageSourceKind } from "@piwork/contracts";

export interface PackageHelperPaths { readonly workRoot: string; readonly spoolRoot: string; readonly sourceRoot?: string; readonly hostModuleRoot?: string }

interface PrepareRequest {
  readonly source: { readonly kind: "npm" | "git"; readonly spec: string } | { readonly kind: "local" | "zip"; readonly displayName: string };
}

type PackageCommandFailureCode = "PI_PACKAGE_SOURCE_FETCH_FAILED" | "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED";
const npmFetchOptions = ["--fetch-retries=8", "--fetch-retry-mintimeout=1000", "--fetch-retry-maxtimeout=30000", "--fetch-timeout=600000"] as const;

class PackageCommandFailure extends Error {
  constructor(readonly code: PackageCommandFailureCode) {
    super(code === "PI_PACKAGE_SOURCE_FETCH_FAILED" ? "Package source fetch failed" : "Package dependency installation failed");
  }
}

function sameDependencies(left: unknown, right: Readonly<Record<string, string>>): boolean {
  if (left === null || typeof left !== "object" || Array.isArray(left)) return Object.keys(right).length === 0;
  const entries = Object.entries(left as Record<string, unknown>);
  return entries.length === Object.keys(right).length && entries.every(([name, value]) => right[name] === value);
}

async function command(executable: string, args: readonly string[], cwd: string, failureCode: PackageCommandFailureCode | null, output = false): Promise<string> {
  return new Promise((resolveCommand, reject) => {
    const failure = () => failureCode === null ? new Error("Package archive command failed") : new PackageCommandFailure(failureCode);
    const child = spawn(executable, args, { cwd, shell: false, env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/package/work/home",
      NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? "/package/work/npm-cache", npm_config_userconfig: "/dev/null",
      ...(process.env.NPM_CONFIG_REGISTRY ? { NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY } : {}),
      ...(process.env.GIT_CONFIG_GLOBAL ? { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL } : {}),
      GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", CI: "true",
    }, stdio: ["ignore", output ? "pipe" : "ignore", "ignore"] });
    const chunks: Buffer[] = [];
    let length = 0;
    child.stdout?.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 4096) { child.kill("SIGKILL"); return; }
      chunks.push(Buffer.from(chunk));
    });
    child.once("error", () => reject(failure()));
    child.once("close", (code) => code === 0 ? resolveCommand(Buffer.concat(chunks).toString("utf8").trim()) : reject(failure()));
  });
}

async function installRuntimeDependencies(root: string, hostModuleRoot: string): Promise<void> {
  const manifestPath = join(root, "package.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = parsePiPackageManifest(manifestBytes);
  const hostVersions: Record<string, string> = {};
  for (const name of PI_HOST_MODULES) {
    for (const parent of [join(hostModuleRoot, "@earendil-works", "pi-coding-agent", "node_modules"), hostModuleRoot]) {
      let bytes: string;
      try { bytes = await readFile(join(parent, ...name.split("/"), "package.json"), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; break; }
      try {
        const host = JSON.parse(bytes) as { version?: unknown };
        if (typeof host.version === "string") hostVersions[name] = host.version;
      } catch { /* A malformed installed host module fails the safe version gate. */ }
      break;
    }
  }
  assertPiPackageHostPeers(manifest, hostVersions);
  const lock = await readFile(join(root, "package-lock.json"), "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => null);
  const lockRoot = lock?.packages !== null && typeof lock?.packages === "object" ? (lock.packages as Record<string, unknown>)[""] : null;
  const lockDependencies = lockRoot !== null && typeof lockRoot === "object" ? (lockRoot as Record<string, unknown>).dependencies : null;
  const validLock = lock !== null && typeof lock === "object" && Number.isInteger(lock.lockfileVersion) &&
    Number(lock.lockfileVersion) >= 2 && lock.name === manifest.name && lock.version === manifest.version &&
    sameDependencies(lockDependencies, manifest.dependencies);
  const args = validLock ? ["ci"] : ["install"];
  const original = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
  const trimDevDependencies = !validLock && original.devDependencies !== null && typeof original.devDependencies === "object" &&
    Object.keys(original.devDependencies).length > 0;
  if (trimDevDependencies) {
    // npm --omit=dev still resolves the entire dev tree when creating a lockfile.
    // Resolve only runtime dependencies, then restore the published manifest bytes.
    const runtimeManifest = { ...original };
    delete runtimeManifest.devDependencies;
    await writeFile(manifestPath, JSON.stringify(runtimeManifest));
  }
  try {
    await command("npm", [...args, ...npmFetchOptions, "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--ignore-scripts=false", "--prefix", root], root,
      "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED");
  } finally {
    if (trimDevDependencies) await writeFile(manifestPath, manifestBytes);
  }
}

async function preparePackage(paths: PackageHelperPaths): Promise<unknown> {
  const inputRoot = paths.sourceRoot ?? "/package/source";
  const request = JSON.parse(await readFile(join(inputRoot, "request.json"), "utf8")) as PrepareRequest;
  if (!request || typeof request !== "object" || !request.source || typeof request.source !== "object") throw new TypeError("invalid package prepare request");
  const source = request.source;
  const result = join(paths.workRoot, "result");
  const hostModuleRoot = paths.hostModuleRoot ?? "/workspace/node_modules";
  if (source.kind === "local" || source.kind === "zip") {
    if (typeof source.displayName !== "string" || !source.displayName || source.displayName.includes("/")) throw new TypeError("invalid package display name");
    await extractPiPackageZip(join(inputRoot, "input.zip"), result);
    await rm(join(result, "node_modules"), { recursive: true, force: true });
    await installRuntimeDependencies(result, hostModuleRoot);
    const manifest = parsePiPackageManifest(await readFile(join(result, "package.json")));
    return { name: manifest.name, version: manifest.version, sourceKind: source.kind, resolvedSource: source.displayName };
  }
  if (source.kind === "npm") {
    if (typeof source.spec !== "string") throw new TypeError("invalid npm source");
    const parsed = parsePiPackageSource(`npm:${source.spec}`);
    if (parsed.kind !== "npm") throw new TypeError("invalid npm source");
    const npmName = source.spec.startsWith("@") ? source.spec.slice(0, source.spec.indexOf("/")) + "/" + source.spec.slice(source.spec.indexOf("/") + 1).split("@")[0] : source.spec.split("@")[0]!;
    const stage = join(paths.workRoot, "npm-stage");
    await mkdir(stage, { recursive: true });
    const archiveName = await command("npm", ["pack", ...npmFetchOptions, "--silent", "--ignore-scripts", "--pack-destination", stage, source.spec], stage,
      "PI_PACKAGE_SOURCE_FETCH_FAILED", true);
    if (!archiveName.endsWith(".tgz") || basename(archiveName) !== archiveName) {
      throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "npm returned an invalid archive name");
    }
    const archive = join(stage, archiveName);
    const archiveStat = await lstat(archive);
    if (!archiveStat.isFile() || archiveStat.size > PI_PACKAGE_LIMITS.compressedBytes) {
      throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "npm archive exceeds 256 MiB");
    }
    const unpacked = join(stage, "unpacked");
    await mkdir(unpacked);
    await command("tar", ["-xzf", archive, "-C", unpacked, "--no-same-owner", "--no-same-permissions"], stage,
      null);
    if ((await readdir(unpacked)).length !== 1) throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "npm archive has multiple roots");
    const installed = join(unpacked, "package");
    const manifest = await validatePiPackageSourceTree(installed);
    if (manifest.name !== npmName) throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "npm package name does not match source");
    if (manifest.version === null) throw new Error("npm did not resolve a package version");
    await rename(installed, result);
    await rm(stage, { recursive: true, force: true });
    await installRuntimeDependencies(result, hostModuleRoot);
    return { name: manifest.name, version: manifest.version, sourceKind: "npm", resolvedSource: `${manifest.name}@${manifest.version}` };
  }
  if (source.kind === "git") {
    if (typeof source.spec !== "string") throw new TypeError("invalid Git source");
    const parsed = parsePiPackageSource(`git:${source.spec}`);
    if (parsed.kind !== "git") throw new TypeError("invalid Git source");
    const checkout = join(paths.workRoot, "git-checkout");
    await command("git", ["clone", "--no-checkout", parsed.url, checkout], paths.workRoot, "PI_PACKAGE_SOURCE_FETCH_FAILED");
    await command("git", ["-C", checkout, "checkout", "--detach", parsed.ref ?? "HEAD"], paths.workRoot, "PI_PACKAGE_SOURCE_FETCH_FAILED");
    const commit = await command("git", ["-C", checkout, "rev-parse", "HEAD"], paths.workRoot, "PI_PACKAGE_SOURCE_FETCH_FAILED", true);
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Git did not resolve a commit");
    await rm(join(checkout, ".git"), { recursive: true, force: true });
    await validatePiPackageSourceTree(checkout);
    await rename(checkout, result);
    await rm(join(result, "node_modules"), { recursive: true, force: true });
    await installRuntimeDependencies(result, hostModuleRoot);
    const manifest = parsePiPackageManifest(await readFile(join(result, "package.json")));
    return { name: manifest.name, version: manifest.version, sourceKind: "git", resolvedSource: `${parsed.url}@${commit}` };
  }
  throw new TypeError("invalid package prepare source");
}

/** These fixed entry points never evaluate package JavaScript. */
export async function runPackageHelper(action: string, paths: PackageHelperPaths): Promise<unknown> {
  if (action === "measure") {
    let bytes = 0, entries = 0;
    const walk = async (directory: string): Promise<void> => {
      for (const name of await readdir(directory)) {
        let info;
        const path = join(directory, name);
        try { info = await lstat(path); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        if (++entries > 1_000_000) { bytes = PI_PACKAGE_LIMITS.preparationBytes + 1; return; }
        if (info.isDirectory()) await walk(path);
        else bytes += info.size;
        if (bytes > PI_PACKAGE_LIMITS.preparationBytes) return;
      }
    };
    await walk(paths.workRoot);
    return { bytes };
  }
  if (action === "init") {
    await mkdir(paths.workRoot, { recursive: true, mode: 0o700 });
    if (process.getuid?.() === 0) await chown(paths.workRoot, 10001, 10001);
    return { initialized: true };
  }
  if (action === "capture") {
    const request = JSON.parse(await readFile(join(paths.spoolRoot, "request.json"), "utf8")) as {
      sourceKind: PiPackageSourceKind; resolvedSource: string; preparedEnvironment: PiPackagePreparedEnvironment;
    };
    const root = join(paths.workRoot, "result");
    const validated = await validatePiPackageArtifact({ root, sourceKind: request.sourceKind,
      resolvedSource: request.resolvedSource, preparedEnvironment: request.preparedEnvironment });
    const packed = await packPiPackageDirectory(root, join(paths.spoolRoot, "artifact.zip"));
    const result = { metadata: validated.metadata, inventory: validated.inventory, entryCount: validated.entryCount,
      restoredBytes: validated.restoredBytes, zipBytes: packed.bytes, zipSha256: packed.digest };
    await writeFile(join(paths.spoolRoot, "result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    await chmod(join(paths.spoolRoot, "artifact.zip"), 0o644);
    await chmod(join(paths.spoolRoot, "result.json"), 0o644);
    return result;
  }
  if (action === "prepare") return preparePackage(paths);
  throw new TypeError("invalid package helper action");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runPackageHelper(process.argv[2] ?? "", { workRoot: "/package/work", spoolRoot: "/package/spool" })
    .then((result) => { process.stdout.write(`${JSON.stringify(result)}\n`); })
    .catch((error: unknown) => {
      process.stdout.write(`${JSON.stringify({ errorCode: error instanceof PiPackageInputError || error instanceof PackageCommandFailure ? error.code : null })}\n`);
      process.exitCode = 1;
    });
}
