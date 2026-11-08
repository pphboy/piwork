import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Runs inside real-core.mjs's isolated installation and exact-label cleanup.
export async function serviceViewAcceptance({ page, coreUrl, uiUrl, token, api, waitFor, image }) {
  const call = async (method, path, body, status = 200) => {
    const result = await api(coreUrl, token, method, path, body);
    assert.equal(result.status, status, JSON.stringify(result.data));
    return result.data;
  };
  const operation = receipt => waitFor(async () => {
    const value = await call('GET', `/api/v1/operations/${receipt.operationId}`);
    assert.notEqual(value.state, 'failed', JSON.stringify(value.error));
    return value.state === 'succeeded';
  }, 'Service view fixture operation', 180000);
  const created = await call('POST', '/api/v1/works', { name: 'Service view acceptance', skills: [], packages: [], idempotencyKey: 'service-view-work' }, 202);
  await operation(created);
  const id = created.workId, path = `/api/v1/works/${id}`;
  const services = [];
  for (const name of ['view-a', 'view-b']) {
    const program = `const http=require('node:http'),crypto=require('node:crypto');http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}res.setHeader('content-type','text/html');res.end('<html><body data-document="'+crypto.randomUUID()+'"><h1>${name}</h1><input aria-label="Application draft"></body></html>');}).listen(8099,'0.0.0.0');`;
    const receipt = await call('POST', path + '/services', { definition: { name, image: { reference: image }, command: 'node', args: ['-e', program], workingDirectory: '/var/data/workspace', mounts: [{ source: 'workspace', target: '/var/data/workspace', readOnly: false }], ports: [{ name: 'web', protocol: 'tcp', containerPort: 8099 }], readiness: { kind: 'http', portName: 'web', path: '/health', deadlineMs: 10000 } }, idempotencyKey: name }, 202);
    await operation(receipt);
    services.push(receipt.serviceId);
  }
  const [a, b] = services;
  const open = async target => {
    await target.setViewportSize({ width: 1920, height: 1080 });
    await target.goto(new URL(`/#/work/${id}`, target === page ? page.url() : uiUrl).href);
    if (await target.getByLabel('Password').isVisible()) {
      await target.getByRole('textbox', { name: 'Account', exact: true }).fill('admin');
      await target.getByLabel('Password').fill('real-browser-admin-password');
      await target.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(target.locator('.works-page')).toBeVisible();
      await target.goto(new URL(`/#/work/${id}`, uiUrl).href);
    }
    await expect(target.getByRole('heading', { name: 'Service view acceptance', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(target.frameLocator('iframe').getByRole('heading', { name: 'view-a', exact: true })).toBeVisible();
  };
  const documentId = target => target.frameLocator('iframe').locator('body').getAttribute('data-document');
  const settled = runId => waitFor(async () => {
    const run = await call('GET', path + '/runs/' + runId);
    if (run.state < 4) return false;
    assert.equal(run.state, 4, JSON.stringify(run.error));
    return run;
  }, 'actual SDK Service view Run', 30000);
  const send = async (target, action, serviceId) => {
    const response = target.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/works/${id}/runs`));
    await target.locator('#composer').fill(`service view ${action} ${serviceId} 8099`);
    await expect(target.locator('[data-action=send-message]')).toBeEnabled();
    await target.locator('[data-action=send-message]').click();
    const receipt = await response;
    assert.equal(receipt.status(), 202, await receipt.text());
    const run = (await receipt.json()).run;
    await settled(run.runId);
    const events = await fetch(coreUrl + path + '/runs/' + run.runId + '/events?after=0', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(events.status, 200);
    const output = await events.text();
    assert.ok(output.includes(`service_${action}`) && output.includes('piwork.service-view'), 'real SDK tool result must cross the Core event projection');
    return run;
  };
  const inspect = async (target, observer, mode) => {
    await open(target);
    await observer.goto(new URL(`/#/work/${id}`, target.url()).href);
    await expect(observer.frameLocator('iframe').getByRole('heading', { name: 'view-a', exact: true })).toBeVisible();
    const originalObserver = await documentId(observer);
    await send(target, 'select', b);
    await expect(target.locator('#service-select')).toHaveAttribute('data-service-id', b);
    await expect(target.frameLocator('iframe').getByRole('heading', { name: 'view-b', exact: true })).toBeVisible();
    await expect(target.locator('#app')).toHaveAttribute('data-layout', 'workspace');
    const first = await documentId(target);
    await target.frameLocator('iframe').getByLabel('Application draft').fill('keep until explicit refresh');
    await send(target, 'select', b);
    assert.equal(await documentId(target), first);
    await expect(target.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('keep until explicit refresh');
    await target.evaluate(() => { window.serviceViewComposer = document.querySelector('#composer'); });
    await send(target, 'refresh', b);
    await expect.poll(() => documentId(target)).not.toBe(first);
    await expect(target.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('');
    assert.equal(await target.evaluate(() => window.serviceViewComposer === document.querySelector('#composer')), true);
    await expect(target.locator('#modal')).toHaveCount(0);
    const refreshed = await documentId(target);
    await send(target, 'refresh', a);
    assert.equal(await documentId(target), refreshed);
    await expect(observer.locator('#service-select')).toHaveAttribute('data-service-id', a);
    assert.equal(await documentId(observer), originalObserver);
    // This raw API submission has no originating browser; observers cannot adopt it.
    const sessions = await call('GET', path + '/sessions');
    const foreign = (await call('POST', path + '/runs', { sessionId: sessions.sessions[0].sessionId, prompt: `service view refresh ${b} 8099`, inputMode: 'text', submissionKey: `foreign-view-${mode}` }, 202)).run;
    await settled(foreign.runId);
    await target.evaluate(async ({ id, run }) => {
      const { adapter } = await import('/desktop/browser/adapter.js');
      await adapter.loadRunDetails(id, run);
    }, { id, run: foreign.runId });
    assert.equal(await documentId(target), refreshed);
    await target.screenshot({ path: `/tmp/piwork-asvc-${mode}-success.png`, fullPage: true });
    console.log(JSON.stringify({ result: 'Service view real SDK/Core/browser passed', mode, twoPages: true, exactTarget: true, repeatedSelectPreserved: true, refreshChangedDocument: true, foreignRunIgnored: true }));
  };
  const desktopObserver = await page.context().newPage();
  try { await inspect(page, desktopObserver, 'desktop'); }
  finally { await desktopObserver.close(); }
  const hosted = await page.context().newPage(), hostedObserver = await page.context().newPage();
  try { await inspect(hosted, hostedObserver, 'hosted'); }
  finally {
    await hosted.close();
    await hostedObserver.close();
  }
}
