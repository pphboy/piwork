import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/adapter.js`)
  : new URL('../dist/browser/adapter.js', import.meta.url);
const { ConsoleAdapter } = await import(moduleURL);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve;
const promise = new Promise(yes => { resolve = yes; });
return { resolve, promise }; };
function fixture(t, fetch) {
  const before = globalThis.fetch;
  globalThis.fetch = fetch;
  globalThis.document = { querySelector: () => null };
  t.after(() => { globalThis.fetch = before; });
  return new ConsoleAdapter();
}
test('same page reads share one request and retain confirmed catalog on a later failure', async t => {
  const gate = deferred();
  let calls = 0;
  const adapter = fixture(t, async () => { calls++;
  return calls === 1 ? gate.promise : json({ code: 'CORE_UNAVAILABLE' }, 503); });
  const first = adapter.skills(), second = adapter.skills();
  assert.equal(calls, 1);
  gate.resolve(json({ skills: [{ name: 'fixture', enabled: true, fileCount: 1, totalBytes: 42 }] }));
  assert.deepEqual(await first, await second);
  await assert.rejects(adapter.skills(), { code: 'CORE_UNREACHABLE' });
  assert.equal(adapter.store.skills[0].name, 'fixture');
});
test('Package Resume reuses exact source and stable key only; changing the intent is rejected before POST', async t => {
  const payloads = [];
  const adapter = fixture(t, async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    if (payloads.length === 1) throw new Error('Synthetic lost acceptance');
    return json({ operationId: 'operation-original' });
  });
  const intent = { key: 'synthetic-original-key', kind: 'npm', source: 'fixture-package@1.0.0', name: 'fixture-package', addDefault: false };
  await assert.rejects(adapter.submitPackage(intent), { code: 'ACCEPTANCE_UNKNOWN' });
  assert.equal(payloads.length, 1);
  const operation = await adapter.submitPackage(intent);
  assert.equal(operation.id, 'operation-original');
  assert.deepEqual(payloads[0], payloads[1]);
  await assert.rejects(adapter.submitPackage({ ...intent, source: 'other-package@1.0.0' }), { code: 'INTENT_CONFLICT' });
  assert.equal(payloads.length, 2);
});
test('a lost optional model Test is not an unknown configuration write', async t => {
  const calls = [];
  const adapter = fixture(t, async (url, options) => { calls.push([url, options.method]);
  throw new Error('Synthetic lost response'); });
  await assert.rejects(adapter.modelRequest('model-tests', 'POST', { modelId: 'synthetic-model' }), { code: 'TEST_RESULT_UNAVAILABLE' });
  assert.deepEqual(calls, [['/console/api/admin/model-tests', 'POST']]);
});
test('Runtime Save returns configuration and does not invent a Package Operation', async t => {
  const calls = [];
  const adapter = fixture(t, async (url, options) => {
    calls.push([url, options.method, JSON.parse(options.body)]);
    return json({ runtime: { configured: true, agentImage: 'fixture-agent', modelRef: 'model-ref', model: { provider: 'fixture', id: 'model-id', credentialAvailable: true } } });
  });
  const value = await adapter.saveRuntimeSelection('model-ref');
  assert.equal(value.modelRef, 'model-ref');
  assert.equal(value.operationId, undefined);
  assert.equal(adapter.store.operations.length, 0);
  assert.deepEqual(calls, [['/console/api/admin/runtime', 'PUT', { modelRef: 'model-ref' }]]);
});
test('old session response cannot replace a new identity after response body decoding', async t => {
  const body = deferred();
  const adapter = fixture(t, async () => ({ status: 200, ok: true, json: () => body.promise }));
  const reading = adapter.users();
  await Promise.resolve();
  adapter.clearIdentity();
  adapter.currentUserId = 'new-user';
  body.resolve({ users: [{ id: 'old-user', account: 'old', role: 'admin', enabled: true }] });
  await assert.rejects(reading, { code: 'SESSION_CHANGED' });
  assert.equal(adapter.currentUserId, 'new-user');
  assert.deepEqual(adapter.store.users, []);
});

const readFamilies = [
  { name: 'Users', read: adapter => adapter.users(), data: { users: [{ id: 'user-original', account: 'original', role: 'user', enabled: true }] }, retained: adapter => adapter.store.users },
  { name: 'Default Work', read: adapter => adapter.defaults(), data: { baseImage: 'agent-original', configuration: { skills: ['skill-original'], packages: ['package-original'], agentsMd: 'Original instructions' } }, retained: adapter => adapter.store.defaults },
  { name: 'Skills', read: adapter => adapter.skills(), data: { skills: [{ name: 'skill-original', enabled: true, fileCount: 1, totalBytes: 42 }] }, retained: adapter => adapter.store.skills },
  { name: 'Packages', read: adapter => adapter.packages(), data: { packages: [{ name: 'package-original', enabled: true, version: '1.0.0', sourceKind: 'npm' }] }, retained: adapter => adapter.store.packages },
  { name: 'Package Operation', read: adapter => adapter.operation('operation-original'), data: { operationId: 'operation-original', state: 'running', packagePhase: 'resolving_source', packageName: 'package-original' }, retained: adapter => adapter.store.operations },
  // About is read-only and its retained productInfo belongs to the page owner, not Adapter.store.
  { name: 'About', read: adapter => adapter.about(), data: { build: { version: '1.0.0', commit: 'original', modified: false }, releaseNotes: { sections: [] } } },
];
for (const family of readFamilies) {
  test(`${family.name}: failed refresh is read-only, actionable and preserves the last transport snapshot`, async t => {
    let fail = false;
    const calls = [];
    const adapter = fixture(t, async (url, options) => {
      calls.push([url, options.method]);
      return fail ? json({ code: 'CORE_UNAVAILABLE', message: 'Do not echo server diagnostics' }, 503) : json(family.data);
    });
    const value = await family.read(adapter);
    const retained = family.retained?.(adapter);
    fail = true;
    await assert.rejects(family.read(adapter), error => {
      assert.equal(error.code, 'CORE_UNREACHABLE');
      assert.ok(error.message.length > 0);
      assert.ok(!error.message.includes('Do not echo'));
      return true;
    });
    if (family.retained) assert.strictEqual(family.retained(adapter), retained);
    assert.ok(value);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(([, method]) => method === 'GET'));
  });
  test(`${family.name}: late decoded response cannot publish into a changed identity`, async t => {
    const body = deferred();
    const adapter = fixture(t, async () => ({ status: 200, ok: true, json: () => body.promise }));
    const reading = family.read(adapter);
    await Promise.resolve();
    adapter.clearIdentity();
    adapter.currentUserId = 'new-identity';
    const afterIdentity = family.retained?.(adapter);
    body.resolve(family.data);
    await assert.rejects(reading, { code: 'SESSION_CHANGED' });
    assert.equal(adapter.currentUserId, 'new-identity');
    if (family.retained) assert.strictEqual(family.retained(adapter), afterIdentity);
  });
}

const mutations = [
  { name: 'Users create', run: adapter => adapter.createUser({ account: 'new-user', password: 'synthetic-password', role: 'User' }), path: '/console/api/admin/users', method: 'POST' },
  { name: 'Users credential reset', run: adapter => adapter.userAction('user-original', 'reset', 'synthetic-password'), path: '/console/api/admin/users/user-original/reset-credential', method: 'POST' },
  { name: 'Default Work patch', run: adapter => adapter.saveDefaults({ agentsMd: 'New instructions', skills: ['skill-original'] }), path: '/console/api/admin/default-work', method: 'PATCH' },
  { name: 'Skills disable', run: adapter => adapter.catalogAction('skills', 'skill-original', 'disable'), path: '/console/api/admin/skills/skill-original/disable', method: 'POST' },
  { name: 'Packages remove', run: adapter => adapter.catalogAction('packages', 'package-original', 'remove'), path: '/console/api/admin/packages/package-original', method: 'DELETE' },
];
for (const mutation of mutations) {
  test(`${mutation.name}: lost acknowledgement is unknown and never automatically replayed`, async t => {
    const calls = [];
    const adapter = fixture(t, async (url, options) => {
      calls.push([url, options.method]);
      throw new Error('Synthetic connection lost');
    });
    await assert.rejects(mutation.run(adapter), { code: 'RESULT_UNKNOWN' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [[mutation.path, mutation.method]]);
    assert.deepEqual(adapter.store.operations, []);
  });
  test(`${mutation.name}: known rejection remains distinct from unknown acceptance`, async t => {
    let calls = 0;
    const adapter = fixture(t, async () => {
      calls++;
      return json({ code: 'INVALID_REQUEST', field: 'name', message: 'Synthetic private payload' }, 400);
    });
    await assert.rejects(mutation.run(adapter), error => {
      assert.equal(error.code, 'INVALID_REQUEST');
      assert.equal(error.field, 'name');
      assert.ok(!error.message.includes('Synthetic private payload'));
      return true;
    });
    assert.equal(calls, 1);
  });
}

test('confirmed user creation survives a failed users read without resubmission or password retention', async t => {
  const calls = [];
  const adapter = fixture(t, async (url, options) => {
    calls.push([url, options.method]);
    return options.method === 'POST'
      ? json({ id: 'user-created', account: 'new-user', enabled: true, role: 'user' }, 201)
      : json({ code: 'CORE_UNAVAILABLE' }, 503);
  });
  const confirmed = await adapter.createUser({ account: 'new-user', password: 'synthetic-password', role: 'User' });
  await assert.rejects(adapter.users(), { code: 'CORE_UNREACHABLE' });
  assert.equal(confirmed.id, 'user-created');
  assert.ok(!JSON.stringify(confirmed).includes('synthetic-password'));
  assert.deepEqual(calls.map(([, method]) => method), ['POST', 'GET']);
});

test('confirmed Default Work patch retains its exact configuration after failed readback', async t => {
  const calls = [];
  const adapter = fixture(t, async (url, options) => {
    calls.push([url, options.method, options.body ? JSON.parse(options.body) : undefined]);
    return options.method === 'PATCH'
      ? json({ baseImage: 'agent-confirmed', configuration: { agentsMd: 'Confirmed instructions', skills: ['skill-confirmed'], packages: [] } })
      : json({ code: 'CORE_UNAVAILABLE' }, 503);
  });
  const confirmed = await adapter.saveDefaults({ agentImage: 'agent-confirmed', agentsMd: 'Confirmed instructions', skills: ['skill-confirmed'] });
  await assert.rejects(adapter.defaults(), { code: 'CORE_UNREACHABLE' });
  assert.strictEqual(adapter.store.defaults, confirmed);
  assert.equal(confirmed.agentsMd, 'Confirmed instructions');
  assert.deepEqual(calls[0][2], { baseImage: 'agent-confirmed', agentsMd: 'Confirmed instructions', skills: ['skill-confirmed'] });
  assert.deepEqual(calls.map(([, method]) => method), ['PATCH', 'GET']);
});

test('Package Operation readback cannot substitute a different operation identity', async t => {
  let wrong = false;
  const adapter = fixture(t, async () => json({ operationId: wrong ? 'operation-other' : 'operation-original', state: 'running', packageName: 'package-original' }));
  const original = await adapter.operation('operation-original');
  wrong = true;
  await assert.rejects(adapter.operation('operation-original'), { code: 'INVALID_RESPONSE' });
  assert.strictEqual(adapter.store.operations[0], original);
  assert.equal(adapter.store.operations[0].id, 'operation-original');
});

function xhrFixture(t) {
  const previousXHR = globalThis.XMLHttpRequest;
  const requests = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.headers = {};
      requests.push(this);
    }
    open(method, url) { this.method = method;
    this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; }
    reply(status, value) {
      this.status = status;
      this.responseText = JSON.stringify(value);
      this.onload();
    }
    progress(loaded, total) { this.upload.onprogress({ loaded, total, lengthComputable: true }); }
  };
  t.after(() => { globalThis.XMLHttpRequest = previousXHR; });
  const file = new File(['Synthetic skill'], 'SKILL.md', { type: 'text/markdown' });
  Object.defineProperty(file, 'webkitRelativePath', { value: 'skill-original/SKILL.md' });
  return { requests, selection: { name: 'skill-original', files: [file], bytes: file.size, summary: 'One synthetic file' } };
}
test('Skill upload loss is unknown without replay and keeps server confirmation separate from byte progress', async t => {
  const { requests, selection } = xhrFixture(t);
  const adapter = fixture(t, async () => { throw new Error('Unexpected fetch'); });
  const progress = [];
  const upload = adapter.uploadSkill(selection, undefined, (...value) => progress.push(value));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/console/api/admin/skills');
  requests[0].progress(selection.bytes, selection.bytes);
  requests[0].onerror();
  await assert.rejects(upload, { code: 'RESULT_UNKNOWN' });
  assert.deepEqual(progress, [[selection.bytes, selection.bytes]]);
  assert.equal(requests.length, 1);
  assert.deepEqual(adapter.store.skills, []);
});
test('Skill upload late progress and acknowledgement cannot cross an identity change', async t => {
  const { requests, selection } = xhrFixture(t);
  const adapter = fixture(t, async () => { throw new Error('Unexpected fetch'); });
  const progress = [];
  const upload = adapter.uploadSkill(selection, 'skill-original', (...value) => progress.push(value));
  requests[0].progress(1, selection.bytes);
  adapter.clearIdentity();
  adapter.currentUserId = 'new-identity';
  requests[0].progress(selection.bytes, selection.bytes);
  requests[0].reply(200, { name: 'skill-original' });
  await assert.rejects(upload, { code: 'SESSION_CHANGED' });
  assert.deepEqual(progress, [[1, selection.bytes]]);
  assert.equal(adapter.currentUserId, 'new-identity');
  assert.deepEqual(adapter.store.skills, []);
});

test('uploaded Package Resume keeps the accepted upload identity and key without uploading bytes again', async t => {
  const { requests, selection } = xhrFixture(t);
  const payloads = [];
  const adapter = fixture(t, async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    if (payloads.length === 1) throw new Error('Synthetic lost package acceptance');
    return json({ operationId: 'operation-original' });
  });
  const intent = { key: 'original-key', kind: 'ZIP', source: 'Original selected archive', name: 'package-original', addDefault: false };
  const progress = [];
  const submitting = adapter.submitPackage(intent, (...value) => progress.push(value), selection.bytes, selection);
  assert.equal(requests.length, 1);
  requests[0].progress(selection.bytes, selection.bytes);
  requests[0].reply(201, { uploadId: 'upload-original' });
  await assert.rejects(submitting, { code: 'ACCEPTANCE_UNKNOWN' });
  const operation = await adapter.submitPackage(intent, undefined, selection.bytes, selection);
  assert.equal(operation.id, 'operation-original');
  assert.equal(requests.length, 1);
  assert.deepEqual(payloads, [
    { source: { kind: 'upload', uploadId: 'upload-original' }, idempotencyKey: 'original-key' },
    { source: { kind: 'upload', uploadId: 'upload-original' }, idempotencyKey: 'original-key' },
  ]);
  assert.deepEqual(progress, [[selection.bytes, selection.bytes]]);
});

test('late Package upload cannot submit an acceptance request under a new identity', async t => {
  const { requests, selection } = xhrFixture(t);
  let acceptanceRequests = 0;
  const adapter = fixture(t, async () => {
    acceptanceRequests++;
    return json({ operationId: 'unexpected-operation' });
  });
  const intent = { key: 'original-key', kind: 'ZIP', source: 'Original selected archive', name: 'package-original', addDefault: false };
  const submitting = adapter.submitPackage(intent, undefined, selection.bytes, selection);
  adapter.clearIdentity();
  adapter.currentUserId = 'new-identity';
  requests[0].reply(201, { uploadId: 'upload-original' });
  await assert.rejects(submitting, { code: 'SESSION_CHANGED' });
  assert.equal(acceptanceRequests, 0);
  assert.deepEqual(adapter.store.operations, []);
});

test('Overview health aggregates independent process health, readiness and true/false/unknown checks', async t => {
  const calls = [];
  const adapter = fixture(t, async (url, options) => {
    calls.push([url, options.method]);
    return url.endsWith('/admin/status')
      ? json({ ready: false, state: 'PREPARING', checks: { runtimeConfigured: true, dockerReady: false, helperReady: 'unknown' } })
      : json({ healthy: true });
  });
  const health = await adapter.health();
  assert.equal(health.reachable, true);
  assert.equal(health.healthy, true);
  assert.equal(health.ready, false);
  assert.equal(health.reason, 'PREPARING');
  assert.deepEqual(health.checks, [
    { name: 'runtimeConfigured', state: true, detail: '' },
    { name: 'dockerReady', state: false, detail: '' },
    { name: 'helperReady', state: null, detail: '' },
  ]);
  assert.ok(Number.isFinite(Date.parse(health.checkedAt)));
  assert.strictEqual(adapter.lastHealth, health);
  assert.deepEqual(calls, [['/console/api/admin/status', 'GET'], ['/console/api/health', 'GET']]);
});

for (const failedPath of ['/admin/status', '/health']) {
  test(`Overview ${failedPath} read failure retains the complete last confirmed health without synthesizing Ready`, async t => {
    let failing = false;
    const calls = [];
    const adapter = fixture(t, async (url, options) => {
      calls.push(options.method);
      if (failing && url.endsWith(failedPath)) return json({ code: 'CORE_UNAVAILABLE' }, 503);
      return url.endsWith('/admin/status') ? json({ ready: false, state: 'PREPARING', checks: { runtimeConfigured: true } }) : json({ healthy: true });
    });
    const original = await adapter.health();
    failing = true;
    await assert.rejects(adapter.health(), { code: 'CORE_UNREACHABLE' });
    assert.strictEqual(adapter.lastHealth, original);
    assert.equal(adapter.lastHealth.ready, false);
    assert.deepEqual(calls, ['GET', 'GET', 'GET', 'GET']);
  });
}

test('Overview late health body after identity change cannot overwrite a newer confirmed snapshot', async t => {
  const body = deferred();
  const adapter = fixture(t, async url => url.endsWith('/admin/status')
    ? { status: 200, ok: true, json: () => body.promise }
    : json({ healthy: true }));
  const reading = adapter.health();
  await Promise.resolve();
  adapter.clearIdentity();
  adapter.currentUserId = 'new-identity';
  const newer = { reachable: true, healthy: true, ready: false, reason: 'NEW_OWNER', checkedAt: '2026-11-01T12:00:00.000Z', checks: [] };
  adapter.lastHealth = newer;
  body.resolve({ ready: true, state: 'OLD_READY', checks: { oldCheck: true } });
  await assert.rejects(reading, { code: 'SESSION_CHANGED' });
  assert.strictEqual(adapter.lastHealth, newer);
  assert.equal(adapter.currentUserId, 'new-identity');
});

for (const value of [{}, [], { authenticated: 'false' }, { authenticated: true }, { authenticated: true, user: { id: 'original-id' } }, { authenticated: true, user: { id: '', account: 'original' } }]) {
  test(`session receipt rejects malformed ${JSON.stringify(value)} before changing confirmed identity`, async t => {
    const adapter = fixture(t, async () => json(value));
    adapter.session = true;
    adapter.currentUserId = 'original-id';
    adapter.account = 'original';
    adapter.csrf = 'original-csrf';
    const store = adapter.store;
    const epoch = adapter.identityEpoch;
    await assert.rejects(adapter.initialize(), { code: 'INVALID_RESPONSE' });
    assert.equal(adapter.session, true);
    assert.equal(adapter.currentUserId, 'original-id');
    assert.equal(adapter.account, 'original');
    assert.equal(adapter.csrfToken, 'original-csrf');
    assert.equal(adapter.identityEpoch, epoch);
    assert.equal(adapter.store, store);
  });
}
test('valid explicit signed-out and authenticated session receipts remain accepted without optional Core URL', async t => {
  let value = { authenticated: false, csrfToken: 'signed-out-csrf' };
  const adapter = fixture(t, async () => json(value));
  assert.equal(await adapter.initialize(), false);
  assert.equal(adapter.csrfToken, 'signed-out-csrf');
  value = { authenticated: true, csrfToken: 'signed-in-csrf', user: { id: 'original-id', account: 'original' } };
  assert.equal(await adapter.initialize(), true);
  assert.equal(adapter.currentUserId, 'original-id');
  assert.equal(adapter.account, 'original');
  assert.equal(adapter.csrfToken, 'signed-in-csrf');
});

test('actual Skill upload uncertainty retains ActionState lock and permits only a read owner', async t => {
  const { ActionState } = await import(new URL('action-state.js', moduleURL));
  const { requests, selection } = xhrFixture(t);
  const adapter = fixture(t, async () => { throw new Error('Unexpected fetch'); });
  const actions = new ActionState();
  t.after(() => actions.clear());
  const intent = { key: 'skill-upload', kind: 'configuration', view: '/skills', label: 'Upload', target: 'skill-original' };
  const record = actions.begin(intent);
  const uploading = adapter.uploadSkill(selection, 'skill-original');
  requests[0].reply(503, { code: 'CORE_UNAVAILABLE' });
  let cause;
  try { await uploading; } catch (error) { cause = error; }
  actions.fail(record, cause);
  assert.equal(record.errorCode, 'RESULT_UNKNOWN');
  assert.equal(record.blocked, true);
  assert.equal(actions.conflict(intent), record);
  assert.equal(actions.conflict({ key: 'read-skills', kind: 'read', view: '/skills', label: 'Read', target: 'skill-original' }), undefined);
  assert.equal(requests.length, 1);
});
test('actual Package acceptance uncertainty retains original key and remains eligible for explicit Resume', async t => {
  const { ActionState } = await import(new URL('action-state.js', moduleURL));
  const payloads = [];
  const adapter = fixture(t, async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    if (payloads.length === 1) throw new Error('Synthetic lost response');
    return json({ operationId: 'original-operation' }, 202);
  });
  const actions = new ActionState();
  t.after(() => actions.clear());
  const owner = { key: 'package-submit', kind: 'configuration', view: '/packages', label: 'Install', target: 'fixture' };
  const record = actions.begin(owner);
  const intent = { key: 'original-key', kind: 'npm', source: 'fixture@1.0.0', name: 'fixture', addDefault: false };
  let cause;
  try { await adapter.submitPackage(intent); } catch (error) { cause = error; }
  actions.fail(record, cause);
  assert.equal(record.errorCode, 'ACCEPTANCE_UNKNOWN');
  assert.equal(record.blocked, false);
  assert.equal(actions.conflict(owner), undefined);
  assert.equal(payloads.length, 1);
  const operation = await adapter.submitPackage(intent);
  assert.equal(operation.id, 'original-operation');
  assert.deepEqual(payloads[1], payloads[0]);
});
