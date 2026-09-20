import { chmodSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { join, resolve } from "node:path";

export interface CorePaths {
  readonly dataDirectory: string;
  readonly databasePath: string;
  readonly runtimeProfilePath: string;
  readonly secretsDirectory: string;
  readonly runtimeDirectory: string;
  readonly operatorCredentialPath: string;
}

export interface ListenAddress {
  readonly host: string;
  readonly port: number;
}

export function ensureCorePaths(dataDirectory: string): CorePaths {
  if (dataDirectory.trim() === "") throw new Error("--data-dir must not be empty");
  const requested = resolve(dataDirectory);
  mkdirSync(requested, { recursive: true, mode: 0o700 });
  const information = statSync(requested);
  if (!information.isDirectory()) throw new Error("--data-dir must name a directory");
  chmodSync(requested, 0o700);
  const root = realpathSync(requested);
  const secretsDirectory = join(root, "secrets");
  const runtimeDirectory = join(root, "runtime");
  mkdirSync(secretsDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  chmodSync(secretsDirectory, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  return {
    dataDirectory: root,
    databasePath: join(root, "core.sqlite"),
    runtimeProfilePath: join(root, "runtime-profile.json"),
    secretsDirectory,
    runtimeDirectory,
    operatorCredentialPath: join(root, "operator.credential"),
  };
}

export function parseListenAddress(
  value = "127.0.0.1:7171",
  allowInsecureRemote = false,
): ListenAddress {
  const match = value.startsWith("[")
    ? /^\[([^\]]+)]:(\d+)$/.exec(value)
    : /^([^:]+):(\d+)$/.exec(value);
  if (match === null) throw new Error("--listen must be HOST:PORT or [IPv6]:PORT");
  const host = match[1]!;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--listen port must be an integer from 0 through 65535");
  }
  if (!isLoopbackHost(host) && !allowInsecureRemote) {
    throw new Error("non-loopback plaintext HTTP requires --allow-insecure-remote");
  }
  return { host, port };
}

export function formatHttpUrl(address: ListenAddress): string {
  const host = isIP(address.host) === 6 ? `[${address.host}]` : address.host;
  return `http://${host}:${address.port}`;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  if (isIP(normalized) === 4) {
    const first = Number(normalized.split(".")[0]);
    return first === 127;
  }
  return false;
}
