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

test("form grid aligns controls, help, groups and actions at desktop and mobile widths", async ({ browser }) => {
  for (const width of [1440, 360]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/login`);
      await page.locator(".login-form input").first().fill("admin");
      await page.locator(".login-form input").last().fill("correct horse battery");
      await Promise.all([page.waitForURL(`${base}/`), page.locator(".login-form button").click()]);
      await page.route("**/console/api/admin/skills/code-review", (route) => route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ name: "code-review", enabled: true, fileCount: 2, totalBytes: 12 }) }));
      for (const path of ["/users", "/runtime", "/default-work", "/skills", "/skills/code-review", "/packages", "/operations"]) {
        await page.goto(`${base}${path}`);
        const metrics = await page.locator(".form-card form").first().evaluate((form) => {
          const bounds = (node) => node && getComputedStyle(node).display !== "none" && node.getClientRects().length ? node.getBoundingClientRect() : undefined;
          const label = form.querySelector(":scope > label:not(:has(> input[type=checkbox])):not([hidden])");
          const control = label?.querySelector("input, select, textarea");
          const action = form.querySelector(":scope > button, :scope > .actions");
          const help = form.querySelector(":scope > .small");
          const group = form.querySelector(":scope > fieldset");
          const textarea = form.querySelector("textarea");
          const file = form.querySelector('input[type="file"]:not([hidden])');
          const checkbox = form.querySelector(":scope > label:has(> input[type=checkbox])");
          return { cardWidth: bounds(form.closest(".form-card"))?.width, labelX: bounds(label)?.x,
            controlX: bounds(control)?.x, actionX: bounds(action)?.x, helpX: bounds(help)?.x,
            groupX: bounds(group)?.x, textareaX: bounds(textarea)?.x, fileX: bounds(file)?.x,
            checkboxX: bounds(checkbox)?.x, controlRight: bounds(control)?.right,
            helpRight: bounds(help)?.right, groupRight: bounds(group)?.right,
            textareaRight: bounds(textarea)?.right, fileRight: bounds(file)?.right,
            checkboxRight: bounds(checkbox)?.right, documentWidth: document.documentElement.scrollWidth };
        });
        expect(metrics.cardWidth, path).toBeLessThanOrEqual(width === 1440 ? 1100 : width - 24);
        expect(metrics.documentWidth, path).toBeLessThanOrEqual(width);
        const aligned = [metrics.actionX, metrics.helpX, metrics.groupX, metrics.textareaX, metrics.fileX, metrics.checkboxX]
          .filter((value) => value !== undefined);
        for (const x of aligned) expect(Math.abs(x - metrics.controlX), path).toBeLessThan(2);
        for (const right of [metrics.helpRight, metrics.groupRight, metrics.textareaRight, metrics.fileRight, metrics.checkboxRight]
          .filter((value) => value !== undefined)) expect(Math.abs(right - metrics.controlRight), path).toBeLessThan(2);
        expect(Math.abs(metrics.controlX - metrics.labelX), path).toBeCloseTo(width === 1440 ? 192 : 0, 0);
      }
    } finally { await context.close(); }
  }
});

test("login stays narrow while every management route shares the same page track", async ({ browser }) => {
  for (const width of [1440, 360]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/login`);
      const login = await page.locator("#app").evaluate((main) => {
        const bounds = (node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; };
        return { main: bounds(main), title: bounds(main.querySelector(":scope > h1")),
          description: bounds(main.querySelector(":scope > .page-description")),
          card: bounds(main.querySelector(":scope > .login-card")) };
      });
      expect(login.card.width).toBeLessThanOrEqual(width === 1440 ? 420 : width - 24);
      expect(Math.abs(login.card.left - login.title.left)).toBeLessThan(2);
      expect(Math.abs(login.card.right - login.description.right)).toBeLessThan(2);
      expect(Math.abs((login.card.left + login.card.right) / 2 - (login.main.left + login.main.right) / 2)).toBeLessThan(2);
      await page.locator(".login-form input").first().fill("admin");
      await page.locator(".login-form input").last().fill("correct horse battery");
      await Promise.all([page.waitForURL(`${base}/`), page.locator(".login-form button").click()]);
      await page.route("**/console/api/admin/skills/code-review", (route) => route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ name: "code-review", enabled: true, fileCount: 2, totalBytes: 12 }) }));
      let baseline;
      const longAccount = `user-${"very-long-".repeat(16)}end`;
      await page.route("**/console/api/admin/users", (route) => route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ users: [...users.slice(0, 1), { id: "user-long-0001", account: longAccount, role: "user", enabled: true }] }) }));
      await page.route("**/console/api/admin/operations/operation-0199e6d8abcd", (route) => route.fulfill({ status: 200,
        contentType: "application/json", body: JSON.stringify({ operationId: "operation-0199e6d8abcd", workId: null,
          kind: "pi-package-install", state: "succeeded", packagePhase: "succeeded", name: "tools",
          result: { source: "long-technical-value-".repeat(60) }, error: null }) }));
      for (const path of ["/", "/users", "/runtime", "/default-work", "/skills", "/skills/code-review",
        "/packages", "/packages/tools", "/operations", "/operations/operation-0199e6d8abcd"]) {
        await page.goto(`${base}${path}`);
        if (path === "/users") await expect(page.getByRole("cell", { name: longAccount })).toBeVisible();
        if (path === "/operations/operation-0199e6d8abcd") {
          await expect(page.getByText("Operation succeeded. Check the result in Packages.")).toBeVisible();
          await page.getByText("View Operation technical details").click();
          await expect(page.locator("pre")).toContainText("long-technical-value-");
        }
        const layout = await page.locator("#app").evaluate((main) => {
          const bounds = (node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; };
          const cards = [...main.querySelectorAll(":scope > section.card")].map(bounds);
          const title = bounds(main.querySelector(":scope > h1"));
          const description = bounds(main.querySelector(":scope > .page-description"));
          const localOverflow = [...main.querySelectorAll(".table-wrap, pre")].every((node) => {
            const box = node.getBoundingClientRect(), card = node.closest(".card").getBoundingClientRect();
            return box.left >= card.left && box.right <= card.right;
          });
          const actionsFit = [...main.querySelectorAll("button:not(.table-wrap button)")].every((node) => {
            const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= document.documentElement.clientWidth;
          });
          const viewport = document.documentElement.clientWidth;
          return { cards, title, description, localOverflow, actionsFit, viewport, scroll: document.documentElement.scrollWidth };
        });
        expect(layout.cards.length, path).toBeGreaterThan(0);
        const first = layout.cards[0];
        for (const edge of [layout.title, layout.description]) {
          expect(Math.abs(edge.left - first.left), path).toBeLessThan(2);
          expect(Math.abs(edge.right - first.right), path).toBeLessThan(2);
        }
        for (const card of layout.cards) {
          expect(Math.abs(card.left - first.left), path).toBeLessThan(2);
          expect(Math.abs(card.right - first.right), path).toBeLessThan(2);
        }
        expect(first.width, path).toBeCloseTo(width === 1440 ? 1100 : 336, 0);
        if (baseline) {
          expect(Math.abs(first.left - baseline.left), path).toBeLessThan(2);
          expect(Math.abs(first.right - baseline.right), path).toBeLessThan(2);
        } else baseline = first;
        expect(layout.localOverflow, path).toBe(true);
        expect(layout.actionsFit, path).toBe(true);
        expect(layout.scroll, path).toBeLessThanOrEqual(layout.viewport);
      }
    } finally { await context.close(); }
  }
});

