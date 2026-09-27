import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsoleServer } from "../dist/server.js";
import { packPiPackageDirectory } from "@piwork/pi-package";

let root, consoleServer, coreServer, base;
const users = [{ id: "user-admin-00000001", account: "admin", role: "admin", enabled: true }];
const skillUploads = [];
let managedSkillExists = false, managedSkillEnabled = true;
let extraSkills = [];
const packageUploads = [];
const packageAccepts = [];
const packageUpdates = [];
let packageCatalog = [];
let packageDetailExists = true, packageDetailEnabled = true, packageDetailDefault = false;
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
    if (req.url === "/api/v1/login") { if (body.account !== "admin" || body.password !== "correct horse battery") { res.statusCode = 401; res.end('{"code":"AUTHENTICATION_FAILED"}'); return; }
      res.end(JSON.stringify({ token: "core-secret-bearer", expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: users[0] })); return; }
    if (req.url === "/api/v1/me") { res.end(JSON.stringify(users[0])); return; }
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
        workId: null, kind: "pi-package-install", state, packagePhase: state === "succeeded" ? "succeeded" : "prepare",
        name: "tools", result: {}, error: null })); return; }
    if (req.url === "/api/v1/logout") { res.end("{}"); return; }
    res.statusCode = 404; res.end('{"code":"NOT_FOUND","message":"not found"}');
  });
  await new Promise((done) => coreServer.listen(0, "127.0.0.1", done));
  const port = await freePort(); base = `https://127.0.0.1:${port}`;
  consoleServer = await createConsoleServer({ coreUrl: `http://127.0.0.1:${coreServer.address().port}`, listenHost: "127.0.0.1",
    listenPort: port, publicOrigin: base, dataDir: root, cert: await readFile(certPath), key: await readFile(keyPath) });
  await new Promise((done) => consoleServer.listen(port, "127.0.0.1", done));
});
test.afterAll(async () => { await new Promise((done) => consoleServer.close(done)); await new Promise((done) => coreServer.close(done)); await rm(root, { recursive: true, force: true }); });

test("administrator logs in, creates a user, and browser never receives Core bearer", async ({ page }) => {
  await page.goto(`${base}/login`);
  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "Core 状态" })).toBeVisible();
  await expect(page.getByText("运行就绪：就绪 · READY")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.some((item) => item.name === "__Host-piwork-console" && item.httpOnly && item.secure && item.sameSite === "Strict")).toBeTruthy();
  expect(JSON.stringify(cookies)).not.toContain("core-secret-bearer");
  await page.getByRole("link", { name: "用户" }).click();
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await page.getByLabel("账号", { exact: true }).fill("new-user");
  await page.getByLabel("密码", { exact: true }).fill("new long password");
  await page.getByLabel("确认密码").fill("new long password");
  await page.getByLabel("角色").selectOption("user");
  await page.getByRole("button", { name: "创建用户" }).click();
  await expect(page.getByRole("cell", { name: "new-user", exact: true })).toBeVisible();
  await expect(page.getByText(/new-user 已创建，角色：user。请使用 piwork-cli 登录/)).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  await page.getByLabel("账号", { exact: true }).fill("new-admin");
  await page.getByLabel("密码", { exact: true }).fill("second long password");
  await page.getByLabel("确认密码").fill("second long password");
  await page.getByLabel("角色").selectOption("admin");
  await page.getByRole("button", { name: "创建用户" }).click();
  await expect(page.getByRole("cell", { name: "new-admin", exact: true })).toBeVisible();
  await expect(page.getByText(/new-admin 已创建，角色：admin。可使用新账号登录此面板/)).toBeVisible();
  await page.getByLabel("账号", { exact: true }).fill("new-user");
  await page.getByLabel("密码", { exact: true }).fill("third long password");
  await page.getByLabel("确认密码").fill("third long password");
  await page.getByRole("button", { name: "创建用户" }).click();
  await expect(page.getByText(/账号已存在/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("coreToken"))).toBeNull();
  expect(await page.locator("body").innerText()).not.toContain("core-secret-bearer");
});

