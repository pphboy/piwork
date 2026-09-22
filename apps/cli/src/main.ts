#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  FileCredentialStore,
  PiworkApiError,
  PiworkClient,
  resolveCoreEndpoint,
  safeErrorMessage,
  type CredentialRecord,
} from "@piwork/client-sdk";

export const CLI_VERSION = "0.1.0";
export const CLI_USAGE = `usage: piwork-cli [--core <url>] [--json] <command>
  status
  login --account <name> [--password-stdin]
  whoami
  logout
  skills list
  skills show <skill-name>
  work create --name <name> [--base-image <image>] [--skill <skill-name>]... [--no-skills] [--agents-md-file <path>] [--config <file>] [--wait]
  work list
  work show <workId>
  work <start|stop|retry|delete> <workId> [--wait]
  work config show <workId>
  work config set <workId> --config <file>
  work config skills list <workId>
  work config skills set <workId> (--skill <skill-name>)... | --no-skills
  work config agents show <workId>
  work config agents set <workId> --file <path>
  work config apply <workId> [--idempotency-key <key>] [--wait]
  operation show <operationId>
  session create <workId>
  session list <workId>
  session show <workId> <sessionId>
  run show <workId> <runId>
  run watch <workId> <runId> [--after <sequence>]
  run cancel <workId> <runId>
  chat <workId> [--session <sessionId>] [--message <text>]
`;

const COMMAND_HELP: Readonly<Record<string, string>> = {
  status: "usage: piwork-cli status\n  Show Core health and readiness.\n",
  login: "usage: piwork-cli login --account <name> [--password-stdin]\n  Authenticate and save the credential locally.\n",
  whoami: "usage: piwork-cli whoami\n  Show the current authenticated identity.\n",
  logout: "usage: piwork-cli logout\n  Revoke the current session and remove the saved credential.\n",
  work: "usage: piwork-cli work <create|list|show|start|stop|retry|delete|config> ...\n  Manage Work resources and per-Work configuration.\n",
  skills: "usage: piwork-cli skills <list|show> [skill-name]\n  Discover enabled Skills available to the current user.\n",
  operation: "usage: piwork-cli operation show <operationId>\n  Inspect an asynchronous Work operation.\n",
  session: "usage: piwork-cli session <create|list|show> <workId> [sessionId]\n  Manage persistent conversation sessions.\n",
  run: "usage: piwork-cli run <show|watch|cancel> <workId> <runId> [options]\n  Inspect, stream, or cancel a Run.\n",
  chat: "usage: piwork-cli chat <workId> [--session <sessionId>] [--message <text>]\n  Send one prompt or start an interactive conversation.\n",
};

export function cliBanner(): string { return `piwork-cli ${CLI_VERSION}`; }

interface GlobalOptions { core?: string; json: boolean; rest: string[]; }
interface Context { readonly coreUrl: string; readonly json: boolean; readonly store: FileCredentialStore; readonly credential?: CredentialRecord; readonly client: PiworkClient; }

export async function runCli(argv: readonly string[]): Promise<number> {
  const globals = parseGlobals(argv);
  const [command, ...args] = globals.rest;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") { process.stdout.write(CLI_USAGE); return 0; }
  if (args.includes("--help") || args.includes("-h")) {
    const help = COMMAND_HELP[command];
    if (help === undefined) throw usage(`unknown command: ${command}`);
    process.stdout.write(help);
    return 0;
  }
  const store = new FileCredentialStore();
  const credential = await store.load();
  const coreUrl = resolveCoreEndpoint({ explicit: globals.core, environment: process.env.PIWORK_CORE_URL, saved: credential?.coreUrl });
  const context: Context = { coreUrl, json: globals.json, store, ...(credential === undefined ? {} : { credential }), client: new PiworkClient({ coreUrl, token: credential?.token }) };
  if (command === "status") return statusCommand(context, args);
  if (command === "login") return loginCommand(context, args);
  if (command === "whoami") return whoamiCommand(context, args);
  if (command === "logout") return logoutCommand(context, args);
  if (command === "skills") return skillsCommand(context, args);
  if (command === "work") return workCommand(context, args);
  if (command === "operation") return operationCommand(context, args);
  if (command === "session") return sessionCommand(context, args);
  if (command === "run") return runCommand(context, args);
  if (command === "chat") return chatCommand(context, args);
  throw usage(`unknown command: ${command}`);
}

