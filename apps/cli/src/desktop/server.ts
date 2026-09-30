import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProxyCoreUrl } from "../service-proxy.js";
import { FileCredentialStore, type CredentialRecord } from "@piwork/client-sdk";
import { DesktopSessions } from "./session.js";
import { DesktopIdentity } from "./identity.js";
import { serveDesktopApi } from "./api.js";
import { BrowserServiceAccess } from "./service-access.js";
import { serveDesktopFiles } from "./files.js";
import { DesktopTransfers } from "./transfers.js";
import { DesktopOperationRecords } from "./operation-records.js";

const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));
const browserDirectory = fileURLToPath(new URL("./browser/", import.meta.url));
const maxHeaderBytes = 32 * 1024;

export interface DesktopOptions { readonly port: number; readonly open: boolean; }

function usage(message: string): Error {
  return Object.assign(new Error(message), { exitCode: 2 });
}

export function parseDesktopOptions(args: readonly string[]): DesktopOptions {
  let port = 17891, seenPort = false, open = true, seenNoOpen = false;
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === "--no-open" && !seenNoOpen) { seenNoOpen = true; open = false; continue; }
    if (value === "--port" && !seenPort) {
      const raw = args[++i];
      if (!raw || !/^[0-9]+$/.test(raw)) throw usage("desktop port must be 1..65535");
      port = Number(raw);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw usage("desktop port must be 1..65535");
      seenPort = true;
      continue;
    }
    throw usage(`unknown or duplicate desktop option: ${value}`);
  }
  return { port, open };
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

function reject(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(code);
}

function serveStatic(request: IncomingMessage, response: ServerResponse, port: number): void {
  if (request.headers.host !== `desktop.localhost:${port}`) return reject(response, 403, "LOCAL_HOST_DENIED");
  if (request.method !== "GET" && request.method !== "HEAD") return reject(response, 405, "METHOD_NOT_ALLOWED");
  const rawPath = (request.url ?? "").split("?", 1)[0] ?? "";
  const path = rawPath === "/style.css" ? join(publicDirectory, "style.css")
    : /^\/desktop\/browser\/[a-z][a-z0-9-]*\.js$/.test(rawPath) ? join(browserDirectory, rawPath.slice("/desktop/browser/".length))
    : rawPath === "/" || /^\/works\/[^/]+(?:\/services\/[^/]+)?$/.test(rawPath) ? join(publicDirectory, "index.html")
    : undefined;
  if (!path || !existsSync(path)) return reject(response, 404, "NOT_FOUND");
  const base = rawPath.startsWith("/desktop/browser/") ? browserDirectory : publicDirectory;
  if (!resolve(path).startsWith(resolve(base) + sep)) return reject(response, 403, "LOCAL_PATH_DENIED");
  const size = statSync(path).size;
  response.writeHead(200, { "content-type": contentType(path), "content-length": size, "cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "origin-agent-cluster": "?1",
    "cross-origin-opener-policy": "same-origin", "content-security-policy": `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src http://*.desktop.localhost:${port}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
  if (request.method === "HEAD") response.end();
  else createReadStream(path).pipe(response);
}

export async function runDesktop(coreUrl: string, options: DesktopOptions, store: FileCredentialStore, credential?: CredentialRecord,
  output: (message: string) => void = (message) => process.stdout.write(message)): Promise<number> {
  validateProxyCoreUrl(coreUrl);
  for (const path of [join(publicDirectory, "index.html"), join(publicDirectory, "style.css"), join(browserDirectory, "app.js")]) {
    if (!existsSync(path)) throw Object.assign(new Error("Desktop browser resources are missing; rebuild piwork-cli"), { exitCode: 5 });
  }
  const sockets = new Set<Socket>();
  const sessions = new DesktopSessions(options.port);
  const identity = new DesktopIdentity(coreUrl, store, credential);
  const serviceAccess = new BrowserServiceAccess(options.port, sessions, identity);
  const transfers = new DesktopTransfers(store.path, identity);
  const records = new DesktopOperationRecords(store.path);
  const server = createServer({ maxHeaderSize: maxHeaderBytes }, (request, response) => {
    if (request.headers.host !== `desktop.localhost:${options.port}`) {
      void serviceAccess.handleApp(request, response);
      return;
    }
    if ((request.url ?? "").startsWith("/_desktop/files/")) { void serveDesktopFiles(request, response, sessions, identity); return; }
    if ((request.url ?? "").startsWith("/_desktop/api/")) { void serveDesktopApi(request, response, sessions, identity, serviceAccess, transfers, records); return; }
    serveStatic(request, response, options.port);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("connect", (_request, socket) => {
    socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
  });
  server.on("upgrade", (request, socket, head) => { void serviceAccess.handleUpgrade(request, socket, head); });
  server.on("clientError", (_error, socket) => { socket.destroy(); });
  try {
    await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(options.port, "127.0.0.1", done); });
  } catch (error) {
    server.close();
    const code = (error as NodeJS.ErrnoException).code;
    throw Object.assign(new Error(code === "EADDRINUSE" ? "Desktop port is already in use" : "Desktop listener could not start"),
      { exitCode: code === "EADDRINUSE" ? 6 : 5 });
  }
  const url = sessions.launchUrl;
  output(`Piwork Desktop: ${url}\n`);
  if (options.open) void openBrowser(url).catch(() => process.stderr.write(`Could not open a browser. Open ${url} manually.\n`));
  return new Promise<number>((done) => {
    let stopped = false;
    const stop = (code: number) => {
      if (stopped) return;
      stopped = true;
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      server.close();
      serviceAccess.clear();
      sessions.clear();
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      void transfers.clear().then(() => done(code), () => done(code));
    };
    const interrupt = () => stop(130);
    const terminate = () => stop(143);
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
  });
}

function openBrowser(url: string): Promise<void> {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", fail);
    child.once("exit", (code) => code === 0 ? done() : fail(new Error("Browser opener failed")));
  });
}
