import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpBridge, RequiredMcpUnavailableError, modelMcpToolName } from "./mcp-bridge.js";
import { startHttpMcpFixture } from "./testing/mcp-http-fixture.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "testing", "mcp-stdio-fixture.js");

test("Work MCP shutdown reaps stdio, leaves remote service alive, and replacement config has fresh tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-mcp-lifecycle-"));
  const pidFile = join(root, "pid");
  const remote = await startHttpMcpFixture(0, "Bearer fixture-secret");
  const first = new McpBridge(), replacement = new McpBridge();
  try {
    await first.initialize([
      { serverId: "old-local", required: true, transport: "stdio", command: process.execPath, args: [fixture], environment: { PIWORK_MCP_PID_FILE: pidFile } },
      { serverId: "remote", required: true, transport: "streamable-http", url: remote.url, headers: { authorization: "Bearer fixture-secret" } },
    ]);
    const pid = Number(await readFile(pidFile, "utf8"));
    await first.close();
    assert.throws(() => process.kill(pid, 0));
    await assert.rejects(first.callTool("remote.echo", { text: "closed" }));
    await replacement.initialize([
      { serverId: "new-local", required: true, transport: "stdio", command: process.execPath, args: [fixture], environment: { PIWORK_MCP_PID_FILE: pidFile } },
      { serverId: "remote", required: true, transport: "streamable-http", url: remote.url, headers: { authorization: "Bearer fixture-secret" } },
    ]);
    assert.notEqual(Number(await readFile(pidFile, "utf8")), pid);
    assert.deepEqual(replacement.listTools().map((tool) => tool.namespacedName), ["new-local.echo", "remote.echo"]);
    assert.deepEqual((await replacement.callTool("remote.echo", { text: "still-alive" }) as any).content, [{ type: "text", text: "http:still-alive" }]);
  } finally { await first.close(); await replacement.close(); await remote.close(); await rm(root, { recursive: true, force: true }); }
});

test("two stdio servers namespace identical tools and route calls correctly", async () => {
  const bridge = new McpBridge();
  await bridge.initialize([
    { serverId: "one", required: true, transport: "stdio", command: process.execPath, args: [fixture], timeoutMs: 500 },
    { serverId: "two", required: true, transport: "stdio", command: process.execPath, args: [fixture] },
  ]);
  try {
    assert.deepEqual(bridge.listTools().map((tool) => [tool.namespacedName, tool.modelName]), [
      ["one.echo", "one__echo"],
      ["two.echo", "two__echo"],
    ]);
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

test("model-facing MCP names satisfy provider identifier limits without changing canonical routing", () => {
  assert.equal(modelMcpToolName("work-services", "deployment_context"), "work-services__deployment_context");
  assert.match(modelMcpToolName("server.with.dots", "tool/with/slashes"), /^[a-zA-Z0-9_-]+$/);
  const long = modelMcpToolName("s".repeat(64), "t".repeat(64));
  assert.equal(long.length, 64);
  assert.match(long, /^[a-zA-Z0-9_-]+$/);
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
    await assert.rejects(optional.callTool("optional-down.echo", { text: "unavailable" }));
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

test("a failed stdio call is not replayed and the next explicit call reconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-mcp-reconnect-"));
  const pidFile = join(root, "pid");
  const bridge = new McpBridge();
  try {
    await bridge.initialize([{
      serverId: "local", required: true, transport: "stdio", command: process.execPath, args: [fixture],
      environment: { PIWORK_MCP_PID_FILE: pidFile }, timeoutMs: 500, reconnectAttempts: 2,
    }]);
    const originalPid = Number(await readFile(pidFile, "utf8"));
    process.kill(originalPid, "SIGKILL");
    await assert.rejects(bridge.callTool("local.echo", { text: "uncertain" }));
    assert.deepEqual((await bridge.callTool("local.echo", { text: "explicit-retry" }) as any).content, [
      { type: "text", text: "stdio:explicit-retry" },
    ]);
    const replacementPid = Number(await readFile(pidFile, "utf8"));
    assert.notEqual(replacementPid, originalPid);
    assert.deepEqual(bridge.unavailableServerIds(), []);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a slow MCP tool call times out without replay and a later call can reconnect", async () => {
  const bridge = new McpBridge();
  try {
    await bridge.initialize([{
      serverId: "slow", required: true, transport: "stdio", command: process.execPath, args: [fixture],
      timeoutMs: 100, reconnectAttempts: 1,
    }]);
    const started = Date.now();
    await assert.rejects(bridge.callTool("slow.echo", { text: "slow" }));
    assert.ok(Date.now() - started < 900, "tool deadline must bound a slow response");
    assert.deepEqual(bridge.unavailableServerIds(), ["slow"]);
    assert.deepEqual((await bridge.callTool("slow.echo", { text: "explicit-retry" }) as any).content, [
      { type: "text", text: "stdio:explicit-retry" },
    ]);
  } finally {
    await bridge.close();
  }
});