test("login rate limit shows the remaining wait and clears the password", async ({ page }) => {
  await page.goto(base + "/login");
  await page.route("**/console/api/login", (route) => route.fulfill({ status: 429, contentType: "application/json",
    body: JSON.stringify({ code: "RATE_LIMITED", message: "登录过于频繁", retryAfterMs: 2500 }) }), { times: 1 });
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText(/请在 3 秒后重试/)).toBeVisible();
  await expect(page.getByLabel("账号", { exact: true })).toHaveValue("admin");
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
});

test("refreshing a form asks before discarding its draft", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "用户" }).click();
  await page.getByLabel("账号", { exact: true }).fill("draft-user");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "刷新用户" }).click();
  await expect(page.getByLabel("账号", { exact: true })).toHaveValue("draft-user");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "刷新用户" }).click();
  await expect(page.getByLabel("账号", { exact: true })).toHaveValue("");
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("npm 或 Git 来源").fill("tools@draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "刷新 Packages" }).click();
  await expect(page.getByLabel("npm 或 Git 来源")).toHaveValue("tools@draft");
});

test("browser directory selection streams relative Skill files through console", async ({ page }) => {
  const directory = join(root, "code-review");
  await mkdir(join(directory, "references"), { recursive: true });
  await writeFile(join(directory, "SKILL.md"), "# Skill\n");
  await writeFile(join(directory, "references", "rules.md"), "Rules\n");
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "Core 状态" })).toBeVisible();
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByLabel("选择 Skill 目录").setInputFiles(directory);
  await page.getByRole("button", { name: "上传 Skill" }).click();
  await expect(page.getByRole("link", { name: "code-review" })).toBeVisible();
  expect(skillUploads).toHaveLength(1);
  expect(skillUploads[0].raw).toContain('name="directoryName"');
  expect(skillUploads[0].raw).toContain('filename="references%2Frules.md"');
  expect(skillUploads[0].raw).not.toContain(root);
  expect(skillUploads[0].authorization).toBe("Bearer core-secret-bearer");
});

test("Skill detail validates update directory and supports disable and remove", async ({ page }) => {
  const wrong = join(root, "wrong-skill"); await mkdir(wrong, { recursive: true });
  await writeFile(join(wrong, "SKILL.md"), "# Wrong\n");
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByRole("link", { name: "code-review" }).click();
  await expect(page.getByRole("heading", { name: "Skill 详情" })).toBeVisible();
  await page.getByRole("button", { name: "禁用" }).click();
  await expect(page.getByText("禁用 · 2 文件 · 12 字节")).toBeVisible();
  const before = skillUploads.length;
  await page.getByLabel("选择同名 Skill 目录更新").setInputFiles(wrong);
  await page.getByRole("button", { name: "上传更新" }).click();
  await expect(page.getByText("目录名称必须与目标 Skill 一致")).toBeVisible();
  expect(skillUploads).toHaveLength(before);
  await page.getByLabel("选择同名 Skill 目录更新").setInputFiles(join(root, "code-review"));
  await expect(page.getByText(/code-review · 2 个文件 · \d+ 字节/)).toBeVisible();
  await page.getByRole("button", { name: "上传更新" }).click();
  await expect.poll(() => skillUploads.length).toBe(before + 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "移除" }).click();
  await expect(page.getByText("暂无 Skill，可选择本地目录上传。")).toBeVisible();
});

test("browser ZIP reaches Core upload and submits only its upload ID", async ({ page }) => {
  const directory = join(root, "local-package"); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), '{"name":"tools","version":"1.0.0"}');
  const zip = join(root, "tools.zip"); await packPiPackageDirectory(directory, zip);
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("来源类型").selectOption("zip");
  await page.getByLabel("选择 ZIP 文件").setInputFiles(zip);
  await page.getByRole("button", { name: "提交安装" }).click();
  await expect(page.getByRole("heading", { name: "操作详情" })).toBeVisible();
  await expect(page.getByText("状态：succeeded · 阶段：succeeded")).toBeVisible();
  expect(packageUploads).toHaveLength(1);
  expect(packageUploads[0].headers["content-type"]).toBe("application/zip");
  expect(packageUploads[0].headers["x-piwork-package-source"]).toBe("zip");
  expect(packageUploads[0].headers["x-piwork-sha256"]).toMatch(/^[a-f0-9]{64}$/);
  expect(packageAccepts).toHaveLength(1);
  expect(packageAccepts[0].source).toEqual({ kind: "upload", uploadId: "upload-0199e6d8abcd" });
  expect(JSON.stringify(packageAccepts[0])).not.toContain(root);
});

