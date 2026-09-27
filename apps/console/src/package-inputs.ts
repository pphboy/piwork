import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { PiworkClient, PiworkApiError } from "@piwork/client-sdk";
import { packPiPackageDirectory, inspectPiPackageZip, PI_PACKAGE_LIMITS, PiPackageInputError } from "@piwork/pi-package";

export class InputError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const invalid = () => new InputError(400, "PI_PACKAGE_INVALID_SOURCE", "Package input is invalid");
const limit = () => new InputError(413, "PI_PACKAGE_LIMIT_EXCEEDED", "Package input exceeds a limit");
function displayName(value: string): string {
  if (!value || Buffer.byteLength(value) > 255 || value === "." || value === ".." || /[\\/\x00-\x1f\x7f]/.test(value)) throw invalid();
  return value;
}
function pathName(value: string): string {
  let path: string; try { path = decodeURIComponent(value); } catch { throw invalid(); }
  if (encodeURIComponent(path) !== value || !path || path.startsWith("/") || /^[A-Za-z]:/.test(path) ||
    /[\\\x00-\x1f\x7f]/.test(path) || path.split("/").length > PI_PACKAGE_LIMITS.depth ||
    Buffer.byteLength(path) > PI_PACKAGE_LIMITS.pathBytes || path.split("/").some((part) => !part || part === "." || part === "..")) throw invalid();
  return path;
}

export async function uploadBrowserPackage(input: { request: IncomingMessage; kind: "zip" | "directory"; dataDir: string;
  coreUrl: string; token: string; beforeUpload: () => Promise<void>; onTimeout?: (error: Error) => void;
  idleTimeoutMs?: number; totalTimeoutMs?: number; signal?: AbortSignal }): Promise<{ uploadId: string; expiresAt: string }> {
  await mkdir(join(input.dataDir, "staging"), { recursive: true, mode: 0o700 });
  const stage = join(input.dataDir, "staging", randomUUID());
  await mkdir(stage, { recursive: false, mode: 0o700 });
  let idle: NodeJS.Timeout | undefined;
  let expired = false;
  const expire = () => { if (expired) return; expired = true;
    const error = new InputError(408, "CONSOLE_UPLOAD_TIMEOUT", "Package upload timed out");
    if (input.onTimeout) input.onTimeout(error); else input.request.destroy(error); };
  const resetIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(expire, input.idleTimeoutMs ?? 60_000); };
  const total = setTimeout(expire, input.totalTimeoutMs ?? 30 * 60_000);
  const stopInputTimers = () => { clearTimeout(total); if (idle) clearTimeout(idle); idle = undefined; };
  const stopForShutdown = () => input.request.destroy();
  input.signal?.addEventListener("abort", stopForShutdown, { once: true });
  let callbackError: unknown;
  try {
    if (input.signal?.aborted) throw new InputError(503, "CONSOLE_SHUTTING_DOWN", "Console is shutting down");
    let path: string, bytes: number, digest: string, name: string, sourceKind: "local" | "zip";
    if (input.kind === "zip") {
      if (input.request.headers["content-type"] !== "application/zip") throw new InputError(415, "UNSUPPORTED_MEDIA_TYPE", "ZIP upload requires application/zip");
      const encoded = input.request.headers["x-piwork-package-name"];
      if (typeof encoded !== "string") throw invalid();
      try { name = displayName(decodeURIComponent(encoded)); } catch { throw invalid(); }
      path = join(stage, "package.zip"); sourceKind = "zip";
      const hash = createHash("sha256"); let size = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length; resetIdle();
        if (size > PI_PACKAGE_LIMITS.compressedBytes) callback(limit()); else { hash.update(chunk); callback(null, chunk); }
      } });
      resetIdle(); await pipeline(input.request, meter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
      stopInputTimers();
      if (expired) throw new InputError(408, "CONSOLE_UPLOAD_TIMEOUT", "Package upload timed out");
      await inspectPiPackageZip(path); bytes = size; digest = hash.digest("hex");
    } else {
      const result = await receiveDirectory(input.request, stage, resetIdle);
      stopInputTimers();
      if (expired) throw new InputError(408, "CONSOLE_UPLOAD_TIMEOUT", "Package upload timed out");
      name = result.name; sourceKind = "local"; path = join(stage, "package.zip");
      const packed = await packPiPackageDirectory(result.root, path);
      bytes = packed.bytes; digest = packed.digest;
    }
    if (input.signal?.aborted) throw new InputError(503, "CONSOLE_SHUTTING_DOWN", "Console is shutting down");
    try { await input.beforeUpload(); } catch (error) { callbackError = error; throw error; }
    const client = new PiworkClient({ coreUrl: input.coreUrl, token: input.token });
    return await client.adminUploadPiPackage(createReadStream(path), digest, bytes, name, sourceKind,
      { signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000) });
  } catch (error) {
    if (error === callbackError && callbackError !== undefined) throw error;
    if (error instanceof InputError) throw error;
    if (error instanceof PiworkApiError) throw new InputError(error.status || 502, error.code, error.message);
    if (error instanceof PiPackageInputError) throw new InputError(error.code === "PI_PACKAGE_LIMIT_EXCEEDED" ? 413 : 400, error.code, error.message);
    throw invalid();
  } finally { input.signal?.removeEventListener("abort", stopForShutdown);
    stopInputTimers(); await rm(stage, { recursive: true, force: true }); }
}

