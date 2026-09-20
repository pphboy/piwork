import { Server, ServerCredentials, type ServiceDefinition } from "@grpc/grpc-js";
import type { Logger } from "../common/logger.js";
import { PiDaemonService, type PiDaemonServer } from "../generated/piwork.js";

export interface RunningServer {
  readonly port: number;
  shutdown(): Promise<void>;
}

export async function startServer(options: {
  host: string;
  port: number;
  implementation: PiDaemonServer;
  log: Logger;
}): Promise<RunningServer> {
  const server = new Server();
  server.addService(PiDaemonService as unknown as ServiceDefinition, options.implementation);

  const port = await new Promise<number>((resolveBound, rejectBound) => {
    server.bindAsync(`${options.host}:${options.port}`, ServerCredentials.createInsecure(), (error, boundPort) => {
      if (error !== null) {
        rejectBound(error);
        return;
      }
      resolveBound(boundPort);
    });
  });

  options.log.info("daemon listening", { host: options.host, port });

  return {
    port,
    shutdown: () =>
      new Promise<void>((resolveShutdown) => {
        server.tryShutdown(() => resolveShutdown());
      }),
  };
}