test("browser package directory is packed without using its folder name as package identity", async ({ page }) => {
  const directory = join(root, "arbitrary-folder"); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), '{"name":"tools","version":"1.0.0"}');
  const uploadsBefore = packageUploads.length, acceptsBefore = packageAccepts.length;
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("来源类型").selectOption("directory");
  await page.getByLabel("选择本地目录").setInputFiles(directory);
  await page.getByRole("button", { name: "提交安装" }).click();
  await expect(page.getByRole("heading", { name: "操作详情" })).toBeVisible();
  expect(packageUploads).toHaveLength(uploadsBefore + 1);
  expect(packageUploads.at(-1).headers["x-piwork-package-source"]).toBe("local");
  expect(packageAccepts).toHaveLength(acceptsBefore + 1);
  expect(packageAccepts.at(-1).source).toEqual({ kind: "upload", uploadId: "upload-0199e6d8abcd" });
  expect(JSON.stringify(packageAccepts.at(-1))).not.toContain("arbitrary-folder");
});

test("AGENTS.md can be selected locally, edited, and explicitly cleared", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "默认 Work" }).click();
  const editor = page.getByLabel("AGENTS.md 内容");
  await page.getByLabel("选择本地 AGENTS.md").setInputFiles({ name: "AGENTS.md", mimeType: "text/markdown",
    buffer: Buffer.from("\ufeff# 说明\n第一行\n") });
  await expect(editor).toHaveValue("\ufeff# 说明\n第一行\n");
  await editor.fill("\ufeff# 说明\n编辑后\n");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("选择本地 AGENTS.md").setInputFiles({ name: "other.md", mimeType: "text/markdown",
    buffer: Buffer.from("# replacement\n") });
  await expect(editor).toHaveValue("\ufeff# 说明\n编辑后\n");
  const previousFileInput = await page.getByLabel("选择本地 AGENTS.md").elementHandle();
  await page.getByRole("button", { name: "保存默认配置" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.agentsMd).toBe("\ufeff# 说明\n编辑后\n");
  await expect.poll(() => previousFileInput.evaluate((node) => node.isConnected)).toBe(false);
  await editor.fill("");
  await page.getByRole("button", { name: "保存默认配置" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.agentsMd).toBe("");
  await page.reload();
  await expect(page.getByLabel("AGENTS.md 内容")).toHaveValue("");
  const countBefore = defaultPatches.length;
  await page.getByLabel("选择本地 AGENTS.md").setInputFiles({ name: "AGENTS.md", mimeType: "text/markdown",
    buffer: Buffer.from([0xff, 0xfe]) });
  await expect(page.getByText("文件不是有效的 UTF-8 文本")).toBeVisible();
  expect(defaultPatches).toHaveLength(countBefore);
});

test("default Work preserves unavailable references and patches only edited fields", async ({ page }) => {
  defaultSkills = ["missing-skill", "alpha", "beta"];
  defaultPackages = [{ name: "missing-package", enabled: true }];
  extraSkills = ["alpha", "beta"].map((name) => ({ name, enabled: true, fileCount: 1, totalBytes: 1 }));
  try {
    await page.goto(base + "/login");
    await page.getByLabel("账号", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "登录" }).click();
    await page.getByRole("link", { name: "默认 Work" }).click();
    const save = page.getByRole("button", { name: "保存默认配置" });
    await expect(save).toBeDisabled();
    await expect(page.getByRole("group", { name: "默认 Skills" }).getByLabel(/missing-skill/)).toBeChecked();
    await expect(page.getByRole("group", { name: "默认 Packages" }).getByLabel(/missing-package/)).toBeChecked();
    const before = defaultPatches.length, readsBeforeSave = defaultReads;
    await page.getByLabel("AGENTS.md 内容").fill("# changed\n");
    await save.click();
    await expect.poll(() => defaultPatches.length).toBe(before + 1);
    await expect(page.getByText("默认配置已保存")).toBeVisible();
    expect(defaultReads).toBe(readsBeforeSave);
    await expect(save).toBeDisabled();
    expect(defaultPatches.at(-1)).toEqual({ agentsMd: "# changed\n" });
    await page.getByRole("button", { name: "上移 beta" }).click();
    await page.getByRole("button", { name: "保存默认配置" }).click();
    await expect.poll(() => defaultPatches.length).toBe(before + 2);
    expect(defaultPatches.at(-1)).toEqual({ skills: ["missing-skill", "beta", "alpha"] });
  } finally {
    defaultSkills = []; defaultPackages = []; extraSkills = [];
  }
});

