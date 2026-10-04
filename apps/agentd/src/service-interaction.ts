import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { Check } from "typebox/value";
import { ServiceCapabilitiesSchema, ServiceConnectionSchema, ServiceQueryResultSchema, ServiceActionResultSchema, ServiceJobResultSchema,
  type ServiceCapabilities, type ServiceConnection, type ServiceInteractionBinding, type ServiceQueryResult,
  type ServiceActionResult, type ServiceJobResult, type AgentEvidence } from "@piwork/contracts";
import { canonicalJson, contentDigest, FeedbackError, redactValue, type FeedbackStore, type ActionReference } from "@piwork/work-store";
import type { WorkPrivateClient } from "./work-private-client.js";

export class ServiceBindingRegistry {
  private current = new Map<string, ServiceInteractionBinding>();
  private established = false;
  get hasAuthority(): boolean { return this.established; }
  private refreshTask: Promise<void> | undefined;
  constructor(readonly workId: string, private readonly control?: Pick<WorkPrivateClient, "bindings">) {}
  async refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    if (!this.control) throw new FeedbackError("BINDINGS_UNAVAILABLE", "Service bindings are unavailable");
    this.refreshTask = (async () => {
      const result = await this.control!.bindings() as { workId?: string; bindings?: ServiceInteractionBinding[] };
      if (result.workId !== this.workId || !Array.isArray(result.bindings)) throw new FeedbackError("BINDINGS_UNAVAILABLE", "Service binding authority did not match this Work");
      const next = new Map<string, ServiceInteractionBinding>();
      for (const binding of result.bindings) {
        if (binding.workId !== this.workId || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(binding.serviceName)
          || !/^service-[a-zA-Z0-9-]+$/.test(binding.serviceId) || !binding.containerId || !/^[a-f0-9]{64}$/.test(binding.token)
          || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(binding.address) || !binding.address.split(".").every((v) => Number(v) <= 255)
          || !Array.isArray(binding.ports) || binding.ports.some((p) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(p.name) || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535 || !["tcp", "udp"].includes(p.protocol))
          || next.has(binding.serviceName)) throw new FeedbackError("BINDINGS_UNAVAILABLE", "Invalid current Service binding");
        next.set(binding.serviceName, binding);
      }
      this.current = next; this.established = true;
    })().catch(() => { throw new FeedbackError("BINDINGS_UNAVAILABLE", "Current Service binding authority is unavailable"); }).finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }
  /** Known bindings survive a temporary Core outage; new/changed identities need authority. */
  async get(name: string): Promise<ServiceInteractionBinding> {
    try { await this.refresh(); } catch (error) { if (!this.current.has(name)) throw error; }
    const result = this.current.get(name); if (!result) throw new FeedbackError("SERVICE_UNAVAILABLE", "Service binding is no longer active"); return result;
  }
  async authenticate(token: string): Promise<ServiceInteractionBinding> {
    const tokenHash = createHash("sha256").update(token).digest();
    const find = () => [...this.current.values()].find((b) => timingSafeEqual(createHash("sha256").update(b.token).digest(), tokenHash));
    try { await this.refresh(); } catch (error) { const known = find(); if (known) return known; throw error; }
    const result = find(); if (!result) throw new FeedbackError("SERVICE_UNAUTHENTICATED", "Service identity is not active in this Work"); return result;
  }
  snapshot(): readonly ServiceInteractionBinding[] { return [...this.current.values()]; }
}

export interface ServiceRunContext { readonly runId: string | null; readonly requestId: string | null; readonly automatic: boolean; readonly sourceServiceName?: string }
const isTerminal = (state: string) => ["succeeded", "failed", "cancelled"].includes(state);

