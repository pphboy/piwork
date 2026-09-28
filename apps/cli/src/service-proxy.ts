import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { PiworkClient } from "@piwork/client-sdk";

const domainPattern = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.w-[a-f0-9]{8,61}\.work$/;
const maxHeaderBytes = 32 * 1024;

export function parseProxyPort(args: readonly string[]): number {
  if (args.length === 0) return 17890;
  if (args.length !== 2 || args[0] !== "--port" || !/^[0-9]+$/.test(args[1] ?? "")) throw proxyUsage("usage: piwork-cli proxy [--port <1..65535>]");
  const port = Number(args[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw proxyUsage("proxy port must be 1..65535");
  return port;
}

export function validateProxyCoreUrl(raw: string): void {
  const url = new URL(raw);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
    throw proxyUsage("remote Core connections require HTTPS");
  }
}

export async function runServiceProxy(client: PiworkClient, port: number,
  output: (message: string) => void = (message) => process.stdout.write(message)): Promise<number> {
  await client.gatewayCapability();
  const sockets = new Set<Duplex>();
  const upstreamSockets = new Set<Duplex>();
  let sessionLost = false;
  let stop!: (code: number) => void;
  const completed = new Promise<number>((resolve) => { stop = resolve; });
  const server = createServer({ maxHeaderSize: maxHeaderBytes }, (request, response) => { void serve(request, response); });
  server.on("clientError", (error, socket) => {
    if (socket.destroyed) return;
    if ((error as NodeJS.ErrnoException).code === "HPE_HEADER_OVERFLOW") rejectSocket(socket, 431, "HEADERS_TOO_LARGE", true);
    else socket.destroy();
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  const shutdown = (code: number) => {
    server.close();
    for (const socket of sockets) socket.destroy();
    for (const socket of upstreamSockets) socket.destroy();
    process.off("SIGINT", interrupt);
    stop(code);
  };
  const interrupt = () => shutdown(130);
  const onPlatformError = (status: number, headers: Record<string, unknown>) => {
    if (status === 401 && headers["x-piwork-gateway-error"] === "1" && !sessionLost) {
      sessionLost = true;
      process.stderr.write("AUTH_REQUIRED: Core session expired; restart the proxy after login.\n");
      shutdown(3);
    }
  };
  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url === "/proxy.pac" && request.method === "GET") {
      const peer = request.socket.remoteAddress ?? "";
      if (!isLoopback(peer)) return reject(response, 403, "PAC_LOCAL_ONLY");
      const script = pac(port);
      response.writeHead(200, { "content-type": "application/x-ns-proxy-autoconfig", "content-length": Buffer.byteLength(script), "cache-control": "no-store" });
      response.end(script);
      return;
    }
    let target: ServiceTarget;
    try { target = serviceUrl(request.url ?? ""); }
    catch { return reject(response, 403, "PROXY_TARGET_DENIED"); }
    try {
      await client.resolveService(target.hostname, target.port);
      const upstream = client.gatewayRequest({ hostname: target.hostname, port: target.port,
        path: target.rawPath, method: request.method ?? "GET", headers: request.headers }, (incoming) => {
        onPlatformError(incoming.statusCode ?? 502, incoming.headers);
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on("error", () => { if (!response.headersSent) reject(response, 502, "CORE_UNAVAILABLE"); else response.destroy(); });
      request.once("aborted", () => upstream.destroy());
      request.pipe(upstream);
    } catch (error) {
      const item = error as { status?: number; code?: string };
      if (item.status === 401) { onPlatformError(401, { "x-piwork-gateway-error": "1" }); return reject(response, 401, "AUTH_REQUIRED"); }
      reject(response, item.status ?? 502, item.code ?? "CORE_UNAVAILABLE");
    }
  }
  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      try {
        const target = serviceUrl(request.url ?? "", true);
        if (request.headers.upgrade?.toLowerCase() !== "websocket") throw new Error("upgrade required");
        await client.resolveService(target.hostname, target.port);
        forwardUpgrade(client, target.hostname, target.port, target.rawPath, request.headers, socket, head, onPlatformError, upstreamSockets);
      } catch (error) {
        if ((error as { status?: number }).status === 401) onPlatformError(401, { "x-piwork-gateway-error": "1" });
        rejectSocket(socket, (error as { status?: number }).status ?? 403, (error as { code?: string }).code ?? "PROXY_TARGET_DENIED");
      }
    })();
  });
  server.on("connect", (request, socket, head) => {
    void (async () => {
      try {
        const authority = request.url ?? "";
        const match = /^([a-z0-9.-]+):([0-9]{1,5})$/i.exec(authority);
        if (!match) throw new Error("target denied");
        const host = match[1]!.toLowerCase().replace(/\.$/, ""), targetPort = Number(match[2]);
        if (!domainPattern.test(host)) throw new Error("target denied");
        if (targetPort === 443 || targetPort < 1 || targetPort > 65_535) throw new Error("secure CONNECT denied");
        await client.resolveService(host, targetPort);
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        let pending = head;
        const deadline = setTimeout(() => socket.destroy(), 10_000);
        deadline.unref();
        socket.once("close", () => clearTimeout(deadline));
        const consume = (chunk: Buffer) => {
          pending = Buffer.concat([pending, chunk]);
          const end = pending.indexOf("\r\n\r\n");
          if ((end < 0 ? pending.length : end + 4) > maxHeaderBytes) return rejectSocket(socket, 431, "HEADERS_TOO_LARGE", true);
          if (pending.length >= 4 && pending.subarray(0, 4).toString("ascii") !== "GET ") return socket.destroy();
          if (end < 0) return;
          clearTimeout(deadline);
          socket.off("data", consume);
          const parsed = parseConnectUpgrade(pending.subarray(0, end + 4), host, targetPort);
          if (!parsed) return socket.destroy();
          const extra = pending.subarray(end + 4);
          forwardUpgrade(client, host, targetPort, parsed.path, parsed.headers, socket, extra, onPlatformError, upstreamSockets);
        };
        socket.on("data", consume);
        if (pending.length) { pending = Buffer.alloc(0); consume(head); }
      } catch (error) {
        if ((error as { status?: number }).status === 401) onPlatformError(401, { "x-piwork-gateway-error": "1" });
        rejectSocket(socket, (error as { status?: number }).status ?? 403, (error as { code?: string }).code ?? "PROXY_TARGET_DENIED");
      }
    })();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    server.close();
    if ((error as { code?: string }).code === "EADDRINUSE") throw Object.assign(new Error("proxy port is occupied"), { exitCode: 6 });
    throw error;
  }
  process.on("SIGINT", interrupt);
  output(`Proxy: http://127.0.0.1:${port}\nPAC: http://127.0.0.1:${port}/proxy.pac\n`);
  return completed;
}