test("oversized AGENTS selection keeps the current draft and never submits", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "默认 Work" }).click();
  const editor = page.getByLabel("AGENTS.md 内容");
  await editor.fill("# unsaved draft\n");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("选择本地 AGENTS.md").setInputFiles({
    name: "AGENTS.md", mimeType: "text/markdown", buffer: Buffer.alloc(262145, 65),
  });
  await expect(page.getByText(/AGENTS.md 文件超过 256 KiB/)).toBeVisible();
  await expect(editor).toHaveValue("# unsaved draft\n");
});

test("Skill and package directory preflight reject missing root manifests", async ({ page }) => {
  const badSkill = join(root, "bad-skill"), badPackage = join(root, "bad-package");
  await mkdir(badSkill); await writeFile(join(badSkill, "README.md"), "no manifest");
  await mkdir(badPackage); await writeFile(join(badPackage, "README.md"), "no manifest");
  const beforeSkills = skillUploads.length, beforePackages = packageUploads.length;
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByLabel("选择 Skill 目录").setInputFiles(badSkill);
  await page.getByRole("button", { name: "上传 Skill" }).click();
  await expect(page.getByText("Skill 目录根部缺少 SKILL.md")).toBeVisible();
  expect(skillUploads).toHaveLength(beforeSkills);
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("来源类型").selectOption("directory");
  await page.getByLabel("选择本地目录").setInputFiles(badPackage);
  await page.getByRole("button", { name: "提交安装" }).click();
  await expect(page.getByText("目录根部缺少 package.json")).toBeVisible();
  expect(packageUploads).toHaveLength(beforePackages);
});

test("npm and Git sources use explicit intents and an Operation can be recovered in a fresh browser", async ({ page, browser }) => {
  const before = packageAccepts.length;
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("npm 或 Git 来源").fill("tools@1.0.0");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("来源类型").selectOption("git");
  await expect(page.getByLabel("来源类型")).toHaveValue("npm");
  await expect(page.getByLabel("npm 或 Git 来源")).toHaveValue("tools@1.0.0");
  await page.getByRole("button", { name: "提交安装" }).click();
  await expect(page.getByRole("heading", { name: "操作详情" })).toBeVisible();
  expect(packageAccepts.at(-1).source).toEqual({ kind: "npm", spec: "tools@1.0.0" });
  const npmKey = packageAccepts.at(-1).idempotencyKey;
  await page.goto(`${base}/packages`);
  await page.getByLabel("来源类型").selectOption("git");
  await page.getByLabel("npm 或 Git 来源").fill("github.com/example/tools@v1");
  await page.getByRole("button", { name: "提交安装" }).click();
  await expect(page.getByRole("heading", { name: "操作详情" })).toBeVisible();
  expect(packageAccepts.at(-1).source).toEqual({ kind: "git", spec: "github.com/example/tools@v1" });
  expect(packageAccepts.at(-1).idempotencyKey).not.toBe(npmKey);
  expect(packageAccepts).toHaveLength(before + 2);
  await page.goto(`${base}/packages/tools`);
  await page.getByLabel("npm 或 Git 来源").fill("tools@2.0.0");
  await page.getByRole("button", { name: "提交更新" }).click();
  await expect(page.getByRole("heading", { name: "操作详情" })).toBeVisible();
  expect(packageUpdates.at(-1).source).toEqual({ kind: "npm", spec: "tools@2.0.0" });
  const fresh = await browser.newContext({ ignoreHTTPSErrors: true });
  try { const another = await fresh.newPage(); await another.goto(`${base}/login`);
    await another.getByLabel("账号", { exact: true }).fill("admin");
    await another.getByLabel("密码", { exact: true }).fill("correct horse battery");
    await another.getByRole("button", { name: "登录" }).click();
    await another.getByRole("link", { name: "操作查询" }).click();
    await another.getByLabel("Operation ID").fill("operation-0199e6d8abcd");
    await another.getByRole("button", { name: "查询" }).click();
    await expect(another.getByText("状态：succeeded · 阶段：succeeded")).toBeVisible();
    await expect(another.getByRole("button", { name: "取消任务" })).toHaveCount(0);
  } finally { await fresh.close(); }
});

