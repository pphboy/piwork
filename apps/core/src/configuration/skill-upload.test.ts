import assert from "node:assert/strict";
import { request as httpRequest, createServer } from "node:http";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { receiveSkillUpload } from "./skill-upload.js";

test("Skill upload idle and total timeouts discard incomplete staging", async () => {
  for (const timeouts of [{ idleTimeoutMs: 50, totalTimeoutMs: 500 }, { idleTimeoutMs: 500, totalTimeoutMs: 50 }]) {
    const root = await mkdtemp(join(tmpdir(), "piwork-skill-timeout-"));
    const stagingRoot = join(root, "stage"); await mkdir(stagingRoot);
    let published = false, finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const server = createServer((incoming, response) => {
      void receiveSkillUpload({ request: incoming, stagingRoot, ...timeouts, beforeCommit: () => undefined,
        onTimeout: (error) => { response.once("finish", () => incoming.destroy(error));
          response.writeHead(408, { "content-type": "application/json", connection: "close" });
          response.end(JSON.stringify({ code: "SKILL_UPLOAD_TIMEOUT" })); },
        publish: () => { published = true; throw new Error("incomplete content was published"); } })
        .catch(() => { if (!response.writableEnded && !response.destroyed) response.destroy(); }).finally(finish);
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
        "--piworktest\r\nContent-Disposition: form-data; name=\"files\"; filename=\"SKILL.md\"\r\n\r\npartial");
      let watchdog: NodeJS.Timeout | undefined;
      try { await Promise.race([finished, new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error("upload timeout did not fire")), 1500);
      })]); } finally { if (watchdog) clearTimeout(watchdog); }
      assert.deepEqual(await reply, { status: 408, body: '{"code":"SKILL_UPLOAD_TIMEOUT"}' });
      wire.destroy();
      assert.equal(published, false);
      assert.deepEqual(await readdir(stagingRoot), []);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  }
});
