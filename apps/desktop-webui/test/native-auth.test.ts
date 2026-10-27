import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
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
  const coreHost = Object.values(networkInterfaces()).flat().find(address => address?.family === 'IPv4' && !address.internal)?.address;
  assert(coreHost, 'native HTTP fixture requires a non-loopback interface');
  await new Promise<void>(done => core.listen(0, coreHost, done)); const addr = core.address(); assert(addr && typeof addr !== 'string');
  const coreUrl = `http://${coreHost}:${addr.port}`;
  const portPicker = createServer(); await new Promise<void>(done => portPicker.listen(0, '127.0.0.1', done)); const local = portPicker.address(); assert(local && typeof local !== 'string'); const port = local.port; await new Promise<void>(done => portPicker.close(() => done()));
  const directory = await mkdtemp(join(tmpdir(), 'piwork-native-auth-'));
  const env = { ...process.env, PIWORK_CONFIG_PATH: join(directory, 'credentials', 'client.json'), PATH: '/nonexistent' };
  let child: ChildProcess;
  const start = async () => {
    child = spawn(binary, ['--core', coreUrl, 'desktop', '--port', String(port), '--no-open'], { env });
    return new Promise<string>((resolve, reject) => {
      let output = '', diagnostic = '';
      child.stdout?.on('data', chunk => { output += chunk; const launch = output.match(/http:\/\/desktop\.localhost:\d+\//); if (launch) resolve(launch[0]); });
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

test('native auth: ordinary addresses reuse the CLI login across new browsers, refresh and terminal logout', async t => {
  const f = await fixture(t); const pid = f.child().pid; let bootstraps = 0;
  f.page.on('request', r => { if (r.url().endsWith('/bootstrap')) bootstraps++; });
  await f.page.goto(f.launch); await f.login(); assert.equal(bootstraps, 0);
  await f.page.goto(f.launch); await expect(f.page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible(); assert.equal(bootstraps, 0);
  const other = await f.browser.newContext(); const tab = await other.newPage(); await tab.goto(f.launch);
  await expect(tab.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  await tab.goto(f.reopen()); await expect(tab.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  assert.equal(f.child().pid, pid); assert.equal(new URL(tab.url()).port, String(f.port));
  await other.clearCookies(); await tab.reload(); await expect(tab.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  const result = await f.helper('logout'); assert.equal(result.status, 0, result.stderr); assert.equal(f.tokens.size, 0);
  await tab.goto(f.reopen()); await f.login(tab);
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/login').length, 2);
  assert.doesNotMatch(await tab.locator('body').innerText(), /private-native-/); await other.close();
});
test('native auth: normal sign-out clears the shared login with no browser reset',async t=>{
  const f=await fixture(t);await f.page.goto(f.launch);await f.login();
  const other=await f.browser.newContext();const tab=await other.newPage();
  await tab.goto(f.launch);await expect(tab.getByRole('heading',{name:'Works',exact:true})).toBeVisible();
  await f.page.locator('[data-action="account"]').click();
  await expect(f.page.locator('[data-action="reset-browser-access"]')).toHaveCount(0);
  await f.page.locator('#modal [data-action="sign-out"]').click();
  await expect(f.page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  await tab.reload();await expect(tab.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  assert.equal(f.tokens.size,0);await f.login();
  assert.equal(f.calls.filter(call=>call==='POST /api/v1/login').length,2);await other.close();
});
test('native auth: daemon restart automatically restores the ordinary session, Core revocation and offline logout stay honest', async t => {
  const f = await fixture(t); let bootstraps = 0;
  f.page.on('request', r => { if (r.url().endsWith('/bootstrap')) bootstraps++; });
  await f.page.goto(f.launch); await f.login(); await stop(f.child());
  const latest = await f.start(); assert.equal(latest, f.launch); await f.page.goto(f.launch); await expect(f.page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  await f.page.goto(latest); await expect(f.page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  f.tokens.clear(); await f.page.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); await adapter.checkSession(); });
  await expect(f.page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible(); await f.login();
  f.setOffline(true); await f.page.reload(); await expect(f.page.locator('body')).toContainText('Core is unreachable');
  const beforeReopen = bootstraps;
  const result = await f.helper('logout'); assert.equal(result.status, 5); assert.equal(result.stdout, ''); assert.match(result.stderr, /local identity cleared: true.*saved credential cleared: true.*remote revocation confirmed: false/);
  f.setOffline(false); await f.page.evaluate(address => location.assign(address), f.reopen()); await f.login();
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
  await f.page.locator('.operation-technical > summary').click();
  await expect(f.page.locator('dd code').filter({ hasText: recoveredImportID })).toBeVisible();
  await expect.poll(() => f.calls.includes(`GET /api/v1/operations/${recoveredImportID}`)).toBe(true);
  await f.page.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); await adapter.checkSession(); });
  await expect(f.page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(await f.page.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); return adapter.state.sessionState; }), 'ready');
  const localCookie = (values: typeof cookies) => values.find(c => c.name.startsWith('__Host-piwork-desktop-'))?.value;
  assert.equal(localCookie(await f.context.cookies()), localCookie(cookies));
  const beforeLogin = f.calls.length;
  await f.login();
  const task = f.page.locator(`.recovery-task[data-operation-id="${recoveredImportID}"]`);
  await expect(task).toBeVisible();
  await task.locator('[data-action="operation"]').click();
  await f.page.locator(`[data-action="check-operation"][data-id="${recoveredImportID}"]`).click();
  await f.page.locator('.operation-technical > summary').click();
  await expect(f.page.locator('dd code').filter({ hasText: recoveredImportID })).toBeVisible();
  await expect(f.page.locator('#modal .phase-track')).toContainText('succeeded');
  assert(f.calls.slice(beforeLogin).includes(`GET /api/v1/operations/${recoveredImportID}`));
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/work-packages').length, 1);
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/work-imports').length, 1);
  assert.equal(f.calls.filter(call => call === 'POST /api/v1/login').length, 2);
  assert.equal(bootstraps, 0);
  assert.equal(f.importBodies.length, 1); assert.equal(f.importBodies[0]?.packageId, 'package-original');
  assert.equal(await f.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
});

test('native auth: obsolete ticket fragments are ignored without a browser authorization flow',async t=>{
  const f=await fixture(t);await f.page.goto(f.launch+'#ticket=obsolete');
  await expect(f.page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  assert.equal(new URL(f.page.url()).hash,'');
  assert.equal(f.calls.filter(call=>call.includes('/api/v1/me')||call.includes('/api/v1/login')).length,0);
  const other=await f.browser.newContext();const page=await other.newPage();await page.goto(f.launch+'#ticket=already-used');
  await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();await other.close();
});

test('native HTTP: offline default save/read/clear, connection switch and local guards use the real Desktop API', async t => {
  const f=await fixture(t); await f.page.goto(f.launch);
  await expect(f.page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  const packageBytes=await readFile(packagePath);
  const inspected=await f.page.evaluate(async bytes=>{
    const {adapter}=await import('/desktop/browser/'+'adapter.js');
    return adapter.inspectWork(new File([new Uint8Array(bytes)],'native.work'));
  },Array.from(packageBytes));
  const before=f.calls.length;
  await f.page.locator('#auth-core').fill('http://192.0.2.1:7171');
  await f.page.locator('[data-action="save-default-core"]').last().click();
  await expect(f.page.locator('.default-core-preferences')).toContainText('http://192.0.2.1:7171');
  await f.page.evaluate(async()=>{const {adapter}=await import('/desktop/browser/'+'adapter.js');await adapter.loadPreferences();});
  assert.equal(f.calls.length,before,'offline preferences contacted Core');
  assert.equal(await f.page.evaluate(async()=>{const {adapter}=await import('/desktop/browser/'+'adapter.js');return adapter.inspectionTransfer;}),inspected,'saving changed anonymous Inspect');
  assert.equal(await f.page.evaluate(async()=>{const {adapter}=await import('/desktop/browser/'+'adapter.js');return adapter.state.core.address;}),f.coreUrl);
  await f.page.locator('[data-action="clear-default-core"]').last().click();
  await expect(f.page.locator('.default-core-preferences')).toContainText('Not set');
  await f.page.evaluate(async core=>{const {adapter}=await import('/desktop/browser/'+'adapter.js');await adapter.switchCore(core);},f.coreUrl);
  await f.page.locator('#auth-core').fill(f.coreUrl);
  await f.login();
  const guardResults=await f.page.evaluate(async()=>{
    return Promise.all([
      fetch('/_desktop/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json','X-Piwork-Csrf':'wrong'},body:JSON.stringify({coreUrl:'http://remote.example'})}).then(r=>r.status),
      fetch('/_desktop/api/connection',{method:'PUT',headers:{'Content-Type':'application/json','X-Piwork-Csrf':'wrong'},body:JSON.stringify({coreUrl:'http://remote.example'})}).then(r=>r.status)
    ]);
  });
  assert.deepEqual(guardResults,[403,403]);
  const anonymous=await f.browser.newContext();t.after(()=>anonymous.close());
  const tab=await anonymous.newPage();
  await tab.goto(`http://desktop.localhost:${f.port}/`);
  await expect(tab.getByRole('heading',{name:'Works',exact:true})).toBeVisible();
  assert.equal(await tab.evaluate(async()=> (await fetch('/_desktop/api/preferences')).status),200);
});
