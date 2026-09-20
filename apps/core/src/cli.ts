#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PiworkApiError, PiworkClient, resolveCoreEndpoint, safeErrorMessage } from "@piwork/client-sdk";
import { CoreStore } from "@piwork/core-store";
import { readEnvironmentFile, resolveEnvironment } from "./application/env-file.js";
import { ensureCorePaths } from "./application/paths.js";
import { readProtectedCredential } from "./application/operator-credential.js";
import { readSecretInput } from "./application/secret-input.js";
import { bootstrapAdministrator } from "./identity/bootstrap-admin.js";

export const SERVE_USAGE = `usage: piwork-serve [--core <url>] [--env-file <path>] [--data-dir <path>] [--operator-credential-file <path>] [--json] <command>
  serve [--data-dir <path>] [--listen <host:port>] [--env-file <path>] [--allow-insecure-remote]
  status
  admin bootstrap --account <name> [--password-stdin]
  admin users list
  admin users create --account <name> [--role <admin|user>] [--password-stdin]
  admin users enable <userId>
  admin users disable <userId>
  admin users reset-credential <userId> [--password-stdin]
  config show
  config set --agent-image <image> --model-provider <provider> --model <id> [--model-base-url <url>] [--api-key-stdin | --api-key-file <path>]
`;

interface Globals {
  readonly core?: string;
  readonly envFile?: string;
  readonly dataDir?: string;
  readonly credentialFile?: string;
  readonly json: boolean;
  readonly rest: string[];
}

interface OperatorContext {
  readonly client: PiworkClient;
  readonly coreUrl: string;
  readonly json: boolean;
}

export async function runServeCli(argv: readonly string[]): Promise<number> {
  const globals = parseGlobals(argv);
  const [command, ...args] = globals.rest;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(SERVE_USAGE);
    return 0;
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(commandHelp(command));
    return 0;
  }
  if (command === "serve") {
    const { runServe } = await import("./server/serve.js");
    await runServe(forwardServeArgs(globals, args));
    return 0;
  }
  if (command === "status") {
    noArgs(args);
    const context = operatorContext(globals, false);
    output(context, await context.client.controlStatus());
    return 0;
  }
  if (command === "admin") {
    if (args[0] === "bootstrap" && offlineBootstrapNeeded(globals)) return offlineBootstrap(globals, args.slice(1));
    return adminCommand(operatorContext(globals, true), args);
  }
  if (command === "config") return configCommand(operatorContext(globals, true), args);
  throw usage(wrongSurface(command));
}

async function adminCommand(context: OperatorContext, args: readonly string[]): Promise<number> {
  const [section, ...rest] = args;
  if (section === "bootstrap") {
    known(rest, ["--account", "--password-stdin"]);
    const password = await readSecretInput({ stdin: process.stdin, stdout: process.stderr, stdinMode: rest.includes("--password-stdin"), prompt: "Administrator password: " });
    output(context, await context.client.bootstrapAdministrator(required(rest, "--account"), password));
    return 0;
  }
  if (section !== "users") throw usage("admin requires bootstrap or users");
  const [action, ...userArgs] = rest;
  if (action === "list") {
    noArgs(userArgs);
    output(context, await context.client.managedUsers());
    return 0;
  }
  if (action === "create") {
    known(userArgs, ["--account", "--role", "--password-stdin"]);
    const role = optional(userArgs, "--role");
    if (role !== undefined && role !== "admin" && role !== "user") throw usage("--role must be admin or user");
    const password = await readSecretInput({ stdin: process.stdin, stdout: process.stderr, stdinMode: userArgs.includes("--password-stdin"), prompt: "Initial password: " });
    output(context, await context.client.createManagedUser({ account: required(userArgs, "--account"), password, ...(role === undefined ? {} : { role }) }));
    return 0;
  }
  if (action === "enable" || action === "disable") {
    exact(userArgs, 1);
    output(context, await context.client.setManagedUserEnabled(userArgs[0]!, action === "enable"));
    return 0;
  }
  if (action === "reset-credential") {
    const userId = userArgs[0];
    if (userId === undefined || userId.startsWith("--")) throw usage("admin users reset-credential requires <userId>");
    const options = userArgs.slice(1);
    known(options, ["--password-stdin"]);
    const password = await readSecretInput({ stdin: process.stdin, stdout: process.stderr, stdinMode: options.includes("--password-stdin"), prompt: "New password: " });
    output(context, await context.client.resetManagedUserCredential(userId, password));
    return 0;
  }
  throw usage("admin users requires list, create, enable, disable, or reset-credential");
}

