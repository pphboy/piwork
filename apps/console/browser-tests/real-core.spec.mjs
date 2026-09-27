import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConsoleServer } from "../dist/server.js";

const coreCli = fileURLToPath(new URL("../../core/dist/cli.js", import.meta.url));
const workspace = fileURLToPath(new URL("../../..", import.meta.url));
async function freePort() {
  const listener = createNetServer();
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
}
let root, core, consoleServer, origin;
test.beforeAll(async () => {
  execFileSync("npm", ["run", "build", "-w", "@piwork/core"], { cwd: workspace, stdio: "ignore" });
  root = await mkdtemp(join(tmpdir(), "piwork-console-real-core-"));
  const [corePort, grpcPort, consolePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const coreUrl = `http://127.0.0.1:${corePort}`;
  core = spawn(process.execPath, [coreCli, "serve", "--data-dir", join(root, "core"),
    "--listen", `127.0.0.1:${corePort}`, "--agent-grpc-listen", `127.0.0.1:${grpcPort}`,
    "--agent-grpc-advertise", `127.0.0.1:${grpcPort}`], { stdio: "ignore" });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${coreUrl}/healthz`)).ok) { ready = true; break; } } catch { /* Core is starting. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, "Core did not start");
  const bootstrap = spawnSync(process.execPath, [coreCli, "--core", coreUrl, "--data-dir", join(root, "core"),
    "admin", "bootstrap", "--account", "admin", "--password-stdin"], { input: "correct horse battery\n", encoding: "utf8" });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  const certPath = join(root, "cert.pem"), keyPath = join(root, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  origin = `https://127.0.0.1:${consolePort}`;
  await mkdir(join(root, "console"), { mode: 0o700 });
  consoleServer = await createConsoleServer({ coreUrl, listenHost: "127.0.0.1", listenPort: consolePort,
    publicOrigin: origin, dataDir: join(root, "console"), cert: await readFile(certPath), key: await readFile(keyPath) });
  await new Promise((done) => consoleServer.listen(consolePort, "127.0.0.1", done));
});
test.afterAll(async () => {
  if (consoleServer) await new Promise((done) => consoleServer.close(done));
  if (core && core.exitCode === null) { core.kill("SIGTERM"); await new Promise((done) => core.once("exit", done)); }
  if (root) await rm(root, { recursive: true, force: true });
});

test("real Core administrator logs in, creates a user, and uploads a browser Skill directory", async ({ page }) => {
  await page.goto(`${origin}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("运行就绪：未就绪 · RUNTIME_NOT_CONFIGURED")).toBeVisible();
  await page.getByRole("link", { name: "用户" }).click();
  await page.getByLabel("账号", { exact: true }).fill("new-user");
  await page.getByLabel("密码", { exact: true }).fill("new-user-password");
  await page.getByLabel("确认密码").fill("new-user-password");
  await page.getByRole("button", { name: "创建用户" }).click();
  await expect(page.getByRole("row", { name: /new-user user/ })).toBeVisible();
  const skillDirectory = join(root, "real-skill");
  await mkdir(skillDirectory);
  await writeFile(join(skillDirectory, "SKILL.md"), "# Real Skill\n");
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByLabel("选择 Skill 目录").setInputFiles(skillDirectory);
  await page.getByRole("button", { name: "上传 Skill" }).click();
  await expect(page.getByRole("link", { name: "real-skill" })).toBeVisible();
  const cookieText = JSON.stringify(await page.context().cookies());
  expect(cookieText).not.toContain("Bearer ");
});
