import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { ResourceIdSchema } from "@piwork/contracts";
import { PiworkClient } from "@piwork/client-sdk";
import { inspectWorkPackage, WORK_PACKAGE_LIMITS } from "@piwork/work-package";
import { Check } from "typebox/value";

export const WORK_SNAPSHOT_USAGE = `usage:
  piwork-cli work export <workId> [--output <file>] [--idempotency-key <key>]
  piwork-cli work snapshot download <snapshotId> --output <file>
  piwork-cli work package inspect <file>
  piwork-cli work import <file> [--name <name>] [--wait] [--idempotency-key <key>]
`;
export type WorkSnapshotCommand =
  | { readonly kind: "help" }
  | { readonly kind: "inspect"; readonly path: string }
  | { readonly kind: "export"; readonly workId: string; readonly output: string; readonly idempotencyKey: string }
  | { readonly kind: "download"; readonly snapshotId: string; readonly output: string }
  | { readonly kind: "import"; readonly path: string; readonly name?: string; readonly wait: boolean; readonly idempotencyKey: string };

function syntax(message: string): never { throw Object.assign(new Error(message), { exitCode: 2 }); }
function value(input: string | undefined, field: string): string {
  if (input === undefined || input === "-" || input.trim() === "" || input.includes("\0") || input.startsWith("--")) syntax(`${field} requires a non-empty value`);
  return input;
}
function options(args: readonly string[], allowed: readonly string[], switches: readonly string[] = []): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index]!;
    if (!allowed.includes(name) && !switches.includes(name)) syntax(`unknown option: ${name}`);
    if (parsed.has(name)) syntax(`${name} may be specified only once`);
    if (switches.includes(name)) parsed.set(name, true);
    else parsed.set(name, value(args[++index], name));
  }
  return parsed;
}
function option(parsed: Map<string, string | true>, name: string): string | undefined {
  const found = parsed.get(name);
  return typeof found === "string" ? found : undefined;
}

/** Returns undefined for ordinary Work commands; all snapshot syntax is resolved before credential loading. */
export function parseWorkSnapshotCommand(args: readonly string[]): WorkSnapshotCommand | undefined {
  const [action, noun, ...rest] = args;
  if (!["export", "snapshot", "package", "import"].includes(action ?? "")) return undefined;
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  if (action === "export") {
    const parsed = options(rest, ["--output", "--idempotency-key"]);
    const workId = value(noun, "workId");
    if (!Check(ResourceIdSchema, workId)) syntax("workId is invalid");
    return { kind: "export", workId, output: option(parsed, "--output") ?? `${workId}.work`,
      idempotencyKey: option(parsed, "--idempotency-key") ?? randomUUID() };
  }
  if (action === "snapshot") {
    if (noun !== "download") syntax("work snapshot requires download");
    const [snapshotId, ...tail] = rest, parsed = options(tail, ["--output"]);
    return { kind: "download", snapshotId: value(snapshotId, "snapshotId"), output: value(option(parsed, "--output"), "--output") };
  }
  if (action === "package") {
    if (noun !== "inspect") syntax("work package requires inspect");
    if (rest.length !== 1) syntax("work package inspect requires one file");
    return { kind: "inspect", path: value(rest[0], "file") };
  }
  const parsed = options(rest, ["--name", "--idempotency-key"], ["--wait"]);
  return { kind: "import", path: value(noun, "file"),
    ...(option(parsed, "--name") === undefined ? {} : { name: option(parsed, "--name") }),
    wait: parsed.has("--wait"), idempotencyKey: option(parsed, "--idempotency-key") ?? randomUUID() };
}