async function statusCommand(context: Context, args: readonly string[]): Promise<number> {
  noArgs(args);
  const health = await context.client.health();
  let readiness: unknown;
  try { readiness = await context.client.readiness(); } catch (error) { if (error instanceof PiworkApiError && error.status === 503) readiness = error.details; else throw error; }
  output(context, { coreUrl: context.coreUrl, health, readiness });
  return (readiness as { ready?: unknown; status?: unknown }).ready === true || (readiness as { status?: unknown }).status === "ready" ? 0 : 5;
}

async function loginCommand(context: Context, args: readonly string[]): Promise<number> {
  known(args, ["--account", "--password-stdin"]);
  const account = required(args, "--account");
  const password = await secret(args.includes("--password-stdin"), "Password: ");
  const client = new PiworkClient({ coreUrl: context.coreUrl });
  const result = await client.login(account, password);
  await context.store.save({ version: 1, coreUrl: context.coreUrl, token: result.token, expiresAt: result.expiresAt, user: result.user });
  output(context, { user: result.user, expiresAt: result.expiresAt, coreUrl: context.coreUrl });
  return 0;
}

async function whoamiCommand(context: Context, args: readonly string[]): Promise<number> {
  noArgs(args); requireCredential(context); output(context, await context.client.me()); return 0;
}

async function logoutCommand(context: Context, args: readonly string[]): Promise<number> {
  noArgs(args);
  if (context.credential !== undefined) { try { await context.client.logout(); } finally { await context.store.clear(); } } else await context.store.clear();
  output(context, { loggedOut: true });
  return 0;
}

async function skillsCommand(context: Context, args: readonly string[]): Promise<number> {
  requireCredential(context);
  if (args[0] === "list") { noArgs(args.slice(1)); output(context, await context.client.skills()); return 0; }
  if (args[0] === "show") { exact(args.slice(1), 1); output(context, await context.client.skill(args[1]!)); return 0; }
  throw usage("skills requires list or show");
}

async function workCommand(context: Context, args: readonly string[]): Promise<number> {
  requireCredential(context);
  const [action, ...rest] = args;
  if (action === "list") { noArgs(rest); output(context, await context.client.works()); return 0; }
  if (action === "show") { exact(rest, 1); output(context, await context.client.work(rest[0]!)); return 0; }
  if (action === "create") {
    known(rest, ["--name", "--config", "--wait", "--idempotency-key", "--base-image", "--skill", "--no-skills", "--agents-md-file"]);
    const name = required(rest, "--name");
    const configPath = optional(rest, "--config");
    const configuration = configPath === undefined ? undefined : JSON.parse(readFileSync(configPath, "utf8"));
    const selectedSkills = parseSkillSelection(rest, false);
    const agentsFile = optional(rest, "--agents-md-file");
    const accepted = await context.client.createWork({ name, ...(configuration === undefined ? {} : { configuration }), ...(optional(rest, "--base-image") === undefined ? {} : { baseImage: optional(rest, "--base-image") }), ...(selectedSkills === undefined ? {} : { skills: selectedSkills }), ...(agentsFile === undefined ? {} : { agentsMd: readFileSync(agentsFile, "utf8") }), idempotencyKey: optional(rest, "--idempotency-key") ?? randomUUID() });
    if (rest.includes("--wait")) {
      if (!context.json) output(context, accepted);
      await waitOperation(context, accepted);
    } else output(context, accepted);
    return 0;
  }
  if (action === "config") {
    const [configAction, ...configArgs] = rest;
    if (configAction === "skills") {
      const [sub, workId, ...options] = configArgs;
      if (workId === undefined || workId.startsWith("--")) throw usage("work config skills requires <workId>");
      if (sub === "list") { noArgs(options); outputConfiguration(context, await context.client.workSkills(workId)); return 0; }
      if (sub === "set") { known(options, ["--skill", "--no-skills"]); const selected = parseSkillSelection(options, true)!; outputConfiguration(context, await context.client.updateWorkSkills(workId, selected), true); return 0; }
      throw usage("work config skills requires list or set");
    }
    if (configAction === "agents") {
      const [sub, workId, ...options] = configArgs;
      if (workId === undefined || workId.startsWith("--")) throw usage("work config agents requires <workId>");
      if (sub === "show") { noArgs(options); output(context, await context.client.workAgents(workId)); return 0; }
      if (sub === "set") { known(options, ["--file"]); outputConfiguration(context, await context.client.updateWorkAgents(workId, readFileSync(required(options, "--file"), "utf8")), true); return 0; }
      throw usage("work config agents requires show or set");
    }
    const [workId, ...options] = configArgs;
    if (workId === undefined || workId.startsWith("--")) throw usage("work config requires <workId>");
    if (configAction === "show") { noArgs(options); outputConfiguration(context, await context.client.workConfiguration(workId)); return 0; }
    if (configAction === "set") {
      known(options, ["--config"]);
      const configuration = JSON.parse(readFileSync(required(options, "--config"), "utf8"));
      outputConfiguration(context, await context.client.updateWorkConfiguration(workId, configuration), true);
      return 0;
    }
    if (configAction === "apply") {
      known(options, ["--wait", "--idempotency-key"]);
      const accepted = await context.client.applyWorkConfiguration(workId, optional(options, "--idempotency-key") ?? randomUUID());
      if (options.includes("--wait")) {
        if (!context.json) output(context, accepted);
        await waitOperation(context, accepted);
      } else output(context, accepted);
      return 0;
    }
    throw usage("work config requires show, set, or apply");
  }
  if (action === "start" || action === "stop" || action === "retry" || action === "delete") {
    known(rest.slice(1), ["--wait", "--idempotency-key"]);
    const workId = rest[0]; if (workId === undefined || workId.startsWith("--")) throw usage(`work ${action} requires <workId>`);
    const accepted = await context.client.workAction(workId, action, optional(rest.slice(1), "--idempotency-key") ?? randomUUID());
    if (rest.includes("--wait")) {
      if (!context.json) output(context, accepted);
      await waitOperation(context, accepted);
    } else output(context, accepted);
    return 0;
  }
  throw usage("work requires create, list, show, start, stop, retry, delete, or config");
}

