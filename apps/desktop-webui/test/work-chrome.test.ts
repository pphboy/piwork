import assert from 'node:assert/strict';
import test from 'node:test';
const { menuCommands, workHeaderModel, serviceToolbarModel } = await import(new URL('../browser/work-chrome.js', import.meta.url).href);

const context = { identity: 4, currentIdentity: 4, targetWorkId: 'row-b', openedWorkId: 'opened-a', hosted: true, administrator: true, canStop: true };

test('row commands explicitly target the non-active Work without Administration or Requests', () => {
  const commands = menuCommands({ ...context, scope: 'work-row' });
  assert.ok(commands.length > 0);
  assert.ok(commands.every((command: { workId: string }) => command.workId === 'row-b'));
  assert.ok(commands.every((command: { action: string }) => !['administration', 'pi-requests', 'service-requests'].includes(command.action)));
});

test('Work header refuses stale targets and identities', () => {
  assert.deepEqual(menuCommands({ ...context, scope: 'work-header' }), []);
  assert.deepEqual(menuCommands({ ...context, scope: 'work-row', currentIdentity: 5 }), []);
  assert.ok(menuCommands({ ...context, scope: 'work-header', targetWorkId: 'opened-a' }).length > 0);
});

test('administration is global, hosted, and permission gated', () => {
  assert.deepEqual(menuCommands({ ...context, scope: 'global-account' }).map((command: { href: string }) => command.href), ['/admin/setup', '/admin']);
  assert.deepEqual(menuCommands({ ...context, scope: 'global-account', administrator: false }), []);
  assert.deepEqual(menuCommands({ ...context, scope: 'global-account', hosted: false }), []);
});

test('service command carries Work and Service identities', () => {
  const commands = menuCommands({ ...context, scope: 'service', targetWorkId: 'opened-a', targetServiceId: 'service-a' });
  assert.equal(commands[0].serviceId, 'service-a');
  assert.equal(commands[0].workId, 'opened-a');
  assert.deepEqual(menuCommands({ ...context, scope: 'service' }), []);
});

test('header and toolbar models do not modify input or share selection state', () => {
  const header = Object.freeze({ id: 'a', name: 'A', status: 'Ready', standalone: false });
  const toolbar = Object.freeze({ workId: 'a', serviceId: 'b', name: 'B', enabled: false, observed: 'Ready', hasRequests: true });
  assert.equal(workHeaderModel(header).backAction, 'back-works');
  assert.equal(serviceToolbarModel(toolbar).status, 'Disabled');
  assert.equal(toolbar.observed, 'Ready');
});

const { workHeaderStatusPresentation } = await import(new URL('../browser/work-chrome.js', import.meta.url).href);
const receipt = {
  workId: 'work-a', control: { phase: 'accepted', operationId: 'original-operation' },
  operation: { id: 'original-operation', workId: 'work-a', checkedWorkId: 'work-a', state: 'succeeded' },
  synchronizationPending: false,
};

test('header hides only the confirmed ordinary receipt without mutating the original control', () => {
  const input = structuredClone(receipt);
  assert.equal(workHeaderStatusPresentation(input), 'observed');
  assert.deepEqual(input, receipt);
  assert.equal(workHeaderStatusPresentation({ ...receipt, synchronizationPending: true }), 'reading');
  assert.equal(workHeaderStatusPresentation({ ...receipt, control: undefined }), 'observed');
  assert.equal(workHeaderStatusPresentation({ ...receipt, control: undefined, synchronizationPending: true }), 'reading');
  assert.equal(workHeaderStatusPresentation({ ...receipt, operation: { ...receipt.operation, state: 'superseded' } }), 'observed');
});

for (const [name, changes] of [
  ['unknown submission', { control: { ...receipt.control, phase: 'unknown' } }],
  ['pending submission', { control: { ...receipt.control, phase: 'pending' } }],
  ['control error', { control: { ...receipt.control, error: 'original write error' } }],
  ['operation read error', { operation: { ...receipt.operation, observationError: 'read failed' } }],
  ['operation execution error', { operation: { ...receipt.operation, error: 'execution failed' } }],
  ['unsaved record', { operation: { ...receipt.operation, localRecordSaved: false } }],
  ['running operation', { operation: { ...receipt.operation, state: 'running' } }],
  ['failed operation', { operation: { ...receipt.operation, state: 'failed' } }],
  ['unknown operation', { operation: { ...receipt.operation, state: 'unknown' } }],
  ['unverified original Work', { operation: { ...receipt.operation, checkedWorkId: undefined } }],
  ['wrong Work', { operation: { ...receipt.operation, workId: 'another-work' } }],
  ['newer operation after supersession', { operation: { ...receipt.operation, id: 'newer-operation', state: 'superseded' } }],
] as const) {
  test(`header retains original control for ${name}`, () => {
    assert.equal(workHeaderStatusPresentation({ ...receipt, ...changes }), 'control');
    assert.equal(workHeaderStatusPresentation({ ...receipt, ...changes, synchronizationPending: true }), 'control');
  });
}

 test('row and header share ordered commands without language, history or requests', () => {
  const row = menuCommands({ ...context, targetWorkId: 'opened-a', scope: 'work-row' });
  const header = menuCommands({ ...context, targetWorkId: 'opened-a', scope: 'work-header' });
  assert.deepEqual(row, header);
  assert.deepEqual(row.map((item: { action: string }) => item.action), ['settings', 'work-info', 'export', 'stop-work', 'delete-work']);
  assert.deepEqual(row.filter((item: { separatorBefore?: boolean }) => item.separatorBefore).map((item: { action: string }) => item.action), ['export', 'delete-work']);
  assert.ok(!menuCommands({ ...context, scope: 'work-row', canStop: false }).some((item: { action: string }) => item.action === 'stop-work'));
});