test("runtime save reports readiness separately and clears the entered key", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "运行时" }).click();
  await page.getByLabel("Agent 镜像").fill("piwork-agentd:new");
  await page.getByLabel("模型提供者").fill("anthropic");
  await page.getByLabel("模型 ID").fill("fixture-new");
  await page.getByLabel("API Key").fill("private-model-key");
  await page.getByRole("button", { name: "保存运行时" }).click();
  await expect(page.getByText("配置已保存，但运行时未就绪：RUNTIME_UNAVAILABLE")).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  expect(runtimeSaves.at(-1).credential).toBe("private-model-key");
  expect(await page.locator("body").innerText()).not.toContain("private-model-key");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("private-model-key");
});

test("runtime save with a lost response offers a readback without overwriting the draft", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "运行时" }).click();
  await page.getByLabel("Agent 镜像").fill("piwork-agentd:verify");
  await page.getByLabel("API Key").fill("private-verify-key");
  await page.route("**/console/api/admin/runtime", async (route) => {
    await route.fetch(); await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "保存运行时" }).click();
  await expect(page.getByText(/保存结果待核实/)).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await page.getByRole("button", { name: "读取当前运行时" }).click();
  await expect(page.getByText(/已读取 Core 当前配置/)).toBeVisible();
  await expect(page.getByText(/当前镜像：piwork-agentd:verify/)).toBeVisible();
  await expect(page.getByLabel("Agent 镜像")).toHaveValue("piwork-agentd:verify");
});

test("invalid successful runtime response is treated as uncertain", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "运行时" }).click();
  await page.getByLabel("Agent 镜像").fill("piwork-agentd:uncertain");
  await page.getByLabel("API Key").fill("private-uncertain-key");
  await page.route("**/console/api/admin/runtime", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: "{broken" }), { times: 1 });
  await page.getByRole("button", { name: "保存运行时" }).click();
  await expect(page.getByText(/保存结果待核实/)).toBeVisible();
  await expect(page.getByRole("button", { name: "读取当前运行时" })).toBeVisible();
  await expect(page.getByLabel("Agent 镜像")).toHaveValue("piwork-agentd:uncertain");
  await expect(page.getByLabel("API Key")).toHaveValue("");
});

test("incomplete successful runtime DTO keeps the draft for readback", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "运行时" }).click();
  await page.getByLabel("Agent 镜像").fill("piwork-agentd:incomplete");
  await page.getByLabel("API Key").fill("private-incomplete-key");
  await page.route("**/console/api/admin/runtime", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: '{"runtime":{},"status":{"ready":false}}' }), { times: 1 });
  await page.getByRole("button", { name: "保存运行时" }).click();
  await expect(page.getByText(/保存结果待核实/)).toBeVisible();
  await expect(page.getByRole("button", { name: "读取当前运行时" })).toBeVisible();
  await expect(page.getByLabel("Agent 镜像")).toHaveValue("piwork-agentd:incomplete");
});

