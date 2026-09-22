import { readFileSync } from "node:fs";
import { Server, ServerCredentials, status, type ServerUnaryCall, type sendUnaryData } from "@grpc/grpc-js";
import {
  CONTRACT_VERSION,
  WorkServicesService,
  type RpcAcceptance as Acceptance,
  type RpcCreateServiceRequest as CreateServiceRequest,
  type RpcDeploymentContext as DeploymentContext,
  type RpcEmpty as Empty,
  type RpcListServicesResponse as ListServicesResponse,
  type RpcMutateServiceRequest as MutateServiceRequest,
  type RpcOperationIdRequest as OperationIdRequest,
  type RpcOperationView as OperationView,
  type RpcReadServiceLogsRequest as ReadServiceLogsRequest,
  type RpcServiceDefinition,
  type RpcServiceIdRequest as ServiceIdRequest,
  type RpcServiceLogs as ServiceLogs,
  type RpcServiceView,
  type RpcUpdateServiceRequest as UpdateServiceRequest,
  type WorkConfig,
  type WorkServicesServer,
} from "@piwork/contracts";
import type { CoreStore } from "@piwork/core-store";
import { ensureCoreServiceTlsIdentity } from "../runtime/mtls.js";
import type { CorePaths } from "../application/paths.js";
import type { ServicePrincipal, ServiceView, WorkServiceManagementService } from "./service-management.js";
import { publicOperation } from "../work-management/diagnostics.js";

export class WorkServiceGrpcServer {
  private readonly server = new Server({ "grpc.max_receive_message_length": 1_048_576 });
  constructor(
    private readonly paths: CorePaths,
    private readonly installationId: string,
    private readonly store: CoreStore,
    private readonly services: WorkServiceManagementService,
  ) {}

