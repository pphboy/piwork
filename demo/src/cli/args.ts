import { DEFAULT_HOST, DEFAULT_PORT } from "../common/config.js";

export type CliCommand = "repl" | "health" | "ask" | "help";

export interface CliOptions {
  command: CliCommand;
  address: string;
  sessionId: string | undefined;
  cwd: string | undefined;
  showThinking: boolean;
  json: boolean;
  prompt: string | undefined;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const COMMANDS: readonly string[] = ["repl", "health", "ask", "help"];

export const USAGE = `piwork-cli - talk to a piwork daemon

Usage:
  piwork-cli [options]                     interactive Q&A loop (default)
  piwork-cli health [options]              print daemon status
  piwork-cli ask "<prompt>" [options]      ask one question and exit

Options:
  --addr <host:port>   daemon address (default ${DEFAULT_HOST}:${DEFAULT_PORT})
  --session <id>       resume an existing session instead of starting one
  --cwd <path>         workspace for a newly created session
  --show-thinking      print thinking deltas to stderr
  --json               emit raw AskEvent JSON lines on stdout
  -h, --help           show this help

In the loop:
  /new                 start a new session on the next question
  /session             show the current session id and model
  /exit, /quit         leave (Ctrl-D also works)
  Ctrl-C               while answering: cancel that answer
                       at the prompt: exit
`;

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === undefined || result === "" ? undefined : result;
}

/** Mirrors the daemon defaults so the CLI works without any flags. */
export function defaultAddress(env: NodeJS.ProcessEnv): string {
  const configuredHost = trimmed(env["PIWORK_HOST"]);
  const host =
    configuredHost === undefined || configuredHost === "0.0.0.0" || configuredHost === "::"
      ? DEFAULT_HOST
      : configuredHost;
  return `${host}:${trimmed(env["PIWORK_PORT"]) ?? DEFAULT_PORT}`;
}

function splitFlag(arg: string): { name: string | undefined; inlineValue: string | undefined } {
  if (!arg.startsWith("--")) return { name: undefined, inlineValue: undefined };
  const separator = arg.indexOf("=");
  if (separator === -1) return { name: arg, inlineValue: undefined };
  return { name: arg.slice(0, separator), inlineValue: arg.slice(separator + 1) };
}

export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv): CliOptions {
  const options: CliOptions = {
    command: "repl",
    address: defaultAddress(env),
    sessionId: undefined,
    cwd: undefined,
    showThinking: false,
    json: false,
    prompt: undefined,
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === "--help" || arg === "-h") {
      options.command = "help";
      return options;
    }
    if (arg === "--show-thinking") {
      options.showThinking = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const { name, inlineValue } = splitFlag(arg);
    if (name !== undefined) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined) throw new UsageError(`missing value for ${name}`);
      if (inlineValue === undefined) index += 1;
      if (name === "--addr") options.address = value;
      else if (name === "--session") options.sessionId = value;
      else if (name === "--cwd") options.cwd = value;
      else throw new UsageError(`unknown option ${name}`);
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option ${arg}`);
    positionals.push(arg);
  }

  const first = positionals[0];
  if (first !== undefined) {
    if (!COMMANDS.includes(first)) throw new UsageError(`unknown command "${first}"`);
    options.command = first as CliCommand;
    positionals.shift();
  }

  if (options.command === "ask") {
    if (positionals.length === 0) {
      throw new UsageError('ask requires a prompt, e.g. piwork-cli ask "what is gRPC?"');
    }
    options.prompt = positionals.join(" ");
  } else if (positionals.length > 0) {
    throw new UsageError(`unexpected argument "${positionals[0]}"`);
  }

  return options;
}
