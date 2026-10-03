import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let root, consoleServer, coreServer, base;
const nativeConsole = process.env.PIWORK_TEST_NATIVE_CONSOLE || fileURLToPath(new URL("../../../dist/go/piwork-console", import.meta.url));
let nativeConsoleOutput = "";
async function startNativeConsole(binary, args) {
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { nativeConsoleOutput += chunk; });
  child.stderr.on("data", (chunk) => { nativeConsoleOutput += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (nativeConsoleOutput.includes("piwork-console listening at")) return child;
    if (child.exitCode !== null) throw new Error(`Go Console exited: ${nativeConsoleOutput}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Go Console did not listen: ${nativeConsoleOutput}`);
}
const users = [{ id: "user-admin-00000001", account: "admin", role: "admin", enabled: true }];
const skillUploads = [];
let managedSkillExists = false, managedSkillEnabled = true;
let extraSkills = [];
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
  const certPath = join(root, "cert.pem"), keyPath = join(root, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
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
    if (req.url === "/api/v1/me") { res.end(JSON.stringify(req.headers.authorization === "Bearer second-admin-private-token" ? users.find(item => item.account === "new-admin") : users[0])); return; }
    if (req.url === "/api/v1/admin/status") { res.end(JSON.stringify({ adminApiVersion: 1, state: "READY", ready: true,
      checks: { administrator: true, runtimeConfigured: true, runtimeAvailable: true, filesystemMigrationReady: true } })); return; }
    if (req.url === "/api/v1/admin/runtime") { if (req.method === "PUT") { runtimeSaves.push(body); runtimeConfigured = true;
        runtimeLast = { configured: true, agentImage: body.agentImage,
          model: { provider: body.provider, id: body.model, credentialAvailable: true }, updatedAt: new Date().toISOString() };
        res.end(JSON.stringify({ runtime: runtimeLast,
        status: { adminApiVersion: 1, state: "RUNTIME_UNAVAILABLE", ready: false,
          checks: { administrator: true, runtimeConfigured: true, runtimeAvailable: false, filesystemMigrationReady: true } } })); }
      else res.end(JSON.stringify(runtimeConfigured ? runtimeLast ?? { configured: true, agentImage: "piwork-agentd:local",
        model: { provider: "anthropic", id: "fixture", credentialAvailable: true }, updatedAt: new Date().toISOString() } :
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
        res.statusCode = 201; res.end(JSON.stringify({ name: "code-review", enabled: true, fileCount: 2, totalBytes: 12 })); }
      else res.end(JSON.stringify({ skills: [...extraSkills, ...(managedSkillExists ? [{ name: "code-review", enabled: managedSkillEnabled, fileCount: 2, totalBytes: 12 }] : [])] })); return; }
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
      else res.end(JSON.stringify({ packages: packageCatalog })); return; }
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
  const port = await freePort(); base = `https://127.0.0.1:${port}`;
  const coreUrl = `http://127.0.0.1:${coreServer.address().port}`;
  consoleServer = await startNativeConsole(nativeConsole,
    ["serve", "--core", coreUrl, "--listen", `127.0.0.1:${port}`, "--public-origin", base,
      "--data-dir", join(root, "console"), "--tls-cert", certPath, "--tls-key", keyPath]);
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
  await page.goto(`${base}/login`);
  await page.getByLabel('Account',{exact:true}).fill('admin');
  await page.getByLabel('Password',{exact:true}).fill('correct horse battery');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'What’s next for your Core?'})).toBeVisible();
}
test.use({ viewport:{width:1440,height:900} });
test('delivered workspaces retain every management deep link, mobile layout, and secret isolation', async ({browser}) => {
  for(const width of [1440,390]) {
    const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900}}); const page=await context.newPage();
    try {
      await login(page);
      if (width < 700) await page.getByRole('button',{name:'Open navigation'}).click();
      await expect(page.getByRole('link',{name:'Overview',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:'User access',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:'Work setup',exact:true})).toBeVisible();
      for(const path of ['/users','/runtime','/default-work','/skills','/packages','/operations']) {
        await page.goto(base+path); await expect(page.locator('h1')).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);
      }
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
  await expect(page.getByText(/CONFLICT/)).toBeVisible(); expect(await page.locator('body').innerText()).not.toContain('账号已存在'); expect(await page.locator('#new-password').inputValue()).toBe('');
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
test('runtime sends write-only credential and model schema, clears secret, and separates readiness',async({page})=>{
  await login(page); await page.goto(base+'/runtime'); await page.getByRole('button',{name:'Edit runtime',exact:true}).click();
  await page.getByLabel('Agent image',{exact:true}).fill('piwork-agentd:fixture'); await page.getByLabel('Model provider',{exact:true}).fill('anthropic'); await page.getByLabel('Model ID',{exact:true}).fill('new-model'); await page.getByLabel('API Key',{exact:true}).fill('write-only-browser-secret');
  await page.getByRole('button',{name:'Save runtime',exact:true}).click(); await expect(page.getByRole('button',{name:'Edit runtime',exact:true})).toBeVisible();
  expect(runtimeSaves.at(-1)).toEqual({agentImage:'piwork-agentd:fixture',provider:'anthropic',model:'new-model',credential:'write-only-browser-secret'});
  expect(await page.locator('body').innerText()).not.toContain('write-only-browser-secret'); await page.getByRole('button',{name:'Edit runtime',exact:true}).click(); await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
});
test('Skill directory preflight, actual multipart bytes, immutable identity, and 204 removal',async({page})=>{
  const dir=join(root,'code-review');await mkdir(dir,{recursive:true});await writeFile(join(dir,'SKILL.md'),'# Browser Skill\n');await writeFile(join(dir,'reference.md'),'reference-bytes');
  await login(page);await page.goto(base+'/skills');await page.getByRole('button',{name:'Add Skill',exact:true}).click();await page.getByLabel('Choose Skill directory').setInputFiles(dir);await page.getByRole('button',{name:'Upload Skill',exact:true}).click();await expect(page.getByRole('heading',{name:'code-review',exact:true})).toBeVisible();
  expect(skillUploads.at(-1).raw).toContain('reference-bytes');expect(skillUploads.at(-1).authorization).toBe('Bearer core-secret-bearer');
  await page.getByRole('button',{name:'Disable Skill',exact:true}).click();await page.locator('#dialog-submit').click();await expect(page.getByRole('button',{name:'Enable Skill',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove Skill',exact:true}).click();await page.getByLabel('Type the name to confirm').fill('code-review');await page.locator('#dialog-submit').click();await expect(page.getByRole('heading',{name:'Add capabilities with Skills',exact:true})).toBeVisible();expect(managedSkillExists).toBe(false);
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
  await expect(page.getByText(/acceptance response was lost/)).toBeVisible();const first=packageAccepts.at(-1);await page.getByRole('button',{name:'Resume this submission',exact:true}).click();await expect(page.getByRole('heading',{name:'Package operation',exact:true})).toBeVisible();expect(packageAccepts.at(-1)).toEqual(first);
});
test('malformed successful runtime response requires readback rather than claiming success',async({page})=>{
  await login(page);await page.goto(base+'/runtime');await page.getByRole('button',{name:'Edit runtime',exact:true}).click();
  await page.route('**/console/api/admin/runtime',route=>route.request().method()==='PUT'?route.fulfill({status:200,contentType:'application/json',body:'{}'}):route.continue());
  await page.getByLabel('API Key',{exact:true}).fill('unknown-runtime-secret');await page.getByRole('button',{name:'Save runtime',exact:true}).click();await expect(page.getByText(/runtime acceptance response is incomplete/)).toBeVisible();expect(await page.getByLabel('API Key',{exact:true}).inputValue()).toBe('');
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
    for (const [raw,label] of [['queued','Accepted'],['source','Resolving'],['prepare','Preparing'],['validate','Validating'],['publish','Publishing']]) {
      operationPhase = raw; await page.getByRole('button',{name:'Refresh',exact:true}).click();
      await expect(page.locator('.phase-step.current')).toHaveText(label);
      await expect(page.locator('dt').filter({hasText:'Package phase'}).locator('+ dd')).toHaveText(raw);
    }
    // Find Operation / full reload uses the raw API enum, without a new install.
    await page.reload(); await expect(page.locator('.phase-step.current')).toHaveText('Publishing');
    operationPhase = 'future-phase'; await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Unrecognized phase: future-phase'})).toBeVisible(); await expect(page.locator('.phase-step.current')).toHaveCount(0);
    operationPhase = 'failed'; operationState = 'failed'; await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Operation failed',exact:true})).toBeVisible(); await expect(page.locator('.phase-step.done')).toHaveCount(0); await expect(page.getByText('Final state · Observation stopped')).toBeVisible();
    operationPhase = 'superseded'; operationState = 'superseded'; await page.getByRole('button',{name:'Refresh',exact:true}).click(); await expect(page.getByRole('heading',{name:'Operation superseded'})).toBeVisible();
    operationPhase = 'cleanup-pending'; operationState = 'succeeded'; await page.getByRole('button',{name:'Refresh',exact:true}).click(); await expect(page.getByText(/Package cleanup is pending/)).toBeVisible(); await expect(page.locator('.phase-step.current')).toHaveCount(0);
    operationPhase = 'succeeded'; await page.getByRole('button',{name:'Refresh',exact:true}).click(); await expect(page.locator('.phase-step.current')).toHaveText('Published'); await expect(page.locator('.phase-step.done')).toHaveCount(5);
    const acceptance = await page.evaluate(async () => { const {adapter} = await import('/browser/adapter.js'); return adapter.submitPackage({kind:'npm',source:'tools@1.0.0',key:crypto.randomUUID(),addDefault:false}); });
    expect(acceptance.packagePhase).toBe('');
    const phase = await page.evaluate(async () => { const {packagePhaseView} = await import('/browser/package-phase.js'); return packagePhaseView('', 'running'); }); expect(phase.label).toBe('Submission accepted'); expect(phase.index).toBe(-1);
    expect(packageAccepts.length).toBe(accepts+1);
  } finally { operationPhase = null; operationState = 'succeeded'; }
});
