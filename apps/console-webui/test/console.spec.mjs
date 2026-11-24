import { test, expect } from "@playwright/test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

let root, consoleServer, coreServer, base;
let nativeConsole;
let nativeConsoleOutput = "";
async function startNativeConsole(binary, args) {
  const child = spawn(binary, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { nativeConsoleOutput += chunk; });
  child.stderr.on("data", (chunk) => { nativeConsoleOutput += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (nativeConsoleOutput.includes("hosted fixture listening")) return child;
    if (child.exitCode !== null) throw new Error(`Go Console exited: ${nativeConsoleOutput}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Go Console did not listen: ${nativeConsoleOutput}`);
}
const users = [{ id: "user-admin-00000001", account: "admin", role: "admin", enabled: true }];
const skillUploads = [];
const skillSaves = [];
let managedSkillExists = false, managedSkillEnabled = true;
let extraSkills = [];
const skillFiles = new Map();
function fileVersion(content) { return "file-sha256:" + createHash("sha256").update(content).digest("hex"); }
function seedSkill(name, files, enabled = true) {
  skillFiles.set(name, new Map(Object.entries(files)));
  const bytes = Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  extraSkills.push({ name, enabled, fileCount: Object.keys(files).length, totalBytes: bytes, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
}
function skillEntry(name, enabled) {
  const files = skillFiles.get(name) || new Map();
  const bytes = [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  return { name, enabled, fileCount: files.size, totalBytes: bytes, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}
const packageUploads = [];
const packageAccepts = [];
const packageUpdates = [];
let packageCatalog = [];
let packageDetailExists = true, packageDetailEnabled = true, packageDetailDefault = false;
let operationPhase = null;
let operationState = "succeeded", operationDelayMs = 0, operationInFlight = 0, operationMaxInFlight = 0, operationRequests = 0;
const defaultPatches = [];
let defaultReads = 0;
let defaultAgents = "# initial\n";
let defaultSkills = [], defaultPackages = [];
const runtimeSaves = [];
let runtimeConfigured = true;
let runtimeLast = null;
const credentialResets = [];
let userReads = 0;
const userActions = [];
let protectAdministrator = true;
async function freePort() { const server = createNetServer(); await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port; await new Promise((done) => server.close(done)); return port; }
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "piwork-console-browser-"));
  nativeConsole=join(root,'hosted-ui-fixture');
  const build=spawnSync('go',['build','-o',nativeConsole,'./scripts/hosted-ui-fixture'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:{...process.env,CGO_ENABLED:'0'},encoding:'utf8'});
  expect(build.status,build.stderr).toBe(0);
  coreServer = createHttpServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = req.headers["content-type"]?.startsWith("application/json") && chunks.length ? JSON.parse(raw) : {};
    res.setHeader("content-type", "application/json");
    if (req.url === "/readyz") { res.end(JSON.stringify({ checks: { administrator: true } })); return; }
    if (req.url === "/healthz") { res.end('{"status":"healthy"}'); return; }
    if (req.url === "/api/v1/login") {
      const additional = users.find(item => item.account === body.account && item.account === "new-admin" && item.role === "admin");
      if (additional && body.password === "new administrator pass") {
        res.end(JSON.stringify({ token: "second-admin-private-token", expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: additional })); return;
      }
      if (body.account !== "admin" || body.password !== "correct horse battery") { res.statusCode = 401; res.end('{"code":"AUTHENTICATION_FAILED"}'); return; }
      res.end(JSON.stringify({ token: "core-secret-bearer", expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: users[0] })); return; }
    if (req.url === "/api/v1/me") { res.end(JSON.stringify({... (req.headers.authorization === "Bearer second-admin-private-token" ? users.find(item => item.account === "new-admin") : users[0]), expiresAt:new Date(Date.now()+3600_000).toISOString()})); return; }
    if(req.url === "/api/v1/about"){res.end(JSON.stringify({aboutApiVersion:1,build:{program:"piwork-core",version:"core-about-fixture",commit:"fixture",modified:false,os:"linux",architecture:"amd64"},releaseNotes:{version:"core-about-fixture",title:"Changes",sections:[{title:"Fixes",items:["<script>window.notesExecuted=true</script>"]}]},releasesUrl:"https://github.com/pphboy/piwork/releases"}));return;}
    if (req.url === "/api/v1/admin/status" || req.url === "/control/status") { res.end(JSON.stringify({ adminApiVersion: 1, state: "READY", ready: true, hasUsers: true, preparation: {version: 1},
      checks: { administrator: true, runtimeConfigured: true, runtimeAvailable: true, filesystemMigrationReady: true } })); return; }
    if (req.url === "/api/v1/admin/model-providers") {res.end(JSON.stringify({providers:[]}));return;}
    if (req.url === "/api/v1/admin/models") {res.end(JSON.stringify({models:[{id:"managed-test-00001",providerId:"provider-test-00001",modelRef:"model-test-00000001",name:"Fixture model",model:"new-model",providerName:"Fixture provider",api:"anthropic-messages",enabled:true,providerEnabled:true,credentialAvailable:true,capabilityStatus:"sdk"}]}));return;}
    if(req.url === "/api/v1/admin/runtime-defaults"){res.end(JSON.stringify({agentImage:"piwork-agentd:fixture"}));return;}
    if (req.url === "/api/v1/admin/runtime") { if (req.method === "PUT") { runtimeSaves.push(body); runtimeConfigured = true;
        runtimeLast = { configured: true, agentImage: "piwork-agentd:fixture",
          modelRef: body.modelRef, model: { provider: body.provider ?? "anthropic", id: body.model ?? "new-model", credentialAvailable: true }, updatedAt: new Date().toISOString() };
        res.end(JSON.stringify({ runtime: runtimeLast,
        status: { adminApiVersion: 1, state: "RUNTIME_UNAVAILABLE", ready: false,
          checks: { administrator: true, runtimeConfigured: true, runtimeAvailable: false, filesystemMigrationReady: true } } })); }
      else res.end(JSON.stringify(runtimeConfigured ? runtimeLast ?? { configured: true, agentImage: "piwork-agentd:local",
        modelRef:"model-test-00000001", model: { provider: "anthropic", id: "fixture", credentialAvailable: true }, updatedAt: new Date().toISOString() } :
        { configured: false })); return; }
    if (req.url === "/api/v1/admin/default-work") { if (req.method === "GET") defaultReads += 1;
      if (req.method === "PATCH") { defaultPatches.push(body);
        if (body.agentsMd !== undefined) defaultAgents = body.agentsMd;
        if (body.skills !== undefined) defaultSkills = body.skills;
        if (body.packages !== undefined) defaultPackages = body.packages; }
      res.end(JSON.stringify({ baseImage: "piwork-agentd:local", configuration: { agentImage: { catalogId: "image-test" },
        modelRef: "model-test", skills: defaultSkills, packages: defaultPackages, agentsMd: defaultAgents } })); return; }
    if (req.url === "/api/v1/admin/users") { if (req.method === "POST") {
        if (users.some((item) => item.account === body.account)) { res.statusCode = 409;
          res.end('{"code":"CONFLICT","message":"账号已存在","field":"account"}'); return; }
        users.push({ id: body.account === "new-user" ? "user-created-00001" : "user-created-00002",
          account: body.account, role: body.role, enabled: true }); res.statusCode = 201; res.end(JSON.stringify(users.at(-1))); }
      else { userReads += 1; res.end(JSON.stringify({ users })); } return; }
    if (req.url?.startsWith("/api/v1/admin/users/") && req.url.endsWith("/reset-credential")) {
      const userId = req.url.split("/").at(-2);
      credentialResets.push({ path: req.url, body });
      const user = users.find((item) => item.id === userId);
      if (!user || user.account === "gone-user") {
        if (user) users.splice(users.indexOf(user), 1);
        res.statusCode = 404; res.end('{"code":"NOT_FOUND","message":"用户不存在"}'); return;
      }
      user.updatedAt = "2025-01-02T03:04:05.000Z";
      res.end(JSON.stringify({ userId, credentialReset: true })); return; }
    if (req.url?.startsWith("/api/v1/admin/users/") && (req.url.endsWith("/enable") || req.url.endsWith("/disable"))) {
      const segments = req.url.split("/"), id = segments.at(-2), enabled = segments.at(-1) === "enable";
      userActions.push({ id, enabled });
      if (id === users[0].id && !enabled && protectAdministrator) { res.statusCode = 409;
        res.end('{"code":"LAST_ADMINISTRATOR","message":"不能禁用最后管理员"}'); return; }
      const user = users.find((item) => item.id === id); if (user) user.enabled = enabled;
      res.end(JSON.stringify({ userId: id, enabled })); return; }
    if (req.url === "/api/v1/admin/skills") { if (req.method === "POST") { skillUploads.push({ raw, type: req.headers["content-type"], authorization: req.headers.authorization });
        managedSkillExists = true; managedSkillEnabled = true;
        skillFiles.set("code-review", new Map([["SKILL.md", "# Browser Skill\n"], ["reference.md", "reference-bytes"]]));
        res.statusCode = 201; res.end(JSON.stringify(skillEntry("code-review", true))); }
      else res.end(JSON.stringify({ skills: [...extraSkills, ...(managedSkillExists ? [skillEntry("code-review", managedSkillEnabled)] : [])] })); return; }
    const skillFileMatch = req.url?.match(/^\/api\/v1\/admin\/skills\/([^/]+)\/(files|file)(\?.*)?$/);
    if (skillFileMatch) {
      const [, encodedName, resource] = skillFileMatch;
      const name = decodeURIComponent(encodedName);
      const files = skillFiles.get(name) || (name === "code-review" && managedSkillExists ? skillFiles.get("code-review") : null);
      if (!files) { res.statusCode = 404; res.end('{"code":"SKILL_UNAVAILABLE"}'); return; }
      if (resource === "files") {
        res.end(JSON.stringify({ files: [...files.entries()].map(([path, content]) => ({ path, size: Buffer.byteLength(content) })) })); return;
      }
      const query = new URL(req.url, "http://fixture.invalid").searchParams;
      const target = query.get("path");
      if (req.method === "GET") {
        if (!target || !files.has(target)) { res.statusCode = 404; res.end('{"code":"SKILL_FILE_NOT_FOUND"}'); return; }
        const content = files.get(target);
        if (content.includes("\u0000") || content.includes("\ufffd")) { res.statusCode = 415; res.end('{"code":"SKILL_FILE_NOT_TEXT"}'); return; }
        res.end(JSON.stringify({ path: target, content, version: fileVersion(content) })); return;
      }
      if (req.method === "PUT") {
        if (!files.has(body.path)) { res.statusCode = 404; res.end('{"code":"SKILL_FILE_NOT_FOUND"}'); return; }
        if (fileVersion(files.get(body.path)) !== body.expectedVersion) { res.statusCode = 409; res.end('{"code":"SKILL_FILE_CONFLICT"}'); return; }
        files.set(body.path, body.content);
        skillSaves.push({ name, path: body.path, content: body.content, expectedVersion: body.expectedVersion });
        res.end(JSON.stringify({ path: body.path, version: fileVersion(body.content) })); return;
      }
    }
    const skillToggle = req.url?.match(/^\/api\/v1\/admin\/skills\/([^/]+)\/(enable|disable)$/);
    if (skillToggle) {
      const name = decodeURIComponent(skillToggle[1]);
      const enabled = skillToggle[2] === "enable";
      if (!enabled && defaultSkills.includes(name)) { res.statusCode = 409; res.end('{"code":"CONFLICT","field":"skills"}'); return; }
      if (name === "code-review") managedSkillEnabled = enabled;
      else { const entry = extraSkills.find(item => item.name === name); if (entry) entry.enabled = enabled; }
      res.end(JSON.stringify(skillEntry(name, enabled))); return;
    }
    const skillObject = req.url?.match(/^\/api\/v1\/admin\/skills\/([^/]+)$/);
    if (skillObject && req.method === "DELETE") {
      const name = decodeURIComponent(skillObject[1]);
      if (name === "code-review") managedSkillExists = false;
      else { const index = extraSkills.findIndex(item => item.name === name); if (index >= 0) extraSkills.splice(index, 1); }
      skillFiles.delete(name); res.statusCode = 204; res.end(); return;
    }
    if (req.url === "/api/v1/admin/skills/code-review") {
      if (!managedSkillExists) { res.statusCode = 404; res.end('{"code":"SKILL_UNAVAILABLE"}'); return; }
      if (req.method === "DELETE") { managedSkillExists = false; res.statusCode = 204; res.end(); return; }
      if (req.method === "PUT") { skillUploads.push({ raw, type: req.headers["content-type"], authorization: req.headers.authorization }); }
      res.end(JSON.stringify({ name: "code-review", enabled: managedSkillEnabled, fileCount: 2, totalBytes: 12 })); return; }
    if (req.url === "/api/v1/admin/skills/code-review/disable" || req.url === "/api/v1/admin/skills/code-review/enable") {
      managedSkillEnabled = req.url.endsWith("enable");
      res.end(JSON.stringify({ name: "code-review", enabled: managedSkillEnabled, fileCount: 2, totalBytes: 12 })); return; }
    if (req.url === "/api/v1/admin/package-uploads") { packageUploads.push({ bytes: Buffer.concat(chunks).length, headers: req.headers });
      res.statusCode = 201; res.end(JSON.stringify({ uploadId: "upload-0199e6d8abcd", expiresAt: new Date(Date.now() + 3600_000).toISOString() })); return; }
    if (req.url === "/api/v1/admin/packages") { if (req.method === "POST") { packageAccepts.push(body); res.statusCode = 202;
        res.end(JSON.stringify({ operationId: "operation-0199e6d8abcd", workId: null, correlationId: "correlation-0199e6d8abcd",
          reused: false, scope: "core", kind: "pi-package-install", name: "tools" })); }
      else res.end(JSON.stringify({ packages: [...(packageDetailExists ? [{ name: "tools", version: null, enabled: packageDetailEnabled, isDefault: packageDetailDefault, sourceKind: "npm", resolvedSource: "npm:tools@1.0.0", updatedAt: "2026-01-01T00:00:00Z" }] : []), ...packageCatalog] })); return; }
    if (req.url === "/api/v1/admin/packages/tools") {
      if (!packageDetailExists) { res.statusCode = 404; res.end('{"code":"PI_PACKAGE_NOT_FOUND"}'); return; }
      if (req.method === "DELETE") { if (packageDetailDefault) { res.statusCode = 409;
          res.end('{"code":"PI_PACKAGE_IN_DEFAULTS","message":"Package is selected by default"}'); return; }
        packageDetailExists = false; res.statusCode = 204; res.end(); return; }
      res.end(JSON.stringify({ name: "tools", version: null, enabled: packageDetailEnabled,
        isDefault: packageDetailDefault, sourceKind: "npm", resolvedSource: "npm:tools@1.0.0" })); return; }
    if (req.url === "/api/v1/admin/packages/tools/disable" || req.url === "/api/v1/admin/packages/tools/enable") {
      if (packageDetailDefault && req.url.endsWith("disable")) { res.statusCode = 409;
        res.end('{"code":"PI_PACKAGE_IN_DEFAULTS","message":"Package is selected by default"}'); return; }
      packageDetailEnabled = req.url.endsWith("enable");
      res.end(JSON.stringify({ name: "tools", version: null, enabled: packageDetailEnabled,
        isDefault: packageDetailDefault, sourceKind: "npm" })); return; }
    if (req.url === "/api/v1/admin/packages/tools/update") { packageUpdates.push(body); res.statusCode = 202;
      res.end(JSON.stringify({ operationId: "operation-0199e6d8abcd", workId: null, correlationId: "correlation-0199e6d8abcd",
        reused: false, scope: "core", kind: "pi-package-update", name: "tools" })); return; }
    if (req.url === "/api/v1/admin/operations/operation-0199e6d8abcd") { const state = operationState;
      operationRequests += 1; operationInFlight += 1; operationMaxInFlight = Math.max(operationMaxInFlight, operationInFlight);
      if (operationDelayMs) await new Promise((done) => setTimeout(done, operationDelayMs));
      operationInFlight -= 1;
      res.end(JSON.stringify({ operationId: "operation-0199e6d8abcd",
        workId: null, kind: "pi-package-install", state, packagePhase: operationPhase ?? (state === "succeeded" ? "succeeded" : "prepare"),
        name: "tools", result: {}, error: null })); return; }
    if (req.url === "/api/v1/logout") { res.end("{}"); return; }
    res.statusCode = 404; res.end('{"code":"NOT_FOUND","message":"not found"}');
  });
  await new Promise((done) => coreServer.listen(0, "127.0.0.1", done));
  const port=await freePort();base=`http://127.0.0.1:${port}/admin`;
  await mkdir(join(root,'console'),{mode:0o700});
  consoleServer=await startNativeConsole(nativeConsole,[JSON.stringify({Core:`http://127.0.0.1:${coreServer.address().port}`,Directory:join(root,'console'),Listen:`127.0.0.1:${port}`})]);
});
test.afterAll(async () => {
  if (consoleServer?.exitCode === null) {
    consoleServer.kill("SIGTERM");
    await new Promise((done) => consoleServer.once("exit", done));
  }
  if (coreServer) await new Promise((done) => coreServer.close(done));
  if (root) await rm(root, { recursive: true, force: true });
});