function forwardUpgrade(client: PiworkClient, hostname: string, port: number, path: string, headers: IncomingMessage["headers"],
  socket: Duplex, head: Buffer, onPlatformError: (status: number, headers: Record<string, unknown>) => void,
  upstreamSockets: Set<Duplex>): void {
  const upstream = client.gatewayRequest({ hostname, port, path, method: "GET", headers: { ...headers, connection: "Upgrade", upgrade: "websocket" } });
  upstream.once("upgrade", (incoming, remote, remoteHead) => {
    upstreamSockets.add(remote);
    const lines = Object.entries(incoming.headers).filter(([key, value]) => key !== "x-piwork-gateway-error" && value !== undefined)
      .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((part) => `${key}: ${part}`)).join("\r\n");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines}\r\n\r\n`);
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket);
    remote.once("close", () => { upstreamSockets.delete(remote); socket.destroy(); });
    socket.once("close", () => remote.destroy());
  });
  upstream.once("response", (incoming) => {
    onPlatformError(incoming.statusCode ?? 502, incoming.headers);
    if (socket.destroyed) { incoming.resume(); return; }
    socket.write(rawResponseHead(incoming));
    incoming.pipe(socket);
  });
  upstream.once("error", () => rejectSocket(socket, 502, "CORE_UNAVAILABLE"));
  socket.once("close", () => upstream.destroy());
  upstream.end();
}

function rawResponseHead(response: IncomingMessage): string {
  const lines = Object.entries(response.headers).filter(([name, value]) =>
    value !== undefined && name !== "connection" && name !== "transfer-encoding")
    .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((part) => `${name}: ${part}`));
  lines.push("connection: close");
  return `HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ""}\r\n${lines.join("\r\n")}\r\n\r\n`;
}

function parseConnectUpgrade(raw: Buffer, hostname: string, port: number): { path: string; headers: IncomingMessage["headers"] } | undefined {
  const lines = raw.toString("latin1").split("\r\n");
  const first = /^GET (\/[^ ]*) HTTP\/1\.1$/.exec(lines.shift() ?? "");
  if (!first) return undefined;
  const headers: Record<string, string> = {};
  for (const line of lines) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1) return undefined;
    const key = line.slice(0, colon).toLowerCase();
    if (key in headers) return undefined;
    headers[key] = line.slice(colon + 1).trim();
  }
  const expected = hostname + (port === 80 ? "" : `:${port}`);
  const claimed = headers.host?.toLowerCase().replace(/\.work\.(?=:|$)/, ".work");
  if ((claimed !== expected && claimed !== `${hostname}:${port}`) || headers.upgrade?.toLowerCase() !== "websocket"
    || !headers.connection?.toLowerCase().split(",").some((name) => name.trim() === "upgrade")) return undefined;
  return { path: first[1]!, headers };
}

type ServiceTarget = { hostname: string; port: number; rawPath: string };

function serviceUrl(raw: string, allowWs = false): ServiceTarget {
  const absolute = /^([a-z][a-z0-9+.-]*):\/\/([a-z0-9.-]+(?::[0-9]{1,5})?)(\/[^#]*|\?[^#]*)?$/i.exec(raw);
  if (!absolute) throw new Error("target denied");
  const target = new URL(raw);
  target.hostname = target.hostname.replace(/\.$/, "");
  if ((target.protocol !== "http:" && !(allowWs && target.protocol === "ws:")) || !domainPattern.test(target.hostname) || target.username || target.password || target.hash) throw new Error("target denied");
  const suffix = absolute[3] ?? "/";
  return { hostname: target.hostname, port: Number(target.port || 80), rawPath: suffix.startsWith("?") ? `/${suffix}` : suffix };
}

function pac(port: number): string {
  return `function FindProxyForURL(url, host) {\n  if (/^(http|ws):\\/\\//i.test(url) && /^[a-z][a-z0-9-]*\\.w-[a-f0-9]{8,61}\\.work\\.?$/i.test(host)) return "PROXY 127.0.0.1:${port}";\n  return "DIRECT";\n}\n`;
}

function isLoopback(address: string): boolean { return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"; }
function reject(response: ServerResponse, status: number, code: string): void { if (response.headersSent) { response.destroy(); return; } const body = JSON.stringify({ code }); response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) }); response.end(body); }
function rejectSocket(socket: Duplex, status: number, code: string, platform = false): void { if (socket.destroyed || socket.writableEnded) return; const body = JSON.stringify({ code }); socket.end(`HTTP/1.1 ${status} Proxy Error\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n${platform ? "x-piwork-gateway-error: 1\r\n" : ""}connection: close\r\n\r\n${body}`); }
function proxyUsage(message: string): Error { return Object.assign(new Error(message), { exitCode: 2 }); }
