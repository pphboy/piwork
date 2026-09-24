import { randomUUID } from "node:crypto";
import { safeErrorMessage, type AcceptedServiceOperation, type PiworkClient, type WorkServiceAction } from "@piwork/client-sdk";

export const WORK_SERVICE_USAGE = `usage: piwork-cli [--core <url>] [--json] work service <command>
  list <workId>
  show <workId> <serviceId>
  start <workId> <serviceId> [--wait] [--idempotency-key <key>]
  stop <workId> <serviceId> [--wait] [--idempotency-key <key>]
  restart <workId> <serviceId> [--wait] [--idempotency-key <key>]
  retry <workId> <serviceId> [--wait] [--idempotency-key <key>]
  remove <workId> <serviceId> [--wait] [--idempotency-key <key>]
  logs <workId> <serviceId> [--tail <lines>]

Use IDs from list; service names are not resolved.
Start persistently enables a service; a stopped Work stays stopped until work start.
Stop persistently disables a service, including across Work restarts.
Restart requires an enabled service and a running Work.
Retry reconciles the saved definition and resets its recovery budget.
Remove does not prompt and preserves shared workspace data; start cannot undo removal.
Logs are owner-only, default to 100 lines, and accept 1 through 200; no follow mode.
Wait observes for up to 120 seconds without cancelling the Operation.
Inspect a retained result with: piwork-cli operation show <operationId>
Service creation and definition updates belong to pi-agentd.
`;

const mutations = { start: "enable", stop: "disable", restart: "restart", retry: "retry", remove: "remove" } as const satisfies Record<string, WorkServiceAction>;
type Mutation = keyof typeof mutations;
const actions = new Set(["list", "show", "logs", ...Object.keys(mutations)]);

export type WorkServiceCommand =
  | { readonly kind: "help" }
  | { readonly kind: "list"; readonly workId: string }
  | { readonly kind: "show"; readonly workId: string; readonly serviceId: string }
  | { readonly kind: "logs"; readonly workId: string; readonly serviceId: string; readonly tail: number }
  | { readonly kind: "mutation"; readonly action: Mutation; readonly workId: string; readonly serviceId: string; readonly wait: boolean; readonly idempotencyKey?: string };

export function parseWorkServiceCommand(args: readonly string[]): WorkServiceCommand {
  const action = args[0];
  if (args.length === 1 && (action === "--help" || action === "-h")) return { kind: "help" };
  if (action === undefined || !actions.has(action)) throw usage("work service requires a supported command");
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  const workId = id(args[1], "workId");
  const serviceId = action === "list" ? undefined : id(args[2], "serviceId");
  const options = args.slice(action === "list" ? 2 : 3);
  const allowed = action === "logs" ? ["--tail"] : action === "list" || action === "show" ? [] : ["--wait", "--idempotency-key"];
  const values = new Map<string, string | true>();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]!;
    if (!allowed.includes(option)) throw usage("unknown option or unexpected argument");
    if (values.has(option)) throw usage(`${option} may be specified only once`);
    if (option === "--wait") { values.set(option, true); continue; }
    const value = options[++index];
    if (value === undefined || value.startsWith("--") || value.trim() === "") throw usage(`${option} requires a nonempty value`);
    values.set(option, value);
  }
  if (action === "list") return { kind: "list", workId };
  if (action === "show") return { kind: "show", workId, serviceId: serviceId! };
  if (action === "logs") {
    const value = values.get("--tail") ?? "100";
    const tail = Number(value);
    if (typeof value !== "string" || !/^[0-9]+$/.test(value) || !Number.isSafeInteger(tail) || tail < 1 || tail > 200) throw usage("--tail must be an integer from 1 through 200");
    return { kind: "logs", workId, serviceId: serviceId!, tail };
  }
  const key = values.get("--idempotency-key") as string | undefined;
  return { kind: "mutation", action: action as Mutation, workId, serviceId: serviceId!, wait: values.has("--wait"), ...(key === undefined ? {} : { idempotencyKey: key }) };
}

function id(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "" || value.startsWith("-") || value.includes("\0")) throw usage(`work service requires <${name}> as a nonempty ID`);
  return value;
}
function usage(message: string): Error { return Object.assign(new Error(`${message}\n${WORK_SERVICE_USAGE}`), { exitCode: 2 }); }

export interface ServiceTiming {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  deadline(callback: () => void, milliseconds: number): () => void;
}
const timing: ServiceTiming = {
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  deadline: (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); },
};
interface ServiceContext {
  readonly client: Pick<PiworkClient, "workServices" | "workService" | "workServiceLogs" | "workServiceAction" | "operation">;
  readonly json: boolean;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly timing?: ServiceTiming;
}

