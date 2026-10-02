import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const nativeCore = process.env.PIWORK_TEST_NATIVE_CORE || fileURLToPath(new URL("../../../dist/go/piwork-serve", import.meta.url));
const nativeConsole = process.env.PIWORK_TEST_NATIVE_CONSOLE || fileURLToPath(new URL("../../../dist/go/piwork-console", import.meta.url));
async function freePort() {
  const listener = createNetServer();
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
}
async function consoleResponds(url) {
  return new Promise((resolve) => {
    const request = httpsRequest(url, { rejectUnauthorized: false }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once("error", () => resolve(false));
    request.end();
  });
}
let root, core, consoleServer, origin;
let nativeCoreOutput = "", nativeConsoleOutput = "";
function captureProcessOutput(child, append) {
  child.stdout?.on("data", (chunk) => append(chunk.toString()));
  child.stderr?.on("data", (chunk) => append(chunk.toString()));
}
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "piwork-console-real-core-"));
  const [corePort, grpcPort, consolePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const coreUrl = `http://127.0.0.1:${corePort}`;
  core = spawn(nativeCore, ["serve", "--data-dir", join(root, "core"),
    "--listen", `127.0.0.1:${corePort}`, "--agent-grpc-listen", `127.0.0.1:${grpcPort}`,
    "--agent-grpc-advertise", `127.0.0.1:${grpcPort}`], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PIWORK_PACKAGE_HELPER_IMAGE:
        process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || "piwork-agentd:go-migration-acceptance" },
    });
  captureProcessOutput(core, (chunk) => { nativeCoreOutput += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${coreUrl}/healthz`)).ok) { ready = true; break; } } catch { /* Core is starting. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, "Core did not start");
  const bootstrap = spawnSync(nativeCore, ["--core", coreUrl, "--data-dir", join(root, "core"),
    "admin", "bootstrap", "--account", "admin", "--password-stdin"], { input: "correct horse battery\n", encoding: "utf8" });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  const certPath = join(root, "cert.pem"), keyPath = join(root, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  origin = `https://127.0.0.1:${consolePort}`;
  await mkdir(join(root, "console"), { mode: 0o700 });
  consoleServer = spawn(nativeConsole, ["serve", "--core", coreUrl, "--listen", `127.0.0.1:${consolePort}`,
    "--public-origin", origin, "--data-dir", join(root, "console"), "--tls-cert", certPath, "--tls-key", keyPath],
  { stdio: ["ignore", "pipe", "pipe"] });
  captureProcessOutput(consoleServer, (chunk) => { nativeConsoleOutput += chunk; });
  let consoleReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (consoleServer.exitCode !== null) break;
    if (await consoleResponds(`${origin}/login`)) { consoleReady = true; break; }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(consoleReady, "Go Console did not start");
});
test.afterAll(async () => {
  if (consoleServer?.exitCode === null) {
    consoleServer.kill("SIGTERM");
    await new Promise((done) => consoleServer.once("exit", done));
  }
  if (core && core.exitCode === null) { core.kill("SIGTERM"); await new Promise((done) => core.once("exit", done)); }
  if (root) await rm(root, { recursive: true, force: true });
});
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    console.error("Go Core process status:", core?.exitCode, nativeCoreOutput.slice(-3000));
    console.error("Go Console process status:", consoleServer?.exitCode, nativeConsoleOutput.slice(-3000));
  }
});

test("real Core administrator logs in, creates a user, and uploads a browser Skill directory", async ({ page }) => {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Runtime readiness: Not ready · RUNTIME_NOT_CONFIGURED")).toBeVisible();
  await page.getByRole("link", { name: "Users" }).click();
  await page.getByLabel("Account", { exact: true }).fill("new-user");
  await page.getByLabel("Password", { exact: true }).fill("new-user-password");
  await page.getByLabel("Confirm password").fill("new-user-password");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("row").filter({ has: page.getByRole("cell", { name: "new-user", exact: true }) })).toBeVisible();
  const skillDirectory = join(root, "real-skill");
  await mkdir(skillDirectory);
  await writeFile(join(skillDirectory, "SKILL.md"), "# Real Skill\n");
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByLabel("Select Skill directory").setInputFiles(skillDirectory);
  await page.getByRole("button", { name: "Upload Skill" }).click();
  await expect(page.getByRole("link", { name: "real-skill" })).toBeVisible();
  const cookieText = JSON.stringify(await page.context().cookies());
  expect(cookieText).not.toContain("Bearer ");
});

test("real Core user controls and Default Work changes round trip through Go Console", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${origin}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Users" }).click();
  const user = page.getByRole("row", { name: /new-user/ });
  await expect(user).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await user.getByRole("button", { name: "Disable" }).click();
  await expect(user.getByText("Disabled")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await user.getByRole("button", { name: "Enable" }).click();
  await expect(user.getByText("Enabled")).toBeVisible();
  await user.getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByLabel("New password", { exact: true }).fill("replacement-password-123");
  await page.getByLabel("Confirm new password").fill("replacement-password-123");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(user).toBeVisible();
  await page.getByRole("link", { name: "Runtime" }).click();
  await expect(page.getByText("Runtime is not configured.")).toBeVisible();
  await page.getByLabel("Agent image").fill(process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || "piwork-agentd:go-migration-acceptance");
  await page.getByLabel("Model provider").fill("anthropic");
  await page.getByLabel("Model ID").fill("fixture");
  await page.getByLabel("API Key").fill("browser-acceptance-only");
  await page.getByRole("button", { name: "Save runtime" }).click();
  await expect(page.getByText(/Configuration saved/)).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Default Work" }).click();
  const editor = page.getByLabel("AGENTS.md content");
  await editor.fill("# Console native default\n");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Defaults saved. Only future Work is affected.")).toBeVisible();
  await page.reload();
  await expect(editor).toHaveValue("# Console native default\n");
});

test("real Core accepts a browser Package directory through Go Console", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = join(root, "native-console-package");
  await mkdir(directory);
  await writeFile(join(directory, "package.json"), '{"name":"native-console-package","version":"1.0.0","pi":{"prompts":["review.md"]}}');
  await writeFile(join(directory, "review.md"), "# Review\n");
  await page.goto(`${origin}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("Source type").selectOption("directory");
  await page.getByLabel("Select local directory").setInputFiles(directory);
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Status: succeeded · Phase: succeeded")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Packages" }).click();
  await expect(page.getByRole("link", { name: "native-console-package" })).toBeVisible();
});
