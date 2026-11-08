import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { root, source, inputHash, verifyEvidence } from './build-fastapi-htmx-base.mjs';
import { initialize } from '../internal/coreassets/piwork-brain/skills/deploy-work-service/initialize.mjs';
import { prefixFixture } from './web-base-prefix-fixture.mjs';

const output = join(root, 'dist/fastapi-htmx-base');
const candidate = JSON.parse(readFileSync(join(output, 'candidate.json')));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20 });
const inspect = JSON.parse(docker('image', 'inspect', candidate.reference))[0];
assert.equal(candidate.inputHash, inputHash());
assert.equal(inspect.Id, candidate.imageId);
const id = 'piwork-fastapi-check-' + randomUUID();
const temporary = mkdtempSync(join(output, 'fixture-'));
const volume = id + '-workspace';
const network = id + '-network';
const container = id + '-app';
let browser, prefixed;
function readable(path) {
  chmodSync(path, 0o755);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) readable(join(path, entry.name));
    else chmodSync(join(path, entry.name), 0o644);
  }
}
const run = (...args) => docker('run', '--rm', '--network', 'none', '--read-only', '--label', `piwork.fixture=${id}`,
  '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--entrypoint', 'python', candidate.reference, ...args);
const python = program => docker('exec', container, 'python', '-c', program);
async function ready(address) {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(address + '/health', { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    const actual = JSON.parse(docker('inspect', container))[0];
    if (!actual.State.Running) throw new Error(docker('logs', container));
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error('Service readiness timed out: ' + docker('logs', container));
}
try {
  initialize({ workspace: temporary, name: 'sample', template: 'fastapi-htmx' });
  cpSync(join(source, 'test'), join(temporary, 'runner-tests'), { recursive: true });
  const identity = join(temporary, 'identity.json');
  writeFileSync(identity, JSON.stringify({ contractVersion: 1, workId: 'work-fastapi-test', serviceId: 'service-fastapi-test',
    serviceName: 'sample', token: 'a'.repeat(64), agentUrl: 'https://unavailable:7172', caPath: '/etc/piwork/missing-test-ca' }));
  readable(temporary);
  docker('volume', 'create', '--label', `piwork.fixture=${id}`, volume);
  docker('network', 'create', '--internal', '--label', `piwork.fixture=${id}`, network);
  docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--user', '0:0',
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--mount', `type=bind,src=${temporary},dst=/fixture,readonly`, '--entrypoint', 'sh', candidate.reference,
    '-c', 'cp -R /fixture/apps /fixture/runner-tests /var/data/workspace/; chown -R 10001:10001 /var/data/workspace');
  assert.equal(run('-c', 'import os,sqlite3,subprocess,fastapi,jinja2,httpx,multipart;assert os.getuid()==10001;print(subprocess.check_output(["sqlite3",":memory:","select 42"],text=True).strip())').trim(), '42');
  process.stdout.write(run('-m', 'pytest', '-q', '-p', 'no:cacheprovider', '/var/data/workspace/runner-tests'));
  docker('run', '-d', '--name', container, '--label', `piwork.fixture=${id}`, '--network', network,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--mount', `type=bind,src=${identity},dst=/etc/piwork/interaction/config.json,readonly`,
    candidate.reference, 'piwork-fastapi', 'run', '--app', '/var/data/workspace/apps/sample');
  const actual = JSON.parse(docker('inspect', container))[0];
  const address = 'http://' + actual.NetworkSettings.Networks[network].IPAddress + ':8080';
  await ready(address);
  const initial = await (await fetch(address + '/api/runtime-version')).json();
  prefixed = await prefixFixture(address);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  const errors = [];
  const escaped = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== prefixed.origin || !url.pathname.startsWith(prefixed.prefix + '/')) {
      escaped.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(prefixed.url);
  await expect(page.getByRole('heading', { name: 'Personal workstation', exact: true })).toBeVisible();
  await page.getByLabel('Todo title').fill('FastAPI browser proof');
  await page.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await expect(page.getByText('FastAPI browser proof', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  await page.getByLabel('Todo title').fill('draft stays');
  await page.getByLabel('Todo title').focus();
  await fetch(address + '/pi/v1/actions/todo_add', { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId: 'agent-one', input: { title: 'Agent shared state' }, expectedStateVersion: '2' }) });
  await expect(page.getByText('Agent shared state', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Todo title')).toHaveValue('draft stays');
  await expect(page.getByLabel('Todo title')).toBeFocused();
  // Delay an old read until a newer mutation has already changed the display.
  let releaseOld;
  let capturedOld;
  const oldReady = new Promise(done => { capturedOld = done; });
  const oldGate = new Promise(done => { releaseOld = done; });
  let held = false;
  await page.route('**/fragments/business*', async route => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    capturedOld();
    await oldGate;
    await route.fulfill({ response });
  });
  await oldReady;
  await page.getByLabel('Todo title').fill('Newer submission');
  await page.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await expect(page.getByText('Newer submission', { exact: true })).toBeVisible();
  releaseOld();
  await page.unroute('**/fragments/business*');
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  await expect(page.getByText('Newer submission', { exact: true })).toBeVisible();
  await page.getByLabel('Todo title').fill('draft stays');
  python("from pathlib import Path;Path('/var/data/workspace/data/sample/awareness-query-failure').touch()");
  await expect(page.locator('[data-piwork-data-status]')).toContainText('outdated');
  await expect(page.getByText('Agent shared state', { exact: true })).toBeVisible();
  python("from pathlib import Path;Path('/var/data/workspace/data/sample/awareness-query-failure').unlink()");
  await expect(page.locator('[data-piwork-data-status]')).toHaveText('');
  await page.getByRole('link', { name: 'Personal review' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Personal review', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  const writes = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.includes('/forms/')) writes.push(request);
  });
  // A retained draft from the older template is retired, even with storage disabled.
  await page.evaluate(() => {
    const r = window.piworkRuntime;
    sessionStorage.setItem(`piwork:fastapi:${r.storageScope}:${r.basePath}:todo-title`, 'obsolete input');
  });
  await page.reload();
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  assert.equal(await page.evaluate(() => {
    const r = window.piworkRuntime;
    return sessionStorage.getItem(`piwork:fastapi:${r.storageScope}:${r.basePath}:todo-title`);
  }), null);
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('controlled storage failure'); }; });
  await page.reload();
  await expect(page.getByLabel('Todo title')).toBeVisible();
  let releaseWrite, reachedWrite;
  const writeGate = new Promise(done => { releaseWrite = done; });
  const writeReached = new Promise(done => { reachedWrite = done; });
  await page.route('**/forms/todo_add', async route => {
    reachedWrite();
    await writeGate;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await page.getByLabel('Todo title').fill('Single form request');
  await page.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await writeReached;
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  for (const button of await page.locator('button[type=submit]').all()) await expect(button).toBeDisabled();
  // Keep the HTTP request pending across two 1.5-second polling ticks.
  await page.waitForTimeout(3500);
  for (const button of await page.locator('button[type=submit]').all()) await expect(button).toBeDisabled();
  await page.getByLabel('Todo title').fill('Not sent while busy');
  await page.locator('form[hx-post$="/forms/todo_add"]').evaluate(form => form.requestSubmit());
  releaseWrite();
  await expect(page.getByText('Single form request', { exact: true })).toBeVisible();
  assert.equal(writes.length, 1, 'Concurrent submission must be dropped, not queued');
  await expect(page.getByLabel('Todo title')).toHaveValue('Not sent while busy');
  await expect(page.getByRole('button', { name: 'Add Todo', exact: true })).toBeEnabled();
  await page.unroute('**/forms/todo_add');
  // Server rejection clears sent input and does not replay it.
  await page.route('**/forms/todo_add', route => {
    const values = new URLSearchParams(route.request().postData());
    values.set('title', '');
    return route.continue({ postData: values.toString() });
  });
  await page.getByLabel('Todo title').fill('Rejected input');
  await page.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('ACTION_INPUT_INVALID');
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Add Todo', exact: true })).toBeEnabled();
  await page.unroute('**/forms/todo_add');
  // A request that never reaches the server times out and is discarded.
  let releaseUnreceived;
  const unreceivedGate = new Promise(done => { releaseUnreceived = done; });
  await page.route('**/forms/todo_add', async route => {
    await unreceivedGate;
    try { await route.abort(); } catch { /* The browser already timed out. */ }
  });
  await page.locator('form[hx-post$="/forms/todo_add"]').evaluate(form => form.setAttribute('hx-request', '{"timeout":200}'));
  await page.getByLabel('Todo title').fill('Unreceived input is discarded');
  await page.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('not confirmed');
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Add Todo', exact: true })).toBeEnabled();
  releaseUnreceived();
  await page.unroute('**/forms/todo_add');
  await page.locator('form[hx-post$="/forms/todo_add"]').evaluate(form => form.removeAttribute('hx-request'));
  assert.equal((await (await fetch(address + '/ui/queries/todos')).json()).value.some(row => row.title === 'Unreceived input is discarded'), false);
  // The POST commits but its reply is lost. No operation record is restored.
  await page.route('**/forms/todo_add', async route => {
    await route.fetch();
    await route.abort();
  });
  await page.getByLabel('Todo title').fill('Lost response stays single');
  await page.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('not confirmed');
  await expect(page.getByText('Lost response stays single', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Add Todo', exact: true })).toBeEnabled();
  await page.unroute('**/forms/todo_add');
  await page.getByRole('link', { name: 'Personal review', exact: true }).click();
  await page.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  await expect(page.getByText('Lost response stays single', { exact: true })).toBeVisible();
  assert.equal(writes.length, 4, 'Navigation must not resend a failed or unconfirmed POST');
  // Working-copy edits must not leak into a still running checked copy.
  python("from pathlib import Path;p=Path('/var/data/workspace/apps/sample/templates/page.html');p.write_text(p.read_text().replace('Build a little structure', 'Changed page structure'))");
  await page.reload();
  await expect(page.getByText('Build a little structure around your day.')).toBeVisible();
  assert.deepEqual(await (await fetch(address + '/api/runtime-version')).json(), initial);
  docker('restart', container);
  await ready(address);
  await expect(page.getByText('Changed page structure around your day.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  const changed = await (await fetch(address + '/api/runtime-version')).json();
  assert.notEqual(changed.frontendVersion, initial.frontendVersion);
  assert.equal(writes.length, 4, 'Ready page adoption must not replay a POST');
  const state = await (await fetch(address + '/ui/queries/todos')).json();
  assert.equal(state.value.filter(row => row.title === 'Lost response stays single').length, 1);
  const previous = JSON.parse(python("from pathlib import Path;print(Path('/var/data/workspace/apps/sample/.build/previous.json').read_text())"));
  assert.equal(previous.codeVersion, initial.codeVersion);
  python("import json;from pathlib import Path;r=Path('/var/data/workspace/apps/sample');v=json.loads((r/'.build/previous.json').read_text());(r/'templates/page.html').write_bytes((r/'.build/releases'/v['release']/'templates/page.html').read_bytes());assert Path(v['python']).is_file()");
  docker('restart', container);
  await ready(address);
  await expect(page.getByText('Build a little structure around your day.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Lost response stays single', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Todo title')).toHaveValue('');
  assert.equal((await (await fetch(address + '/api/runtime-version')).json()).codeVersion, initial.codeVersion);

  assert.deepEqual(escaped, []);
  assert.deepEqual(errors, []);
  const report = { passed: true, imageId: candidate.imageId, inputHash: candidate.inputHash, checkedAt: new Date().toISOString(),
    checks: ['python-runtime-tests', 'readonly-nonroot', 'sqlite3', 'offline-local-assets', 'htmx-form', 'shared-agent-state',
      'prefix-deep-refresh', 'query-failure-recovery', 'draft-focus', 'checked-copy-fixed', 'ready-page-adoption', 'restart-data', 'repaired-release-reuse', 'single-form-request', 'pending-form-pauses-polling', 'unreceived-request-discarded', 'sent-input-cleared', 'no-form-storage', 'no-navigation-input-restore', 'failed-request-no-replay', 'page-update-after-unconfirmed-request', 'previous-code-dependency-restoration'] };
  verifyEvidence(candidate, inspect, [report]);
  writeFileSync(join(output, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('FastAPI image and prefixed browser validation passed.');
} finally {
  await browser?.close();
  await prefixed?.close();
  try { docker('rm', '-f', container); } catch { /* A failed startup may not have created it. */ }
  try { docker('network', 'rm', network); } catch { /* Keep original test failure. */ }
  try { docker('volume', 'rm', volume); } catch { /* Exact fixture resources only. */ }
  rmSync(temporary, { recursive: true, force: true });
}