export class ServiceInteractionClient {
  constructor(private readonly workspace: string, private readonly bindings: ServiceBindingRegistry, private readonly feedback: FeedbackStore) {}
  async discover(serviceName: string): Promise<{ mode: "external"; serviceName: string } | { mode: "pi-managed"; capabilities: ServiceCapabilities }> {
    const connection = this.connection(serviceName);
    if (connection.mode === "external") return { mode: "external", serviceName };
    const value = await this.http(serviceName, "GET", "/pi/v1/capabilities");
    if (!Check(ServiceCapabilitiesSchema, value) || value.logicalServiceName !== serviceName) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Service capabilities are invalid");
    for (const action of Object.values(value.actions)) {
      if (!value.queries[action.verificationQuery] || (action.mode === "async" && !value.jobs)) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Action has no usable verification query or Job contract");
      this.checkSchema(action.inputSchema);
    }
    for (const query of Object.values(value.queries)) this.checkSchema(query.inputSchema);
    return { mode: "pi-managed", capabilities: value };
  }
  async query(context: ServiceRunContext, serviceName: string, queryName: string, input: unknown): Promise<{ result: ServiceQueryResult; evidence: AgentEvidence }> {
    this.assertScope(context, serviceName);
    const capabilities = await this.capabilities(serviceName);
    const query = capabilities.queries[queryName]; if (!query) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Query is not declared");
    this.checkInput(query.inputSchema, input);
    const result = await this.http(serviceName, "POST", `/pi/v1/queries/${encodeURIComponent(queryName)}`, { input });
    if (!Check(ServiceQueryResultSchema, result)) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Query result is invalid");
    const verified = !!result.checks?.length && result.checks.every((c) => c.passed);
    const evidence = this.feedback.addEvidence(this.bindings.workId, { runId: context.runId, requestId: context.requestId, serviceName,
      kind: "query", objectRef: queryName, observedAt: result.observedAt, stateVersion: result.stateVersion, codeVersion: result.codeVersion,
      summary: result.checks?.map((c) => `${c.name}: ${c.passed ? "passed" : "failed"} ${c.summary}`).join("; ") ?? "Actual Service state queried", verified }, result);
    return { result: redactValue(result) as ServiceQueryResult, evidence };
  }
  async action(context: ServiceRunContext, serviceName: string, actionName: string, actionId: string, input: unknown,
    expectedStateVersion: string | null): Promise<{ result: ServiceActionResult; evidence: AgentEvidence }> {
    if (!context.requestId) throw new FeedbackError("REQUEST_NOT_FOUND", "Mutation needs an associated Pi goal");
    if (context.automatic && context.sourceServiceName !== serviceName) throw new FeedbackError("MUTATION_NOT_ALLOWED", "Automatic goal may operate only its source Service");
    const capabilities = await this.capabilities(serviceName); const action = capabilities.actions[actionName];
    if (!action || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(actionId)) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Action or identity is invalid");
    this.checkInput(action.inputSchema, input);
    if (action.requiresExpectedStateVersion && !expectedStateVersion) throw new FeedbackError("ACTION_STATE_CONFLICT", "Action requires the observed state version");
    const goal = this.feedback.internal(this.bindings.workId, context.requestId);
    const prior = goal?.actionRefs.find((r) => r.serviceName === serviceName && r.actionId === actionId);
    const reference: ActionReference = { serviceName, actionName, actionId, input, expectedStateVersion, verificationQuery: action.verificationQuery, status: "calling" };
    if (prior) {
      if (contentDigest({ actionName: prior.actionName, input: prior.input, expectedStateVersion: prior.expectedStateVersion }) !== contentDigest({ actionName, input, expectedStateVersion })) throw new FeedbackError("ACTION_IDEMPOTENCY_CONFLICT", "Original Action input changed");
      return this.readAction(context, serviceName, actionId);
    }
    this.feedback.recordAction(this.bindings.workId, context.requestId, reference);
    let response: unknown;
    try {
      response = await this.http(serviceName, "POST", `/pi/v1/actions/${encodeURIComponent(actionName)}`, { actionId, input, expectedStateVersion, causationRequestId: context.requestId });
    } catch (error) {
      if (error instanceof FeedbackError && ["ACTION_STATE_CONFLICT", "ACTION_IDEMPOTENCY_CONFLICT"].includes(error.code)) {
        this.feedback.recordAction(this.bindings.workId, context.requestId, { ...reference, status: "known" });
        this.feedback.addEvidence(this.bindings.workId, { runId: context.runId, requestId: context.requestId, serviceName, kind: "action", objectRef: actionId,
          observedAt: new Date().toISOString(), summary: error.message, verified: true }, { state: "failed", code: error.code });
        throw error;
      }
      // The only reconciliation is a read of the original identity. Never POST again.
      try { return await this.readAction(context, serviceName, actionId); }
      catch {
        this.feedback.recordAction(this.bindings.workId, context.requestId, { ...reference, status: "unknown" });
        throw new FeedbackError("ACTION_RESULT_UNKNOWN", "Action reply was lost and its original result cannot be proved");
      }
    }
    try { return this.recordActionResult(context, serviceName, actionId, response); }
    catch {
      try { return await this.readAction(context, serviceName, actionId); }
      catch { this.feedback.recordAction(this.bindings.workId, context.requestId, { ...reference, status: "unknown" });
        throw new FeedbackError("ACTION_RESULT_UNKNOWN", "Action acknowledgment is unusable and its original result cannot be proved"); }
    }
  }
  async readAction(context: ServiceRunContext, serviceName: string, actionId: string): Promise<{ result: ServiceActionResult; evidence: AgentEvidence }> {
    this.assertScope(context, serviceName);
    const result = await this.http(serviceName, "GET", `/pi/v1/actions/${encodeURIComponent(actionId)}`);
    return this.recordActionResult(context, serviceName, actionId, result);
  }
  async job(context: ServiceRunContext, serviceName: string, jobId: string): Promise<{ result: ServiceJobResult; evidence: AgentEvidence }> {
    this.assertScope(context, serviceName);
    const result = await this.http(serviceName, "GET", `/pi/v1/jobs/${encodeURIComponent(jobId)}`);
    if (!Check(ServiceJobResultSchema, result) || result.jobId !== jobId || result.artifacts.some((p) => p.startsWith("/") || p.split("/").includes("..") || p.includes("\\"))) {
      throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Job result or Work-relative artifacts are invalid");
    }
    if (context.requestId) {
      const references = this.feedback.internal(this.bindings.workId, context.requestId)?.actionRefs.filter((r) => r.serviceName === serviceName
        && (r.jobId === jobId || r.actionId === result.actionId)) ?? [];
      if (references.some((r) => r.actionId !== result.actionId || (r.jobId !== undefined && r.jobId !== jobId))) {
        throw new FeedbackError("INVALID_WAIT", "Job result does not match the original Action and Job identity");
      }
    }
    const evidence = this.feedback.addEvidence(this.bindings.workId, { runId: context.runId, requestId: context.requestId, serviceName,
      kind: "job", objectRef: jobId, observedAt: result.observedAt, summary: `Job ${result.state}`, verified: isTerminal(result.state) }, result);
    return { result: redactValue(result) as ServiceJobResult, evidence };
  }
  private recordActionResult(context: ServiceRunContext, name: string, id: string, value: unknown): { result: ServiceActionResult; evidence: AgentEvidence } {
    if (!Check(ServiceActionResultSchema, value) || value.actionId !== id) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Action result does not match its identity");
    if (context.requestId) {
      const current = this.feedback.internal(this.bindings.workId, context.requestId);
      const reference = current?.actionRefs.find((r) => r.serviceName === name && r.actionId === id);
      if (reference) {
        if (contentDigest({ actionName: reference.actionName, input: reference.input, expectedStateVersion: reference.expectedStateVersion }) !== contentDigest({ actionName: value.actionName, input: value.input, expectedStateVersion: value.expectedStateVersion })) {
          throw new FeedbackError("ACTION_IDEMPOTENCY_CONFLICT", "Original Action result has different input");
        }
        // Verification may reconcile a known Action, never create a new mutation.
        this.feedback.reconcileAction(this.bindings.workId, context.requestId, name, id, value.jobId ?? undefined);
      }
    }
    const evidence = this.feedback.addEvidence(this.bindings.workId, { runId: context.runId, requestId: context.requestId, serviceName: name,
      kind: "action", objectRef: id, observedAt: value.observedAt, stateVersion: value.stateVersion,
      summary: `Action ${value.actionName}: ${value.state}`, verified: isTerminal(value.state) }, value);
    return { result: redactValue(value) as ServiceActionResult, evidence };
  }
  private async capabilities(name: string): Promise<ServiceCapabilities> {
    const result = await this.discover(name); if (result.mode !== "pi-managed") throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "External Service has no declared business protocol"); return result.capabilities;
  }
  private assertScope(context: ServiceRunContext, serviceName: string): void {
    if (context.automatic && context.sourceServiceName !== serviceName) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Automatic handling is scoped to its source Service");
  }
  connection(name: string): ServiceConnection {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Invalid Service name");
    const directories = [join(this.workspace, ".pi"), join(this.workspace, ".pi", "services")];
    try {
      for (const directory of directories) { const info = lstatSync(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(); }
      const path = join(directories[1]!, `${name}.json`); const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 8192) throw new Error();
      const result: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!Check(ServiceConnectionSchema, result) || result.serviceName !== name) throw new Error(); return result;
    } catch { throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Work Service connection is missing or invalid"); }
  }
  private checkSchema(schema: unknown): void {
    const visit = (value: unknown, depth: number): void => {
      if (depth > 24) throw new Error();
      if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (key === "$ref" || key === "$dynamicRef") throw new Error(); visit(item, depth + 1); }
    };
    try { visit(schema, 0); if (Buffer.byteLength(canonicalJson(schema)) > 8192) throw new Error(); }
    catch { throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Capability input schema is unsupported or unbounded"); }
  }
  private checkInput(schema: object, input: unknown): void {
    let valid = false; try { valid = Check(schema as any, input); } catch { /* Invalid schemas cannot authorize calls. */ }
    if (!valid || Buffer.byteLength(canonicalJson(input)) > 64 * 1024) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Input does not match the declared capability");
  }
  private async http(name: string, method: "GET" | "POST", path: string, input?: unknown): Promise<unknown> {
    const connection = this.connection(name); if (connection.mode !== "pi-managed") throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "External Service does not opt into business interaction");
    const binding = await this.bindings.get(name); const port = binding.ports.find((p) => p.name === connection.apiPortName && p.protocol === "tcp");
    if (!port) throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Service API port is not declared in the current runtime");
    return new Promise((resolve, reject) => {
      const encoded = input === undefined ? undefined : canonicalJson(input);
      const request = httpRequest({ host: binding.address, port: port.port, path, method, agent: false, timeout: 10_000,
        headers: { authorization: `Bearer ${binding.token}`, ...(encoded === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(encoded) }) } }, (response) => {
        let bytes = 0; const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 64 * 1024) response.destroy(new Error("Response exceeds limit")); else chunks.push(chunk); });
        response.once("error", () => reject(new FeedbackError("SERVICE_UNAVAILABLE", "Service response was incomplete")));
        response.once("end", () => {
          let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reject(new FeedbackError("SERVICE_CAPABILITY_INVALID", "Service response is invalid JSON")); return; }
          if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300) { resolve(body); return; }
          const code = (body as { code?: unknown } | null)?.code;
          reject(new FeedbackError(["ACTION_STATE_CONFLICT", "ACTION_IDEMPOTENCY_CONFLICT"].includes(String(code)) ? String(code) : "SERVICE_UNAVAILABLE", "Service rejected the declared operation; query its current state"));
        });
      });
      request.once("timeout", () => request.destroy()); request.once("error", () => reject(new FeedbackError("SERVICE_UNAVAILABLE", "Service is not reachable"))); request.end(encoded);
    });
  }
}