export async function executeWorkServiceCommand(context: ServiceContext, command: WorkServiceCommand): Promise<number> {
  if (command.kind === "help") { context.stdout(WORK_SERVICE_USAGE); return 0; }
  if (command.kind === "list") { output(context, await context.client.workServices(command.workId)); return 0; }
  if (command.kind === "show") { output(context, await context.client.workService(command.workId, command.serviceId)); return 0; }
  if (command.kind === "logs") {
    const logs = await context.client.workServiceLogs(command.workId, command.serviceId, command.tail);
    if (context.json) output(context, {
      workId: command.workId, serviceId: logs.serviceId, status: logs.status,
      text: logs.text, truncated: logs.truncated, collectedAt: logs.collectedAt,
      ...(logs.reason === undefined ? {} : { reason: logs.reason }),
    });
    else if (logs.status === "unavailable") context.stderr(`${safeErrorMessage(new Error(logs.reason ?? "Service logs are unavailable."))}\n`);
    else {
      if (logs.text !== "") context.stdout(logs.text.endsWith("\n") ? logs.text : `${logs.text}\n`);
      if (logs.truncated) context.stderr("Service logs are truncated.\n");
    }
    return logs.status === "unavailable" ? 5 : 0;
  }
  const response = await context.client.workServiceAction(command.workId, command.serviceId, mutations[command.action], command.idempotencyKey ?? randomUUID());
  const accepted: AcceptedServiceOperation = {
    workId: response.workId, serviceId: response.serviceId, operationId: response.operationId,
    correlationId: response.correlationId, reused: response.reused,
  };
  if (!command.wait) { output(context, accepted); return 0; }
  // Start the observation clock at acceptance, before emitting text output.
  const clock = context.timing ?? timing;
  const acceptedAt = clock.now();
  if (!context.json) output(context, accepted);
  const result = await observeServiceOperation(context.client, accepted, clock, acceptedAt);
  if (context.json) output(context, result.value);
  else outputServiceOperation(context, result.value);
  return result.exitCode;
}

export async function observeServiceOperation(
  client: Pick<PiworkClient, "operation">,
  accepted: AcceptedServiceOperation,
  clock: ServiceTiming = timing,
  acceptedAt = clock.now(),
): Promise<{ value: Record<string, unknown>; exitCode: number }> {
  const deadline = acceptedAt + 120_000;
  const controller = new AbortController();
  const clearDeadline = clock.deadline(() => controller.abort(), Math.max(0, deadline - clock.now()));
  const expired = () => controller.signal.aborted || clock.now() >= deadline;
  const waiting = () => ({
    exitCode: 5,
    value: {
      ...accepted, state: "waiting", result: null, diagnostics: null,
      error: {
        code: expired() ? "OPERATION_WAIT_TIMEOUT" : "OPERATION_OBSERVATION_UNAVAILABLE",
        message: `Operation observation ${expired() ? "timed out" : "is unavailable"}; inspect with piwork-cli operation show ${accepted.operationId}.`,
      },
    },
  });
  try {
    for (;;) {
      if (expired()) return waiting();
      let operation: Record<string, unknown>;
      try {
        operation = await client.operation(accepted.operationId, { signal: controller.signal });
        if (!validOperation(operation, accepted)) return waiting();
      } catch { return waiting(); }
      if (expired()) return waiting();
      if (operation.state === "succeeded" || operation.state === "failed" || operation.state === "superseded") {
        return { value: { ...operation, serviceId: accepted.serviceId }, exitCode: operation.state === "succeeded" ? 0 : 6 };
      }
      await clock.sleep(Math.min(250, deadline - clock.now()));
    }
  } finally { clearDeadline(); }
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validOperation(value: unknown, accepted: AcceptedServiceOperation): value is Record<string, unknown> {
  if (!object(value)) return false;
  return value.operationId === accepted.operationId && value.workId === accepted.workId
    && typeof value.state === "string" && ["pending", "running", "succeeded", "failed", "superseded"].includes(value.state)
    && ["correlationId", "kind", "createdAt", "updatedAt"].every((key) => typeof value[key] === "string")
    && (value.result === null || object(value.result))
    && (value.error === null || object(value.error)) && object(value.diagnostics);
}
function output(context: ServiceContext, value: unknown): void { context.stdout(`${JSON.stringify(value, null, context.json ? 0 : 2)}\n`); }
function outputServiceOperation(context: ServiceContext, value: Record<string, unknown>): void {
  const error = object(value.error) ? value.error : undefined;
  const field = (name: string, fallback: string) => typeof error?.[name] === "string" ? String(error[name]) : fallback;
  context.stdout(safeErrorMessage(new Error([
    `Work ID: ${String(value.workId)}`, `Service ID: ${String(value.serviceId)}`,
    `Operation ID: ${String(value.operationId)}`, `State: ${String(value.state)}`,
    ...(error === undefined && value.state !== "failed" && value.state !== "superseded" ? [] : [
      `Stage: ${field("stage", "unknown")}`, `Code: ${field("code", "unknown")}`,
      `Reason: ${field("message", "unknown")}`, `Remediation: ${field("remediation", "Inspect the Operation")}`,
    ]),
    `Inspect: piwork-cli operation show ${String(value.operationId)}`,
  ].join("\n"))) + "\n");
}
