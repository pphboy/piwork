import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { URL } from "node:url";
import { startHttpMcpFixture } from "./testing/mcp-http-fixture.js";

const stdioFixture = join(dirname(fileURLToPath(import.meta.url)), "testing", "mcp-stdio-fixture.js");

test("stdio MCP fixture exposes deterministic echo", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [stdioFixture], stderr: "pipe" });
  await assertFixture(transport, "stdio:hello");
});

test("Streamable HTTP MCP fixture exposes deterministic echo", async () => {
  const fixture = await startHttpMcpFixture();
  try {
    await assertFixture(new StreamableHTTPClientTransport(new URL(fixture.url)), "http:hello");
  } finally {
    await fixture.close();
  }
});

async function assertFixture(transport: StdioClientTransport | StreamableHTTPClientTransport, expected: string): Promise<void> {
  const client = new Client({ name: "piwork-fixture-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["echo"]);
    const result = await client.callTool({ name: "echo", arguments: { text: "hello" } });
    assert.deepEqual(result.content, [{ type: "text", text: expected }]);
  } finally {
    await client.close();
  }
}