interface CommandContext { readonly client: PiworkClient; readonly json: boolean; readonly stdout: (text: string) => void; readonly stderr: (text: string) => void }
function output(context: CommandContext, result: unknown): void { context.stdout(`${JSON.stringify(result, null, context.json ? 0 : 2)}\n`); }
function warning(context: CommandContext): void {
  context.stderr("Warning: a Work package contains the complete private Work, including code, configuration, data and possibly credentials. Import does not execute or start it.\n");
}
function sameFile(before: Awaited<ReturnType<FileHandle["stat"]>>, after: Awaited<ReturnType<FileHandle["stat"]>>): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
async function openInput(path: string): Promise<FileHandle> {
  const descriptor = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  if (!(await descriptor.stat()).isFile()) { await descriptor.close(); syntax("input must be a regular file"); }
  return descriptor;
}
async function destination(path: string): Promise<{ path: string; directory: FileHandle; anchored: string }> {
  value(path, "--output");
  const target = resolve(path), parent = dirname(target);
  let current = isAbsolute(parent) ? sep : "";
  for (const part of parent.split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) syntax("output parent must be a real directory without symlinks");
  }
  if (await realpath(parent) !== parent) syntax("output parent must not contain symlinks");
  try { await lstat(target); syntax("output already exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  return { path: target, directory, anchored: `/proc/self/fd/${directory.fd}/${basename(target)}` };
}
async function saveDownload(context: CommandContext, snapshotId: string, outputPath: string, expectedDigest: string, expectedSize: number): Promise<string> {
  const target = await destination(outputPath), temporary = `/proc/self/fd/${target.directory.fd}/.piwork-${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  let published = false;
  try {
    const downloaded = await context.client.downloadWorkSnapshot(snapshotId, { signal: AbortSignal.timeout(30 * 60_000) });
    if (downloaded.digest !== expectedDigest || downloaded.size !== expectedSize) throw new Error("download metadata does not match the snapshot");
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of downloaded.stream) {
      size += chunk.length;
      if (size > downloaded.size || size > WORK_PACKAGE_LIMITS.packageBytes) throw new Error("download exceeded declared size");
      hash.update(chunk);
      for (let offset = 0; offset < chunk.length;) { const written = await file.write(chunk, offset); if (!written.bytesWritten) throw new Error("download write failed"); offset += written.bytesWritten; }
    }
    if (size !== downloaded.size || hash.digest("hex") !== downloaded.digest) throw new Error("download digest mismatch");
    await file.sync();
    const verified = await inspectWorkPackage(file.createReadStream({ start: 0, autoClose: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }));
    if (verified.digest !== downloaded.digest || verified.size !== downloaded.size) throw new Error("downloaded package verification failed");
    await link(temporary, target.anchored); published = true;
    await unlink(temporary); await target.directory.sync();
    return target.path;
  } finally {
    await file.close();
    if (!published) await unlink(temporary).catch(() => undefined);
    await target.directory.close();
  }
}
async function observe(context: CommandContext, accepted: { workId: string; operationId: string; snapshotId?: string }): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    let operation: Record<string, unknown>;
    try { operation = await context.client.operation(accepted.operationId, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) }); }
    catch {
      const waiting = { ...accepted, state: "waiting", error: { code: "OPERATION_OBSERVATION_UNAVAILABLE", message: "Query the retained Operation again." } };
      if (context.json) output(context, waiting);
      throw Object.assign(new Error(`Work ID: ${accepted.workId}\nOperation ID: ${accepted.operationId}\nResume: piwork-cli operation show ${accepted.operationId}${accepted.snapshotId ? `; piwork-cli work snapshot download ${accepted.snapshotId} --output <file>` : ""}`), { exitCode: 5 });
    }
    if (operation.state === "succeeded") return operation;
    if (operation.state === "failed" || operation.state === "superseded") {
      output(context, operation);
      throw Object.assign(new Error(`Work ID: ${accepted.workId}\nOperation ID: ${accepted.operationId}\nSnapshot task failed. Inspect: piwork-cli operation show ${accepted.operationId}`), { exitCode: 6 });
    }
    if (Date.now() >= deadline) {
      if (context.json) output(context, { ...accepted, state: "waiting", error: { code: "OPERATION_WAIT_TIMEOUT", message: "The Operation remains queryable." } });
      throw Object.assign(new Error(`Work ID: ${accepted.workId}\nOperation ID: ${accepted.operationId}${accepted.snapshotId ? `\nSnapshot ID: ${accepted.snapshotId}\nResume: piwork-cli work snapshot download ${accepted.snapshotId} --output <file>` : ""}\nTimed out. Inspect: piwork-cli operation show ${accepted.operationId}`), { exitCode: 5 });
    }
    await new Promise((done) => setTimeout(done, Math.min(250, deadline - Date.now())));
  }
}

export async function executeWorkSnapshotCommand(context: CommandContext, command: Exclude<WorkSnapshotCommand, { kind: "help" }>): Promise<number> {
  if (command.kind === "inspect") {
    const file = await openInput(command.path);
    try { output(context, await inspectWorkPackage(file.createReadStream({ start: 0, autoClose: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }))); return 0; }
    finally { await file.close(); }
  }
  warning(context);
  if (command.kind === "export") {
    const preflight = await destination(command.output); await preflight.directory.close();
    const accepted = await context.client.exportWork(command.workId, command.idempotencyKey);
    await observe(context, accepted);
    const status = await context.client.workSnapshot(accepted.snapshotId);
    if (status.state !== "succeeded" || status.digest === null || status.size === null) throw new Error("snapshot is not ready for download");
    const path = await saveDownload(context, accepted.snapshotId, command.output, status.digest, status.size);
    output(context, { workId: accepted.workId, snapshotId: accepted.snapshotId, operationId: accepted.operationId, path, digest: status.digest, size: status.size });
    return 0;
  }
  if (command.kind === "download") {
    const preflight = await destination(command.output); await preflight.directory.close();
    const status = await context.client.workSnapshot(command.snapshotId);
    if (status.digest === null || status.size === null) throw new Error("snapshot is not ready for download");
    const path = await saveDownload(context, command.snapshotId, command.output, status.digest, status.size);
    output(context, { workId: status.workId, snapshotId: status.snapshotId, operationId: status.operationId, path, digest: status.digest, size: status.size });
    return 0;
  }
  const file = await openInput(command.path);
  try {
    const before = await file.stat();
    const verified = await inspectWorkPackage(file.createReadStream({ start: 0, autoClose: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }));
    if (!sameFile(before, await file.stat())) syntax("input package changed during validation");
    const uploaded = await context.client.uploadWorkPackage(file.createReadStream({ start: 0, autoClose: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }),
      verified.digest, verified.size, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!sameFile(before, await file.stat())) syntax("input package changed during upload");
    if (uploaded.digest !== verified.digest || uploaded.size !== verified.size) throw new Error("server package identity changed");
    const accepted = await context.client.importWork({ packageId: uploaded.packageId,
      ...(command.name === undefined ? {} : { name: command.name }), idempotencyKey: command.idempotencyKey });
    if (command.wait) output(context, { ...await observe(context, accepted), name: accepted.name }); else output(context, accepted);
    return 0;
  } finally { await file.close(); }
}
