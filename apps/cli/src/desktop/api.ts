import type { IncomingMessage, ServerResponse } from "node:http";
import { PiworkApiError, PiworkClient, safeErrorMessage } from "@piwork/client-sdk";
import { DesktopIdentity } from "./identity.js";
import { DesktopSessions, sendError } from "./session.js";
import { validateProxyCoreUrl } from "../service-proxy.js";
import { dispatchControl } from "./control-routes.js";
import { BrowserServiceAccess } from "./service-access.js";
import { once } from "node:events";
import { DesktopTransfers } from "./transfers.js";
import { DesktopOperationRecords } from "./operation-records.js";

const jsonLimit = 1_048_576;

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  response.end(JSON.stringify(value ?? {}));
}

async function readObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json") throw new PiworkApiError(415, "JSON_REQUIRED", "Use application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > jsonLimit) throw new PiworkApiError(413, "REQUEST_TOO_LARGE", "Request is too large");
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PiworkApiError(400, "INVALID_JSON", "Invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PiworkApiError(400, "INVALID_JSON", "Expected a JSON object");
  return value as Record<string, unknown>;
}

export async function serveDesktopApi(request: IncomingMessage, response: ServerResponse,
  sessions: DesktopSessions, identity: DesktopIdentity, serviceAccess: BrowserServiceAccess,
  transfers: DesktopTransfers, records: DesktopOperationRecords): Promise<void> {
  const path = request.url;
  const method = request.method;
  if (path === "/_desktop/api/bootstrap") return sessions.bootstrap(request, response);
  if (!sessions.sameOriginRequest(request)) return sendError(response, 403, "LOCAL_ORIGIN_DENIED");
  const mutation = method !== "GET";
  const session = sessions.authorizeRequest(request, mutation);
  if (!session) return sendError(response, mutation ? 403 : 401, mutation ? "LOCAL_CSRF_OR_AUTH_REQUIRED" : "LOCAL_AUTH_REQUIRED");
  try {
    if (path === "/_desktop/api/session" && method === "GET")
      return send(response, 200, { ...(await identity.view()), csrf: session.csrf });
    if (path === "/_desktop/api/login" && method === "POST") {
      const input = await readObject(request);
      if (typeof input.account !== "string" || typeof input.password !== "string") throw new PiworkApiError(400, "INVALID_LOGIN", "Account and password are required");
      return send(response, 200, await identity.login(input.account, input.password));
    }
    if (path === "/_desktop/api/logout" && method === "POST") return send(response, 200, await identity.logout());
    if (path === "/_desktop/api/connection" && method === "PUT") {
      const input = await readObject(request);
      if (typeof input.coreUrl !== "string" || input.coreUrl.length > 2048) throw new PiworkApiError(400, "INVALID_CORE_URL", "Enter a Core URL");
      try { validateProxyCoreUrl(input.coreUrl); }
      catch { throw new PiworkApiError(400, "INVALID_CORE_URL", "Remote Core requires HTTPS"); }
      return send(response, 200, await identity.switchCore(input.coreUrl));
    }
    if (path === "/_desktop/api/status" && method === "GET") {
      const anonymous = new PiworkClient({ coreUrl: identity.currentCoreUrl });
      const health = await anonymous.health().then((value) => ({ available: true, value }),
        (error: unknown) => ({ available: false, error: safeErrorMessage(error) }));
      const readiness = await anonymous.readiness().then((value) => ({ available: true, value }),
        (error: unknown) => ({ available: false, error: safeErrorMessage(error) }));
      const view = await identity.view();
      let service: unknown = { available: false, reason: "Sign in to check service access" };
      let files: unknown = { available: false, reason: "Sign in to check file access" };
      if (view.state === "authenticated") {
        service = await identity.client().gatewayCapability().then((value) => ({ available: Array.isArray(value.protocols) && value.protocols.includes("http"), value }),
          (error: unknown) => ({ available: false, error: safeErrorMessage(error) }));
        files = await identity.client().fileAccessCapability().then((value) => ({ available: value.available, value }),
          (error: unknown) => ({ available: false, error: safeErrorMessage(error) }));
      }
      return send(response, 200, { coreUrl: identity.currentCoreUrl, health, readiness, service, files, checkedAt: new Date().toISOString() });
    }
    if (path === "/_desktop/api/work-packages" && method === "POST") return await transfers.receive(request, response, session);
    const packageTransfer = /^\/_desktop\/api\/work-packages\/([A-Za-z0-9-]+)$/.exec(path ?? "");
    if (packageTransfer && method === "GET") return send(response, 200, transfers.status(packageTransfer[1]!, session, "inspect"));
    if (packageTransfer && method === "DELETE") { await transfers.remove(packageTransfer[1]!, session); return send(response, 200, { removed: true }); }
    if (path === "/_desktop/api/work-imports" && method === "POST") {
      const input = await readObject(request);
      if (typeof input.transferId !== "string" || Object.keys(input).some((key) => !["transferId", "name"].includes(key))
        || input.name !== undefined && typeof input.name !== "string") return sendError(response, 400, "INVALID_IMPORT");
      const accepted = await transfers.import(input.transferId, session, input.name as string | undefined);
      const view = await identity.view();
      const localRecordSaved = view.user ? await records.accept(view.coreUrl, view.user.id, "Import Work", accepted).then(() => true, () => false) : false;
      return send(response, 202, { ...accepted, localRecordSaved });
    }
    const prepareDownload = /^\/_desktop\/api\/work-snapshots\/([A-Za-z0-9-]+)\/downloads$/.exec(path ?? "");
    if (prepareDownload && method === "POST") {
      const transferId = request.headers["x-piwork-transfer-id"];
      if (transferId !== undefined && typeof transferId !== "string") return sendError(response, 400, "INVALID_TRANSFER");
      return send(response, 200, await transfers.prepareDownload(prepareDownload[1]!, session, transferId));
    }
    const packageUpload = /^\/_desktop\/api\/works\/([A-Za-z0-9-]+)\/package-uploads$/.exec(path ?? "");
    if (packageUpload && method === "POST") return send(response, 201, await transfers.uploadPiPackage(request, session, packageUpload[1]!));
    const download = /^\/_desktop\/api\/downloads\/([A-Za-z0-9-]+)(\/content)?$/.exec(path ?? "");
    if (download && method === "GET") {
      if (download[2]) return await transfers.serveDownload(download[1]!, session, response);
      const state = await identity.view();
      if (state.state !== "authenticated") return sendError(response, 401, "AUTH_REQUIRED");
      return send(response, 200, transfers.status(download[1]!, session, "download",
        { generation: state.generation, userId: state.user!.id }));
    }
    if (path === "/_desktop/api/service-entries" && method === "POST")
      return serviceAccess.create(request, response, session);
    const serviceEntry = /^\/_desktop\/api\/service-entries\/([A-Za-z0-9_-]+)$/.exec(path ?? "");
    if (serviceEntry && method === "GET") return serviceAccess.status(response, serviceEntry[1]!, session);
    const runEvents = /^\/_desktop\/api\/works\/([A-Za-z0-9-]+)\/runs\/([A-Za-z0-9-]+)\/events\?after=(\d+)$/.exec(path ?? "");
    if (runEvents && method === "GET") {
      const after = Number(runEvents[3]);
      if (!Number.isSafeInteger(after)) return sendError(response, 400, "INVALID_CURSOR");
      const view = await identity.view();
      if (view.state !== "authenticated") return sendError(response, 401, "AUTH_REQUIRED");
      const client = identity.client();
      await client.getRun(runEvents[1]!, runEvents[2]!);
      if (view.generation !== identity.currentGeneration) return sendError(response, 409, "CONNECTION_CHANGED");
      const abort = new AbortController();
      const unsubscribe = identity.onRevoked(() => abort.abort());
      response.once("close", () => abort.abort());
      const events = client.watchRun(runEvents[1]!, runEvents[2]!, after, abort.signal);
      try {
        const first = await events.next();
        response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", "referrer-policy": "no-referrer" });
        if (!first.done && view.generation === identity.currentGeneration)
          if (!response.write(`${JSON.stringify(first.value)}\n`)) await once(response, "drain", { signal: abort.signal });
        for await (const event of events) {
          if (view.generation !== identity.currentGeneration) break;
          if (!response.write(`${JSON.stringify(event)}\n`)) await once(response, "drain", { signal: abort.signal });
        }
      } catch (error) {
        if (error instanceof PiworkApiError && error.status === 401) identity.revokeContent();
        if (!response.headersSent && !response.destroyed) {
          const item = error instanceof PiworkApiError ? error : new PiworkApiError(503, "RUN_STREAM_UNAVAILABLE", safeErrorMessage(error));
          send(response, item.status > 0 ? item.status : 503, { code: item.code, message: safeErrorMessage(item.message) });
        }
      } finally { unsubscribe(); if (!response.writableEnded) response.end(); }
      return;
    }
    const current = await identity.view();
    if (current.state !== "authenticated") throw new PiworkApiError(401, "AUTH_REQUIRED", "Sign in to Core");
    if (path === "/_desktop/api/known-operations" && method === "GET")
      return send(response, 200, { operations: await records.list(current.coreUrl, current.user!.id) });
    const hiddenOperation = /^\/_desktop\/api\/known-operations\/([A-Za-z0-9-]+)$/.exec(path ?? "");
    if (hiddenOperation && method === "DELETE") {
      await records.hide(current.coreUrl, current.user!.id, hiddenOperation[1]!);
      return send(response, 200, { hidden: true });
    }
    const generation = current.generation;
    const result = await dispatchControl(request, identity.client());
    if (generation !== identity.currentGeneration) throw new PiworkApiError(409, "CONNECTION_CHANGED", "Connection changed during request");
    if (result) {
      const observedOperation = /^\/_desktop\/api\/operations\/([A-Za-z0-9-]+)$/.exec(path ?? "");
      if (method === "GET" && observedOperation && result.status === 200 && result.value
        && typeof result.value === "object" && "state" in result.value
        && ["succeeded", "failed", "superseded"].includes(String(result.value.state)))
        await records.markTerminal(current.coreUrl, current.user!.id, observedOperation[1]!).catch(() => undefined);
      if (mutation && result.status === 202 && result.value && typeof result.value === "object" && "operationId" in result.value) {
        const localRecordSaved = await records.accept(current.coreUrl, current.user!.id, operationType(path ?? ""), result.value)
          .then(() => true, () => false);
        return send(response, result.status, { ...result.value, localRecordSaved });
      }
      return send(response, result.status, result.value);
    }
    return sendError(response, 404, "NOT_FOUND");
  } catch (error) {
    const item = error instanceof PiworkApiError ? error : new PiworkApiError(500, "DESKTOP_ERROR", safeErrorMessage(error));
    if (item.status === 401 && path !== "/_desktop/api/login" && identity.hasContentAuthorization) identity.revokeContent();
    return send(response, item.status > 0 ? item.status : 503,
      { code: item.code, message: safeErrorMessage(item.message) });
  }
}

function operationType(path: string): string {
  if (path === "/_desktop/api/works") return "Create Work";
  if (path.endsWith("/exports")) return "Export Work";
  if (path.endsWith("/apply")) return "Apply Work configuration";
  if (path.includes("/services/")) return "Service action";
  if (path.includes("/packages")) return "Pi Package action";
  if (path.includes("/works/")) return "Work action";
  return "Operation";
}
