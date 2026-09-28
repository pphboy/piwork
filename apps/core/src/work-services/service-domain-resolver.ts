import type { ServiceDefinition } from "@piwork/contracts";
import { CoreStore, type ServiceRecord, type WorkRecord } from "@piwork/core-store";

export interface ServiceAccess {
  readonly hostname: string;
  readonly defaultUrl: string | null;
  readonly defaultPortName: string | null;
  readonly status: "available" | "unavailable" | "no-default-port";
  readonly ports: { readonly name: string; readonly port: number; readonly url: string }[];
}

export class ServiceAccessError extends Error {
  constructor(readonly code: "NOT_FOUND" | "PORT_REQUIRED" | "PORT_NOT_DECLARED" | "SERVICE_UNAVAILABLE" | "SERVICE_UPSTREAM_UNAVAILABLE") {
    super(code);
    this.name = "ServiceAccessError";
  }
}

const hostnamePattern = /^([a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(w-[a-f0-9]{8,61})\.work$/;

export function normalizeServiceHostname(value: string): string | undefined {
  if (value.length > 254 || !/^[\x21-\x7e]+$/.test(value)) return undefined;
  const hostname = value.replace(/\.$/, "").toLowerCase();
  return hostnamePattern.test(hostname) ? hostname : undefined;
}

/** The sole Core boundary for default domain assignment, display, and target resolution. */
export class ServiceDomainResolver {
  constructor(
    private readonly store: CoreStore,
    private readonly inspect: (workId: string, serviceId: string) => Promise<{ exists: boolean; running: boolean }>,
  ) {}

  assignDefault(workId: string, serviceId: string, serviceName: string, now: string): string {
    const network = this.store.assignWorkNetworkName(workId, now);
    const label = this.store.assignServiceDomainLabel(workId, serviceId, serviceName, now);
    return `${label}.${network}.work`;
  }

  async describe(workId: string, serviceId: string): Promise<ServiceAccess> {
    const work = this.store.getWork(workId);
    const service = this.store.getService(workId, serviceId);
    if (!work || !service) throw new ServiceAccessError("NOT_FOUND");
    return this.describeRecord(work, service);
  }

  async describeRecord(work: WorkRecord, service: ServiceRecord): Promise<ServiceAccess> {
    const network = this.store.getWorkNetworkName(work.id);
    const label = this.store.getServiceDomainLabel(work.id, service.serviceId);
    if (!network || !label) throw new Error("service network identity is missing");
    const hostname = `${label}.${network}.work`;
    const definition = JSON.parse(service.definitionJson) as ServiceDefinition;
    const tcp = definition.ports.filter((port) => port.protocol === "tcp")
      .sort((a, b) => a.containerPort - b.containerPort || a.name.localeCompare(b.name));
    const defaultPort = tcp.find((port) => port.containerPort === 80)
      ?? (definition.readiness?.kind === "http" ? tcp.find((port) => port.name === definition.readiness?.portName) : undefined);
    let ready = false;
    if (eligible(work, service)) {
      try { const inspected = await this.inspect(work.id, service.serviceId); ready = inspected.exists && inspected.running; }
      catch { ready = false; }
    }
    return {
      hostname,
      defaultUrl: defaultPort ? `http://${hostname}/` : null,
      defaultPortName: defaultPort?.name ?? null,
      status: !ready ? "unavailable" : defaultPort ? "available" : tcp.length ? "no-default-port" : "unavailable",
      ports: tcp.map((port) => ({ name: port.name, port: port.containerPort, url: `http://${hostname}:${port.containerPort}/` })),
    };
  }

  async resolveTarget(rawHostname: string, requestedPort: number | null): Promise<{
    readonly hostname: string; readonly work: WorkRecord; readonly service: ServiceRecord; readonly port: number;
  }> {
    const hostname = normalizeServiceHostname(rawHostname);
    if (!hostname) throw new ServiceAccessError("NOT_FOUND");
    const identity = this.store.resolveServiceHostname(hostname);
    if (!identity) throw new ServiceAccessError("NOT_FOUND");
    const work = this.store.getWork(identity.workId);
    const service = this.store.getService(identity.workId, identity.serviceId);
    if (!work || !service) throw new ServiceAccessError("NOT_FOUND");
    const definition = JSON.parse(service.definitionJson) as ServiceDefinition;
    const tcp = definition.ports.filter((port) => port.protocol === "tcp");
    const defaultPort = tcp.find((port) => port.containerPort === 80)
      ?? (definition.readiness?.kind === "http" ? tcp.find((port) => port.name === definition.readiness?.portName) : undefined);
    if (requestedPort !== null && (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535)) throw new ServiceAccessError("PORT_NOT_DECLARED");
    const selected = requestedPort === null || requestedPort === 80 && !tcp.some((port) => port.containerPort === 80)
      ? defaultPort : tcp.find((port) => port.containerPort === requestedPort);
    if (!selected) throw new ServiceAccessError(requestedPort === null || requestedPort === 80 ? "PORT_REQUIRED" : "PORT_NOT_DECLARED");
    if (!eligible(work, service)) throw new ServiceAccessError("SERVICE_UNAVAILABLE");
    let inspected: { exists: boolean; running: boolean };
    try { inspected = await this.inspect(work.id, service.serviceId); }
    catch { throw new ServiceAccessError("SERVICE_UPSTREAM_UNAVAILABLE"); }
    if (!inspected.exists || !inspected.running) throw new ServiceAccessError("SERVICE_UNAVAILABLE");
    return { hostname, work, service, port: selected.containerPort };
  }
}

function eligible(work: WorkRecord, service: ServiceRecord): boolean {
  return work.desiredState === "running" && (work.observedState === "ready" || work.observedState === "degraded")
    && service.enabled && service.observedState === "ready" && service.tombstonedAt === null;
}
