import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const binary = process.env.PIWORK_TEST_NATIVE_CLI || fileURLToPath(new URL('../../../../dist/go/piwork-cli', import.meta.url));
const packagePath = fileURLToPath(new URL('../../../../internal/workpackage/testdata/golden-native-pi-package.work', import.meta.url));
const recoveredImportID = 'operation-expiring-import-1234';
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(done => child.once('exit', () => done())); child.kill('SIGTERM'); await exited;
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }, expireImport = false) {
  let nextToken = 0, offline = false; const tokens = new Set<string>(); const calls: string[] = [];
  const packageBytes = expireImport ? await readFile(packagePath) : Buffer.alloc(0);
  const importBodies: Record<string, unknown>[] = [];
  const core = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`); response.setHeader('Content-Type', 'application/json');
    const token = request.headers.authorization?.slice(7) ?? '';
    if (request.url === '/api/v1/login') { const token = `private-native-${++nextToken}`; tokens.add(token); response.end(JSON.stringify({ token, expiresAt: '2099-01-01T00:00:00Z', user: { id: 'owner', account: 'owner', role: 'user' } })); }
    else if (request.url === '/api/v1/me') { if (offline) { response.writeHead(503); response.end('{}'); } else if (tokens.has(token)) response.end(JSON.stringify({ id: 'owner', account: 'owner', role: 'user' })); else { response.writeHead(401); response.end(JSON.stringify({ code: 'AUTHENTICATION_FAILED', message: 'Expired session' })); } }
    else if (request.url === '/api/v1/logout') { if (offline) { response.writeHead(503); response.end('{}'); } else { tokens.delete(token); response.writeHead(204); response.end(); } }
    else if (request.url === '/healthz' || request.url === '/readyz') response.end(JSON.stringify({ ready: !offline }));
    else if (request.url === '/api/v1/works') response.end(JSON.stringify({ works: [] }));
    else if (request.url === '/api/v1/skills') response.end(JSON.stringify({ skills: [] }));
    else if (request.url === '/api/v1/packages') response.end(JSON.stringify({ packages: [] }));
    else if (expireImport && request.url === '/api/v1/work-packages' && request.method === 'POST') {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      assert.deepEqual(Buffer.concat(chunks), packageBytes);
      response.writeHead(201); response.end(JSON.stringify({ packageId: 'package-original', digest: createHash('sha256').update(packageBytes).digest('hex'), size: packageBytes.length }));
    }
    else if (expireImport && request.url === '/api/v1/work-imports' && request.method === 'POST') {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      importBodies.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(202); response.end(JSON.stringify({ operationId: recoveredImportID, workId: 'work-imported', name: 'Expired import' }));
    }
    else if (expireImport && request.url === `/api/v1/operations/${recoveredImportID}`) {
      if (nextToken === 1) tokens.clear();
      if (!tokens.has(token)) { response.writeHead(401); response.end(JSON.stringify({ code: 'AUTHENTICATION_FAILED', message: 'Session expired while observing the accepted import' })); }
      else response.end(JSON.stringify({ operationId: recoveredImportID, workId: 'work-imported', state: 'succeeded' }));
    }
    else { response.writeHead(404); response.end('{}'); }
  });
  await new Promise<void>(done => core.listen(0, '127.0.0.1', done)); const addr = core.address(); assert(addr && typeof addr !== 'string');
  const coreUrl = `http://127.0.0.1:${addr.port}`;
  const portPicker = createServer(); await new Promise<void>(done => portPicker.listen(0, '127.0.0.1', done)); const local = portPicker.address(); assert(local && typeof local !== 'string'); const port = local.port; await new Promise<void>(done => portPicker.close(() => done()));
  const directory = await mkdtemp(join(tmpdir(), 'piwork-native-auth-'));
  const env = { ...process.env, PIWORK_CONFIG_PATH: join(directory, 'client.json'), PATH: '/nonexistent' };
  let child: ChildProcess;
  const start = async () => {
    child = spawn(binary, ['--core', coreUrl, 'desktop', '--port', String(port), '--no-open'], { env });
    return new Promise<string>((resolve, reject) => {
      let output = '', diagnostic = '';
      child.stdout?.on('data', chunk => { output += chunk; const launch = output.match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/); if (launch) resolve(launch[0]); });
      child.stderr?.on('data', chunk => { diagnostic += chunk; });
      child.once('exit', code => reject(new Error(`Native Desktop startup failed ${code}: ${diagnostic}`)));
      setTimeout(() => reject(new Error('Native Desktop launch timeout')), 5000).unref();
    });
  };
  const launch = await start();
  const browser = await chromium.launch(process.env.PIWORK_TEST_BROWSER_BIN ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN } : { headless: true, channel: 'chromium' });
  const context = await browser.newContext(); const page = await context.newPage(); page.setDefaultTimeout(5000);
  t.after(async () => { await browser.close(); await stop(child); await new Promise<void>(done => core.close(() => done())); await rm(directory, { recursive: true, force: true }); });
  const helperArgs = (action: string) => ['desktop', action, '--port', String(port), ...(action === 'open' ? ['--no-open'] : [])];
  const helperEnv = { ...process.env, PIWORK_CONFIG_PATH: '/wrong/file', PIWORK_CORE_URL: 'bad-core', PATH: '/nonexistent' };
  const helper = (action: string) => new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
    const process = spawn(binary, helperArgs(action), { cwd: tmpdir(), env: helperEnv }); let stdout = '', stderr = '';
    process.stdout.on('data', chunk => { stdout += chunk; }); process.stderr.on('data', chunk => { stderr += chunk; });
    process.once('exit', status => resolve({ status, stdout, stderr }));
  });
  const reopen = () => { const result = spawnSync(binary, helperArgs('open'), { encoding: 'utf8', cwd: tmpdir(), env: helperEnv }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim().replace('Piwork Desktop: ', ''); };
  const login = async (target = page) => { await target.getByRole('heading', { name: 'Connect to your Core' }).waitFor(); await target.getByLabel('Account', { exact: true }).fill('owner'); await target.getByLabel('Password').fill('password'); await target.getByRole('button', { name: 'Sign in', exact: true }).click(); await target.getByRole('heading', { name: 'Works', exact: true }).waitFor(); await target.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); await adapter.checkConnection(); }); };
  return { browser, context, page, launch, port, calls, tokens, importBodies, helper, reopen, login, start, child: () => child, setOffline: (value: boolean) => { offline = value; }, coreUrl };
}