function repeated(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === name) {
    const value = args[index + 1]; if (value === undefined || value.startsWith("--")) throw usage(`${name} requires a value`); values.push(value); index += 1;
  }
  return values;
}

export function parseSkillSelection(args: readonly string[], requiredSelection: boolean): string[] | undefined {
  const skills = repeated(args, "--skill");
  const noSkillsCount = args.filter((value) => value === "--no-skills").length;
  if (noSkillsCount > 1) throw usage("--no-skills may be specified only once");
  if (skills.length > 0 && noSkillsCount === 1) throw usage("--skill and --no-skills are mutually exclusive");
  if (new Set(skills).size !== skills.length) throw usage("--skill may not be repeated");
  if (noSkillsCount === 1) return [];
  if (skills.length > 0) return skills;
  if (requiredSelection) throw usage("select at least one --skill or use --no-skills");
  return undefined;
}

async function operationCommand(context: Context, args: readonly string[]): Promise<number> {
  requireCredential(context); if (args[0] !== "show") throw usage("operation requires show"); exact(args.slice(1), 1); outputOperation(context, await context.client.operation(args[1]!)); return 0;
}

async function sessionCommand(context: Context, args: readonly string[]): Promise<number> {
  requireCredential(context);
  const [action, workId, sessionId, ...extra] = args;
  if (workId === undefined) throw usage("session command requires <workId>");
  if (action === "create") { if (sessionId !== undefined) throw usage("session create accepts only <workId>"); output(context, await context.client.createSession(workId, randomUUID())); return 0; }
  if (action === "list") { if (sessionId !== undefined) throw usage("session list accepts only <workId>"); output(context, await context.client.sessions(workId)); return 0; }
  if (action === "show") { if (sessionId === undefined || extra.length > 0) throw usage("session show requires <workId> <sessionId>"); output(context, await context.client.session(workId, sessionId)); return 0; }
  throw usage("session requires create, list, or show");
}

async function runCommand(context: Context, args: readonly string[]): Promise<number> {
  requireCredential(context);
  const [action, workId, runId, ...rest] = args;
  if (workId === undefined || runId === undefined) throw usage("run command requires <workId> <runId>");
  if (action === "show") { noArgs(rest); output(context, await context.client.getRun(workId, runId)); return 0; }
  if (action === "cancel") { noArgs(rest); output(context, await context.client.cancelRun(workId, runId, randomUUID())); return 0; }
  if (action === "watch") { known(rest, ["--after"]); await renderEvents(context, workId, runId, Number(optional(rest, "--after") ?? "0")); return 0; }
  throw usage("run requires show, watch, or cancel");
}

