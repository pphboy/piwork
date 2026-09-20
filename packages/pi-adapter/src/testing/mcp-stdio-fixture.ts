import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync } from "node:fs";
import { createFixtureMcpServer } from "./mcp-server.js";

if (process.env.PIWORK_MCP_PID_FILE !== undefined) {
  writeFileSync(process.env.PIWORK_MCP_PID_FILE, String(process.pid), { mode: 0o600 });
}

const server = createFixtureMcpServer("stdio");
await server.connect(new StdioServerTransport());