  async start(listen: string): Promise<number> {
    this.server.addService(WorkServicesService, this.handlers());
    const tls = ensureCoreServiceTlsIdentity(this.paths.runtimeDirectory, this.installationId);
    const credentials = ServerCredentials.createSsl(
      readFileSync(tls.caCertificatePath),
      [{ cert_chain: readFileSync(tls.serverCertificatePath), private_key: readFileSync(tls.serverPrivateKeyPath) }],
      true,
    );
    return new Promise((resolve, reject) => this.server.bindAsync(listen, credentials, (error, port) => error === null ? resolve(port) : reject(error)));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.tryShutdown(() => resolve()));
  }

  private handlers(): WorkServicesServer {
    const unary = <Q, R>(handler: (principal: ServicePrincipal & { kind: "work-runtime" }, request: Q) => Promise<R> | R) =>
      async (call: ServerUnaryCall<Q, R>, callback: sendUnaryData<R>) => {
        try { callback(null, await handler(this.authenticate(call), call.request)); }
        catch (error) { callback(grpcError(error)); }
      };
    return {
      getDeploymentContext: unary((principal, _request: Empty): DeploymentContext => this.deploymentContext(principal)),
      createService: unary((principal, request: CreateServiceRequest): Acceptance => {
        if (request.definition === undefined) throw invalid("definition is required");
        return this.services.create(principal, principal.workId, { definition: fromRpcDefinition(request.definition), idempotencyKey: requiredKey(request.idempotencyKey) });
      }),
      listServices: unary((principal, _request: Empty): ListServicesResponse => ({ services: this.services.list(principal, principal.workId).map(toRpcView) })),
      getService: unary((principal, request: ServiceIdRequest): RpcServiceView => toRpcView(this.services.show(principal, principal.workId, request.serviceId))),
      updateService: unary((principal, request: UpdateServiceRequest): Acceptance => {
        if (request.definition === undefined) throw invalid("definition is required");
        return this.services.update(principal, principal.workId, request.serviceId, request.expectedRevision, fromRpcDefinition(request.definition), requiredKey(request.idempotencyKey));
      }),
      startService: unary((principal, request: MutateServiceRequest): Acceptance => this.services.enable(principal, principal.workId, request.serviceId, requiredKey(request.idempotencyKey))),
      stopService: unary((principal, request: MutateServiceRequest): Acceptance => this.services.disable(principal, principal.workId, request.serviceId, requiredKey(request.idempotencyKey))),
      restartService: unary((principal, request: MutateServiceRequest): Acceptance => this.services.restart(principal, principal.workId, request.serviceId, requiredKey(request.idempotencyKey))),
      removeService: unary((principal, request: MutateServiceRequest): Acceptance => this.services.remove(principal, principal.workId, request.serviceId, requiredKey(request.idempotencyKey))),
      retryService: unary((principal, request: MutateServiceRequest): Acceptance => this.services.retry(principal, principal.workId, request.serviceId, requiredKey(request.idempotencyKey))),
      getOperation: unary((principal, request: OperationIdRequest): OperationView => {
        const operation = this.services.operation(principal, principal.workId, request.operationId);
        const projected = publicOperation(operation);
        return {
          operationId: operation.id, workId: operation.workId!, serviceId: operation.serviceId!, kind: operation.kind,
          state: operation.state, createdAt: operation.createdAt, updatedAt: operation.updatedAt,
          ...(projected.error === null ? {} : { error: {
            code: projected.error.code, message: projected.error.message, field: projected.error.field ?? "",
            remediation: projected.error.remediation, correlationId: projected.error.correlationId ?? projected.correlationId,
          } }),
        };
      }),
      readServiceLogs: unary(async (principal, request: ReadServiceLogsRequest): Promise<ServiceLogs> => {
        const value = await this.services.logs(principal, principal.workId, request.serviceId, request.tailLines || 100);
        return {
          serviceId: request.serviceId, status: value.status, text: redact(value.text), truncated: value.truncated,
          collectedAt: value.collectedAt,
          ...(value.reason === undefined ? {} : { error: { code: "LOGS_UNAVAILABLE", message: value.reason, field: "", remediation: "Verify the service instance and retry.", correlationId: request.serviceId } }),
        };
      }),
    };
  }

  private authenticate(call: ServerUnaryCall<unknown, unknown>): ServicePrincipal & { kind: "work-runtime" } {
    const context = call.getAuthContext() as Record<string, any>;
    const values = context.x509_common_name;
    const subjectName = context.sslPeerCertificate?.subject?.CN;
    const commonName = typeof subjectName === "string" ? subjectName
      : Array.isArray(values) ? String(values[0]) : typeof values === "string" ? values : "";
    if (commonName !== "agent-service-client") throw Object.assign(new Error("untrusted service client role"), { grpcCode: status.UNAUTHENTICATED });
    const altValues = context.x509_subject_alternative_name;
    const certificateAlt = context.sslPeerCertificate?.subjectaltname;
    const alternatives = [
      ...(Array.isArray(altValues) ? altValues.map(String) : typeof altValues === "string" ? [altValues] : []),
      ...(typeof certificateAlt === "string" ? certificateAlt.split(/,\s*/) : []),
    ];
    const identity = alternatives.map((item) => item.replace(/^URI:/, "")).find((item) => item.startsWith("spiffe://piwork/installation/"));
    const match = identity === undefined ? null : /^spiffe:\/\/piwork\/installation\/([^/]+)\/work\/(work-[a-zA-Z0-9-]+)\/generation\/([0-9]+)\/instance\/(agent-[a-zA-Z0-9-]+)\/role\/agent-service-client$/.exec(identity);
    if (match === null) throw Object.assign(new Error("untrusted service client identity"), { grpcCode: status.UNAUTHENTICATED });
    if (match[1] !== this.installationId) throw Object.assign(new Error("wrong installation identity"), { grpcCode: status.UNAUTHENTICATED });
    const principal = { kind: "work-runtime" as const, generation: Number(match[3]), workId: match[2]!, instanceId: match[4]! };
    const runtime = this.store.getRuntimeGeneration(principal.workId, principal.generation);
    if (runtime?.state !== "ready" || runtime.instanceId !== principal.instanceId) throw Object.assign(new Error("stale or inactive runtime identity"), { grpcCode: status.FAILED_PRECONDITION });
    return principal;
  }

  private deploymentContext(principal: ServicePrincipal & { kind: "work-runtime" }): DeploymentContext {
    const work = this.store.getWork(principal.workId)!;
    const state = this.store.getWorkConfiguration(principal.workId)!;
    const config = JSON.parse(state.desiredConfigJson) as WorkConfig;
    const reservations = this.store.listQuotaReservations(principal.workId);
    const cpu = reservations.reduce((sum, item) => sum + Math.max(item.desiredCpuMillis, item.occupiedCpuMillis), 0);
    const memory = reservations.reduce((sum, item) => sum + Math.max(item.desiredMemoryBytes, item.occupiedMemoryBytes), 0);
    return {
      workId: principal.workId,
      workspacePath: "/var/data/workspace",
      workspaceWritable: true,
      lifecycle: work.desiredState,
      totalCpuMillis: config.resources.cpuMillis,
      totalMemoryBytes: BigInt(config.resources.memoryBytes),
      agentCpuMillis: config.resources.agentCpuMillis,
      agentMemoryBytes: BigInt(config.resources.agentMemoryBytes),
      availableCpuMillis: Math.max(0, config.resources.cpuMillis - cpu),
      availableMemoryBytes: BigInt(Math.max(0, config.resources.memoryBytes - memory)),
      defaultServiceCpuMillis: 250,
      defaultServiceMemoryBytes: 128n * 1_024n * 1_024n,
      apiVersion: CONTRACT_VERSION,
    };
  }
}

