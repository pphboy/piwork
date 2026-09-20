import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

export function createFixtureMcpServer(transportName: "stdio" | "http"): McpServer {
  const server = new McpServer({ name: `piwork-${transportName}-fixture`, version: "1.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Returns deterministic fixture text",
      inputSchema: { text: z.string() },
    },
    async ({ text }) => {
      if (text === "slow") await new Promise((resolve) => setTimeout(resolve, 1_000));
      return { content: [{ type: "text", text: `${transportName}:${text}` }] };
    },
  );
  return server;
}
