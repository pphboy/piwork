import { createServer, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFixtureMcpServer } from "./mcp-server.js";

export async function startHttpMcpFixture(port = 0, expectedAuthorization?: string): Promise<{
  readonly url: string;
  close(): Promise<void>;
}> {
  const httpServer = createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (expectedAuthorization !== undefined && request.headers.authorization !== expectedAuthorization) {
      response.writeHead(401).end();
      return;
    }
    const server = createFixtureMcpServer("http");
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } finally {
      response.once("close", () => {
        void transport.close();
        void server.close();
      });
    }
  });
  await listen(httpServer, port);
  const address = httpServer.address();
  if (address === null || typeof address === "string") throw new Error("HTTP fixture did not bind a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => close(httpServer),
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}