function fromRpcDefinition(value: RpcServiceDefinition) {
  if (value.secretRefs.length !== 0) throw invalid("secretRefs are unsupported in this version");
  if (value.mounts.some((item) => item.source !== "workspace" || item.target !== "/var/data/workspace")) throw invalid("only the Work workspace mount is supported");
  return {
    name: value.name,
    image: { reference: value.image?.reference ?? "" },
    command: value.command,
    args: value.args,
    environment: value.environment,
    secretRefs: [] as never[],
    workingDirectory: value.workingDirectory,
    mounts: value.mounts.map((item) => ({ source: "workspace" as const, target: "/var/data/workspace" as const, readOnly: item.readOnly })),
    ports: value.ports.map((item) => {
      if (item.protocol !== "tcp" && item.protocol !== "udp") throw invalid("port protocol must be tcp or udp");
      return { name: item.name, containerPort: item.containerPort, protocol: item.protocol as "tcp" | "udp" };
    }),
    cpuMillis: value.cpuMillis,
    memoryBytes: Number(value.memoryBytes),
    enabled: value.enabled,
    required: value.required,
    ...(value.readiness === undefined ? {} : { readiness: {
      kind: value.readiness.kind as "tcp" | "http" | "exec",
      ...(value.readiness.portName === "" ? {} : { portName: value.readiness.portName }),
      ...(value.readiness.path === "" ? {} : { path: value.readiness.path }),
      ...(value.readiness.command.length === 0 ? {} : { command: value.readiness.command }),
      deadlineMs: value.readiness.deadlineMs,
      timeoutMs: value.readiness.timeoutMs,
    } }),
    restartPolicy: value.restartPolicy as "bounded" | "never",
  };
}

function toRpcView(value: ServiceView): RpcServiceView {
  return {
    workId: value.workId, serviceId: value.serviceId, name: value.name, desiredRevision: value.desiredRevision,
    ...(value.appliedRevision === null ? {} : { appliedRevision: value.appliedRevision }), enabled: value.enabled,
    observedState: value.observedState, definition: {
      ...value.definition, image: value.definition.image, memoryBytes: BigInt(value.definition.memoryBytes),
      secretRefs: [], readiness: value.definition.readiness === undefined ? undefined : {
        kind: value.definition.readiness.kind, portName: value.definition.readiness.portName ?? "",
        path: value.definition.readiness.path ?? "", command: value.definition.readiness.command ?? [],
        deadlineMs: value.definition.readiness.deadlineMs ?? 120_000, timeoutMs: value.definition.readiness.timeoutMs ?? 2_000,
      },
    },
    endpoints: value.endpoints.map((item) => ({ ...item, url: item.url ?? "" })),
    ...(value.lastError === null ? {} : { lastError: { code: "SERVICE_FAILED", message: safeMessage(value.lastError), field: "", remediation: "Inspect service logs and retry.", correlationId: value.serviceId } }),
    createdAt: value.createdAt,
  };
}

function requiredKey(value: string): string { if (value.length < 1 || value.length > 256) throw invalid("idempotencyKey is required"); return value; }
function invalid(message: string): Error { return Object.assign(new Error(message), { grpcCode: status.INVALID_ARGUMENT }); }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : "service failed"; }
function redact(value: string): string { return value.replace(/(token|password|secret|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]"); }
function grpcError(error: unknown): Error & { code: number } {
  const item = error as { grpcCode?: number; name?: string; code?: string; message?: string };
  const code = item.grpcCode ?? (item.name === "ServiceDefinitionValidationError" ? status.INVALID_ARGUMENT
    : item.name === "ServiceQuotaExceededError" ? status.RESOURCE_EXHAUSTED
    : item.name === "ServiceNameConflictError" || item.name === "ServiceRevisionConflictError" || item.name === "IdempotencyConflictError" ? status.ABORTED
    : item.name === "ServicePreconditionError" ? status.FAILED_PRECONDITION
    : /not found/i.test(item.message ?? "") ? status.NOT_FOUND : status.UNAVAILABLE);
  return Object.assign(new Error(item.message ?? "service request failed"), { code });
}