async function login(page) {
  await page.goto(`${base.slice(0,-6)}/login?returnTo=/admin`);
  await page.getByLabel('Account',{exact:true}).fill('admin');
  await page.getByLabel('Password',{exact:true}).fill('correct horse battery');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(url=>!url.pathname.includes('login'));
  await page.goto(base);
  await expect(page.getByRole('heading',{name:'Overview',level:1,exact:true})).toBeVisible();
}
test.use({ viewport:{width:1440,height:900} });
test('delivered workspaces retain every management deep link, mobile layout, and secret isolation', async ({browser}) => {
  for(const width of [1440,360]) {
    const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900}}); const page=await context.newPage();
    try {
      const screenshots = fileURLToPath(new URL("../../../dist/logo-title-style", import.meta.url));
      await mkdir(screenshots, {recursive:true});
      await page.goto(`${base.slice(0,-6)}/login?returnTo=/admin`);
      await expect(page.getByRole('heading',{name:'Sign in to Piwork',exact:true})).toBeVisible();
      await expect.poll(()=>page.locator('.setup-brand img').evaluate(image=>image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(page.locator('.setup-brand img')).toHaveAttribute('alt','');
      await page.screenshot({path:join(screenshots,`console-login-${width}.png`),fullPage:true});
      await login(page);
      const brand = page.getByRole('link',{name:'Piwork overview',exact:true});
      await expect(brand).toHaveAttribute('href','/admin');
      await expect(brand).toHaveText('Administration');
      await expect(brand.getByText('Administration',{exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'Administrator account',exact:true})).toBeVisible();
      await expect(brand.locator('img')).toHaveAttribute('alt','');
      await expect.poll(()=>brand.locator('img').evaluate(image=>image.complete && image.naturalWidth > 0)).toBe(true);
      await brand.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(brand).toBeFocused();
      expect(await brand.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading',{name:'Overview',level:1,exact:true})).toBeVisible();
      await page.screenshot({path:join(screenshots,`console-overview-${width}.png`),fullPage:true});
      await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
      await expect(page.getByRole('link',{name:'Overview',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:'Users',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:'Setup',exact:true})).toBeVisible();
      for(const path of ['/users','/runtime','/default-work','/skills','/packages']) {
        await page.goto(base+path); await expect(page.locator('h1')).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);
      }
      await page.goto(base+'/operations/operation-0199e6d8abcd');
      await expect(page.getByRole('heading',{name:'Package operation',exact:true})).toBeVisible();
      await expect.poll(()=>page.locator('.brand-logo').evaluate(image=>image.complete && image.naturalWidth > 0)).toBe(true);
      await page.screenshot({path:join(screenshots,`console-detail-${width}.png`),fullPage:true});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await brand.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading',{name:'Overview',level:1,exact:true})).toBeVisible();
      const state=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},text:document.body.innerText}));
      expect(JSON.stringify(state)).not.toContain('core-secret-bearer'); expect(JSON.stringify(await context.cookies())).not.toContain('core-secret-bearer');
      expect(await page.locator('[onclick],[style]').count()).toBe(0);
    } finally {await context.close();}
  }
});
test('user confirmation, credential reset, last administrator, and localized conflict stay truthful', async ({page}) => {
  await login(page); await page.goto(base+'/users');
  await page.getByRole('button',{name:'Create user',exact:true}).click();
  await page.getByLabel('Account',{exact:true}).fill('new-user');
  await page.getByLabel('Password',{exact:true}).fill('replacement-password');
  await page.getByLabel('Confirm password').fill('replacement-password'); await page.locator('#dialog-submit').click();
  const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'new-user',exact:true})}); await expect(row).toBeVisible();
  const before=userActions.length; await row.getByRole('button',{name:'Disable',exact:true}).click(); expect(userActions.length).toBe(before);
  await page.locator('#dialog-submit').click(); await expect(row.getByText('Disabled',{exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Enable',exact:true}).click(); await page.locator('#dialog-submit').click(); await expect(row.getByText('Enabled',{exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Reset password',exact:true}).click(); await page.getByLabel('New password',{exact:true}).fill('reset-browser-password');
  await page.getByLabel('Confirm password').fill('reset-browser-password'); await page.locator('#dialog-submit').click(); await expect(row).toBeVisible();
  await expect.poll(()=>credentialResets.at(-1)?.body).toEqual({password:'reset-browser-password'});
  const admin=page.getByRole('row').filter({has:page.getByRole('button',{name:'admin',exact:true})}); await admin.getByRole('button',{name:'Disable',exact:true}).click(); await page.locator('#dialog-submit').click();
  await expect(page.getByText('At least one enabled administrator must remain.',{exact:true})).toBeVisible(); expect(users[0].enabled).toBe(true);
  await page.keyboard.press('Escape'); await page.getByRole('button',{name:'Create user',exact:true}).click();
  await page.getByLabel('Account',{exact:true}).fill('new-user'); await page.getByLabel('Password',{exact:true}).fill('replacement-password'); await page.getByLabel('Confirm password').fill('replacement-password'); await page.locator('#dialog-submit').click();
  await expect(page.locator('#dialog-feedback')).toContainText('CONFLICT');
  expect(await page.locator('body').innerText()).not.toContain('账号已存在');
  expect(await page.locator('#new-password').inputValue()).toBe('');
});
test('default draft submits only edited fields and retains unknown public configuration', async ({page}) => {
  await login(page); await page.goto(base+'/default-work');
  await page.locator('[data-action=edit-defaults][data-section=agentsMd]').click(); await page.locator('#agentsMd').fill('# browser instructions\n');
  await page.locator('[data-action=save-defaults]').click(); await expect(page.getByText(/Defaults saved|Starting point saved|Saved.*confirmed/).first()).toBeVisible();
  expect(defaultPatches.at(-1)).toEqual({agentsMd:'# browser instructions\n'});
  await page.reload(); await page.locator('[data-action=edit-defaults][data-section=agentsMd]').click(); await expect(page.locator('#agentsMd')).toHaveValue('# browser instructions\n');
  await page.locator('details').filter({has:page.getByText('Public configuration',{exact:true})}).count();
  expect(await page.locator('body').innerText()).not.toContain('networkMode');
});
test('runtime references a configured model without sending credentials and separates readiness',async({page})=>{
  await login(page); await page.goto(base+'/runtime'); await page.getByRole('button',{name:'Edit runtime',exact:true}).click();
  await expect(page.getByLabel('Agent image',{exact:true})).toHaveCount(0); await page.getByText('Runtime diagnostics',{exact:true}).click(); await expect(page.locator('[data-runtime-agent-image]')).toHaveText('piwork-agentd:fixture'); await page.getByLabel('AI model',{exact:true}).selectOption('model-test-00000001');
  await page.getByRole('button',{name:'Save runtime',exact:true}).click(); await expect(page.getByRole('button',{name:'Edit runtime',exact:true})).toBeVisible();
  expect(runtimeSaves.at(-1)).toEqual({modelRef:'model-test-00000001'});
  expect(await page.locator('body').innerText()).not.toContain('write-only-browser-secret'); await page.getByRole('button',{name:'Edit runtime',exact:true}).click(); await expect(page.getByLabel('API Key',{exact:true})).toHaveCount(0);
});
test('Skill directory preflight, actual multipart bytes, immutable identity, and 204 removal',async({page})=>{
  const dir=join(root,'code-review');await mkdir(dir,{recursive:true});await writeFile(join(dir,'SKILL.md'),'# Browser Skill\n');await writeFile(join(dir,'reference.md'),'reference-bytes');
  await login(page);await page.goto(base+'/skills');await page.getByRole('button',{name:'Add Skill',exact:true}).click();await page.getByLabel('Choose Skill directory').setInputFiles(dir);await page.getByRole('button',{name:'Upload Skill',exact:true}).click();await expect(page.locator('#detail-title')).toContainText('code-review');
  expect(skillUploads.at(-1).raw).toContain('reference-bytes');expect(skillUploads.at(-1).authorization).toBe('Bearer core-secret-bearer');
  await page.locator('[data-action="catalog-more"][data-name="code-review"]').click();await page.getByRole('menuitem',{name:'Disable Skill'}).click();await page.locator('#dialog-submit').click();await expect(page.locator('.navigator-item[data-name="code-review"] .row-note')).toHaveText('Disabled');
  await page.locator('[data-action="catalog-more"][data-name="code-review"]').click();await page.getByRole('menuitem',{name:'Enable Skill'}).click();await page.locator('#dialog-submit').click();await expect.poll(()=>managedSkillEnabled).toBe(true);
  await page.locator('[data-action="catalog-more"][data-name="code-review"]').click();await page.getByRole('menuitem',{name:'Remove Skill'}).click();await page.getByLabel('Type the name to confirm').fill('code-review');await page.locator('#dialog-submit').click();await expect(page.getByRole('heading',{name:'Capability library',exact:true})).toBeVisible();expect(managedSkillExists).toBe(false);
});
for(const kind of ['npm','Git','Local directory','ZIP']) test(`Package ${kind} uses real source, stable acceptance, and recoverable Operation`,async({page})=>{
  await login(page);await page.goto(base+'/packages');await page.getByRole('button',{name:'Install Package',exact:true}).click();
  await page.getByRole('button',{name:kind,exact:true}).click();
  if(kind==='ZIP') { const dir=join(root,'zip-tools');await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),'{"name":"tools","version":"1.0.0"}');const zip=join(root,'browser-tools.zip');execFileSync('zip',['-q','-r',zip,'.'],{cwd:dir});await page.getByLabel('Choose Package ZIP').setInputFiles(zip); }
  else if(kind==='Local directory') {const dir=join(root,'browser-tools');await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),'{"name":"tools","version":"1.0.0"}');await page.getByLabel('Choose Package directory').setInputFiles(dir);}
  else await page.getByLabel('Source specification').fill(kind==='npm'?'tools@1.0.0':'https://example.com/tools.git#main');
  await page.locator('#dialog-submit').click();await expect(page.getByRole('heading',{name:'Package operation',exact:true})).toBeVisible();await expect(page.getByText(/^succeeded$/i).first()).toBeVisible();
  const accepted=packageAccepts.at(-1);expect(accepted.idempotencyKey).toBeTruthy();expect(accepted.source.kind).toBe(kind==='npm'?'npm':kind==='Git'?'git':'upload');
  const path=page.url();await page.reload();await expect(page.getByText(/^succeeded$/i).first()).toBeVisible();expect(page.url()).toBe(path);
});
test('Package lost acceptance recovers original key and payload without duplicate upload',async({page})=>{
  await login(page);await page.goto(base+'/packages');let dropped=false;
  await page.route('**/console/api/admin/packages',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await page.getByRole('button',{name:'Install Package',exact:true}).click();await page.getByLabel('Source specification').fill('tools@1.0.0');await page.locator('#dialog-submit').click();
  await expect(page.locator('#dialog-feedback')).toContainText(/acceptance response was lost/);
  await expect(page.getByRole('button',{name:'Resume this submission',exact:true})).toBeEnabled();
  const first=packageAccepts.at(-1);
  await page.getByRole('button',{name:'Resume this submission',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Package operation',exact:true})).toBeVisible();
  expect(packageAccepts.at(-1)).toEqual(first);
});
test('malformed successful runtime response requires readback rather than claiming success',async({page})=>{
  await login(page);await page.goto(base+'/runtime');await page.getByRole('button',{name:'Edit runtime',exact:true}).click();
  await page.route('**/console/api/admin/runtime',route=>route.request().method()==='PUT'?route.fulfill({status:200,contentType:'application/json',body:'{}'}):route.continue());
  await page.getByLabel('AI model',{exact:true}).selectOption('model-test-00000001');
  await page.getByRole('button',{name:'Save runtime',exact:true}).click();
  await expect(page.locator('main .owned-feedback').filter({hasText:'Read current runtime before saving again'})).toBeVisible();
  await expect(page.getByLabel('API Key',{exact:true})).toHaveCount(0);
});
test('Operation observation is serial and does not re-submit acceptance',async({page})=>{
  operationState='running';operationDelayMs=1200;operationMaxInFlight=0;const accepts=packageAccepts.length;
  try{await login(page);await page.goto(base+'/operations/operation-0199e6d8abcd');await expect(page.getByText(/^running$/i).first()).toBeVisible();await expect.poll(()=>operationRequests,{timeout:15000}).toBeGreaterThan(1);expect(operationMaxInFlight).toBe(1);expect(packageAccepts.length).toBe(accepts);}
  finally{operationState='succeeded';operationDelayMs=0;}
});

test('R6 actual Core phase enums drive progress and raw details, including readback, failure, cleanup and unknown', async ({page}) => {
  const accepts = packageAccepts.length;
  operationState = 'running'; operationPhase = 'queued';
  try {
    await login(page); await page.goto(base+'/operations/operation-0199e6d8abcd');
    const assertNoInventedProgressOrCancel = async () => {
      const operationView = page.locator('main');
      await expect(operationView.getByRole('button', { name: /cancel/i })).toHaveCount(0);
      await expect(operationView.locator('progress, [role="progressbar"][aria-valuenow]')).toHaveCount(0);
      await expect(operationView).not.toContainText(/\b\d+(?:\.\d+)?\s*%/);
    };
    for (const [raw,label] of [['queued','Accepted'],['source','Resolving'],['prepare','Preparing'],['validate','Validating'],['publish','Publishing']]) {
      operationPhase = raw; await page.getByRole('button',{name:'Refresh',exact:true}).click();
      await expect(page.locator('.phase-step.current')).toHaveText(label);
      await expect(page.locator('dt').filter({hasText:'Package phase'}).locator('+ dd')).toHaveText(raw);
      await assertNoInventedProgressOrCancel();
    }
    // Known Operation detail / full reload uses the raw API enum, without a new install.
    await page.reload(); await expect(page.locator('.phase-step.current')).toHaveText('Publishing');
    operationPhase = 'future-phase'; await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Unrecognized phase: future-phase'})).toBeVisible(); await expect(page.locator('.phase-step.current')).toHaveCount(0);
    await assertNoInventedProgressOrCancel();
    operationPhase = 'failed'; operationState = 'failed'; await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Operation failed',exact:true})).toBeVisible(); await expect(page.locator('.phase-step.done')).toHaveCount(0); await expect(page.getByText('Final state · Observation stopped')).toBeVisible();
    operationPhase = 'superseded'; operationState = 'superseded'; await page.getByRole('button',{name:'Refresh',exact:true}).click(); await expect(page.getByRole('heading',{name:'Operation superseded'})).toBeVisible();
    operationPhase = 'cleanup-pending'; operationState = 'succeeded'; await page.getByRole('button',{name:'Refresh',exact:true}).click(); await expect(page.getByText(/Package cleanup is pending/)).toBeVisible(); await expect(page.locator('.phase-step.current')).toHaveCount(0);
    operationPhase = 'succeeded'; await page.getByRole('button',{name:'Refresh',exact:true}).click(); await expect(page.locator('.phase-step.current')).toHaveText('Published'); await expect(page.locator('.phase-step.done')).toHaveCount(5);
    const acceptance = await page.evaluate(async () => { const {adapter} = await import('/admin/browser/adapter.js'); return adapter.submitPackage({kind:'npm',source:'tools@1.0.0',key:crypto.randomUUID(),addDefault:false}); });
    expect(acceptance.packagePhase).toBe('');
    const phase = await page.evaluate(async () => { const {packagePhaseView} = await import('/admin/browser/package-phase.js'); return packagePhaseView('', 'running'); }); expect(phase.label).toBe('Submission accepted'); expect(phase.index).toBe(-1);
    expect(packageAccepts.length).toBe(accepts+1);
  } finally { operationPhase = null; operationState = 'succeeded'; }
});

test("About Piwork displays remote Core notes as text",async({page})=>{
 await login(page);
 await page.goto(base+"/about");await expect(page.getByRole('heading',{name:'About Piwork',exact:true})).toBeVisible();await expect(page.locator('main')).toContainText('core-about-fixture');await expect(page.locator('main')).toContainText('<script>');expect(await page.evaluate(()=>window.notesExecuted)).toBeUndefined();await expect(page.getByRole('link',{name:'All releases'})).toHaveAttribute('href','https://github.com/pphboy/piwork/releases');
});

test('catalog lost response stays unknown after dialog close and Details cannot restore or replay a mutation', async ({ page }) => {
  packageDetailExists = true;
  packageDetailEnabled = true;
  packageDetailDefault = false;
  let writes = 0;
  await login(page);
  await page.goto(base + '/packages/tools');
  await page.route('**/console/api/admin/packages/tools/disable', async route => {
    writes++;
    await route.abort('failed');
  });
  await page.locator('[data-action="catalog-more"][data-name="tools"]').click();
  await page.getByRole('menuitem',{name:'Disable Package'}).click();
  await page.locator('#dialog-submit').click();
  await expect(page.locator('.notice-unknown')).toHaveCount(1);
  await page.locator('dialog [data-action="close-dialog"]').first().click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.locator('.notice-unknown').getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('.notice-unknown')).toHaveCount(1);
  expect(writes).toBe(1);
  expect(packageDetailEnabled).toBe(true);
});

test('capability library edits only the current Skill file and keeps drafts across search', async ({ page }) => {
  seedSkill('z-editor-skill', { 'SKILL.md': '# Original\n', 'references/checklist.md': '# Checklist\n', 'assets/raw.bin': 'binary\u0000data' });
  await login(page);
  await page.goto(base + '/skills/z-editor-skill');
  await expect(page.locator('#file-editor')).toHaveValue('# Original\n');
  await expect(page.locator('#editor-save-state')).toHaveText('Saved');
  await page.locator('#file-editor').fill('# Changed\nsecond line');
  await expect(page.locator('#editor-save-state')).toHaveText('Unsaved');
  await expect(page.locator('#line-numbers')).toHaveText('1\n2');
  await page.locator('#catalog-search').fill('z-editor');
  await page.locator('#catalog-search').fill('');
  await expect(page.locator('#file-editor')).toHaveValue('# Changed\nsecond line');
  const before = skillSaves.length, beforeDefaults = defaultPatches.length;
  await page.locator('#file-editor').press('Control+s');
  await expect.poll(() => skillSaves.length).toBe(before + 1);
  expect(skillSaves.at(-1)).toMatchObject({ name: 'z-editor-skill', path: 'SKILL.md', content: '# Changed\nsecond line' });
  await expect(page.locator('#editor-save-state')).toHaveText('Saved');
  expect(defaultPatches.length).toBe(beforeDefaults);
  await page.getByRole('button', { name: /references/ }).click();
  await page.getByRole('button', { name: 'checklist.md' }).click();
  await expect(page.locator('#file-editor')).toHaveValue('# Checklist\n');
  await page.locator('#file-editor').click();
  await page.keyboard.press('End');
  await expect(page.locator('#editor-cursor')).toHaveText(/Line 2, column 1/);
});

test('unsaved Skill edits offer save, discard and continue before switching files', async ({ page }) => {
  seedSkill('z-choice-skill', { 'SKILL.md': '# Base\n', 'notes.md': 'notes\n' });
  await login(page);
  await page.goto(base + '/skills/z-choice-skill');
  await page.locator('#file-editor').fill('# Draft\n');
  await page.getByRole('button', { name: 'notes.md' }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page.locator('#file-editor')).toHaveValue('# Draft\n');
  await page.getByRole('button', { name: 'notes.md' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.locator('#file-editor')).toHaveValue('notes\n');
});

test('non-text Skill files stay read-only and point to folder update', async ({ page }) => {
  seedSkill('z-binary-skill', { 'SKILL.md': '# B\n', 'blob.bin': 'binary\u0000data' });
  await login(page);
  await page.goto(base + '/skills/z-binary-skill');
  await page.getByRole('button', { name: 'blob.bin' }).click();
  await expect(page.getByRole('heading', { name: 'This file cannot be edited as text' })).toBeVisible();
  await expect(page.locator('#file-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update folder', exact: true })).toBeVisible();
});

test('row menu actions target their row without changing the open Skill draft', async ({ page }) => {
  seedSkill('z-menu-a', { 'SKILL.md': '# A\n' });
  seedSkill('z-menu-b', { 'SKILL.md': '# B\n' });
  await login(page);
  await page.goto(base + '/skills/z-menu-a');
  await page.locator('#file-editor').fill('# A draft\n');
  await page.locator('[data-action="catalog-more"][data-name="z-menu-b"]').click();
  await page.getByRole('menuitem', { name: 'Skill information' }).click();
  const modal = page.locator('dialog');
  await expect(modal).toContainText('z-menu-b');
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#file-editor')).toHaveValue('# A draft\n');
  await expect(page.locator('#detail-title')).toContainText('z-menu-a');
  await page.locator('[data-action="catalog-more"][data-name="z-menu-b"]').click();
  await page.getByRole('menuitem', { name: 'Disable Skill' }).click();
  await page.locator('#dialog-submit').click();
  await expect(page.locator('.navigator-item[data-name="z-menu-b"] .row-note')).toHaveText('Disabled');
  await expect(page.locator('#file-editor')).toHaveValue('# A draft\n');
  await page.locator('[data-action="catalog-more"][data-name="z-menu-b"]').click();
  await page.getByRole('menuitem', { name: 'Remove Skill' }).click();
  await page.getByLabel('Type the name to confirm').fill('z-menu-b');
  await page.locator('#dialog-submit').click();
  await expect(page.locator('.navigator-item[data-name="z-menu-b"]')).toHaveCount(0);
  await expect(page.locator('#file-editor')).toHaveValue('# A draft\n');
  await expect(page.locator('#detail-title')).toContainText('z-menu-a');
});

test('default Package ordering saves only the packages field', async ({ page }) => {
  packageCatalog = ['pkg-a', 'pkg-b', 'pkg-c'].map((name) => ({ name, version: '1.0.0', enabled: true, sourceKind: 'npm', resolvedSource: `npm:${name}@1.0.0` }));
  defaultPackages = ['pkg-a', 'pkg-b', 'pkg-c'];
  defaultPatches.length = 0;
  await login(page);
  await page.goto(base + '/default-work');
  await page.locator('[data-action=edit-defaults][data-section=packages]').click();
  await page.locator('[data-action="move-package"][data-name="pkg-c"][data-direction="up"]').click();
  await expect(page.locator('[data-action="move-package"][data-name="pkg-a"][data-direction="up"]')).toBeDisabled();
  await expect(page.locator('[data-action="move-package"][data-name="pkg-b"][data-direction="down"]')).toBeDisabled();
  await page.locator('[data-action="save-defaults"]').click();
  await expect.poll(() => defaultPatches.length).toBeGreaterThan(0);
  expect(defaultPatches.at(-1)).toEqual({ packages: ['pkg-a', 'pkg-c', 'pkg-b'] });
  await page.reload();
  await expect(page.locator('[data-testid="default-summary-packages"] .summary-token').nth(1)).toHaveText('pkg-c');
});

test('Skill content is shown as text and the library marks default selections', async ({ page }) => {
  seedSkill('z-text-skill', { 'SKILL.md': '<script>window.pwned=1</script>\n<img src=x onerror=window.pwned=2>\n' });
  defaultSkills = [];
  await login(page);
  await page.goto(base + '/default-work');
  await page.locator('[data-action=edit-defaults][data-section=skills]').click();
  await page.locator('[data-default-skill="z-text-skill"]').check();
  await page.locator('[data-action="save-defaults"]').click();
  await expect.poll(() => defaultSkills).toContain('z-text-skill');
  await page.goto(base + '/skills/z-text-skill');
  await expect(page.locator('#file-editor')).toHaveValue('<script>window.pwned=1</script>\n<img src=x onerror=window.pwned=2>\n');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await expect(page.locator('.navigator-item[data-name="z-text-skill"] .row-note')).toHaveText('Default');
});

test('360px Skill library switches between the file list and content', async ({ page }) => {
  seedSkill('z-mobile-skill', { 'SKILL.md': '# M\n', 'notes.md': 'mobile\n' });
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto(base + '/skills/z-mobile-skill');
  await expect(page.locator('.navigator')).toBeVisible();
  await page.getByRole('button', { name: 'notes.md' }).click();
  await expect(page.locator('.inspector-layout')).toHaveClass(/mobile-inspecting/);
  await expect(page.locator('#file-editor')).toHaveValue('mobile\n');
  await page.getByRole('button', { name: 'Files' }).click();
  await expect(page.locator('.navigator')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('same-page refresh keeps the Skill draft and editor scroll', async ({ page }) => {
  const body = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n");
  seedSkill('z-refresh-skill', { 'SKILL.md': body });
  await login(page);
  await page.goto(base + '/skills/z-refresh-skill');
  const draft = '# Draft\n' + body;
  await page.locator('#file-editor').fill(draft);
  await page.locator('#file-editor').evaluate(node => { node.scrollTop = 140; });
  const scroll = await page.locator('#file-editor').evaluate(node => node.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await page.locator('[data-action="refresh"]').first().click();
  await expect(page.locator('#file-editor')).toHaveValue(draft);
  expect(await page.locator('#file-editor').evaluate(node => node.scrollTop)).toBe(scroll);
});

test('library row menu supports keyboard, Escape and narrow placement', async ({ page }) => {
  seedSkill('z-menu-kbd', { 'SKILL.md': '# K\n' });
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto(base + '/skills/z-menu-kbd');
  const trigger = page.locator('[data-action="catalog-more"][data-name="z-menu-kbd"]');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.locator('#catalog-menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const box = await page.locator('#catalog-menu').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test('default reference protection from the row menu keeps the draft', async ({ page }) => {
  seedSkill('z-protected-skill', { 'SKILL.md': '# P\n' });
  defaultSkills = ['z-protected-skill'];
  await login(page);
  await page.goto(base + '/skills/z-protected-skill');
  await page.locator('#file-editor').fill('# P draft\n');
  await page.locator('[data-action="catalog-more"][data-name="z-protected-skill"]').click();
  await page.getByRole('menuitem', { name: 'Disable Skill' }).click();
  await page.locator('#dialog-submit').click();
  await expect(page.locator('#dialog-feedback')).toContainText('Remove this resource from Default Work');
  await expect(page.locator('#dialog-feedback').getByRole('button', { name: 'Review default reference' })).toBeVisible();
  await page.locator('dialog [data-action="close-dialog"]').first().click();
  await expect(page.locator('#file-editor')).toHaveValue('# P draft\n');
});

test('browser back with an unsaved Skill draft offers the three choices', async ({ page }) => {
  seedSkill('z-history-other', { 'SKILL.md': '# O\n' });
  seedSkill('z-history-skill', { 'SKILL.md': '# H\n' });
  await login(page);
  await page.goto(base + '/skills');
  await expect(page.locator('.console-read-skeleton')).toHaveCount(0);
  await page.locator('[data-action="library-select"][data-name="z-history-skill"]').click();
  await expect(page.locator('#file-editor')).toHaveValue('# H\n');
  await page.locator('#file-editor').fill('# H draft\n');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page).toHaveURL(base + '/skills/z-history-skill');
  await expect(page.locator('#file-editor')).toHaveValue('# H draft\n');
});
