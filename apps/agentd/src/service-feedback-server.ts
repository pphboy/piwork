import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { Check } from "typebox/value";
import { BRAIN_LIMITS, ServiceEventSchema, type ServiceEvent } from "@piwork/contracts";
import { FeedbackError, type WorkStore } from "@piwork/work-store";
import type { ServiceBindingRegistry, ServiceInteractionClient } from "./service-interaction.js";
import type { AgentRuntimeConfig } from "./application.js";

/** Work bridge only. Services receive this identity file, never Core credentials. */
export class ServiceFeedbackServer {
  private readonly server: Server;
  constructor(private readonly workId: string, tls: AgentRuntimeConfig["tls"], private readonly store: WorkStore,
    private readonly bindings: ServiceBindingRegistry, private readonly interactions: ServiceInteractionClient,
    private readonly cancelRun: (runId: string) => void, private readonly wake: (event?: ServiceEvent) => void,
    private readonly canRequest: () => { readonly available: boolean; readonly initializing: boolean }) {
    this.server = createServer({ key: readFileSync(tls.serverPrivateKeyPath), cert: readFileSync(tls.serverCertificatePath),
      ca: readFileSync(tls.caCertificatePath), minVersion: "TLSv1.2", maxHeaderSize: 8192 }, (request, response) => { void this.route(request, response); });
    this.server.requestTimeout = 30_000;
  }
  async start(listen: string): Promise<number> {
    const match = /^([^:]+):(\d+)$/.exec(listen); if (!match) throw new Error("Invalid feedback listener");
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(Number(match[2]), match[1], () => { this.server.off("error", reject); resolve(); }); });
    const address = this.server.address(); if (!address || typeof address === "string") throw new Error("Feedback listener has no address"); return address.port;
  }
  async close(): Promise<void> { this.server.closeIdleConnections(); await new Promise<void>((resolve, reject) => this.server.close((e) => e && (e as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(e) : resolve())); }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!request.headers.authorization?.startsWith("Bearer ") || request.headers.authorization.length > 256) throw new FeedbackError("SERVICE_UNAUTHENTICATED", "Service authentication required");
      const binding = await this.bindings.authenticate(request.headers.authorization.slice(7));
      if (request.url === "/pi/v1/events" && request.method === "POST") {
        let event = await readEvent(request);
        if (event.origin.workId !== this.workId || event.origin.serviceId !== binding.serviceId || event.serviceName !== binding.serviceName) {
          throw new FeedbackError("SERVICE_EVENT_ORIGIN_MISMATCH", "Event origin does not match its current Service identity");
        }
        if (event.type === "page.visited") event = normalizedVisit(event);
        const prior = this.store.feedback.findEventReceipt(event);
        if (prior) { send(response, 200, prior); return; }
        let reasons: readonly string[] = [];
        if (event.type === "agent.requested") {
          const gate = this.canRequest();
          if (!gate.available) throw new FeedbackError(gate.initializing ? "PI_BRAIN_INITIALIZING" : "BRAIN_UNAVAILABLE", gate.initializing ? "Pi brain is initializing" : "Pi brain is not enabled for this Work");
          const discovered = await this.interactions.discover(binding.serviceName);
          if (discovered.mode !== "pi-managed") throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "External Service cannot request automatic business handling");
          reasons = discovered.capabilities.events.requestReasons;
        } else {
          const discovered = await this.interactions.discover(binding.serviceName);
          if (discovered.mode !== "pi-managed" || !discovered.capabilities.events.facts.includes(event.type)) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Event is not a declared Service fact");
        }
        const receipt = this.store.feedback.receiveEvent(event, reasons);
        if (!receipt.reused) this.wake(event); send(response, receipt.reused ? 200 : 201, receipt); return;
      }
      const match = /^\/pi\/v1\/requests\/([a-zA-Z0-9._:-]{1,128})(\/cancel)?$/.exec(request.url ?? "");
      if (match && ((!match[2] && request.method === "GET") || (match[2] && request.method === "POST"))) {
        const goal = this.store.feedback.getRequest(this.workId, match[1]!, binding.serviceId);
        if (!goal) throw new FeedbackError("REQUEST_NOT_FOUND", "Request not found");
        if (match[2]) {
          const value = this.store.feedback.cancel(this.workId, goal.requestId, binding.serviceId);
          if (value.state === "cancelling") for (const runId of value.runIds) if (["accepted", "running", "cancelling"].includes(this.store.getRun(runId)?.state ?? "")) this.cancelRun(runId);
          this.wake();
        }
        send(response, 200, { request: this.store.feedback.getRequest(this.workId, goal.requestId, binding.serviceId),
          evidence: this.store.feedback.listEvidence(this.workId, goal.requestId).items }); return;
      }
      send(response, 404, { code: "NOT_FOUND", message: "Route not found" });
    } catch (error) {
      if (error instanceof FeedbackError) {
        const status = error.code === "SERVICE_UNAUTHENTICATED" ? 401 : error.code === "REQUEST_NOT_FOUND" ? 404
          : error.code === "EVENT_TOO_LARGE" ? 413 : error.code === "REQUEST_CAPACITY_EXCEEDED" ? 429
          : ["SERVICE_EVENT_CONFLICT", "SERVICE_EVENT_ORIGIN_MISMATCH", "REQUEST_RETRY_NOT_ALLOWED"].includes(error.code) ? 409
          : ["BINDINGS_UNAVAILABLE", "SERVICE_UNAVAILABLE", "PI_BRAIN_INITIALIZING", "BRAIN_UNAVAILABLE"].includes(error.code) ? 503 : 400;
        send(response, status, { code: error.code, message: error.message });
      } else send(response, 503, { code: "RECEIPT_STORAGE_UNAVAILABLE", message: "Receipt could not be persisted. Keep the original event and retry." });
    }
  }
}
async function readEvent(request: IncomingMessage): Promise<ServiceEvent> {
  if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json" || request.headers["content-encoding"]) throw new FeedbackError("INVALID_EVENT", "Use uncompressed application/json");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > BRAIN_LIMITS.eventBytes) throw new FeedbackError("EVENT_TOO_LARGE", "Event exceeds 64 KiB"); chunks.push(Buffer.from(chunk)); }
  let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new FeedbackError("INVALID_EVENT", "Event JSON is invalid"); }
  if (!Check(ServiceEventSchema, value)) throw new FeedbackError("INVALID_EVENT", "Event envelope is invalid"); return value;
}
function normalizedVisit(event: ServiceEvent): ServiceEvent {
  const path = event.payload.pathname;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.length > 2048) throw new FeedbackError("INVALID_EVENT", "Page visit needs a Service pathname");
  return { ...event, payload: { pathname: new URL(path, "http://service.invalid").pathname } };
}
function send(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value));
}