async function offlineBootstrap(globals: Globals, args: readonly string[]): Promise<number> {
  known(args, ["--account", "--password-stdin"]);
  const file = globals.envFile === undefined ? {} : readEnvironmentFile(globals.envFile);
  const environment = resolveEnvironment(file, process.env);
  const dataDir = globals.dataDir ?? environment.PIWORK_DATA_DIR;
  if (dataDir === undefined) throw usage("offline administrator bootstrap requires --data-dir or PIWORK_DATA_DIR");
  const password = await readSecretInput({ stdin: process.stdin, stdout: process.stderr, stdinMode: args.includes("--password-stdin"), prompt: "Administrator password: " });
  const paths = ensureCorePaths(dataDir);
  const store = CoreStore.open({ databasePath: paths.databasePath });
  try {
    output({ json: globals.json }, await bootstrapAdministrator({ store, account: required(args, "--account"), password }));
    return 0;
  } finally {
    store.close();
  }
}

function offlineBootstrapNeeded(globals: Globals): boolean {
  const file = globals.envFile === undefined ? {} : readEnvironmentFile(globals.envFile);
  const environment = resolveEnvironment(file, process.env);
  const dataDir = globals.dataDir ?? environment.PIWORK_DATA_DIR;
  const credentialPath = globals.credentialFile ?? environment.PIWORK_OPERATOR_CREDENTIAL_PATH
    ?? (dataDir === undefined ? undefined : ensureCorePaths(dataDir).operatorCredentialPath);
  return credentialPath !== undefined && !existsSync(credentialPath);
}

async function configCommand(context: OperatorContext, args: readonly string[]): Promise<number> {
  const [action, ...rest] = args;
  if (action === "show") {
    noArgs(rest);
    output(context, await context.client.runtimeProfile());
    return 0;
  }
  if (action !== "set") throw usage("config requires show or set");
  known(rest, ["--agent-image", "--model-provider", "--model", "--model-base-url", "--api-key-stdin", "--api-key-file"]);
  const stdinMode = rest.includes("--api-key-stdin");
  const keyFile = optional(rest, "--api-key-file");
  if (stdinMode && keyFile !== undefined) throw usage("choose only one of --api-key-stdin and --api-key-file");
  const credential = keyFile === undefined
    ? await readSecretInput({ stdin: process.stdin, stdout: process.stderr, stdinMode, prompt: "Model API key: " })
    : readProtectedSecretFile(keyFile);
  const baseUrl = optional(rest, "--model-base-url");
  output(context, await context.client.configureRuntime({
    agentImage: required(rest, "--agent-image"),
    provider: required(rest, "--model-provider"),
    model: required(rest, "--model"),
    credential,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  }));
  return 0;
}

function operatorContext(globals: Globals, authenticated: boolean): OperatorContext {
  const file = globals.envFile === undefined ? {} : readEnvironmentFile(globals.envFile);
  const environment = resolveEnvironment(file, process.env);
  const coreUrl = resolveCoreEndpoint({ explicit: globals.core, environment: environment.PIWORK_CORE_URL });
  let operatorToken: string | undefined;
  if (authenticated) {
    const dataDir = globals.dataDir ?? environment.PIWORK_DATA_DIR;
    const credentialPath = globals.credentialFile ?? environment.PIWORK_OPERATOR_CREDENTIAL_PATH
      ?? (dataDir === undefined ? undefined : ensureCorePaths(dataDir).operatorCredentialPath);
    if (credentialPath === undefined) throw usage("operator commands require --data-dir, --operator-credential-file, PIWORK_DATA_DIR, or PIWORK_OPERATOR_CREDENTIAL_PATH");
    operatorToken = readProtectedCredential(credentialPath);
  }
  return { coreUrl, json: globals.json, client: new PiworkClient({ coreUrl, ...(operatorToken === undefined ? {} : { operatorToken }) }) };
}

