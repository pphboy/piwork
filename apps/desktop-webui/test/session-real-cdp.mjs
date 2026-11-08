// Real Core/Agent Desktop smoke without a browser automation framework.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const [origin, workId, browserBinary] = process.argv.slice(2);
if (!origin || !workId || !browserBinary) throw new Error('Missing synthetic integration parameters');
const profile = await mkdtemp(join(tmpdir(), 'piwork-session-cdp-'));
const browser = spawn(browserBinary, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PATH: '/usr/bin:/bin' } });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chromium startup timed out')), 15_000);
    browser.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    browser.once('exit', () => reject(new Error('Chromium exited before startup')));
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let next = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression, label) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    } throw new Error(`Timed out: ${label}; page: ${await evaluate('document.body.innerText.slice(0,600)')}`);
  };
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await call('Page.navigate', { url: origin }, sessionId);
  await wait("!!document.querySelector('.works-page') || !!document.querySelector('#auth-account')", 'Desktop session');
  if (await evaluate("!!document.querySelector('#auth-account')")) {
    await evaluate("document.querySelector('#auth-account').value='admin';document.querySelector('#auth-account').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#auth-password').value='development-fixture-pass';document.querySelector('[data-action=\"sign-in\"]').click()");
    await wait("!!document.querySelector('.works-page')", 'Desktop signed in');
  }
  await evaluate(`location.hash=${JSON.stringify('/work/' + workId)}`);
  await wait("!!document.querySelector('[data-action=\"sessions\"]')", 'Work chat');
  await evaluate("document.querySelector('[data-action=\"sessions\"]').click()");
  await wait("!!document.querySelector('#modal [data-action=\"new-session\"]:not([disabled])') && !document.querySelector('#modal [aria-busy=\"true\"]')", 'Session picker');
  const before = await evaluate(`(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');return adapter.getWork(${JSON.stringify(workId)}).sessions.map(s=>s.id)})()`);
  await evaluate("document.querySelector('#modal [data-action=\"new-session\"]').click()");
  const condition = `(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');const w=adapter.getWork(${JSON.stringify(workId)});const added=w?.sessions.find(s=>!${JSON.stringify(before)}.includes(s.id));return !!added && !!added.checkedAt && !added.loading && !added.error && !!document.querySelector('.chat-welcome') && document.querySelector('.messages')?.dataset.readingKey?.includes(added.id)})()`;
  await wait(condition, 'new Session empty history');
  assert.equal(await evaluate("!!document.querySelector('.messages .read-placeholder')"), false);
  const first = await evaluate(`(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');return adapter.getWork(${JSON.stringify(workId)}).sessions.find(s=>!${JSON.stringify(before)}.includes(s.id)).id})()`);
  const firstIndex = await evaluate(`(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');return adapter.getWork(${JSON.stringify(workId)}).sessions.findIndex(s=>s.id===${JSON.stringify(first)})})()`);
  assert.equal(await evaluate("document.querySelector('#session-current-trigger').innerText.trim()"), `Session ${firstIndex + 1}`);
  await evaluate("document.querySelector('[data-action=\"sessions\"]').click()");
  await wait("!!document.querySelector('#modal [data-action=\"new-session\"]:not([disabled])')", 'second Session picker');
  await evaluate("document.querySelector('#modal [data-action=\"new-session\"]').click()");
  const secondCondition = `(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');const sessions=adapter.getWork(${JSON.stringify(workId)})?.sessions || [];const added=sessions.find(s=>!${JSON.stringify(before)}.includes(s.id) && s.id!==${JSON.stringify(first)});return !!added && !!added.checkedAt && !added.loading && !added.error && document.querySelector('.messages')?.dataset.readingKey?.includes(added.id)})()`;
  await wait(secondCondition, 'second Session empty history');
  const second = await evaluate(`(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');return adapter.getWork(${JSON.stringify(workId)}).sessions.find(s=>!${JSON.stringify(before)}.includes(s.id) && s.id!==${JSON.stringify(first)}).id})()`);
  await evaluate("document.querySelector('[data-action=\"sessions\"]').click()");
  await wait(`!!document.querySelector('[data-action="toggle-session-menu"][data-session="${second}"]:not([disabled])')`, 'Session management menu');
  await evaluate(`document.querySelector('[data-action="toggle-session-menu"][data-session="${second}"]').click()`);
  await evaluate("document.querySelector('[data-action=\"delete-session\"]').click()");
  await wait("!!document.querySelector('[data-action=\"confirm-delete-session\"]:not([disabled])')", 'delete confirmation');
  await evaluate("document.querySelector('[data-action=\"confirm-delete-session\"]').click()");
  const replacementCondition = `(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');const sessions=adapter.getWork(${JSON.stringify(workId)})?.sessions || [];const added=sessions.find(s=>!${JSON.stringify(before)}.includes(s.id) && s.id!==${JSON.stringify(first)} && s.id!==${JSON.stringify(second)});return !!added && !!added.checkedAt && !added.loading && !added.error && sessions.some(s=>s.id===${JSON.stringify(first)}) && !sessions.some(s=>s.id===${JSON.stringify(second)}) && document.querySelector('.messages')?.dataset.readingKey?.includes(added.id)})()`;
  await wait(replacementCondition, 'replacement Session after deletion');
  const replacementIndex = await evaluate(`(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');const sessions=adapter.getWork(${JSON.stringify(workId)}).sessions;return sessions.findIndex(s=>document.querySelector('.messages')?.dataset.readingKey?.endsWith(':'+s.id))})()`);
  assert.ok(replacementIndex >= 0);
  assert.equal(await evaluate("document.querySelector('#session-current-trigger').innerText.trim()"), `Session ${replacementIndex + 1}`);
  console.log('Real Desktop → Core → Agent: new Session leaves the skeleton; deleting it creates and selects a new Session.');
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await new Promise(resolve => {
    if (browser.exitCode !== null || browser.signalCode !== null) resolve();
    else browser.once('exit', resolve);
  });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