test("password reset and every Package source keep the form grid and errors aligned", async ({ browser }) => {
  for (const width of [1440, 360]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const check = async (selector) => {
      const layout = await page.locator(selector).evaluate((card) => {
        const form = card.querySelector("form"), control = form.querySelector(":scope > label:not([hidden]) input, :scope > label:not([hidden]) select");
        const action = form.querySelector(":scope > button, :scope > .actions");
        const visibleFiles = [...form.querySelectorAll('input[type="file"]')].filter((node) => node.getClientRects().length);
        const checkbox = form.querySelector(':scope > label:has(> input[type="checkbox"])');
        const error = card.querySelector(":scope > .message.error");
        const x = (node) => node?.getBoundingClientRect().x;
        return { control: x(control), action: x(action), files: visibleFiles.map(x), checkbox: x(checkbox), error: x(error),
          scroll: document.documentElement.scrollWidth };
      });
      expect(layout.scroll).toBeLessThanOrEqual(width);
      for (const x of [layout.action, ...layout.files, layout.checkbox, layout.error].filter((item) => item !== undefined))
        expect(Math.abs(x - layout.control), selector).toBeLessThan(2);
    };
    try {
      await page.goto(`${base}/login`);
      await page.locator(".login-form input").first().fill("admin");
      await page.locator(".login-form input").last().fill("correct horse battery");
      await Promise.all([page.waitForURL(`${base}/`), page.locator(".login-form button").click()]);
      await page.goto(`${base}/users`);
      await page.getByRole("row", { name: /^admin / }).getByRole("button", { name: "Reset password" }).click();
      await check(".reset-card");
      await page.locator(".reset-card button[type=submit]").click();
      await check(".reset-card");
      await page.goto(`${base}/packages`);
      for (const kind of ["npm", "git", "directory", "zip"]) {
        await page.getByLabel("Source type").selectOption(kind);
        await check(".form-card");
      }
    } finally { await context.close(); }
  }
});

