#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CoreStore, InitialAdministratorExistsError } from "@piwork/core-store";
import { ensureCorePaths } from "./application/paths.js";
import { readSecretInput } from "./application/secret-input.js";
import { RuntimeProfileStore } from "./configuration/runtime-profile.js";
import { bootstrapAdministrator } from "./identity/bootstrap-admin.js";

export const CORE_USAGE = `usage:
  piwork-core bootstrap-admin --data-dir <path> --account <name> [--password-stdin]
  piwork-core configure-runtime --data-dir <path> --agent-image <image> --model-provider <provider> --model <id> [--model-base-url <url>] [--api-key-stdin | --api-key-file <path>]
  piwork-core show-runtime --data-dir <path>
  piwork-core serve --data-dir <path> [--listen <host:port>] [--allow-insecure-remote]
`;

export async function runCoreCli(args: readonly string[]): Promise<void> {
  const [command, ...commandArgs] = args;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(CORE_USAGE);
    return;
  }
  switch (command) {
    case "bootstrap-admin":
      await runBootstrap(commandArgs);
      return;
    case "configure-runtime":
      await runConfigureRuntime(commandArgs);
      return;
    case "show-runtime":
      runShowRuntime(commandArgs);
      return;
    case "serve": {
      const { runServe } = await import("./server/serve.js");
      await runServe(commandArgs);
      return;
    }
    default:
      throw new UsageError(`unknown command: ${command}\n${CORE_USAGE}`);
  }
}

async function runBootstrap(args: readonly string[]): Promise<void> {
  assertKnownOptions(args, ["--data-dir", "--account", "--password-stdin"]);
  const paths = ensureCorePaths(requiredValue(args, "--data-dir"));
  const account = requiredValue(args, "--account");
  const password = await readSecretInput({
    stdin: process.stdin,
    stdout: process.stderr,
    stdinMode: args.includes("--password-stdin"),
    prompt: "Administrator password: ",
  });
  const store = CoreStore.open({ databasePath: paths.databasePath });
  try {
    const result = await bootstrapAdministrator({ store, account, password });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error instanceof InitialAdministratorExistsError) {
      throw new Error("an administrator already exists; bootstrap made no changes");
    }
    throw error;
  } finally {
    store.close();
  }
}

async function runConfigureRuntime(args: readonly string[]): Promise<void> {
  assertKnownOptions(args, [
    "--data-dir",
    "--agent-image",
    "--model-provider",
    "--model",
    "--model-base-url",
    "--api-key-stdin",
    "--api-key-file",
  ]);
  const paths = ensureCorePaths(requiredValue(args, "--data-dir"));
  const agentImage = requiredValue(args, "--agent-image");
  const image = inspectAgentImage(agentImage);
  const provider = requiredValue(args, "--model-provider");
  if (provider === "piwork-deterministic" && image.variant !== "acceptance") {
    throw new Error("the deterministic provider requires an acceptance agent image");
  }
  const stdinMode = args.includes("--api-key-stdin");
  const keyFile = optionalValue(args, "--api-key-file");
  if (stdinMode && keyFile !== undefined) throw new UsageError("choose only one of --api-key-stdin and --api-key-file");
  const credential = keyFile === undefined
    ? await readSecretInput({
        stdin: process.stdin,
        stdout: process.stderr,
        stdinMode,
        prompt: "Model API key: ",
      })
    : readProtectedSecretFile(keyFile);
  const profiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory);
  const baseUrl = optionalValue(args, "--model-base-url");
  const profile = profiles.configure({
    agentImage,
    provider,
    model: requiredValue(args, "--model"),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    credential,
  });
  process.stdout.write(`${JSON.stringify(profile)}\n`);
}

function runShowRuntime(args: readonly string[]): void {
  assertKnownOptions(args, ["--data-dir"]);
  const paths = ensureCorePaths(requiredValue(args, "--data-dir"));
  const profiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory);
  process.stdout.write(`${JSON.stringify(profiles.inspect())}\n`);
}

function inspectAgentImage(image: string): { readonly variant: string } {
  try {
    const output = execFileSync("docker", ["image", "inspect", image], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const record = (JSON.parse(output) as Array<{ Config?: { Labels?: Record<string, string> } }>)[0];
    const labels = record?.Config?.Labels ?? {};
    if (labels["io.piwork.agent.protocol"] !== "v1") throw new Error("agent image protocol label is incompatible");
    const variant = labels["io.piwork.agent.variant"];
    if (variant !== "production" && variant !== "acceptance") throw new Error("agent image variant label is missing");
    return { variant };
  } catch {
    throw new Error(`agent image is unavailable: ${image}`);
  }
}

function readProtectedSecretFile(path: string): string {
  const information = lstatSync(path);
  if (information.isSymbolicLink() || !information.isFile()) throw new Error("API key file must be a regular file, not a symbolic link");
  if (process.platform !== "win32" && (information.mode & 0o077) !== 0) {
    throw new Error("API key file must not be accessible by group or other users");
  }
  const value = readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
  if (value.length === 0) throw new Error("API key file is empty");
  return value;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function requiredValue(args: readonly string[], flag: string): string {
  const value = optionalValue(args, flag);
  if (value === undefined) throw new UsageError(`${flag} requires a value`);
  return value;
}

export function optionalValue(args: readonly string[], flag: string): string | undefined {
  const matches: number[] = [];
  args.forEach((value, index) => {
    if (value === flag) matches.push(index);
  });
  if (matches.length > 1) throw new UsageError(`${flag} may be specified only once`);
  const index = matches[0];
  if (index === undefined) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} requires a value`);
  return value;
}

export function assertKnownOptions(args: readonly string[], options: readonly string[]): void {
  const booleanOptions = new Set(["--password-stdin", "--api-key-stdin", "--allow-insecure-remote"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--") || !options.includes(argument)) throw new UsageError(`unknown option: ${argument}`);
    if (!booleanOptions.has(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${argument} requires a value`);
      index += 1;
    }
  }
}

function publicError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectExecution()) {
  await runCoreCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
