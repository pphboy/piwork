#!/usr/bin/env node
import { lookup } from "node:dns/promises";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createConsoleServer, requestConsoleShutdown, type ConsoleConfig } from "./server.js";

const HELP = `usage: piwork-console serve --public-origin <https-origin> --tls-cert <file> --tls-key <file>
  [--core <loopback-url>] [--listen <host:port>] [--data-dir <directory>]
`;
class UsageError extends Error {}

export async function runConsoleCli(args: readonly string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help" || args[0] === "serve" && args.includes("--help")) {
    process.stdout.write(HELP); return 0;
  }
  let config: ConsoleConfig;
  try { config = await parseConfig(args); }
  catch (error) { process.stderr.write(`${error instanceof UsageError ? error.message : "piwork-console could not start"}\n${HELP}`);
    return error instanceof UsageError ? 2 : 1; }
  let lock: (() => Promise<void>) | undefined;
  try {
    lock = await acquireDataLock(config.dataDir);
    const server = await createConsoleServer(config);
    await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(config.listenPort, config.listenHost, () => { server.off("error", fail); done(); }); });
    process.stdout.write(`piwork-console listening at ${config.publicOrigin}\n`);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      requestConsoleShutdown(server);
      const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 9_500);
      try { await new Promise<void>((done) => server.close(() => done()));
        await lock?.(); }
      finally { clearTimeout(deadline); }
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
    await new Promise<void>((done) => server.once("close", done));
    return 0;
  } catch (error) {
    await lock?.();
    process.stderr.write(`piwork-console could not start: ${error instanceof Error && "code" in error ? String(error.code) : "STARTUP_FAILED"}\n`);
    return 1;
  }
}

async function parseConfig(args: readonly string[]): Promise<ConsoleConfig> {
  if (args[0] !== "serve") throw new UsageError("expected serve command");
  const values = new Map<string, string>();
  const allowed = new Set(["--core", "--listen", "--public-origin", "--tls-cert", "--tls-key", "--data-dir"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!name || !allowed.has(name) || !value || value.startsWith("--") || values.has(name)) throw new UsageError("invalid or repeated option");
    values.set(name, value);
  }
  const origin = values.get("--public-origin"), certPath = values.get("--tls-cert"), keyPath = values.get("--tls-key");
  if (!origin || !certPath || !keyPath) throw new UsageError("public-origin, TLS certificate and key are required");
  const listen = values.get("--listen") ?? "0.0.0.0:7173";
  let listenUrl: URL, originUrl: URL, coreUrl: URL;
  try { listenUrl = new URL(`http://${listen}`); originUrl = new URL(origin); coreUrl = new URL(values.get("--core") ?? "http://127.0.0.1:7171"); }
  catch { throw new UsageError("invalid listener, public origin or Core URL"); }
  if (!listenUrl.port || !Number.isInteger(Number(listenUrl.port)) || Number(listenUrl.port) < 1 ||
    listenUrl.pathname !== "/" || listenUrl.search || listenUrl.hash || listenUrl.username || listenUrl.password) throw new UsageError("invalid listen address");
  const originPort = Number(originUrl.port || 443);
  if (originUrl.protocol !== "https:" || originPort !== Number(listenUrl.port) || originUrl.pathname !== "/" ||
    originUrl.search || originUrl.hash || originUrl.username || originUrl.password) throw new UsageError("public-origin must be an HTTPS origin on the listen port");
  if (!["http:", "https:"].includes(coreUrl.protocol) || coreUrl.pathname !== "/" || coreUrl.search || coreUrl.hash ||
    coreUrl.username || coreUrl.password || !coreUrl.hostname) throw new UsageError("Core URL must be a plain loopback origin");
  const addresses = isIP(coreUrl.hostname.replace(/^\[|\]$/g, ""))
    ? [{ address: coreUrl.hostname.replace(/^\[|\]$/g, "") }]
    : coreUrl.hostname === "localhost" ? await lookup("localhost", { all: true }) : [];
  if (addresses.length === 0 || addresses.some((item) => item.address !== "127.0.0.1" && item.address !== "::1")) {
    throw new UsageError("Core URL must resolve only to loopback");
  }
  const cert = await safeTlsFile(certPath, false), key = await safeTlsFile(keyPath, true);
  return { coreUrl: coreUrl.origin, listenHost: listenUrl.hostname.replace(/^\[|\]$/g, ""), listenPort: Number(listenUrl.port),
    publicOrigin: originUrl.origin, dataDir: resolve(values.get("--data-dir") ?? join(process.cwd(), ".piwork", "console")), cert, key };
}

async function safeTlsFile(path: string, key: boolean): Promise<Buffer> {
  let info;
  try { info = await lstat(path); }
  catch { throw new Error("TLS certificate or key is unavailable"); }
  if (!info.isFile() || info.isSymbolicLink() || key && process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error("TLS certificate or key has unsafe permissions");
  }
  return readFile(path);
}

async function acquireDataLock(dataDir: string): Promise<() => Promise<void>> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const info = await lstat(dataDir);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("unsafe console data directory");
  const lockPath = join(dataDir, "console.lock");
  let descriptor;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { descriptor = await open(lockPath, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockInfo = await lstat(lockPath);
      if (!lockInfo.isFile() || lockInfo.isSymbolicLink() || process.platform !== "win32" && (lockInfo.mode & 0o077) !== 0) {
        throw new Error("console lock is unsafe");
      }
      const pid = Number((await readFile(lockPath, "utf8").catch(() => "")).trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("console lock cannot be verified");
      try { process.kill(pid, 0); throw new Error("console data directory is already in use"); }
      catch (check) { if ((check as NodeJS.ErrnoException).code !== "ESRCH") throw check; }
      await rm(lockPath);
    }
  }
  if (!descriptor) throw new Error("console lock could not be acquired");
  await descriptor.writeFile(`${process.pid}\n`); await descriptor.close();
  const staging = join(dataDir, "staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  return async () => { await rm(staging, { recursive: true, force: true }); await rm(lockPath, { force: true }); };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConsoleCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
