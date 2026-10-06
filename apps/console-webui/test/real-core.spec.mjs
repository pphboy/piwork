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
test.use({ viewport: { width: 1440, height: 900 } });
let root, core, consoleServer, origin, coreOrigin;
let nativeCoreOutput = "", nativeConsoleOutput = "";
function captureProcessOutput(child, append) {
  child.stdout?.on("data", (chunk) => append(chunk.toString()));
  child.stderr?.on("data", (chunk) => append(chunk.toString()));
}
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "piwork-console-real-core-"));
  const [corePort, grpcPort, consolePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const coreUrl = `http://127.0.0.1:${corePort}`;
  coreOrigin = coreUrl;
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

async function login(page) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Account', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What’s next for your Core?' })).toBeVisible();
}
test('delivered Serve UI uses real administrator users, revocation, and browser Skill upload', async ({page}) => {
  await login(page);
  await page.getByRole('link', { name: 'User access', exact: true }).click();
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await page.getByLabel('Account', { exact: true }).fill('new-user');
  await page.getByLabel('Password', { exact: true }).fill('new-user-password');
  await page.getByLabel('Confirm password').fill('new-user-password');
  await page.locator('#dialog-submit').click();
  const user = page.getByRole('row').filter({ has: page.getByRole('button', {name:'new-user',exact:true}) });
  await expect(user).toBeVisible();
  await user.getByRole('button', {name:'Disable',exact:true}).click();
  await page.locator('#dialog-submit').click();
  await expect(user.getByText('Disabled', {exact:true})).toBeVisible();
  await user.getByRole('button', {name:'Enable',exact:true}).click();
  await page.locator('#dialog-submit').click();
  await expect(user.getByText('Enabled', {exact:true})).toBeVisible();
  await user.getByRole('button', {name:'Reset password',exact:true}).click();
  await page.getByLabel('New password', {exact:true}).fill('replacement-password-123');
  await page.getByLabel('Confirm password', {exact:true}).fill('replacement-password-123');
  await page.locator('#dialog-submit').click();
  await expect(user).toBeVisible();
  const skillDirectory = join(root,'real-skill'); await mkdir(skillDirectory); await writeFile(join(skillDirectory,'SKILL.md'),'# Real Skill\n');
  await page.getByRole('link',{name:'Work setup',exact:true}).click();
  await page.getByRole('link',{name:'Skills',exact:true}).click();
  await page.getByRole('button',{name:'Add Skill',exact:true}).click();
  await page.getByLabel('Choose Skill directory').setInputFiles(skillDirectory);
  await page.getByRole('button',{name:'Upload Skill',exact:true}).click();
  await expect(page.getByRole('heading',{name:'real-skill',exact:true})).toBeVisible();
  expect(JSON.stringify(await page.context().cookies())).not.toContain('Bearer ');
});
async function saveFixtureRuntime(page) {
  await page.goto(`${origin}/runtime`);
  const image = page.getByLabel('Agent image', {exact:true});
  const edit = page.getByRole('button', {name:'Edit runtime',exact:true});
  await expect(image.or(edit).first()).toBeVisible();
  if (await edit.isVisible()) await edit.click();
  await page.getByLabel('Agent image', {exact:true}).fill(process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || 'piwork-agentd:go-migration-acceptance');
  await page.getByLabel('Model provider', {exact:true}).fill('anthropic');
  await page.getByLabel('Model ID', {exact:true}).fill('fixture');
  await page.getByLabel('API Key', {exact:true}).fill('browser-acceptance-only');
  await page.getByRole('button',{name:'Save runtime',exact:true}).click();
  await expect(page.getByRole('button',{name:'Edit runtime',exact:true})).toBeVisible({timeout:90000});
  // Saving persists configuration; automatic image/context preparation completes later.
  await expect.poll(async () => (await fetch(`${coreOrigin}/readyz`)).status,
    { timeout: 90000, message: 'Core preparation requires a reachable Docker Engine and the native acceptance Agent image' }).toBe(200);
}
test('real Serve runtime and starting point distinguish saved changes from existing Work', async ({page}) => {
  test.setTimeout(120000); await login(page); await saveFixtureRuntime(page);
  await page.getByRole('link',{name:'Work setup',exact:true}).click();
  await page.locator('[data-action="edit-defaults"][data-section="agentsMd"]').click();
  await page.locator('#agentsMd').fill('# Console native default\n');
  await page.locator('[data-action="save-defaults"]').click();
  await expect(page.getByText(/Saved.*confirmed|Starting point saved|Defaults saved/).first()).toBeVisible();
  await page.reload();
  await page.locator('[data-action="edit-defaults"][data-section="agentsMd"]').click();
  await expect(page.locator('#agentsMd')).toHaveValue('# Console native default\n');
});
test('real browser Package directory installs asynchronously and operation deep link recovers', async ({page}) => {
  test.setTimeout(120000); const directory = join(root,'native-console-package'); await mkdir(directory);
  await writeFile(join(directory,'package.json'),'{"name":"native-console-package","version":"1.0.0","pi":{"prompts":["review.md"]}}'); await writeFile(join(directory,'review.md'),'# Review\n');
  await login(page); await saveFixtureRuntime(page); await page.goto(`${origin}/packages`);
  await page.getByRole('button',{name:'Install Package',exact:true}).click();
  await page.getByRole('button',{name:'Local directory',exact:true}).click();
  await page.getByLabel('Choose Package directory').setInputFiles(directory);
  await page.locator('#dialog-submit').click();
  await expect(page.getByRole('heading',{name:'Package operation',exact:true})).toBeVisible({timeout:30000});
  await expect(page.getByText(/^succeeded$/i).first()).toBeVisible({timeout:90000});
  const operationURL = page.url(); await page.reload();
  await expect(page.getByText(/^succeeded$/i).first()).toBeVisible(); expect(page.url()).toBe(operationURL);
  await page.goto(`${origin}/packages`);
  await expect(page.getByRole('link',{name:'native-console-package',exact:true})).toBeVisible();
});
