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
  assert.deepEqual(menuCommands({ ...context, scope: 'global-account' }).map((command: { href: string }) => command.href), ['/admin']);
  assert.deepEqual(menuCommands({ ...context, scope: 'global-account', administrator: false }), []);
  assert.deepEqual(menuCommands({ ...context, scope: 'global-account', hosted: false }), []);
});

test('service request command carries Work and Service identities', () => {
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
