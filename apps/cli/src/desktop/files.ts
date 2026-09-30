import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { PiworkApiError } from "@piwork/client-sdk";
import { FILE_ACCESS_PROFILE, FILE_ACCESS_VERSION, FILE_LIMITS, FileAccessCapabilitySchema } from "@piwork/contracts";
import { Check } from "typebox/value";
import { FileProxyError, mapDavXml, mapDestination, toCorePath, toLocalPath } from "../work-file-proxy.js";
import { DesktopIdentity } from "./identity.js";
import { DesktopSessions, sendError } from "./session.js";

const prefix = "/_desktop/files";
const methods = new Set(["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "MKCOL", "COPY", "MOVE", "DELETE"]);
const hop = new Set(["connection", "transfer-encoding", "keep-alive", "te", "trailer", "upgrade", "proxy-authenticate", "proxy-authorization"]);
const activeMutations = new Set<string>();

function destination(value: string, workId: string, origin: string): string {
  let raw = value;
  if (value.startsWith(origin + prefix)) raw = value.slice((origin + prefix).length);
  else if (value.startsWith(prefix)) raw = value.slice(prefix.length);
  else throw new FileProxyError("FILE_DESTINATION_DENIED");
  return mapDestination(raw, workId, origin);
}

function requestHeaders(request: IncomingMessage, workId: string, origin: string): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  const connections = String(request.headers.connection ?? "").toLowerCase().split(",").map((value) => value.trim());
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || hop.has(key) || connections.includes(key) || key === "host" || key === "cookie" || key === "authorization"
      || key === "x-piwork-csrf" || key.startsWith("x-piwork-") || key.startsWith("proxy-")) continue;
    if (key === "destination") result.destination = destination(String(value), workId, origin);
    else if (key === "origin" || key === "referer") continue;
    else result[key] = value;
  }
  return result;
}

function responseHeaders(headers: IncomingHttpHeaders, workId: string): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || hop.has(key) || key === "set-cookie" || key === "www-authenticate"
      || key.startsWith("x-piwork-gateway-") || key.startsWith("proxy-")) continue;
    if (key === "location" && typeof value === "string") result.location = prefix + toLocalPath(value, workId);
    else result[key] = value;
  }
  return result;
}