test('native auth: Cookie-first reuse, replay rejection, same-process reopen and terminal logout-to-login', async t => {
  const f = await fixture(t); const pid = f.child().pid; let bootstraps = 0;
  f.page.on('request', r => { if (r.url().endsWith('/bootstrap')) bootstraps++; });
  await f.page.goto(f.launch); await f.login(); assert.equal(bootstraps, 1);
  await f.page.goto(f.launch); await expect(f.page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible(); assert.equal(bootstraps, 1);
  const other = await f.browser.newContext(); const tab = await other.newPage(); await tab.goto(f.launch);
  await expect(tab.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  await tab.goto(f.reopen()); await expect(tab.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  assert.equal(f.child().pid, pid); assert.equal(new URL(tab.url()).port, String(f.port));
  await other.clearCookies(); await tab.reload(); await expect(tab.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  const result = await f.helper('logout'); assert.equal(result.status, 0, result.stderr); assert.equal(f.tokens.size, 0);
  await tab.goto(f.reopen()); await f.login(tab);
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/login').length, 2);
  assert.doesNotMatch(await tab.locator('body').innerText(), /private-native-/); await other.close();
});
test('native auth: reset revokes all Cookies and tickets, retains Core session; normal sign out permits login', async t => {
  const f = await fixture(t); await f.page.goto(f.launch); await f.login();
  const other = await f.browser.newContext(); const tab = await other.newPage(); await tab.goto(f.reopen()); await tab.getByRole('heading', { name: 'Works', exact: true }).waitFor();
  const pendingTicket = f.reopen(); const before = [...f.tokens];
  await f.page.locator('[data-action="account"]').click(); await f.page.getByRole('button', { name: 'Reset browser access', exact: true }).click();
  await f.page.getByRole('button', { name: 'Reset browser access', exact: true }).click();
  await expect(f.page.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  await tab.reload(); await expect(tab.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  await tab.goto(pendingTicket); await expect(tab.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  assert.deepEqual([...f.tokens], before); await f.page.goto(f.reopen()); await expect(f.page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  await f.page.locator('[data-action="account"]').click(); await f.page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await f.login(); assert.equal(f.calls.filter(call => call === 'POST /api/v1/login').length, 2); await other.close();
});
test('native auth: daemon restart rejects old authorization, Core revocation retains local login, offline logout is honest', async t => {
  const f = await fixture(t); let bootstraps = 0;
  f.page.on('request', r => { if (r.url().endsWith('/bootstrap')) bootstraps++; });
  await f.page.goto(f.launch); await f.login(); await stop(f.child());
  const latest = await f.start(); await f.page.goto(f.launch); await expect(f.page.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  await f.page.goto(latest); await expect(f.page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  f.tokens.clear(); await f.page.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); await adapter.checkBrowserAccess(); });
  await expect(f.page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible(); await f.login();
  f.setOffline(true); await f.page.reload(); await expect(f.page.locator('body')).toContainText('Core is unreachable');
  const documentMarker = 'offline-before-terminal-logout';
  await f.page.evaluate(marker => Reflect.set(window, 'piworkRecoveryDocument', marker), documentMarker);
  const beforeReopen = bootstraps;
  const result = await f.helper('logout'); assert.equal(result.status, 5); assert.equal(result.stdout, ''); assert.match(result.stderr, /local identity cleared: true.*saved credential cleared: true.*remote revocation confirmed: false/);
  f.setOffline(false); await f.page.evaluate(address => location.assign(address), f.reopen()); await f.login();
  assert.equal(await f.page.evaluate(() => Reflect.get(window, 'piworkRecoveryDocument')), documentMarker);
  assert.equal(bootstraps, beforeReopen);
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/login').length, 3);
  assert.equal(f.child().exitCode, null);
});

test('native auth: an accepted Import survives Core expiry and same-account login without a second submission or local ticket', async t => {
  const f = await fixture(t, true); let bootstraps = 0;
  f.page.on('request', r => { if (r.url().endsWith('/bootstrap')) bootstraps++; });
  await f.page.goto(f.launch); await f.login();
  const cookies = await f.context.cookies();
  await f.page.getByRole('button', { name: 'Import Work', exact: true }).click();
  await f.page.locator('#work-file-input').setInputFiles(packagePath);
  await f.page.getByText('Package format and contents verified locally.', { exact: true }).waitFor();
  await f.page.locator('#import-name').fill('Expired import');
  await f.page.getByRole('button', { name: 'Import Work', exact: true }).last().click();
  await expect(f.page.locator('dd code').filter({ hasText: recoveredImportID })).toBeVisible();
  await expect.poll(() => f.calls.includes(`GET /api/v1/operations/${recoveredImportID}`)).toBe(true);
  await f.page.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); await adapter.checkBrowserAccess(); });
  await expect(f.page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(await f.page.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); return adapter.state.browserAccess; }), 'authorized');
  const localCookie = (values: typeof cookies) => values.find(c => c.name.startsWith('__Host-piwork-desktop-'))?.value;
  assert.equal(localCookie(await f.context.cookies()), localCookie(cookies));
  const beforeLogin = f.calls.length;
  await f.login();
  await f.page.getByRole('button', { name: 'Known operations', exact: true }).click();
  await f.page.locator(`[data-action="operation"][data-id="${recoveredImportID}"]`).click();
  await f.page.locator(`[data-action="check-operation"][data-id="${recoveredImportID}"]`).click();
  await expect(f.page.locator('dd code').filter({ hasText: recoveredImportID })).toBeVisible();
  await expect(f.page.getByText('succeeded. The original Operation reached a confirmed result.', { exact: true })).toBeVisible();
  assert(f.calls.slice(beforeLogin).includes(`GET /api/v1/operations/${recoveredImportID}`));
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/work-packages').length, 1);
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/work-imports').length, 1);
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/login').length, 2);
  assert.equal(bootstraps, 1);
  assert.equal(f.importBodies.length, 1); assert.equal(f.importBodies[0]?.packageId, 'package-original');
  assert.equal(await f.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
});

test('native auth: an actually five-minute-old unused ticket cannot authorize a browser', { timeout: 330000, skip: process.env.PIWORK_TEST_TICKET_EXPIRY !== '1' }, async t => {
  const f = await fixture(t);
  await new Promise(done => setTimeout(done, 300250));
  await f.page.goto(f.launch); await expect(f.page.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  assert.equal(f.calls.filter(call => call.includes('/api/v1/me') || call.includes('/api/v1/login')).length, 0);
  await f.page.goto(f.reopen()); await expect(f.page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
});