async function chatCommand(context: Context, args: readonly string[]): Promise<number> {
  requireCredential(context);
  const workId = args[0]; if (workId === undefined || workId.startsWith("--")) throw usage("chat requires <workId>");
  const options = args.slice(1); known(options, ["--session", "--message"]);
  let sessionId = optional(options, "--session");
  if (sessionId === undefined) {
    const created = await context.client.createSession(workId, randomUUID());
    sessionId = String(created.sessionId);
    streamOutput(context, { type: "session", workId, sessionId });
  }
  const oneMessage = optional(options, "--message");
  if (oneMessage !== undefined) return submitChat(context, workId, sessionId, oneMessage);
  if (!process.stdin.isTTY) throw usage("interactive chat requires a terminal or --message");
  const { createInterface } = await import("node:readline/promises");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const message = await terminal.question("> ").catch(() => "");
      if (message === "") break;
      const code = await submitChat(context, workId, sessionId, message);
      if (code !== 0) return code;
    }
  } finally { terminal.close(); }
  return 0;
}

async function submitChat(context: Context, workId: string, sessionId: string, prompt: string): Promise<number> {
  const submissionKey = randomUUID();
  const submitted = await context.client.submitRun(workId, { sessionId, submissionKey, prompt });
  const runId = String(submitted.run?.runId);
  streamOutput(context, { type: "run", workId, sessionId, runId });
  const abort = new AbortController();
  let cancelling = false;
  const onInterrupt = () => {
    if (cancelling) return;
    cancelling = true;
    void context.client.cancelRun(workId, runId, `cancel-${submissionKey}`).catch(() => undefined).finally(() => abort.abort());
  };
  process.once("SIGINT", onInterrupt);
  try {
    try {
      await renderEvents(context, workId, runId, 0, true, abort.signal, () => cancelling);
    } catch (error) {
      if (!cancelling) throw error;
    }
  } finally {
    process.off("SIGINT", onInterrupt);
  }
  if (cancelling) await waitRunTerminal(context, workId, runId);
  const result = await context.client.getRun(workId, runId);
  if (["RUN_STATE_FAILED", "RUN_STATE_CANCELLED", "RUN_STATE_INTERRUPTED", 5, 6, 7].includes(result.state as never)) {
    if (context.json) streamOutput(context, { type: "run-terminal", ...result });
    else process.stderr.write(`${formatTerminalRunFailure(workId, runId, result)}\n`);
    return 7;
  }
  return 0;
}

export function formatTerminalRunFailure(
  workId: string,
  runId: string,
  result: { readonly state?: unknown; readonly error?: { readonly code?: unknown; readonly message?: unknown; readonly retryable?: unknown } },
): string {
  const error = result.error;
  return [
    `Run: ${runId}`,
    `State: ${runStateName(result.state)}`,
    ...(error === undefined ? [] : [
      `Code: ${typeof error.code === "string" ? error.code : "RUN_FAILED"}`,
      `Reason: ${typeof error.message === "string" ? error.message : "Run failed."}`,
      `Retryable: ${error.retryable === true ? "yes" : "no"}`,
    ]),
    `Inspect: piwork-cli run show ${workId} ${runId}`,
  ].join("\n");
}

function runStateName(state: unknown): string {
  if (state === 5 || state === "RUN_STATE_FAILED") return "failed";
  if (state === 6 || state === "RUN_STATE_CANCELLED") return "cancelled";
  if (state === 7 || state === "RUN_STATE_INTERRUPTED") return "interrupted";
  return String(state ?? "unknown");
}

async function renderEvents(context: Context, workId: string, runId: string, after: number, chat = false, signal?: AbortSignal, interrupted?: () => boolean): Promise<void> {
  let cursor = after;
  try {
    const watchRun = context.client.watchRun.bind(context.client) as unknown as (workId: string, runId: string, after: number, signal?: AbortSignal) => AsyncGenerator<Record<string, unknown>>;
    for await (const event of watchRun(workId, runId, after, signal)) {
      cursor = Number(event.sequence);
      if (context.json || !chat) streamOutput(context, event);
      else {
        const kind = event.kind as { $case?: string; text?: { delta?: string } } | undefined;
        if (kind?.$case === "text") process.stdout.write(kind.text?.delta ?? "");
      }
    }
    if (chat && !context.json) process.stdout.write("\n");
  } catch (error) {
    if (!interrupted?.()) process.stderr.write(`Run stream disconnected. Resume with: piwork-cli run watch ${workId} ${runId} --after ${cursor}\n`);
    throw error;
  }
}