export async function serveDesktopFiles(request: IncomingMessage, response: ServerResponse,
  sessions: DesktopSessions, identity: DesktopIdentity): Promise<void> {
  const method = request.method ?? "GET";
  if (!methods.has(method) || request.headers.upgrade) return sendError(response, 405, "FILE_METHOD_NOT_ALLOWED");
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const session = sessions.authorizeRequest(request, mutation);
  if (!session) return sendError(response, mutation ? 403 : 401, mutation ? "LOCAL_CSRF_OR_AUTH_REQUIRED" : "LOCAL_AUTH_REQUIRED");
  let target: ReturnType<typeof toCorePath>;
  let cleanupStreams: (() => void) | undefined;
  try {
    const raw = request.url ?? "";
    if (!raw.startsWith(prefix + "/works/")) throw new FileProxyError("FILE_PATH_INVALID");
    target = toCorePath(raw.slice(prefix.length));
    if (method === "PROPFIND" && !["0", "1"].includes(String(request.headers.depth ?? "")))
      throw new FileProxyError("FILE_DEPTH_UNSUPPORTED");
    if (["PUT", "MKCOL", "COPY", "MOVE", "DELETE"].includes(method) && /\/files\/?$/.test(target.path))
      throw new FileProxyError("FILE_ROOT_PROTECTED");
    if (method === "PUT" && Number(request.headers["content-length"] ?? 0) > FILE_LIMITS.maxFileBytes)
      throw new FileProxyError("FILE_LIMIT_EXCEEDED");
    if (["PUT", "MKCOL", "COPY", "MOVE", "DELETE"].includes(method)) {
      if (activeMutations.has(target.workId)) return sendError(response, 409, "FILE_MUTATION_BUSY");
      activeMutations.add(target.workId);
      const release = () => { activeMutations.delete(target.workId); };
      response.once("finish", release);
      response.once("close", release);
    }
    const state = await identity.view();
    if (state.state !== "authenticated") return sendError(response, 401, "AUTH_REQUIRED");
    const generation = state.generation;
    const client = identity.client();
    const capability = await client.fileAccessCapability();
    if (!Check(FileAccessCapabilitySchema, capability) || capability.version !== FILE_ACCESS_VERSION
      || capability.profile !== FILE_ACCESS_PROFILE) return sendError(response, 501, "FILE_ACCESS_UNSUPPORTED");
    if (!capability.available) return sendError(response, 503, "FILE_HELPER_UNAVAILABLE");
    if (generation !== identity.currentGeneration) return sendError(response, 409, "CONNECTION_CHANGED");
    const headers = requestHeaders(request, target.workId, sessions.origin);
    let upstream: ClientRequest | undefined;
    let incomingResponse: IncomingMessage | undefined;
    let cleaned = false;
    let aborted = false;
    const abort = () => {
      if (aborted) return;
      aborted = true;
      incomingResponse?.destroy();
      upstream?.destroy();
      request.destroy();
      response.destroy();
    };
    const unsubscribe = identity.onRevoked(abort);
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
      request.off("aborted", abort);
      response.off("finish", cleanup);
      response.off("close", cleanup);
    };
    cleanupStreams = cleanup;
    request.once("aborted", abort);
    response.once("finish", cleanup);
    response.once("close", cleanup);
    if (generation !== identity.currentGeneration) { abort(); return; }
    upstream = client.fileRequest({ path: target.path, method, headers }, async (incoming) => {
      incomingResponse = incoming;
      if (generation !== identity.currentGeneration) { incoming.destroy(); response.destroy(); return; }
      const status = incoming.statusCode ?? 502;
      if (status === 401) { incoming.resume(); sendError(response, 401, "AUTH_REQUIRED"); queueMicrotask(() => identity.revokeContent()); return; }
      try {
        const returned = responseHeaders(incoming.headers, target.workId);
        const type = String(returned["content-type"] ?? "");
        if (status === 207 && /^(?:application|text)\/xml(?:\s*;|$)/i.test(type)) {
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of incoming) {
            size += (chunk as Buffer).length;
            if (size > FILE_LIMITS.maxMetadataBytes) throw new FileProxyError("FILE_LIMIT_EXCEEDED");
            chunks.push(chunk as Buffer);
          }
          const mapped = mapDavXml(Buffer.concat(chunks), target.workId, prefix);
          returned["content-length"] = String(mapped.length);
          response.writeHead(status, returned); response.end(mapped);
        } else {
          response.writeHead(status, returned);
          incoming.once("close", () => {
            if (!incoming.complete && !response.writableEnded) response.destroy();
          });
          incoming.pipe(response);
        }
      } catch (error) {
        if (!response.headersSent) sendError(response, error instanceof FileProxyError ? error.status : 502,
          error instanceof FileProxyError ? error.code : "FILE_BACKEND_PROTOCOL_ERROR");
        else response.destroy();
      }
    });
    upstream.once("error", () => {
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent) sendError(response, 502, "CORE_UNAVAILABLE"); else response.destroy();
    });
    upstream.once("close", () => {
      if (response.destroyed || response.writableEnded || incomingResponse?.complete) return;
      if (!response.headersSent) sendError(response, 502, "CORE_UNAVAILABLE");
      else response.destroy();
      request.destroy();
    });
    response.once("close", () => { if (!response.writableEnded) upstream?.destroy(); });
    request.pipe(upstream);
  } catch (error) {
    cleanupStreams?.();
    const status = error instanceof FileProxyError ? error.status : error instanceof PiworkApiError ? error.status > 0 ? error.status : 503 : 502;
    const code = error instanceof FileProxyError || error instanceof PiworkApiError ? error.code : "CORE_UNAVAILABLE";
    if (status === 401) identity.revokeContent();
    if (!response.headersSent) sendError(response, status, code);
  }
}
