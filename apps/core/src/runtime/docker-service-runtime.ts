import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import type { ServiceDefinition } from "@piwork/contracts";
import { DockerRuntime, type ContainerLogCollection } from "@piwork/runtime-docker";
import type { CoreStore } from "@piwork/core-store";
import type { ServiceRuntimeAdapter } from "../work-services/service-management.js";

export class ServiceExitedError extends Error {
  readonly code = "SERVICE_EXITED";
  constructor(readonly exitCode: number | undefined) {
    super(`service exited before readiness${exitCode === undefined ? "" : ` with code ${exitCode}`}`);
    this.name = "ServiceExitedError";
  }
}

export class ServiceReadinessTimeoutError extends Error {
  readonly code = "SERVICE_READINESS_TIMEOUT";
  constructor() { super("service readiness deadline expired"); this.name = "ServiceReadinessTimeoutError"; }
}

export class DockerServiceRuntimeAdapter implements ServiceRuntimeAdapter {
  constructor(private readonly docker: DockerRuntime, private readonly store?: CoreStore) {}

  async resolveImage(_workId: string, definition: ServiceDefinition): Promise<string> {
    try { return (await this.docker.prepareImage(definition.image.reference)).imageId; }
    catch (cause) { throw Object.assign(new Error("service image is unavailable"), { code: "IMAGE_UNAVAILABLE", cause }); }
  }

  async prepare(workId: string, definition: ServiceDefinition): Promise<void> {
    try { await this.docker.ensureWorkNetwork(workId); }
    catch (cause) { throw Object.assign(new Error("service network is unavailable"), { code: "DOCKER_UNAVAILABLE", cause }); }
    if (definition.mounts.length === 1) {
      try { await this.docker.requireManagedVolume(workId, "work-workspace"); }
      catch (cause) { throw Object.assign(new Error("service workspace mount is unavailable"), { code: "MOUNT_DENIED", cause }); }
    }
  }

  async start(workId: string, definition: ServiceDefinition, imageIdentity?: string): Promise<void> {
    if (imageIdentity === undefined) throw new Error("service image identity was not captured");
    const network = await this.docker.ensureWorkNetwork(workId);
    const mounts = [];
    if (definition.mounts.length === 1) {
      const workspace = await this.docker.requireManagedVolume(workId, "work-workspace");
      mounts.push({
        type: "volume" as const,
        source: workspace.volumeName,
        target: definition.mounts[0]!.target,
        readOnly: definition.mounts[0]!.readOnly,
      });
    }
    mounts.push({ type: "tmpfs" as const, target: "/tmp", readOnly: false });
    await this.docker.ensureContainer({
      workId,
      kind: "service",
      logicalId: definition.serviceId,
      ...(this.store?.getWorkNetworkName(workId) === undefined ? {} : { displayName: `${this.store.getWorkNetworkName(workId)}_${definition.name}` }),
      image: imageIdentity,
      entrypoint: [definition.command],
      command: definition.args,
      environment: definition.environment,
      cpuMillis: definition.cpuMillis,
      memoryBytes: definition.memoryBytes,
      user: "10001:10001",
      workingDirectory: definition.workingDirectory,
      network: { name: network.name, workId, aliases: [`svc-${definition.name}`] },
      mounts,
      labels: {
        "piwork.service_name": definition.name,
        "piwork.service_revision": String(definition.revision),
        "piwork.image_identity": imageIdentity,
      },
    });
    const running = await this.docker.startContainer(workId, "service", definition.serviceId);
    if (!running.running) throw new ServiceExitedError(running.exitCode);
  }

  async waitReady(workId: string, definition: ServiceDefinition, timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + Math.min(Math.max(timeoutMs, 1_000), 300_000);
    for (;;) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new ServiceReadinessTimeoutError();
      const inspection = await this.docker.inspectContainer(workId, "service", definition.serviceId, Math.max(1, Math.ceil(Math.min(remaining, 2_000))));
      if (!inspection.running) throw new ServiceExitedError(inspection.exitCode);
      if (definition.readiness === undefined) return true;
      const probeTimeout = Math.max(1, Math.ceil(Math.min(definition.readiness.timeoutMs ?? 2_000, remaining)));
      try {
        if (definition.readiness.kind === "exec") {
          await this.docker.execContainer(workId, "service", definition.serviceId, definition.readiness.command!, probeTimeout);
          return true;
        }
        const port = definition.ports.find((candidate) => candidate.name === definition.readiness!.portName)!;
        const address = Object.values(inspection.networkAddresses ?? {})[0];
        if (address !== undefined) {
          if (definition.readiness.kind === "tcp" && await tcpReady(address, port.containerPort, probeTimeout)) return true;
          if (definition.readiness.kind === "http" && await httpReady(address, port.containerPort, definition.readiness.path!, probeTimeout)) return true;
        }
      } catch {
        // The next bounded poll records final process/deadline state.
      }
      await delay(Math.min(500, remaining));
    }
  }

  async stop(workId: string, definition: ServiceDefinition, timeoutMs = 10_000): Promise<void> {
    // Keep part of the Work-wide stop budget for the authoritative inspection.
    // PID 1 workloads can ignore SIGTERM, so giving Docker the entire deadline
    // would race a successful SIGKILL against Core's timeout.
    const graceSeconds = Math.max(1, Math.floor(Math.max(0, timeoutMs - 2_000) / 1_000));
    const stopped = await this.docker.stopContainer(workId, "service", definition.serviceId, graceSeconds);
    if (stopped.exists && stopped.running) throw new Error(`service ${definition.serviceId} did not stop`);
  }

  async remove(workId: string, definition: ServiceDefinition): Promise<void> {
    await this.docker.deleteContainer(workId, "service", definition.serviceId);
  }

  async logs(workId: string, serviceId: string, tailLines: number): Promise<ContainerLogCollection> {
    const inspected = await this.docker.inspectContainer(workId, "service", serviceId, 2_000);
    return this.docker.collectContainerLogs(workId, "service", serviceId, tailLines, inspected.containerId);
  }

  async inspect(workId: string, serviceId: string) {
    const value = await this.docker.inspectContainer(workId, "service", serviceId, 2_000);
    return { exists: value.exists, running: value.running === true,
      ...(value.containerId === undefined ? {} : { containerId: value.containerId }),
      ...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }) };
  }

  async routeTarget(workId: string, serviceId: string): Promise<{ address: string } | undefined> {
    const network = await this.docker.inspectManagedWorkNetwork(workId);
    if (!network) return undefined;
    const container = await this.docker.inspectContainer(workId, "service", serviceId, 2_000);
    const address = container.networkAddresses?.[network];
    if (!container.running || !address || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return undefined;
    return { address };
  }
}

function tcpReady(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (ready: boolean) => { socket.destroy(); resolve(ready); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function httpReady(host: string, port: number, path: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpRequest({ host, port, path, method: "GET", timeout: timeoutMs }, (response) => {
      response.resume();
      resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) <= 299);
    });
    request.once("timeout", () => { request.destroy(); resolve(false); });
    request.once("error", () => resolve(false));
    request.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
