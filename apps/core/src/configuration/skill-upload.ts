import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import type { OperatorSkill } from "@piwork/contracts";

const MAX_BODY = 64 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_CONTENT = 32 * 1024 * 1024;
const MAX_FILES = 2048;

class SkillUploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = () => new SkillUploadError(400, "SKILL_UPLOAD_INVALID", "Skill directory upload is invalid");
const exceeded = () => new SkillUploadError(413, "SKILL_UPLOAD_LIMIT_EXCEEDED", "Skill directory upload exceeds a limit");

function relativePath(encoded: string): string {
  let path: string;
  try { path = decodeURIComponent(encoded); }
  catch { throw invalid(); }
  if (encodeURIComponent(path) !== encoded || !path || path.startsWith("/") || path.includes("\\") ||
    /^[A-Za-z]:/.test(path) || Buffer.byteLength(path, "utf8") > 4096 ||
    path.split("/").length > 64 || path.split("/").some((part) => !part || part === "." || part === ".." || /[\x00-\x1f\x7f]/.test(part))) {
    throw invalid();
  }
  return path;
}

export async function receiveSkillUpload(input: {
  readonly request: IncomingMessage;
  readonly stagingRoot: string;
  readonly expectedName?: string;
  readonly beforeCommit: () => void;
  readonly publish: (directory: string) => OperatorSkill;
  readonly idleTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly onTimeout?: (error: Error) => void;
}): Promise<OperatorSkill> {
  const contentType = input.request.headers["content-type"];
  if (typeof contentType !== "string" || !/^multipart\/form-data;\s*boundary=[A-Za-z0-9'()+_,.\/:=?-]{1,70}$/.test(contentType)) {
    throw new SkillUploadError(415, "UNSUPPORTED_MEDIA_TYPE", "Skill upload requires multipart/form-data");
  }
  const stage = join(input.stagingRoot, randomUUID());
  await mkdir(stage, { recursive: false, mode: 0o700 });
  let directoryName: string | undefined;
  let partCount = 0, fileCount = 0, contentBytes = 0, bodyBytes = 0;
  const seen = new Set<string>();
  const writes: Promise<void>[] = [];
  let writeFailure: unknown;
  let idleTimer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const timeout = () => { if (timedOut) return; timedOut = true;
    const error = new SkillUploadError(408, "SKILL_UPLOAD_TIMEOUT", "Skill upload timed out");
    if (input.onTimeout) input.onTimeout(error); else input.request.destroy(error); };
  const resetIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(timeout, input.idleTimeoutMs ?? 60_000); };
  const totalTimer = setTimeout(timeout, input.totalTimeoutMs ?? 30 * 60_000);
  try {
    const parser = busboy({ headers: input.request.headers, preservePath: true,
      limits: { fields: 1, files: MAX_FILES, parts: MAX_FILES + 2, fileSize: MAX_FILE + 1, fieldSize: 64,
        headerPairs: 64, fieldNameSize: 64 } });
    parser.on("error", () => undefined);
    const fail = (error: unknown) => { if (writeFailure === undefined) writeFailure = error; parser.destroy(error instanceof Error ? error : invalid()); };
    parser.on("field", (name, value, info) => {
      partCount += 1;
      if (partCount !== 1 || name !== "directoryName" || info.valueTruncated || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) return fail(invalid());
      if (input.expectedName !== undefined && value !== input.expectedName) {
        return fail(new SkillUploadError(400, "SKILL_NAME_MISMATCH", "Skill directory name does not match target"));
      }
      directoryName = value;
    });
    parser.on("file", (name, stream, info) => {
      stream.on("error", () => undefined);
      partCount += 1; fileCount += 1;
      if (directoryName === undefined || name !== "files" || fileCount > MAX_FILES) { stream.resume(); return fail(fileCount > MAX_FILES ? exceeded() : invalid()); }
      let path: string;
      try { path = relativePath(info.filename); } catch (error) { stream.resume(); return fail(error); }
      const parts = path.split("/");
      if (seen.has(path) || parts.slice(0, -1).some((_part, index) => seen.has(parts.slice(0, index + 1).join("/"))) ||
        [...seen].some((previous) => previous.startsWith(`${path}/`))) { stream.resume(); return fail(invalid()); }
      seen.add(path);
      const output = join(stage, directoryName, ...parts);
      let fileBytes = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        fileBytes += chunk.length; contentBytes += chunk.length;
        if (fileBytes > MAX_FILE || contentBytes > MAX_CONTENT) callback(exceeded());
        else callback(null, chunk);
      } });
      stream.on("limit", () => fail(exceeded()));
      const write = (async () => {
        await mkdir(dirname(output), { recursive: true, mode: 0o700 });
        await pipeline(stream, meter, createWriteStream(output, { flags: "wx", mode: 0o600 }));
        if (stream.truncated) throw exceeded();
      })().catch(fail);
      writes.push(write);
    });
    for (const event of ["fieldsLimit", "filesLimit", "partsLimit"] as const) parser.on(event, () => fail(exceeded()));
    const bodyMeter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bodyBytes += chunk.length; resetIdle();
      if (bodyBytes > MAX_BODY) callback(exceeded()); else callback(null, chunk);
    } });
    resetIdle();
    try { await pipeline(input.request, bodyMeter, parser); }
    catch (error) { throw writeFailure ?? error; }
    await Promise.all(writes);
    if (writeFailure !== undefined) throw writeFailure;
    if (timedOut) throw new SkillUploadError(408, "SKILL_UPLOAD_TIMEOUT", "Skill upload timed out");
    if (directoryName === undefined || fileCount === 0 || !seen.has("SKILL.md")) throw invalid();
    input.beforeCommit();
    return input.publish(join(stage, directoryName));
  } catch (error) {
    if (error instanceof SkillUploadError || error instanceof Error &&
      (error.name === "InvalidLoginSessionError" || error.name === "ManagedSkillNotFoundError" ||
        typeof (error as { code?: unknown }).code === "string" && String((error as { code?: unknown }).code).startsWith("SKILL_"))) throw error;
    throw invalid();
  } finally {
    clearTimeout(totalTimer); if (idleTimer) clearTimeout(idleTimer);
    await Promise.all(writes);
    await rm(stage, { recursive: true, force: true });
  }
}