function parseGlobals(argv: readonly string[]): Globals {
  let core: string | undefined;
  let envFile: string | undefined;
  let dataDir: string | undefined;
  let credentialFile: string | undefined;
  let json = false;
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index]!;
    if (argument === "--json") { json = true; index += 1; continue; }
    const target = argument === "--core" ? "core" : argument === "--env-file" ? "envFile" : argument === "--data-dir" ? "dataDir" : argument === "--operator-credential-file" ? "credentialFile" : undefined;
    if (target === undefined) break;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw usage(`${argument} requires a value`);
    if ((target === "core" && core !== undefined) || (target === "envFile" && envFile !== undefined) || (target === "dataDir" && dataDir !== undefined) || (target === "credentialFile" && credentialFile !== undefined)) throw usage(`${argument} may be specified only once`);
    if (target === "core") core = value;
    else if (target === "envFile") envFile = value;
    else if (target === "dataDir") dataDir = value;
    else credentialFile = value;
    index += 2;
  }
  return { ...(core === undefined ? {} : { core }), ...(envFile === undefined ? {} : { envFile }), ...(dataDir === undefined ? {} : { dataDir }), ...(credentialFile === undefined ? {} : { credentialFile }), json, rest: [...argv.slice(index)] };
}

function forwardServeArgs(globals: Globals, args: readonly string[]): string[] {
  const forwarded = [...args];
  if (globals.dataDir !== undefined && !forwarded.includes("--data-dir")) forwarded.unshift("--data-dir", globals.dataDir);
  if (globals.envFile !== undefined && !forwarded.includes("--env-file")) forwarded.unshift("--env-file", globals.envFile);
  if (globals.core !== undefined || globals.credentialFile !== undefined || globals.json) throw usage("--core, --operator-credential-file, and --json are not serve options");
  return forwarded;
}

function readProtectedSecretFile(path: string): string {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("API key file must be a regular file, not a symbolic link");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("API key file must not be accessible by group or other users");
  const value = readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
  if (value.length === 0) throw new Error("API key file is empty");
  return value;
}

function commandHelp(command: string): string {
  if (command === "serve") return "usage: piwork-serve serve [--data-dir <path>] [--listen <host:port>] [--env-file <path>] [--allow-insecure-remote]\n";
  if (command === "status") return "usage: piwork-serve status\n";
  if (command === "admin") return "usage: piwork-serve admin <bootstrap|users> ...\n";
  if (command === "config") return "usage: piwork-serve config <show|set> ...\n";
  throw usage(`unknown command: ${command}`);
}

function wrongSurface(command: string): string {
  if (["login", "logout", "whoami", "work", "operation", "session", "run", "chat"].includes(command)) return `${command} is a user command; use piwork-cli`;
  return `unknown command: ${command}`;
}

function known(args: readonly string[], names: readonly string[]): void {
  const boolean = new Set(["--password-stdin", "--api-key-stdin"]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--") || !names.includes(value)) throw usage(`unknown option: ${value}`);
    if (!boolean.has(value)) {
      if (args[index + 1] === undefined || args[index + 1]!.startsWith("--")) throw usage(`${value} requires a value`);
      index += 1;
    }
  }
}
function optional(args: readonly string[], name: string): string | undefined { const indexes = args.flatMap((value, index) => value === name ? [index] : []); if (indexes.length > 1) throw usage(`${name} may be specified only once`); const index = indexes[0]; return index === undefined ? undefined : args[index + 1]; }
function required(args: readonly string[], name: string): string { const value = optional(args, name); if (value === undefined) throw usage(`${name} is required`); return value; }
function exact(args: readonly string[], count: number): void { if (args.length !== count) throw usage("unexpected arguments"); }
function noArgs(args: readonly string[]): void { exact(args, 0); }
function usage(message: string): Error { return Object.assign(new Error(message), { exitCode: 2 }); }
function output(context: Pick<OperatorContext, "json">, value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, context.json ? 0 : 2)}\n`); }

export function serveExitCodeFor(error: unknown): number {
  const explicit = (error as { exitCode?: unknown }).exitCode;
  if (typeof explicit === "number") return explicit;
  if (error instanceof PiworkApiError) {
    if (error.status === 401 || error.status === 403) return 3;
    if (error.code === "ADMIN_REQUIRED" || error.code === "RUNTIME_NOT_CONFIGURED") return 4;
    if (error.status === 0) return 5;
    if (error.status === 409) return 6;
    if (error.status === 502 || error.status === 503 || error.status === 504) return 7;
  }
  return 1;
}

function isDirectExecution(): boolean { const entry = process.argv[1]; return entry !== undefined && import.meta.url === pathToFileURL(entry).href; }

if (isDirectExecution()) {
  runServeCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = serveExitCodeFor(error);
  });
}