async function waitRunTerminal(context: Context, workId: string, runId: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const run = await context.client.getRun(workId, runId);
    if (["RUN_STATE_SUCCEEDED", "RUN_STATE_FAILED", "RUN_STATE_CANCELLED", "RUN_STATE_INTERRUPTED", 4, 5, 6, 7].includes(run.state as never)) return;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitOperation(context: Context, accepted: { readonly workId: string; readonly operationId: string }): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    let operation: Record<string, unknown>;
    try {
      operation = await context.client.operation(accepted.operationId);
    } catch {
      const waiting = waitingEnvelope(accepted, "OPERATION_OBSERVATION_UNAVAILABLE", "Operation observation is unavailable; query it again with operation show.");
      if (context.json) output(context, waiting);
      throw Object.assign(new Error(`Work ID: ${accepted.workId}\nOperation ID: ${accepted.operationId}\nObservation unavailable. Retry: piwork-cli operation show ${accepted.operationId}`), { exitCode: 5 });
    }
    const state = String(operation.state);
    if (state === "succeeded") { outputOperation(context, operation); return; }
    if (state === "failed" || state === "superseded") {
      outputOperation(context, operation);
      const error = operation.error as { stage?: unknown; code?: unknown; message?: unknown; remediation?: unknown } | null;
      throw Object.assign(new Error([
        `Work ID: ${accepted.workId}`,
        `Operation ID: ${accepted.operationId}`,
        `Stage: ${typeof error?.stage === "string" ? error.stage : "unknown"}`,
        `Code: ${typeof error?.code === "string" ? error.code : state.toUpperCase()}`,
        `Reason: ${typeof error?.message === "string" ? error.message : `Work operation ${state}.`}`,
        `Remediation: ${typeof error?.remediation === "string" ? error.remediation : "Inspect the retained Operation."}`,
        `Inspect: piwork-cli operation show ${accepted.operationId}`,
      ].join("\n")), { exitCode: 6 });
    }
    if (Date.now() >= deadline) {
      const waiting = waitingEnvelope(accepted, "OPERATION_WAIT_TIMEOUT", "Timed out waiting; the Operation remains queryable and was not resubmitted.");
      if (context.json) output(context, waiting);
      throw Object.assign(new Error(`Work ID: ${accepted.workId}\nOperation ID: ${accepted.operationId}\nTimed out without resubmitting. Inspect: piwork-cli operation show ${accepted.operationId}`), { exitCode: 5 });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function waitingEnvelope(accepted: { readonly workId: string; readonly operationId: string }, code: string, message: string) {
  return { ...accepted, correlationId: accepted.operationId, state: "waiting", result: null, error: { code, message }, diagnostics: null };
}

function parseGlobals(argv: readonly string[]): GlobalOptions {
  let core: string | undefined; let json = false; let index = 0;
  while (index < argv.length) {
    if (argv[index] === "--json") { json = true; index += 1; continue; }
    if (argv[index] === "--core") { if (core !== undefined) throw usage("--core may be specified only once"); core = argv[index + 1]; if (core === undefined || core.startsWith("--")) throw usage("--core requires a value"); index += 2; continue; }
    break;
  }
  return { ...(core === undefined ? {} : { core }), json, rest: [...argv.slice(index)] };
}
function known(args: readonly string[], names: readonly string[]): void { const boolean = new Set(["--wait", "--password-stdin", "--no-skills"]); for (let index = 0; index < args.length; index += 1) { const value = args[index]!; if (!value.startsWith("--") || !names.includes(value)) throw usage(`unknown option: ${value}`); if (!boolean.has(value)) { if (args[index + 1] === undefined || args[index +1]!.startsWith("--")) throw usage(`${value} requires a value`); index += 1; } } }
function optional(args: readonly string[], name: string): string | undefined { const indexes = args.flatMap((value, index) => value === name ? [index] : []); if (indexes.length > 1) throw usage(`${name} may be specified only once`); const index = indexes[0]; return index === undefined ? undefined : args[index + 1]; }
function required(args: readonly string[], name: string): string { const value = optional(args, name); if (value === undefined) throw usage(`${name} is required`); return value; }
function positiveInteger(value: string, name: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw usage(`${name} must be a positive integer`); return parsed; }
function exact(args: readonly string[], count: number): void { if (args.length !== count) throw usage("unexpected arguments"); }
function noArgs(args: readonly string[]): void { exact(args, 0); }
function usage(message: string): Error { return Object.assign(new Error(message), { exitCode: 2 }); }
function requireCredential(context: Context): void { if (context.credential === undefined) throw Object.assign(new Error("not logged in; run piwork-cli login"), { exitCode: 3 }); }
function output(context: Context, value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, context.json ? 0 : 2)}\n`); }
function outputOperation(context: Context, value: Record<string, unknown>): void {
  if (context.json) return output(context, value);
  const error = value.error as { stage?: unknown; code?: unknown; message?: unknown; remediation?: unknown } | null;
  process.stdout.write([
    `Work: ${String(value.workId ?? "unknown")}`,
    `Operation: ${String(value.operationId ?? "unknown")}`,
    `State: ${String(value.state ?? "unknown")}`,
    ...(error === null || error === undefined ? [] : [
      `Stage: ${String(error.stage ?? "unknown")}`,
      `Code: ${String(error.code ?? "unknown")}`,
      `Reason: ${String(error.message ?? "Operation failed")}`,
      `Remediation: ${String(error.remediation ?? "Inspect the Operation")}`,
    ]),
  ].join("\n") + "\n");
}
function outputConfiguration(context: Context, value: Record<string, unknown>, saved = false): void {
  if (context.json) return output(context, value);
  const desired = (value.desired ?? value.skills) as { skills?: unknown } | unknown[] | undefined;
  const active = value.active as { skills?: unknown } | unknown[] | null | undefined;
  const desiredSkills = Array.isArray(desired) ? desired : Array.isArray(desired?.skills) ? desired.skills : [];
  const activeSkills = Array.isArray(active) ? active : Array.isArray(active?.skills) ? active.skills : [];
  const runtime = value.runtime as { state?: unknown; skills?: unknown[] } | undefined;
  process.stdout.write([
    ...(saved ? ["Desired configuration saved. It remains pending until work config apply succeeds."] : []),
    `Work: ${String(value.workId ?? "")}`,
    `Desired Skills: ${desiredSkills.length === 0 ? "(none)" : desiredSkills.join(", ")}`,
    `Active Skills: ${activeSkills.length === 0 ? "(none)" : activeSkills.join(", ")}`,
    `Pending apply: ${value.pendingApply === true ? "yes" : "no"}`,
    `Runtime: ${String(runtime?.state ?? "unavailable")}`,
    `Loaded Skills: ${Array.isArray(runtime?.skills) && runtime.skills.length > 0 ? runtime.skills.map((item) => String((item as { name?: unknown }).name ?? "")).join(", ") : "(none)"}`,
  ].join("\n") + "\n");
}
function streamOutput(_context: Context, value: unknown): void { process.stdout.write(`${JSON.stringify(value)}\n`); }
async function secret(stdinMode: boolean, prompt: string): Promise<string> {
  if (stdinMode) { const value = readFileSync(0, "utf8").replace(/[\r\n]+$/, ""); if (value === "") throw new Error("password must not be empty"); return value; }
  if (!process.stdin.isTTY || !process.stderr.isTTY || typeof process.stdin.setRawMode !== "function") throw usage("interactive password input requires a terminal; use --password-stdin");
  process.stderr.write(prompt); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8"); let value = "";
  try { return await new Promise<string>((resolve, reject) => { const data = (chunk: string) => { for (const character of chunk) { if (character === "\n" || character === "\r") { cleanup(); process.stderr.write("\n"); value === "" ? reject(new Error("password must not be empty")) : resolve(value); } else if (character === "\u0003") { cleanup(); reject(new Error("password input cancelled")); } else if (character === "\u007f") value = value.slice(0, -1); else if (character >= " ") value += character; } }; const end = () => { cleanup(); reject(new Error("password input ended")); }; const cleanup = () => { process.stdin.off("data", data); process.stdin.off("end", end); }; process.stdin.on("data", data); process.stdin.once("end", end); }); }
  finally { process.stdin.setRawMode(false); process.stdin.pause(); }
}

export function exitCodeFor(error: unknown): number {
  const explicit = (error as { exitCode?: unknown }).exitCode; if (typeof explicit === "number") return explicit;
  if (error instanceof PiworkApiError) { if (error.status === 401 || error.status === 403) return 3; if (error.status === 404) return 4; if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) return 5; if (error.status === 409) return 6; }
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = exitCodeFor(error); });
}
