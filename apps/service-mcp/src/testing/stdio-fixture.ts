import type { ClientUnaryCall } from "@grpc/grpc-js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { WorkServicesClient } from "@piwork/contracts";
import { createServiceMcpServer } from "../main.js";

const rpc = {
  getDeploymentContext(_request: unknown, done: (error: null, response: unknown) => void) {
    done(null, {
      workId: "work-stdio", workspacePath: "/var/data/workspace", workspaceWritable: true,
      lifecycle: "running", totalCpuMillis: 2_000, totalMemoryBytes: 1_610_612_736n,
      agentCpuMillis: 1_000, agentMemoryBytes: 805_306_368n,
      availableCpuMillis: 1_000, availableMemoryBytes: 805_306_368n,
      defaultServiceCpuMillis: 250, defaultServiceMemoryBytes: 134_217_728n, apiVersion: "v2",
    });
    return {} as ClientUnaryCall;
  },
} as unknown as WorkServicesClient;

await createServiceMcpServer(rpc).connect(new StdioServerTransport());