test("UI language tokens, keyboard focus, compact sections and preview screenshots", async ({ browser }) => {
  const preview = join(process.cwd(), "../../test-results/ui-preview"); await mkdir(preview, { recursive: true });
  for (const width of [1440, 360]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/login`);
      await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
      expect(await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement), header = getComputedStyle(document.querySelector("header"));
        const section = getComputedStyle(document.querySelector("section"));
        return { canvas: root.getPropertyValue("--ui-canvas").trim(), accent: root.getPropertyValue("--ui-accent").trim(),
          header: header.backgroundColor, surface: section.backgroundColor, shadow: section.boxShadow };
      })).toEqual({ canvas: "#F5F8FC", accent: "#0969DA", header: "rgb(248, 251, 255)", surface: "rgb(255, 255, 255)", shadow: "none" });
      const contrast = (ink, paper) => { const luminance = (hex) => { const channels = hex.match(/[\da-f]{2}/gi).map((item) => parseInt(item, 16) / 255)
        .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]; };
        const first = luminance(ink), second = luminance(paper); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); };
      for (const ink of ["#1B2634", "#526477", "#0969DA", "#B42332", "#8A5A00"]) expect(contrast(ink, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      await page.getByLabel("Account", { exact: true }).focus();
      expect(await page.getByLabel("Account", { exact: true }).evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
      await page.mouse.move(0, 0); await page.screenshot({ path: join(preview, `${width}-login.png`), fullPage: true });
      await page.getByLabel("Account", { exact: true }).fill("admin");
      await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("heading", { name: "Core status" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
      await page.mouse.move(0, 0); await page.screenshot({ path: join(preview, `${width}-status.png`), fullPage: true });
      await page.getByRole("link", { name: "Users" }).click();
      await expect(page.getByRole("heading", { name: "User list" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh users" }).locator("xpath=..") ).toContainText("User list");
      await expect(page.getByRole("button", { name: "Create user" }).locator("xpath=..").locator("button:last-child")).toHaveText("Create user");
      await expect(page.getByRole("button", { name: "Disable", exact: true }).first()).toHaveClass(/danger/);
      await expect(page.getByRole("button", { name: "Refresh users" })).toHaveClass(/secondary/);
      if (width === 360) expect(await page.locator(".table-wrap").evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      await page.mouse.move(0, 0); await page.screenshot({ path: join(preview, `${width}-users-form.png`), fullPage: true });
      await page.goto(`${base}/operations/operation-0199e6d8abcd`);
      await expect(page.getByText(/Status: .* · Phase: /)).toBeVisible();
      await expect(page.getByRole("button", { name: "Copy ID" }).locator("xpath=..") ).toContainText("operation-0199e6d8abcd");
      await page.mouse.move(0, 0); await page.screenshot({ path: join(preview, `${width}-operation-detail.png`), fullPage: true });
      await page.route("**/console/api/admin/skills/code-review", (route) => route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ name: "code-review", enabled: true, fileCount: 2, totalBytes: 12 }) }));
      for (const [path, title, filename] of [
        ["/runtime", "Runtime", "runtime"], ["/default-work", "Default Work", "default-work"],
        ["/skills", "Skills", "skills"], ["/skills/code-review", "Skill details", "skill-detail"],
        ["/packages", "Packages", "packages"], ["/packages/tools", "Package details", "package-detail"],
        ["/operations", "Find Operation", "operations"],
      ]) {
        await page.goto(`${base}${path}`);
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(page.locator(".loading-state")).toHaveCount(0);
        await expect(page.locator("#app > section.form-card").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: join(preview, `${width}-${filename}.png`), fullPage: true });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 360) for (const [path, title] of [
        ["/", "Core status"], ["/users", "Users"], ["/runtime", "Runtime"],
        ["/default-work", "Default Work"], ["/skills", "Skills"],
        ["/packages", "Packages"], ["/operations", "Find Operation"],
        ["/packages/tools", "Package details"],
      ]) {
        await page.goto(`${base}${path}`);
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      }
    } finally { await context.close(); }
  }
});

test("administrator logs in, creates a user, and browser never receives Core bearer", async ({ page }) => {
  await page.goto(`${base}/login`);
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Core status" })).toBeVisible();
  await expect(page.getByText("Runtime readiness: Ready · READY")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.some((item) => item.name === "__Host-piwork-console" && item.httpOnly && item.secure && item.sameSite === "Strict")).toBeTruthy();
  expect(JSON.stringify(cookies)).not.toContain("core-secret-bearer");
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByLabel("Account", { exact: true }).fill("new-user");
  await page.getByLabel("Password", { exact: true }).fill("new long password");
  await page.getByLabel("Confirm password").fill("new long password");
  await page.getByLabel("Role").selectOption("user");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("cell", { name: "new-user", exact: true })).toBeVisible();
  await expect(page.getByText(/new-user created as a user. Sign in through piwork-cli./)).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page.getByLabel("Account", { exact: true }).fill("new-admin");
  await page.getByLabel("Password", { exact: true }).fill("second long password");
  await page.getByLabel("Confirm password").fill("second long password");
  await page.getByLabel("Role").selectOption("admin");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("cell", { name: "new-admin", exact: true })).toBeVisible();
  await expect(page.getByText(/new-admin created as an administrator. The account can sign in here./)).toBeVisible();
  await page.getByLabel("Account", { exact: true }).fill("new-user");
  await page.getByLabel("Password", { exact: true }).fill("third long password");
  await page.getByLabel("Confirm password").fill("third long password");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText(/This value conflicts with the current record/)).toBeVisible();
  await expect(page.locator('label[data-field="account"] .field-error')).toHaveText("Check this field and try again.");
  await expect(page.getByText("Code: CONFLICT · Field: account")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("coreToken"))).toBeNull();
  expect(await page.locator("body").innerText()).not.toContain("core-secret-bearer");
});

test("login rate limit shows the remaining wait and clears the password", async ({ page }) => {
  await page.goto(base + "/login");
  await page.route("**/console/api/login", (route) => route.fulfill({ status: 429, contentType: "application/json",
    body: JSON.stringify({ code: "RATE_LIMITED", message: "Sign in过于频繁", retryAfterMs: 2500 }) }), { times: 1 });
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Try again in 3 seconds/)).toBeVisible();
  await expect(page.getByText(/Too many requests/)).toBeVisible();
  await expect(page.getByText("Code: RATE_LIMITED")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("过于频繁");
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue("admin");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("unknown non-English server errors use neutral English while retaining safe identifiers", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Sign in" }).click()]);
  await page.route("**/console/api/admin/users", (route) => route.fulfill({ status: 500, contentType: "application/json",
    body: JSON.stringify({ code: "NEW_FAILURE", message: "服务暂时出错", field: "account", correlationId: "trace-123" }) }), { times: 1 });
  await page.goto(`${base}/users`);
  await expect(page.getByText("The request failed. Check the current state and try again.")).toBeVisible();
  await expect(page.getByText("Code: NEW_FAILURE · Field: account · Correlation ID: trace-123")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("服务暂时出错");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("non-English resource names remain unchanged beside English UI text", async ({ page }) => {
  const item = { name: "资料工具", enabled: true, fileCount: 1, totalBytes: 12 };
  extraSkills.push(item);
  try {
    await page.goto(`${base}/login`);
    await page.getByLabel("Account", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Sign in" }).click()]);
    await page.goto(`${base}/skills`);
    await expect(page.getByRole("link", { name: "资料工具" })).toBeVisible();
    await expect(page.getByText("Enabled · 1 file · 12 bytes")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Skill list" })).toBeVisible();
  } finally { extraSkills.splice(extraSkills.indexOf(item), 1); }
});

test("login, navigation, forms and details use English UI text", async ({ page }) => {
  await page.goto(`${base}/login`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("piwork admin console");
  expect(await page.locator("body").innerText()).not.toMatch(/[\u4e00-\u9fff]/);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Sign in" }).click()]);
  await expect(page.locator("nav a")).toHaveText(["Status", "Users", "Runtime", "Default Work", "Skills", "Packages", "Find Operation"]);
  for (const path of ["/", "/users", "/runtime", "/default-work", "/skills", "/packages", "/operations", "/packages/tools", "/operations/operation-0199e6d8abcd"]) {
    await page.goto(`${base}${path}`);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.locator("body").innerText(), path).not.toMatch(/[\u4e00-\u9fff]/);
  }
});

test("page content places current facts before edits and technical details after summaries", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Sign in" }).click()]);
  for (const [path, facts, form] of [
    ["/users", ".table-wrap", ".form-card"],
    ["/runtime", ".summary-list", ".form-card"],
    ["/default-work", "details", ".form-card"],
    ["/skills", ".card:first-of-type", ".form-card"],
    ["/packages", ".table-wrap", ".form-card"],
  ]) {
    await page.goto(`${base}${path}`);
    await expect(page.locator(form).first()).toBeVisible();
    const order = await page.evaluate(([factsSelector, formSelector]) => {
      const first = document.querySelector(factsSelector), second = document.querySelector(formSelector);
      return Boolean(first && second && first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, [facts, form]);
    expect(order, path).toBe(true);
  }
  await page.goto(`${base}/operations/operation-0199e6d8abcd`);
  await expect(page.locator("details")).toBeVisible();
  expect(await page.evaluate(() => {
    const summary = document.querySelector("#app section #result p, #app section > div:not(.section-header) > p");
    const technical = document.querySelector("#app details");
    return Boolean(summary && technical && summary.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
});

test("refreshing a form asks before discarding its draft", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Users" }).click();
  await page.getByLabel("Account", { exact: true }).fill("draft-user");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Refresh users" }).click();
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue("draft-user");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Refresh users" }).click();
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue("");
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("npm or Git source").fill("tools@draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Refresh Packages" }).click();
  await expect(page.getByLabel("npm or Git source")).toHaveValue("tools@draft");
});

test("browser directory selection streams relative Skill files through console", async ({ page }) => {
  const directory = join(root, "code-review");
  await mkdir(join(directory, "references"), { recursive: true });
  await writeFile(join(directory, "SKILL.md"), "# Skill\n");
  await writeFile(join(directory, "references", "rules.md"), "Rules\n");
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Core status" })).toBeVisible();
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByLabel("Select Skill directory").setInputFiles(directory);
  await page.getByRole("button", { name: "Upload Skill" }).click();
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
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByRole("link", { name: "code-review" }).click();
  await expect(page.getByRole("heading", { name: "Skill details" })).toBeVisible();
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("Disabled · 2 files · 12 bytes")).toBeVisible();
  const before = skillUploads.length;
  await page.getByLabel("Select matching Skill directory").setInputFiles(wrong);
  await page.getByRole("button", { name: "Upload update" }).click();
  await expect(page.getByText("SKILL_NAME_MISMATCH: Directory name must match this Skill.")).toBeVisible();
  expect(skillUploads).toHaveLength(before);
  await page.getByLabel("Select matching Skill directory").setInputFiles(join(root, "code-review"));
  await expect(page.getByText(/code-review · 2 files · \d+ bytes/)).toBeVisible();
  await page.getByRole("button", { name: "Upload update" }).click();
  await expect.poll(() => skillUploads.length).toBe(before + 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No Skills yet. Upload a local directory.")).toBeVisible();
});

test("browser ZIP reaches Core upload and submits only its upload ID", async ({ page }) => {
  const directory = join(root, "local-package"); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), '{"name":"tools","version":"1.0.0"}');
  const zip = join(root, "tools.zip"); await packPiPackageDirectory(directory, zip);
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("Source type").selectOption("zip");
  await page.getByLabel("Select ZIP file").setInputFiles(zip);
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible();
  await expect(page.getByText("Status: succeeded · Phase: succeeded")).toBeVisible();
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
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("Source type").selectOption("directory");
  await page.getByLabel("Select local directory").setInputFiles(directory);
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible();
  expect(packageUploads).toHaveLength(uploadsBefore + 1);
  expect(packageUploads.at(-1).headers["x-piwork-package-source"]).toBe("local");
  expect(packageAccepts).toHaveLength(acceptsBefore + 1);
  expect(packageAccepts.at(-1).source).toEqual({ kind: "upload", uploadId: "upload-0199e6d8abcd" });
  expect(JSON.stringify(packageAccepts.at(-1))).not.toContain("arbitrary-folder");
});

test("AGENTS.md can be selected locally, edited, and explicitly cleared", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Default Work" }).click();
  const editor = page.getByLabel("AGENTS.md content");
  await page.getByLabel("Select local AGENTS.md").setInputFiles({ name: "AGENTS.md", mimeType: "text/markdown",
    buffer: Buffer.from("\ufeff# 说明\n第一行\n") });
  await expect(editor).toHaveValue("\ufeff# 说明\n第一行\n");
  await editor.fill("\ufeff# 说明\n编辑后\n");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Select local AGENTS.md").setInputFiles({ name: "other.md", mimeType: "text/markdown",
    buffer: Buffer.from("# replacement\n") });
  await expect(editor).toHaveValue("\ufeff# 说明\n编辑后\n");
  const previousFileInput = await page.getByLabel("Select local AGENTS.md").elementHandle();
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.agentsMd).toBe("\ufeff# 说明\n编辑后\n");
  await expect.poll(() => previousFileInput.evaluate((node) => node.isConnected)).toBe(false);
  await editor.fill("");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.agentsMd).toBe("");
  await page.reload();
  await expect(page.getByLabel("AGENTS.md content")).toHaveValue("");
  const countBefore = defaultPatches.length;
  await page.getByLabel("Select local AGENTS.md").setInputFiles({ name: "AGENTS.md", mimeType: "text/markdown",
    buffer: Buffer.from([0xff, 0xfe]) });
  await expect(page.getByText("The file is not valid UTF-8 text.")).toBeVisible();
  expect(defaultPatches).toHaveLength(countBefore);
});

test("default Work preserves unavailable references and patches only edited fields", async ({ page }) => {
  defaultSkills = ["missing-skill", "alpha", "beta"];
  defaultPackages = [{ name: "missing-package", enabled: true }];
  extraSkills = ["alpha", "beta"].map((name) => ({ name, enabled: true, fileCount: 1, totalBytes: 1 }));
  try {
    await page.goto(base + "/login");
    await page.getByLabel("Account", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Default Work" }).click();
    const save = page.getByRole("button", { name: "Save defaults" });
    await expect(save).toBeDisabled();
    await expect(page.getByRole("group", { name: "Default Skills" }).getByRole("checkbox", { name: /missing-skill/ })).toBeChecked();
    await expect(page.getByRole("group", { name: "Default Packages" }).getByLabel(/missing-package/)).toBeChecked();
    const before = defaultPatches.length, readsBeforeSave = defaultReads;
    await page.getByLabel("AGENTS.md content").fill("# changed\n");
    await save.click();
    await expect.poll(() => defaultPatches.length).toBe(before + 1);
    await expect(page.getByText("Defaults saved. Only future Work is affected.")).toBeVisible();
    expect(defaultReads).toBe(readsBeforeSave);
    await expect(save).toBeDisabled();
    expect(defaultPatches.at(-1)).toEqual({ agentsMd: "# changed\n" });
    await page.getByRole("button", { name: "Move up Skill beta" }).click();
    await page.getByRole("button", { name: "Save defaults" }).click();
    await expect.poll(() => defaultPatches.length).toBe(before + 2);
    expect(defaultPatches.at(-1)).toEqual({ skills: ["missing-skill", "beta", "alpha"] });
  } finally {
    defaultSkills = []; defaultPackages = []; extraSkills = [];
  }
});

test("Default Skills keeps empty and unavailable selections readable at 360px", async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 360, height: 900 } });
  const page = await context.newPage();
  const longName = "skill-with-a-very-long-technical-name-that-must-remain-fully-readable-0001";
  try {
    defaultSkills = [];
    extraSkills = [{ name: longName, enabled: true, fileCount: 1, totalBytes: 1 }];
    await page.goto(`${base}/login`);
    await page.getByLabel("Account", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Sign in" }).click()]);
    await page.goto(`${base}/default-work`);
    await expect(page.getByText("No Skills selected. Choose from the list above.")).toBeVisible();
    await expect(page.locator(".skill-order-row")).toHaveCount(0);
    defaultSkills = ["removed-skill", longName, "disabled-skill"];
    extraSkills.push({ name: "disabled-skill", enabled: false, fileCount: 1, totalBytes: 1 });
    await page.reload();
    await expect(page.locator(".skill-order-row")).toHaveCount(3);
    await expect(page.locator(".skill-order-row").filter({ hasText: longName })).toContainText(longName);
    await expect(page.locator(".skill-order-row").filter({ hasText: "removed-skill" })).toContainText("Removed from catalog");
    await expect(page.locator(".skill-order-row").filter({ hasText: "disabled-skill" })).toContainText("Disabled");
    await expect(page.getByRole("button", { name: `Move up Skill ${longName}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Move down Skill ${longName}` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.getByRole("button", { name: "Remove Skill removed-skill from defaults" }).click();
    await expect(page.getByRole("group", { name: "Default Skills" }).getByLabel(/removed-skill/)).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Save defaults" })).toBeEnabled();
  } finally { defaultSkills = []; extraSkills = []; await context.close(); }
});

test("oversized AGENTS selection keeps the current draft and never submits", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Default Work" }).click();
  const editor = page.getByLabel("AGENTS.md content");
  await editor.fill("# unsaved draft\n");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Select local AGENTS.md").setInputFiles({
    name: "AGENTS.md", mimeType: "text/markdown", buffer: Buffer.alloc(262145, 65),
  });
  await expect(page.getByText(/AGENTS.md exceeds 256 KiB./)).toBeVisible();
  await expect(editor).toHaveValue("# unsaved draft\n");
});

test("Skill and package directory preflight reject missing root manifests", async ({ page }) => {
  const badSkill = join(root, "bad-skill"), badPackage = join(root, "bad-package");
  await mkdir(badSkill); await writeFile(join(badSkill, "README.md"), "no manifest");
  await mkdir(badPackage); await writeFile(join(badPackage, "README.md"), "no manifest");
  const beforeSkills = skillUploads.length, beforePackages = packageUploads.length;
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Skills" }).click();
  await page.getByLabel("Select Skill directory").setInputFiles(badSkill);
  await page.getByRole("button", { name: "Upload Skill" }).click();
  await expect(page.getByText("The Skill root must contain SKILL.md.")).toBeVisible();
  expect(skillUploads).toHaveLength(beforeSkills);
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("Source type").selectOption("directory");
  await page.getByLabel("Select local directory").setInputFiles(badPackage);
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByText("The directory root must contain package.json.")).toBeVisible();
  expect(packageUploads).toHaveLength(beforePackages);
});

test("npm and Git sources use explicit intents and an Operation can be recovered in a fresh browser", async ({ page, browser }) => {
  const before = packageAccepts.length;
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("npm or Git source").fill("tools@1.0.0");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Source type").selectOption("git");
  await expect(page.getByLabel("Source type")).toHaveValue("npm");
  await expect(page.getByLabel("npm or Git source")).toHaveValue("tools@1.0.0");
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible();
  expect(packageAccepts.at(-1).source).toEqual({ kind: "npm", spec: "tools@1.0.0" });
  const npmKey = packageAccepts.at(-1).idempotencyKey;
  await page.goto(`${base}/packages`);
  await page.getByLabel("Source type").selectOption("git");
  await page.getByLabel("npm or Git source").fill("github.com/example/tools@v1");
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible();
  expect(packageAccepts.at(-1).source).toEqual({ kind: "git", spec: "github.com/example/tools@v1" });
  expect(packageAccepts.at(-1).idempotencyKey).not.toBe(npmKey);
  expect(packageAccepts).toHaveLength(before + 2);
  await page.goto(`${base}/packages/tools`);
  await page.getByLabel("npm or Git source").fill("tools@2.0.0");
  await page.getByRole("button", { name: "Update Package" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible();
  expect(packageUpdates.at(-1).source).toEqual({ kind: "npm", spec: "tools@2.0.0" });
  const fresh = await browser.newContext({ ignoreHTTPSErrors: true });
  try { const another = await fresh.newPage(); await another.goto(`${base}/login`);
    await another.getByLabel("Account", { exact: true }).fill("admin");
    await another.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await another.getByRole("button", { name: "Sign in" }).click();
    await another.getByRole("link", { name: "Find Operation" }).click();
    await another.getByLabel("Operation ID").fill("operation-0199e6d8abcd");
    await another.getByRole("button", { name: "Find Operation" }).click();
    await expect(another.getByText("Status: succeeded · Phase: succeeded")).toBeVisible();
    await expect(another.getByRole("button", { name: "Cancel task" })).toHaveCount(0);
  } finally { await fresh.close(); }
});

test("runtime save reports readiness separately and clears the entered key", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Runtime" }).click();
  await page.getByLabel("Agent image").fill("piwork-agentd:new");
  await page.getByLabel("Model provider").fill("anthropic");
  await page.getByLabel("Model ID").fill("fixture-new");
  await page.getByLabel("API Key").fill("private-model-key");
  await page.getByRole("button", { name: "Save runtime" }).click();
  await expect(page.getByText("Configuration saved. Runtime is not ready: RUNTIME_UNAVAILABLE")).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  expect(runtimeSaves.at(-1).credential).toBe("private-model-key");
  expect(await page.locator("body").innerText()).not.toContain("private-model-key");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("private-model-key");
});

test("runtime save with a lost response offers a readback without overwriting the draft", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Runtime" }).click();
  await page.getByLabel("Agent image").fill("piwork-agentd:verify");
  await page.getByLabel("API Key").fill("private-verify-key");
  await page.route("**/console/api/admin/runtime", async (route) => {
    await route.fetch(); await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Save runtime" }).click();
  await expect(page.getByText(/Save result is uncertain/)).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await page.getByRole("button", { name: "Read current runtime" }).click();
  await expect(page.getByText(/Current Core configuration loaded/)).toBeVisible();
  await expect(page.getByText(/Current image: piwork-agentd:verify/)).toBeVisible();
  await expect(page.getByLabel("Agent image")).toHaveValue("piwork-agentd:verify");
});

test("invalid successful runtime response is treated as uncertain", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Runtime" }).click();
  await page.getByLabel("Agent image").fill("piwork-agentd:uncertain");
  await page.getByLabel("API Key").fill("private-uncertain-key");
  await page.route("**/console/api/admin/runtime", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: "{broken" }), { times: 1 });
  await page.getByRole("button", { name: "Save runtime" }).click();
  await expect(page.getByText(/Save result is uncertain/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Read current runtime" })).toBeVisible();
  await expect(page.getByLabel("Agent image")).toHaveValue("piwork-agentd:uncertain");
  await expect(page.getByLabel("API Key")).toHaveValue("");
});

test("incomplete successful runtime DTO keeps the draft for readback", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Runtime" }).click();
  await page.getByLabel("Agent image").fill("piwork-agentd:incomplete");
  await page.getByLabel("API Key").fill("private-incomplete-key");
  await page.route("**/console/api/admin/runtime", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: '{"runtime":{},"status":{"ready":false}}' }), { times: 1 });
  await page.getByRole("button", { name: "Save runtime" }).click();
  await expect(page.getByText(/Save result is uncertain/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Read current runtime" })).toBeVisible();
  await expect(page.getByLabel("Agent image")).toHaveValue("piwork-agentd:incomplete");
});

test("lists show loading before ready content", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  for (const [name, path, loading] of [
    ["Users", "users", "Loading users…"], ["Skills", "skills", "Loading Skills…"],
    ["Packages", "packages", "Loading Packages…"],
  ]) {
    await page.route("**/console/api/admin/" + path, async (route) => {
      await new Promise((done) => setTimeout(done, 400)); await route.continue();
    }, { times: 1 });
    await page.getByRole("link", { name }).click();
    await expect(page.getByText(loading)).toBeVisible();
    await expect(page.getByText(loading)).toHaveCount(0);
  }
});

test("settings pages show a named loading state before first read", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Sign in" }).click()]);
  for (const [path, loading] of [["runtime", "Loading runtime…"], ["default-work", "Loading defaults…"]]) {
    await page.route(`**/console/api/admin/${path}`, async (route) => {
      await new Promise((done) => setTimeout(done, 400)); await route.continue();
    }, { times: 1 });
    await page.goto(`${base}/${path}`);
    await expect(page.getByText(loading)).toBeVisible();
    await expect(page.getByText(loading)).toHaveCount(0);
  }
});

test("Default Work keeps a draft and requires readback after an uncertain save", async ({ page }) => {
  const previousAgents = defaultAgents;
  defaultSkills = [];
  try {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Sign in" }).click()]);
  await page.goto(`${base}/default-work`);
  await expect(page.getByText("No changes to save.")).toBeVisible();
  const editor = page.getByLabel("AGENTS.md content");
  await editor.fill("# pending default\n");
  await expect(page.getByText("Unsaved changes to Default Work.")).toBeVisible();
  await page.route("**/console/api/admin/default-work", async (route) => {
    if (route.request().method() === "PATCH") { await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  }, { times: 1 });
  const before = defaultPatches.length;
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Save result is uncertain. Read the current defaults before retrying.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save defaults" })).toBeDisabled();
  await expect.poll(() => defaultPatches.length).toBe(before + 1);
  await page.getByRole("button", { name: "Read current defaults" }).click();
  await expect(page.getByText("Current defaults loaded. Compare them with the retained draft before saving again.")).toBeVisible();
  await expect(editor).toHaveValue("# pending default\n");
  expect(defaultPatches).toHaveLength(before + 1);
  } finally { defaultAgents = previousAgents; }
});

test("runtime unconfigured and status connection errors remain distinct and recoverable", async ({ page }) => {
  runtimeConfigured = false;
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Runtime" }).click();
  await expect(page.getByText("Runtime is not configured.")).toBeVisible();
  await page.getByLabel("Agent image").fill("piwork-agentd:local");
  await page.getByLabel("Model provider").fill("anthropic");
  await page.getByLabel("Model ID").fill("fixture");
  await page.getByLabel("API Key").fill("temporary-key");
  await page.getByRole("button", { name: "Save runtime" }).click();
  await expect(page.getByText("Configuration saved. Runtime is not ready: RUNTIME_UNAVAILABLE")).toBeVisible();
  await page.route("**/console/api/admin/status", (route) => route.abort("failed"), { times: 1 });
  await page.getByRole("link", { name: "Status" }).click();
  await expect(page.getByText(/Connection interrupted. Check the current state before retrying./)).toBeVisible();
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText("Runtime readiness: Ready · READY")).toBeVisible();
});

test("credential reset requires matching input and explicit confirmation", async ({ page }) => {
  if (!users.some((item) => item.account === "new-user")) users.push({ id: "user-created-00001", account: "new-user", role: "user", enabled: true });
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Users" }).click();
  const row = page.getByRole("row", { name: /new-user/ });
  await row.getByRole("button", { name: "Reset password", exact: true }).click();
  const before = credentialResets.length, readsBefore = userReads;
  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByLabel("Confirm new password").fill("short");
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByText("Password must be 12–1024 characters.")).toBeVisible();
  expect(credentialResets).toHaveLength(before);
  await page.getByLabel("New password", { exact: true }).fill("new correct password");
  await page.getByLabel("Confirm new password").fill("different password");
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  expect(credentialResets).toHaveLength(before);
  await page.getByLabel("Confirm new password").fill("new correct password");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Confirm reset" }).click();
  expect(credentialResets).toHaveLength(before);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect.poll(() => credentialResets.length).toBe(before + 1);
  expect(credentialResets.at(-1).body).toEqual({ password: "new correct password" });
  await expect.poll(() => userReads).toBeGreaterThan(readsBefore);
  await expect(page.getByRole("row", { name: /new-user/ })).toContainText("2025");
});

test("missing reset target refreshes the user list and keeps the error visible", async ({ page }) => {
  users.push({ id: "user-gone-00000001", account: "gone-user", role: "user", enabled: true });
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Users" }).click();
  await page.getByRole("row", { name: /gone-user/ }).getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByLabel("New password", { exact: true }).fill("new correct password");
  await page.getByLabel("Confirm new password").fill("new correct password");
  const readsBefore = userReads;
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect.poll(() => userReads).toBeGreaterThan(readsBefore);
  await expect(page.getByRole("row", { name: /gone-user/ })).toHaveCount(0);
  await expect(page.getByText(/The requested item was not found/)).toBeVisible();
  await expect(page.getByText("Code: NOT_FOUND")).toBeVisible();
});

test("user enable and disable confirmations handle cancellation and self-account exit", async ({ page }) => {
  if (!users.some((item) => item.account === "new-user")) users.push({ id: "user-created-00001", account: "new-user", role: "user", enabled: true });
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Users" }).click();
  const row = page.getByRole("row", { name: /new-user/ });
  const before = userActions.length;
  page.once("dialog", (dialog) => dialog.dismiss());
  await row.getByRole("button", { name: "Disable" }).click();
  expect(userActions).toHaveLength(before);
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("row", { name: /new-user/ }).getByText("Disabled")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /new-user/ }).getByRole("button", { name: "Enable" }).click();
  await expect(page.getByRole("row", { name: /new-user/ }).getByText("Enabled")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /^admin / }).getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText(/LAST_ADMINISTRATOR/)).toBeVisible();
  protectAdministrator = false;
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /^admin / }).getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
});

test("lost acceptance response exposes an explicit same-key recovery action", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await expect(page.getByLabel("npm or Git source")).toBeVisible();
  const before = packageAccepts.length;
  await page.route("**/console/api/admin/packages", async (route) => {
    await route.fetch();
    await route.abort("failed");
  }, { times: 1 });
  await page.getByLabel("npm or Git source").fill("tools@3.0.0");
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByRole("button", { name: "Resume submission" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install Package" })).toBeDisabled();
  expect(packageAccepts).toHaveLength(before + 1);
  const originalKey = packageAccepts.at(-1).idempotencyKey;
  await page.getByRole("button", { name: "Resume submission" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible();
  expect(packageAccepts).toHaveLength(before + 2);
  expect(packageAccepts.at(-1).idempotencyKey).toBe(originalKey);
  expect(packageAccepts.at(-1).source).toEqual({ kind: "npm", spec: "tools@3.0.0" });
});

test("invalid successful package acceptance keeps the intent for same-key recovery", async ({ page }) => {
  await page.goto(base + "/login");
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Packages" }).click();
  await page.getByLabel("npm or Git source").fill("tools@invalid-response");
  await page.route("**/console/api/admin/packages", (route) => route.fulfill({ status: 202,
    contentType: "application/json", body: "{}" }), { times: 1 });
  await page.getByRole("button", { name: "Install Package" }).click();
  await expect(page.getByRole("button", { name: "Resume submission" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install Package" })).toBeDisabled();
  await expect(page).toHaveURL(base + "/packages");
  await page.getByRole("button", { name: "Resume submission" }).click();
  await expect(page.getByRole("heading", { name: "Operation details" })).toBeVisible();
});

test("AGENTS.md byte boundary is enforced before submitting", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Default Work" }).click();
  await page.getByLabel("AGENTS.md content").fill("x".repeat(262144));
  await expect(page.getByText("262144 / 262144 bytes")).toBeVisible();
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.agentsMd?.length).toBe(262144);
  await page.reload();
  await page.getByLabel("AGENTS.md content").fill("x".repeat(262145));
  const before = defaultPatches.length;
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("AGENTS.md exceeds 256 KiB.")).toBeVisible();
  expect(defaultPatches).toHaveLength(before);
});

test("user strings remain text and primary actions fit a 360px viewport", async ({ page }) => {
  users.push({ id: "user-script-0001", account: "<script>window.hacked=1</script>", role: "user", enabled: true });
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page.getByText("<script>window.hacked=1</script>")).toBeVisible();
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect(page.getByRole("button", { name: "Create user" })).toBeVisible();
});

test("default Package selection enforces the 64 item boundary", async ({ page }) => {
  packageCatalog = Array.from({ length: 65 }, (_, index) => ({ name: `@example/p${String(index).padStart(2, "0")}`,
    version: null, sourceKind: "npm", enabled: true, isDefault: false }));
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Default Work" }).click();
  const boxes = page.getByRole("group", { name: "Default Packages" }).getByRole("checkbox");
  await expect(boxes).toHaveCount(65);
  for (let index = 0; index < 65; index++) await boxes.nth(index).check();
  const before = defaultPatches.length;
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Select at most 64 default Packages.")).toBeVisible();
  expect(defaultPatches).toHaveLength(before);
  await boxes.last().uncheck();
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect.poll(() => defaultPatches.at(-1)?.packages?.length).toBe(64);
});

test("Package detail displays missing version and default reference errors before disable or remove", async ({ page }) => {
  packageDetailDefault = true;
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Core status" })).toBeVisible();
  await page.goto(`${base}/packages/tools`);
  await expect(page.getByText(/Version: Not provided/)).toBeVisible();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(page.getByText(/PI_PACKAGE_IN_DEFAULTS/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/PI_PACKAGE_IN_DEFAULTS/).first()).toBeVisible();
  packageDetailDefault = false;
  await page.reload();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(page.getByText(/Status: Disabled/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("heading", { name: "Packages" })).toBeVisible();
  expect(packageDetailExists).toBe(false);
});

test("Operation observation keeps one poll in flight and stops at a terminal state", async ({ page }) => {
  operationState = "running"; operationDelayMs = 150; operationInFlight = 0; operationMaxInFlight = 0; operationRequests = 0;
  try {
    await page.goto(`${base}/login`);
    await page.getByLabel("Account", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Core status" })).toBeVisible();
    await page.goto(`${base}/operations/operation-0199e6d8abcd`);
    await expect.poll(() => operationInFlight).toBe(1);
    await page.evaluate(() => { for (let index = 0; index < 5; index++) document.dispatchEvent(new Event("visibilitychange")); });
    await expect(page.getByText("Status: running · Phase: prepare")).toBeVisible();
    await expect(page.getByText(/Last checked:/)).toBeVisible();
    expect(operationMaxInFlight).toBe(1);
    operationState = "succeeded";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("Status: succeeded · Phase: succeeded")).toBeVisible();
    const afterTerminal = operationRequests;
    await page.waitForTimeout(2200);
    expect(operationRequests).toBe(afterTerminal);
  } finally { operationState = "succeeded"; operationDelayMs = 0; }
});

test("invalid Operation ID stays local and observation failure preserves last result", async ({ page }) => {
  operationState = "running";
  try {
    await page.goto(base + "/login");
    await page.getByLabel("Account", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Find Operation" }).click();
    const before = operationRequests;
    await page.getByLabel("Operation ID").fill("bad-id");
    await page.getByRole("button", { name: "Find Operation" }).click();
    await expect(page.getByText("Enter a valid Operation ID.")).toBeVisible();
    expect(operationRequests).toBe(before);
    await page.goto(base + "/operations/operation-0199e6d8abcd");
    await expect(page.getByText("Status: running · Phase: prepare")).toBeVisible();
    await page.route("**/console/api/admin/operations/operation-0199e6d8abcd", (route) => route.abort("failed"), { times: 1 });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText(/Observation interrupted. Current result is uncertain; the previous result is historical/)).toBeVisible();
    await expect(page.getByText("Status: running · Phase: prepare")).toBeVisible();
    await expect(page.getByText("operation-0199e6d8abcd", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry observation" }).click();
    await expect(page.getByText(/Observation interrupted. Current result is uncertain; the previous result is historical/)).toHaveCount(0);
  } finally { operationState = "succeeded"; }
});

test("visible administrator session and status are rechecked after fifteen seconds", async ({ page }) => {
  await page.clock.install();
  let checks = 0, statuses = 0;
  page.on("request", (request) => { if (request.url().endsWith("/console/api/session")) checks += 1; });
  page.on("request", (request) => { if (request.url().endsWith("/console/api/admin/status")) statuses += 1; });
  await page.goto(`${base}/login`);
  await page.getByLabel("Account", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Core status" })).toBeVisible();
  const before = checks, beforeStatus = statuses;
  await page.clock.fastForward(15_000);
  await expect.poll(() => checks).toBeGreaterThan(before);
  await expect.poll(() => statuses).toBeGreaterThan(beforeStatus);
});
