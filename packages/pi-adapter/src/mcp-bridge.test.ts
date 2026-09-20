import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpBridge, RequiredMcpUnavailableError } from "./mcp-bridge.js";
import { startHttpMcpFixture } from "./testing/mcp-http-fixture.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "testing", "mcp-stdio-fixture.js");

test("two stdio servers namespace identical tools and route calls correctly", async () => {
  const bridge = new McpBridge();
  await bridge.initialize([
    { serverId: "one", required: true, transport: "stdio", command: process.execPath, args: [fixture], timeoutMs: 500 },
    { serverId: "two", required: true, transport: "stdio", command: process.execPath, args: [fixture] },
  ]);
  try {
    assert.deepEqual(bridge.listTools().map((tool) => tool.namespacedName), ["one.echo", "two.echo"]);
    const one = await bridge.callTool("one.echo", { text: "hello" }) as { content: unknown };
    const two = await bridge.callTool("two.echo", { text: "hello" }) as { content: unknown };
    assert.deepEqual(one.content, [{ type: "text", text: "stdio:hello" }]);
    assert.deepEqual(two.content, [{ type: "text", text: "stdio:hello" }]);
    await assert.rejects(bridge.callTool("one.echo", { text: 42 }));
    await assert.rejects(bridge.callTool("one.echo", { text: "slow" }));
  } finally {
    await bridge.close();
  }
});

test("HTTP secrets are injected only as configured and required/optional failures affect readiness", async () => {
  const fixtureServer = await startHttpMcpFixture(0, "Bearer fixture-secret");
  const optional = new McpBridge();
  try {
    await optional.initialize([
      { serverId: "secure", required: true, transport: "streamable-http", url: fixtureServer.url, headers: { authorization: "Bearer fixture-secret" } },
      { serverId: "optional-down", required: false, transport: "streamable-http", url: "http://127.0.0.1:9/mcp", reconnectAttempts: 1, timeoutMs: 100 },
    ]);
    assert.deepEqual(optional.unavailableServerIds(), ["optional-down"]);
    assert.deepEqual((await optional.callTool("secure.echo", { text: "secret" }) as any).content, [{ type: "text", text: "http:secret" }]);
    const required = new McpBridge();
    await assert.rejects(
      required.initialize([{ serverId: "required-down", required: true, transport: "streamable-http", url: "http://127.0.0.1:9/mcp", reconnectAttempts: 1, timeoutMs: 100 }]),
      (error) => error instanceof RequiredMcpUnavailableError,
    );
  } finally {
    await optional.close();
    await fixtureServer.close();
  }
});

test("closing the bridge reaps its local stdio process", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-mcp-pid-"));
  const pidFile = join(root, "pid");
  const bridge = new McpBridge();
  try {
    await bridge.initialize([{
      serverId: "local", required: true, transport: "stdio", command: process.execPath, args: [fixture],
      environment: { PIWORK_MCP_PID_FILE: pidFile },
    }]);
    const pid = Number(await readFile(pidFile, "utf8"));
    await bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.throws(() => process.kill(pid, 0));
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