test("lists show loading before ready content", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  for (const [name, path, loading] of [
    ["用户", "users", "正在加载用户…"], ["Skills", "skills", "正在加载 Skills…"],
    ["Packages", "packages", "正在加载 Packages…"],
  ]) {
    await page.route("**/console/api/admin/" + path, async (route) => {
      await new Promise((done) => setTimeout(done, 400)); await route.continue();
    }, { times: 1 });
    await page.getByRole("link", { name }).click();
    await expect(page.getByText(loading)).toBeVisible();
    await expect(page.getByText(loading)).toHaveCount(0);
  }
});

test("runtime unconfigured and status connection errors remain distinct and recoverable", async ({ page }) => {
  runtimeConfigured = false;
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "运行时" }).click();
  await expect(page.getByText("尚未配置运行时。")).toBeVisible();
  await page.getByLabel("Agent 镜像").fill("piwork-agentd:local");
  await page.getByLabel("模型提供者").fill("anthropic");
  await page.getByLabel("模型 ID").fill("fixture");
  await page.getByLabel("API Key").fill("temporary-key");
  await page.getByRole("button", { name: "保存运行时" }).click();
  await expect(page.getByText("配置已保存，但运行时未就绪：RUNTIME_UNAVAILABLE")).toBeVisible();
  await page.route("**/console/api/admin/status", (route) => route.abort("failed"), { times: 1 });
  await page.getByRole("link", { name: "状态" }).click();
  await expect(page.getByText(/连接中断，请查询当前状态后再操作/)).toBeVisible();
  await page.getByRole("button", { name: "刷新状态" }).click();
  await expect(page.getByText("运行就绪：就绪 · READY")).toBeVisible();
});

test("credential reset requires matching input and explicit confirmation", async ({ page }) => {
  if (!users.some((item) => item.account === "new-user")) users.push({ id: "user-created-00001", account: "new-user", role: "user", enabled: true });
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "用户" }).click();
  const row = page.getByRole("row", { name: /new-user/ });
  await row.getByRole("button", { name: "重置密码" }).click();
  const before = credentialResets.length, readsBefore = userReads;
  await page.getByLabel("新密码", { exact: true }).fill("short");
  await page.getByLabel("确认新密码").fill("short");
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText("密码长度需为 12–1024 个字符")).toBeVisible();
  expect(credentialResets).toHaveLength(before);
  await page.getByLabel("新密码", { exact: true }).fill("new correct password");
  await page.getByLabel("确认新密码").fill("different password");
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText("两次密码不一致")).toBeVisible();
  expect(credentialResets).toHaveLength(before);
  await page.getByLabel("确认新密码").fill("new correct password");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "确认重置" }).click();
  expect(credentialResets).toHaveLength(before);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect.poll(() => credentialResets.length).toBe(before + 1);
  expect(credentialResets.at(-1).body).toEqual({ password: "new correct password" });
  await expect.poll(() => userReads).toBeGreaterThan(readsBefore);
  await expect(page.getByRole("row", { name: /new-user/ })).toContainText("2025");
});

test("missing reset target refreshes the user list and keeps the error visible", async ({ page }) => {
  users.push({ id: "user-gone-00000001", account: "gone-user", role: "user", enabled: true });
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "用户" }).click();
  await page.getByRole("row", { name: /gone-user/ }).getByRole("button", { name: "重置密码" }).click();
  await page.getByLabel("新密码", { exact: true }).fill("new correct password");
  await page.getByLabel("确认新密码").fill("new correct password");
  const readsBefore = userReads;
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect.poll(() => userReads).toBeGreaterThan(readsBefore);
  await expect(page.getByRole("row", { name: /gone-user/ })).toHaveCount(0);
  await expect(page.getByText(/用户不存在.*NOT_FOUND/)).toBeVisible();
});

test("user enable and disable confirmations handle cancellation and self-account exit", async ({ page }) => {
  if (!users.some((item) => item.account === "new-user")) users.push({ id: "user-created-00001", account: "new-user", role: "user", enabled: true });
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "用户" }).click();
  const row = page.getByRole("row", { name: /new-user/ });
  const before = userActions.length;
  page.once("dialog", (dialog) => dialog.dismiss());
  await row.getByRole("button", { name: "禁用" }).click();
  expect(userActions).toHaveLength(before);
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "禁用" }).click();
  await expect(page.getByRole("row", { name: /new-user/ }).getByText("禁用")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /new-user/ }).getByRole("button", { name: "启用" }).click();
  await expect(page.getByRole("row", { name: /new-user/ }).getByText("启用")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /^admin / }).getByRole("button", { name: "禁用" }).click();
  await expect(page.getByText(/LAST_ADMINISTRATOR/)).toBeVisible();
  protectAdministrator = false;
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /^admin / }).getByRole("button", { name: "禁用" }).click();
  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
});

