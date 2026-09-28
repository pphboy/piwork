import type { IncomingMessage, ServerResponse } from "node:http";
import { FILE_ERROR_STATUS, FILE_LIMITS, type FileErrorCode } from "@piwork/contracts";
import { WorkFileStoreError, type CoreStore } from "@piwork/core-store";
import type { DockerRuntime } from "@piwork/runtime-docker";
import { IdentityService, InvalidLoginSessionError } from "../identity/sessions.js";
import type { WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import { WorkFileAccessGuard } from "./access.js";
import { FileHelperUnavailableError } from "./availability.js";
import { WorkFileCoordinator, WorkFileExecutionError, type WorkFileExecutionInput } from "./coordinator.js";
import { parseRawFileTarget } from "./path.js";
import { readXml, parsePropfind, parseProppatch, renderPropfind, renderProppatch,
  type FileMetadata } from "./xml.js";

const ALLOW = "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, COPY, MOVE, DELETE, PROPPATCH";
const ROOT = /^\/api\/v1\/works\/([^/?#]+)\/files(?:[/?#]|$)/;

export interface WorkFileHttpContext {
  readonly store: CoreStore;
  readonly identity: IdentityService;
  readonly workRuntime: Pick<WorkRuntimeAdapter, "inspect">;
  readonly fileRuntime: DockerRuntime;
  readonly installationId: string;
  readonly imageId: () => string;
  readonly coreEpoch: number;
  readonly signal?: AbortSignal;
}

function errorCode(error: unknown): FileErrorCode {
  if (error instanceof WorkFileExecutionError || error instanceof WorkFileStoreError) return error.code;
  if (error instanceof FileHelperUnavailableError) return error.code;
  if (error instanceof InvalidLoginSessionError) return "AUTH_REQUIRED";
  return "FILE_RUNTIME_UNAVAILABLE";
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function sendFileError(response: ServerResponse, error: unknown, head = false, rangeSize?: number): void {
  if (response.headersSent) { response.destroy(); return; }
  const code = errorCode(error);
  const body = `<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:p="urn:piwork:files"><p:code>${xmlEscape(code)}</p:code>${code === "FILE_DEPTH_UNSUPPORTED" ? "<d:propfind-finite-depth/>" : ""}</d:error>`;
  response.writeHead(FILE_ERROR_STATUS[code], { "content-type": "application/xml; charset=utf-8",
    "cache-control": "no-store", "x-piwork-file-error": code,
    ...(code === "FILE_ACCESS_BUSY" ? { "retry-after": "1" } : {}),
    ...(code === "FILE_METHOD_NOT_ALLOWED" ? { allow: ALLOW } : {}),
    ...(code === "FILE_RANGE_UNSATISFIABLE" && rangeSize !== undefined ? { "content-range": `bytes */${rangeSize}` } : {}),
    "content-length": Buffer.byteLength(body) });
  response.end(head ? undefined : body);
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function readRange(value: string | null): WorkFileExecutionInput["range"] {
  if (value === null) return undefined;
  const suffix = /^bytes=-(\d+)$/.exec(value);
  if (suffix) {
    const length = Number(suffix[1]);
    if (Number.isSafeInteger(length) && length > 0) return { suffix: length };
  }
  const span = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (span) {
    const start = Number(span[1]);
    const end = span[2] === "" ? null : Number(span[2]);
    if (Number.isSafeInteger(start) && (end === null || Number.isSafeInteger(end) && end >= start))
      return { start, end };
  }
  throw new WorkFileExecutionError("FILE_RANGE_UNSATISFIABLE");
}

function readLength(request: IncomingMessage): number | undefined {
  const raw = header(request, "content-length");
  if (raw === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw new WorkFileExecutionError("FILE_REQUEST_INVALID");
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > FILE_LIMITS.maxFileBytes)
    throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
  return length;
}

function destination(request: IncomingMessage, sourceWorkId: string): readonly string[] {
  const value = header(request, "destination");
  if (!value || value.includes("?") || value.includes("#"))
    throw new WorkFileExecutionError("FILE_DESTINATION_DENIED");
  let raw = value;
  if (!value.startsWith("/")) {
    const absolute = /^(https?):\/\/([^/?#]+)(\/[^?#]*)$/i.exec(value);
    const scheme = (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted ? "https" : "http";
    if (!absolute || absolute[1]!.toLowerCase() !== scheme
      || absolute[2]!.toLowerCase() !== header(request, "host")?.toLowerCase())
      throw new WorkFileExecutionError("FILE_DESTINATION_DENIED");
    raw = absolute[3]!;
  }
  let parsed;
  try { parsed = parseRawFileTarget(raw); }
  catch { throw new WorkFileExecutionError("FILE_DESTINATION_DENIED"); }
  if (parsed.workId !== sourceWorkId) throw new WorkFileExecutionError("FILE_DESTINATION_DENIED");
  if (parsed.segments.length === 0) throw new WorkFileExecutionError("FILE_ROOT_PROTECTED");
  return parsed.segments;
}

function mutationDepth(request: IncomingMessage, method: string): 0 | "infinity" {
  const value = header(request, "depth");
  if (method === "COPY" && value === "0") return 0;
  if (value === null || value === "infinity") return "infinity";
  throw new WorkFileExecutionError("FILE_REQUEST_INVALID");
}

async function requireEmptyBody(request: IncomingMessage, code: FileErrorCode): Promise<void> {
  const declared = header(request, "content-length");
  if (declared !== null && declared !== "0") throw new WorkFileExecutionError(code);
  for await (const chunk of request) if (chunk.length > 0) throw new WorkFileExecutionError(code);
}

function renderFailures(workId: string, roots: readonly (readonly string[])[],
  failures: readonly { code: FileErrorCode; pathSegments: readonly string[] | null }[]): string {
  const items = failures.map((failure) => {
    if (failure.pathSegments === null || !roots.some((root) => failure.pathSegments!.length >= root.length
      && root.every((part, index) => failure.pathSegments![index] === part)))
      throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
    const href = `/api/v1/works/${workId}/files/${failure.pathSegments.map(encodeURIComponent).join("/")}`;
    const status = FILE_ERROR_STATUS[failure.code];
    return `<d:response><d:href>${xmlEscape(href)}</d:href><d:status>HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Error"}</d:status><d:error><p:code>${xmlEscape(failure.code)}</p:code></d:error></d:response>`;
  });
  const body = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files">${items.join("")}</d:multistatus>`;
  if (Buffer.byteLength(body) > FILE_LIMITS.maxMetadataBytes) throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
  return body;
}

async function waitForDrain(response: ServerResponse): Promise<void> {
  if (response.destroyed) throw new WorkFileExecutionError("FILE_TRANSFER_TIMEOUT");
  await new Promise<void>((resolve, reject) => {
    const clear = () => { response.off("drain", drained); response.off("close", closed); response.off("error", failed); };
    const drained = () => { clear(); resolve(); };
    const closed = () => { clear(); reject(new WorkFileExecutionError("FILE_TRANSFER_TIMEOUT")); };
    const failed = () => { clear(); reject(new WorkFileExecutionError("FILE_RUNTIME_UNAVAILABLE")); };
    response.once("drain", drained); response.once("close", closed); response.once("error", failed);
  });
}

export async function serveWorkFiles(request: IncomingMessage, response: ServerResponse,
  context: WorkFileHttpContext): Promise<void> {
  let rangeSize: number | undefined;
  try {
    const token = /^Bearer ([^\s]+)$/.exec(header(request, "authorization") ?? "")?.[1];
    if (!token) throw new WorkFileExecutionError("AUTH_REQUIRED");
    const session = context.identity.authenticate(token);
    const raw = request.url ?? "";
    const workId = ROOT.exec(raw)?.[1];
    const work = workId && context.store.getWork(workId);
    if (!work || work.ownerUserId !== session.user.id) throw new WorkFileExecutionError("NOT_FOUND");
    const target = parseRawFileTarget(raw);
    const generations = context.store.listRuntimeGenerations(target.workId).filter((item) => item.state === "ready");
    const generation = generations.at(-1);
    if (!generation) throw new WorkFileExecutionError("WORK_FILES_UNAVAILABLE");
    const guard = new WorkFileAccessGuard(context.store, context.workRuntime);
    const identity = { workId: target.workId, ownerUserId: session.user.id, sessionId: session.sessionId,
      runtimeGeneration: generation.generation };
    await guard.validate(identity);
    const requestAbort = new AbortController();
    const abortRequest = () => requestAbort.abort(new WorkFileExecutionError("FILE_TRANSFER_TIMEOUT"));
    request.once("aborted", abortRequest);
    response.once("close", () => { if (!response.writableEnded) abortRequest(); });
    const signal = context.signal === undefined ? requestAbort.signal
      : AbortSignal.any([requestAbort.signal, context.signal]);
    if (target.isRootWithoutSlash) {
      response.writeHead(308, { location: target.encodedPath, "cache-control": "no-store" });
      response.end();
      return;
    }
    const imageId = context.imageId();
    if (request.headers["if"] !== undefined || request.headers["lock-token"] !== undefined)
      throw new WorkFileExecutionError("FILE_CONDITION_UNSUPPORTED");
    if (header(request, "content-encoding") !== null && header(request, "content-encoding") !== "identity")
      throw new WorkFileExecutionError("FILE_MEDIA_UNSUPPORTED");
    if (request.method === "OPTIONS") {
      response.writeHead(200, { allow: ALLOW, "cache-control": "no-store", "content-length": "0" });
      response.end();
      return;
    }
    if (request.method === "PROPFIND" || request.method === "PROPPATCH") {
      if (request.method === "PROPPATCH" && target.segments.length === 0)
        throw new WorkFileExecutionError("FILE_ROOT_PROTECTED");
      const xml = await readXml(request);
      const kind = request.method;
      const propertyRequest = kind === "PROPFIND" ? parsePropfind(xml) : undefined;
      const patchProperties = kind === "PROPPATCH" ? parseProppatch(xml) : undefined;
      const depth = header(request, "depth");
      if (kind === "PROPFIND" && depth !== "0" && depth !== "1")
        throw new WorkFileExecutionError(depth === null || depth === "infinity"
          ? "FILE_DEPTH_UNSUPPORTED" : "FILE_REQUEST_INVALID");
      const entries: FileMetadata[] = [];
      const coordinator = new WorkFileCoordinator(context.store, context.fileRuntime, context.installationId,
        imageId, context.coreEpoch, guard);
      const result = await coordinator.execute({ ...identity, kind: "PROPFIND",
        pathSegments: target.segments, depth: kind === "PROPFIND" ? Number(depth) as 0 | 1 : 0,
        conditions: { ifMatch: null, ifNoneMatch: null, ifModifiedSince: null, ifUnmodifiedSince: null },
        signal,
        onMeta: (value) => {
          const entry = value as FileMetadata;
          if (entries.length === 0) {
            if (JSON.stringify(entry.pathSegments) !== JSON.stringify(target.segments))
              throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          } else if (entry.pathSegments.length !== target.segments.length + 1
            || entry.pathSegments.some((part, index) => index < target.segments.length && part !== target.segments[index]))
            throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          entries.push(entry);
          if (entries.length > FILE_LIMITS.maxDirectoryEntries + 1)
            throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
        } });
      if (entries.length === 0 || result.status !== 207 || result.entries !== entries.length)
        throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
      const body = kind === "PROPFIND" ? renderPropfind(target.workId, entries, propertyRequest!)
        : renderProppatch(target.workId, entries[0]!, patchProperties!);
      response.writeHead(207, { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store",
        "content-length": Buffer.byteLength(body) });
      response.end(body);
      return;
    }
    if (["MKCOL", "COPY", "MOVE", "DELETE"].includes(request.method ?? "")) {
      const kind = request.method as "MKCOL" | "COPY" | "MOVE" | "DELETE";
      if (target.segments.length === 0) throw new WorkFileExecutionError("FILE_ROOT_PROTECTED");
      const targetSegments = kind === "COPY" || kind === "MOVE" ? destination(request, target.workId) : undefined;
      const depth = kind === "COPY" || kind === "MOVE" || kind === "DELETE" ? mutationDepth(request, kind) : undefined;
      const overwriteHeader = header(request, "overwrite");
      if (overwriteHeader !== null && overwriteHeader !== "T" && overwriteHeader !== "F")
        throw new WorkFileExecutionError("FILE_REQUEST_INVALID");
      await requireEmptyBody(request, kind === "MKCOL" ? "FILE_MEDIA_UNSUPPORTED" : "FILE_REQUEST_INVALID");
      const coordinator = new WorkFileCoordinator(context.store, context.fileRuntime, context.installationId,
        imageId, context.coreEpoch, guard);
      const result = await coordinator.execute({ ...identity, kind, pathSegments: target.segments,
        ...(targetSegments === undefined ? {} : { destinationSegments: targetSegments }),
        ...(depth === undefined ? {} : { depth }),
        ...(overwriteHeader === null ? {} : { overwrite: overwriteHeader === "T" }),
        conditions: { ifMatch: header(request, "if-match"), ifNoneMatch: header(request, "if-none-match"),
          ifModifiedSince: header(request, "if-modified-since"), ifUnmodifiedSince: header(request, "if-unmodified-since") }, signal });
      if (result.status === 207) {
        if (result.failures.length === 0) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
        const body = renderFailures(target.workId, targetSegments === undefined ? [target.segments]
          : [target.segments, targetSegments], result.failures);
        response.writeHead(207, { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store",
          "content-length": Buffer.byteLength(body) });
        response.end(body);
      } else {
        if (![201, 204].includes(result.status) || result.failures.length)
          throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
        response.writeHead(result.status, { "cache-control": "no-store", "content-length": "0" });
        response.end();
      }
      return;
    }
    if (!["GET", "HEAD", "PUT"].includes(request.method ?? ""))
      throw new WorkFileExecutionError("FILE_METHOD_NOT_ALLOWED");
    if (request.method === "PUT" && request.headers["content-range"] !== undefined)
      throw new WorkFileExecutionError("FILE_REQUEST_INVALID");
    const kind = request.method as "GET" | "HEAD" | "PUT";
    let range: WorkFileExecutionInput["range"];
    if (kind === "GET" && header(request, "if-range") === null) {
      try { range = readRange(header(request, "range")); }
      catch (error) {
        if (errorCode(error) !== "FILE_RANGE_UNSATISFIABLE") throw error;
        const coordinator = new WorkFileCoordinator(context.store, context.fileRuntime, context.installationId,
          imageId, context.coreEpoch, guard);
        await coordinator.execute({ ...identity, kind: "HEAD", pathSegments: target.segments,
          conditions: { ifMatch: null, ifNoneMatch: null, ifModifiedSince: null, ifUnmodifiedSince: null },
          signal, onMeta: (value) => {
            const item = value as FileMetadata;
            if (item.kind === "file" && item.size !== null) rangeSize = item.size;
          } });
        throw error;
      }
    }
    const expectedLength = kind === "PUT" ? readLength(request) : undefined;
    const conditions = { ifMatch: header(request, "if-match"), ifNoneMatch: header(request, "if-none-match"),
      ifModifiedSince: header(request, "if-modified-since"), ifUnmodifiedSince: header(request, "if-unmodified-since") };
    let metadata: { kind: string; size: number | null; modifiedMs: number | null } | undefined;
    let started = false;
    let transferred = 0;
    let announcedLength = 0;
    const begin = (status: number, bytes: number) => {
      if (started) return;
      started = true;
      announcedLength = bytes;
      const headers: Record<string, string | number> = { "cache-control": "no-store", "content-length": bytes };
      if (metadata?.kind === "file") headers["content-type"] = "application/octet-stream";
      if (metadata?.modifiedMs !== null && metadata?.modifiedMs !== undefined)
        headers["last-modified"] = new Date(metadata.modifiedMs).toUTCString();
      if (status === 206 && metadata?.size !== null && metadata?.size !== undefined && range) {
        const start = "suffix" in range ? Math.max(0, metadata.size - range.suffix) : range.start;
        headers["content-range"] = `bytes ${start}-${start + bytes - 1}/${metadata.size}`;
      }
      response.writeHead(status, headers);
    };
    const coordinator = new WorkFileCoordinator(context.store, context.fileRuntime, context.installationId,
      imageId, context.coreEpoch, guard);
    const result = await coordinator.execute({ ...identity, kind, pathSegments: target.segments,
      conditions, ...(range === undefined ? {} : { range }), ...(expectedLength === undefined ? {} : { expectedLength }),
      ...(kind === "PUT" ? { body: request } : {}), signal,
      onMeta: (value) => {
        if (metadata !== undefined) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
        metadata = value as { kind: string; size: number | null; modifiedMs: number | null };
        if (metadata?.size !== null && metadata?.size !== undefined) {
          if (metadata.size > FILE_LIMITS.maxFileBytes) throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
          rangeSize = metadata.size;
        }
      },
      onData: async (bytes) => {
        if (!metadata || kind !== "GET") throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
        if (!started) begin(range === undefined ? 200 : 206, range === undefined ? metadata?.size ?? bytes.length :
          "suffix" in range ? Math.min(range.suffix, metadata?.size ?? 0) : Math.max(0,
            Math.min(range.end ?? ((metadata?.size ?? 0) - 1), (metadata?.size ?? 0) - 1) - range.start + 1));
        transferred += bytes.length;
        if (transferred > announcedLength) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
        if (!response.write(bytes)) await waitForDrain(response);
      } });
    if (kind === "GET" && (transferred !== result.bytes || started &&
      (transferred !== announcedLength || result.status !== (range === undefined ? 200 : 206))
      || !started && result.status === 200 && metadata?.size !== result.bytes))
      throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
    if (!started) begin(result.status, kind === "HEAD" && metadata?.kind === "file"
      ? metadata.size ?? 0 : kind === "GET" ? result.bytes : 0);
    response.end();
  } catch (error) { sendFileError(response, error, request.method === "HEAD", rangeSize); }
}