async function receiveDirectory(request: IncomingMessage, stage: string, resetIdle: () => void): Promise<{ name: string; root: string }> {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.startsWith("multipart/form-data; boundary=")) throw new InputError(415, "UNSUPPORTED_MEDIA_TYPE", "Directory upload requires multipart/form-data");
  const parser = busboy({ headers: request.headers, preservePath: true,
    limits: { fields: 1, files: PI_PACKAGE_LIMITS.entries, parts: PI_PACKAGE_LIMITS.entries + 2,
      fileSize: PI_PACKAGE_LIMITS.fileBytes + 1, fieldSize: 255, headerPairs: 64 } });
  parser.on("error", () => undefined);
  let name: string | undefined, partCount = 0, fileCount = 0, contentBytes = 0, bodyBytes = 0, failure: unknown;
  const seen = new Set<string>(), writes: Promise<void>[] = [];
  const fail = (error: unknown) => { if (failure === undefined) failure = error; parser.destroy(error instanceof Error ? error : invalid()); };
  parser.on("field", (field, value, info) => { partCount += 1;
    if (partCount !== 1 || field !== "directoryName" || info.valueTruncated) return fail(invalid());
    try { name = displayName(value); } catch (error) { fail(error); }
  });
  parser.on("file", (field, stream, info) => {
    stream.on("error", () => undefined); partCount += 1; fileCount += 1;
    if (name === undefined || field !== "files" || fileCount > PI_PACKAGE_LIMITS.entries) { stream.resume(); return fail(limit()); }
    let path: string; try { path = pathName(info.filename); } catch (error) { stream.resume(); return fail(error); }
    const parts = path.split("/");
    if (seen.has(path) || parts.slice(0, -1).some((_part, index) => seen.has(parts.slice(0, index + 1).join("/"))) ||
      [...seen].some((previous) => previous.startsWith(`${path}/`))) { stream.resume(); return fail(invalid()); }
    seen.add(path);
    const output = join(stage, "tree", ...parts);
    let fileBytes = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      fileBytes += chunk.length; contentBytes += chunk.length;
      if (fileBytes > PI_PACKAGE_LIMITS.fileBytes || contentBytes > PI_PACKAGE_LIMITS.restoredBytes) callback(limit());
      else callback(null, chunk);
    } });
    stream.on("limit", () => fail(limit()));
    writes.push((async () => { await mkdir(dirname(output), { recursive: true, mode: 0o755 });
      await pipeline(stream, meter, createWriteStream(output, { flags: "wx", mode: 0o644 }));
      if (stream.truncated) throw limit(); })().catch(fail));
  });
  for (const event of ["fieldsLimit", "filesLimit", "partsLimit"] as const) parser.on(event, () => fail(limit()));
  const bodyMeter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bodyBytes += chunk.length; resetIdle();
    if (bodyBytes > PI_PACKAGE_LIMITS.restoredBytes + 64 * 1024 * 1024) callback(limit()); else callback(null, chunk);
  } });
  resetIdle(); try { await pipeline(request, bodyMeter, parser); } catch (error) { throw failure ?? error; }
  await Promise.all(writes); if (failure) throw failure;
  if (!name || !seen.has("package.json")) throw invalid();
  const root = join(stage, "tree"); if (!(await stat(root)).isDirectory()) throw invalid();
  return { name, root };
}
