import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ClientUnaryCall } from "@grpc/grpc-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { WorkServicesClient } from "@piwork/contracts";
import { createServiceMcpServer } from "./main.js";

test("MCP exposes the exact Work-scoped service tools and maps calls to typed gRPC requests", async () => {
  let createRequest: Record<string, unknown> | undefined;
  const rpc = {
    listServices(_request: unknown, _metadata: unknown, _options: unknown, done: (error: null, response: unknown) => void) {
      done(null, { services: [{ serviceId: "service-one", endpoints: [{ host: "svc-demo", port: 8000 }],
        access: { hostname: "demo.w-a1b2c3d4.work", defaultUrl: "http://demo.w-a1b2c3d4.work/", defaultPortName: "http", status: "available",
          ports: [{ name: "http", port: 8000, url: "http://demo.w-a1b2c3d4.work:8000/" }] } }] });
      return {} as ClientUnaryCall;
    },
    getDeploymentContext(_request: unknown, done: (error: null, response: unknown) => void) {
      done(null, {
        workId: "work-current", workspacePath: "/var/data/workspace", workspaceWritable: true,
        lifecycle: "running", totalCpuMillis: 2_000, totalMemoryBytes: 1_610_612_736n,
        agentCpuMillis: 1_000, agentMemoryBytes: 805_306_368n,
        availableCpuMillis: 1_000, availableMemoryBytes: 805_306_368n,
        defaultServiceCpuMillis: 250, defaultServiceMemoryBytes: 134_217_728n, apiVersion: "v2",
      });
      return {} as ClientUnaryCall;
    },
    createService(request: Record<string, unknown>, _metadata: unknown, _options: unknown, done: (error: null, response: unknown) => void) {
      createRequest = request;
      done(null, { serviceId: "service-one", operationId: "operation-one", reused: false });
      return {} as ClientUnaryCall;
    },
  } as unknown as WorkServicesClient;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServiceMcpServer(rpc);
  const client = new Client({ name: "service-mcp-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const discovered = await client.listTools();
    assert.deepEqual(discovered.tools.map((tool) => tool.name), [
      "deployment_context", "service_create", "service_list", "service_get", "service_update",
      "service_start", "service_stop", "service_restart", "service_remove", "service_retry",
      "operation_get", "service_logs",
    ]);
    const forbidden = new Set(["workId", "containerId", "dockerId", "hostPath", "generation", "instanceId"]);
    for (const tool of discovered.tools) {
      for (const key of objectKeys(tool.inputSchema)) assert.equal(forbidden.has(key), false, `${tool.name} exposes ${key}`);
    }

    const context = await client.callTool({ name: "deployment_context", arguments: {} });
    assert.equal((context.structuredContent as Record<string, unknown>).totalMemoryBytes, "1610612736");
    assert.doesNotThrow(() => JSON.stringify(context.structuredContent));

    const listed = await client.callTool({ name: "service_list", arguments: {} });
    const listedService = ((listed.structuredContent as { services: unknown[] }).services[0]) as { access: { hostname: string }; endpoints: { host: string }[] };
    assert.equal(listedService.access.hostname, "demo.w-a1b2c3d4.work");
    assert.equal(listedService.endpoints[0]?.host, "svc-demo");

    const created = await client.callTool({
      name: "service_create",
      arguments: {
        definition: { name: "demo", image: { reference: "python:3.13-slim" }, command: "python3" },
        idempotencyKey: "deploy-demo-v1",
      },
    });
    assert.equal((created.structuredContent as Record<string, unknown>).operationId, "operation-one");
    const definition = createRequest?.definition as Record<string, unknown>;
    assert.equal(definition.memoryBytes, 134_217_728n);
    assert.equal(definition.workingDirectory, "/var/data/workspace");
    assert.equal("workId" in (createRequest ?? {}), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("compiled adapter keeps stdout protocol-clean over stdio", async () => {
  const fixture = join(dirname(fileURLToPath(import.meta.url)), "testing", "stdio-fixture.js");
  const transport = new StdioClientTransport({ command: process.execPath, args: [fixture], stderr: "pipe" });
  const client = new Client({ name: "service-mcp-stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 12);
    const context = await client.callTool({ name: "deployment_context", arguments: {} });
    assert.equal((context.structuredContent as Record<string, unknown>).workId, "work-stdio");
  } finally {
    await client.close();
  }
});

function objectKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [key, ...objectKeys(item)]);
}
