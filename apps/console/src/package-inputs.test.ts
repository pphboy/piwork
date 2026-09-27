import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uploadBrowserPackage } from "./package-inputs.js";

test("package directory upload returns 408 and removes staging on idle or total timeout", async () => {
  for (const limits of [{ idleTimeoutMs: 50, totalTimeoutMs: 500 }, { idleTimeoutMs: 500, totalTimeoutMs: 50 }]) {
    const dataDir = await mkdtemp(join(tmpdir(), "piwork-package-input-timeout-"));
    let finished!: () => void;
    const complete = new Promise<void>((resolve) => { finished = resolve; });
    const server = createServer((incoming, response) => {
      void uploadBrowserPackage({ request: incoming, kind: "directory", dataDir, coreUrl: "http://127.0.0.1:1",
        token: "unused", beforeUpload: async () => { throw new Error("incomplete upload reached Core"); }, ...limits,
        onTimeout: (error) => { response.once("finish", () => incoming.destroy(error));
          response.writeHead(408, { "content-type": "application/json", connection: "close" });
          response.end('{"code":"CONSOLE_UPLOAD_TIMEOUT"}'); } })
        .catch(() => { if (!response.writableEnded && !response.destroyed) response.destroy(); }).finally(finished);
    });
    try {
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const wire = httpRequest({ hostname: "127.0.0.1", port: address.port, method: "POST", path: "/",
        headers: { "content-type": "multipart/form-data; boundary=piworktest" } });
      const reply = new Promise<{ status: number; body: string }>((resolve, reject) => {
        wire.on("error", reject); wire.on("response", (result) => { const chunks: Buffer[] = [];
          result.on("data", (chunk: Buffer) => chunks.push(chunk));
          result.on("end", () => resolve({ status: result.statusCode!, body: Buffer.concat(chunks).toString() })); }); });
      wire.write("--piworktest\r\nContent-Disposition: form-data; name=\"directoryName\"\r\n\r\nslow\r\n" +
        "--piworktest\r\nContent-Disposition: form-data; name=\"files\"; filename=\"package.json\"\r\n\r\n{\"name\":");
      assert.deepEqual(await reply, { status: 408, body: '{"code":"CONSOLE_UPLOAD_TIMEOUT"}' });
      await complete;
      assert.deepEqual(await readdir(join(dataDir, "staging")), []);
      wire.destroy();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(dataDir, { recursive: true, force: true });
    }
  }
});