test("lost acceptance response exposes an explicit same-key recovery action", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await expect(page.getByLabel("npm 或 Git 来源")).toBeVisible();
  const before = packageAccepts.length;
  await page.route("**/console/api/admin/packages", async (route) => {
    await route.fetch();
    await route.abort("failed");
  }, { times: 1 });
  await page.getByLabel("npm 或 Git 来源").fill("tools@3.0.0");
  await page.getByRole("button", { name: "提交安装" }).click();
  await expect(page.getByRole("button", { name: "恢复此次提交" })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交安装" })).toBeDisabled();
  expect(packageAccepts).toHaveLength(before + 1);
  const originalKey = packageAccepts.at(-1).idempotencyKey;
  await page.getByRole("button", { name: "恢复此次提交" }).click();
  await expect(page.getByRole("heading", { name: "操作详情" })).toBeVisible();
  expect(packageAccepts).toHaveLength(before + 2);
  expect(packageAccepts.at(-1).idempotencyKey).toBe(originalKey);
  expect(packageAccepts.at(-1).source).toEqual({ kind: "npm", spec: "tools@3.0.0" });
});

test("invalid successful package acceptance keeps the intent for same-key recovery", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("npm 或 Git 来源").fill("tools@invalid-response");
  await page.route("**/console/api/admin/packages", (route) => route.fulfill({ status: 202,
    contentType: "application/json", body: "{}" }), { times: 1 });
  await page.getByRole("button", { name: "提交安装" }).click();
  await expect(page.getByRole("button", { name: "恢复此次提交" })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交安装" })).toBeDisabled();
  await expect(page).toHaveURL(base + "/packages");
  await page.getByRole("button", { name: "恢复此次提交" }).click();
  await expect(page.getByRole("heading", { name: "操作详情" })).toBeVisible();
});

test("AGENTS.md byte boundary is enforced before submitting", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "默认 Work" }).click();
  await page.getByLabel("AGENTS.md 内容").fill("x".repeat(262144));
  await expect(page.getByText("262144 / 262144 字节")).toBeVisible();
  await page.getByRole("button", { name: "保存默认配置" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.agentsMd?.length).toBe(262144);
  await page.reload();
  await page.getByLabel("AGENTS.md 内容").fill("x".repeat(262145));
  const before = defaultPatches.length;
  await page.getByRole("button", { name: "保存默认配置" }).click();
  await expect(page.getByText("AGENTS.md 超过 256 KiB")).toBeVisible();
  expect(defaultPatches).toHaveLength(before);
});

test("user strings remain text and primary actions fit a 360px viewport", async ({ page }) => {
  users.push({ id: "user-script-0001", account: "<script>window.hacked=1</script>", role: "user", enabled: true });
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "用户" }).click();
  await expect(page.getByText("<script>window.hacked=1</script>")).toBeVisible();
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect(page.getByRole("button", { name: "创建用户" })).toBeVisible();
});

test("default Package selection enforces the 64 item boundary", async ({ page }) => {
  packageCatalog = Array.from({ length: 65 }, (_, index) => ({ name: `@example/p${String(index).padStart(2, "0")}`,
    version: null, sourceKind: "npm", enabled: true, isDefault: false }));
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "默认 Work" }).click();
  const boxes = page.getByRole("group", { name: "默认 Packages" }).getByRole("checkbox");
  await expect(boxes).toHaveCount(65);
  for (let index = 0; index < 65; index++) await boxes.nth(index).check();
  const before = defaultPatches.length;
  await page.getByRole("button", { name: "保存默认配置" }).click();
  await expect(page.getByText("默认 Package 最多选择 64 个")).toBeVisible();
  expect(defaultPatches).toHaveLength(before);
  await boxes.last().uncheck();
  await page.getByRole("button", { name: "保存默认配置" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.packages?.length).toBe(64);
});

test("Package detail displays missing version and default reference errors before disable or remove", async ({ page }) => {
  packageDetailDefault = true;
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "Core 状态" })).toBeVisible();
  await page.goto(`${base}/packages/tools`);
  await expect(page.getByText(/版本：未提供/)).toBeVisible();
  await page.getByRole("button", { name: "禁用", exact: true }).click();
  await expect(page.getByText(/PI_PACKAGE_IN_DEFAULTS/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "移除" }).click();
  await expect(page.getByText(/PI_PACKAGE_IN_DEFAULTS/).first()).toBeVisible();
  packageDetailDefault = false;
  await page.reload();
  await page.getByRole("button", { name: "禁用", exact: true }).click();
  await expect(page.getByText(/状态：禁用/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "移除" }).click();
  await expect(page.getByRole("heading", { name: "Packages" })).toBeVisible();
  expect(packageDetailExists).toBe(false);
});

test("Operation observation keeps one poll in flight and stops at a terminal state", async ({ page }) => {
  operationState = "running"; operationDelayMs = 150; operationInFlight = 0; operationMaxInFlight = 0; operationRequests = 0;
  try {
    await page.goto(`${base}/login`);
    await page.getByLabel("账号", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "Core 状态" })).toBeVisible();
    await page.goto(`${base}/operations/operation-0199e6d8abcd`);
    await expect.poll(() => operationInFlight).toBe(1);
    await page.evaluate(() => { for (let index = 0; index < 5; index++) document.dispatchEvent(new Event("visibilitychange")); });
    await expect(page.getByText("状态：running · 阶段：prepare")).toBeVisible();
    expect(operationMaxInFlight).toBe(1);
    operationState = "succeeded";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("状态：succeeded · 阶段：succeeded")).toBeVisible();
    const afterTerminal = operationRequests;
    await page.waitForTimeout(2200);
    expect(operationRequests).toBe(afterTerminal);
  } finally { operationState = "succeeded"; operationDelayMs = 0; }
});

test("invalid Operation ID stays local and observation failure preserves last result", async ({ page }) => {
  operationState = "running";
  try {
    await page.goto(base + "/login");
    await page.getByLabel("账号", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "登录" }).click();
    await page.getByRole("link", { name: "操作查询" }).click();
    const before = operationRequests;
    await page.getByLabel("Operation ID").fill("bad-id");
    await page.getByRole("button", { name: "查询" }).click();
    await expect(page.getByText("请输入有效的 Operation ID")).toBeVisible();
    expect(operationRequests).toBe(before);
    await page.goto(base + "/operations/operation-0199e6d8abcd");
    await expect(page.getByText("状态：running · 阶段：prepare")).toBeVisible();
    await page.route("**/console/api/admin/operations/operation-0199e6d8abcd", (route) => route.abort("failed"), { times: 1 });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText(/观察中断，上次结果为历史状态/)).toBeVisible();
    await expect(page.getByText("状态：running · 阶段：prepare")).toBeVisible();
    await expect(page.getByText("operation-0199e6d8abcd", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "重试观察" }).click();
    await expect(page.getByText(/观察中断，上次结果为历史状态/)).toHaveCount(0);
  } finally { operationState = "succeeded"; }
});

test("visible administrator session and status are rechecked after fifteen seconds", async ({ page }) => {
  await page.clock.install();
  let checks = 0, statuses = 0;
  page.on("request", (request) => { if (request.url().endsWith("/console/api/session")) checks += 1; });
  page.on("request", (request) => { if (request.url().endsWith("/console/api/admin/status")) statuses += 1; });
  await page.goto(`${base}/login`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "Core 状态" })).toBeVisible();
  const before = checks, beforeStatus = statuses;
  await page.clock.fastForward(15_000);
  await expect.poll(() => checks).toBeGreaterThan(before);
  await expect.poll(() => statuses).toBeGreaterThan(beforeStatus);
});
