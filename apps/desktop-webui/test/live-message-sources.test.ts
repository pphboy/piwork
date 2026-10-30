import test from 'node:test';
import assert from 'node:assert/strict';
const { LiveMessageSources } = await import(new URL('../browser/live-message-sources.js', import.meta.url).href);

test('same event fragments keep every byte once, including multi-byte text and a replay', () => {
  const sources = new LiveMessageSources(); sources.begin('run-1', 0);
  assert.equal(sources.text('run-1', 7, '你好', { byteOffset: 0, totalBytes: 7, complete: false })!.message.text, '你好');
  assert.equal(sources.pendingFragments('run-1'), true);
  assert.equal(sources.text('run-1', 7, '你好', { byteOffset: 0, totalBytes: 7, complete: false }), undefined, 'replay does not append');
  assert.equal(sources.text('run-1', 7, '!', { byteOffset: 6, totalBytes: 7, complete: true })!.message.text, '你好!');
  assert.equal(sources.pendingFragments('run-1'), false);
  assert.equal(sources.text('run-1', 7, '!', { byteOffset: 6, totalBytes: 7, complete: true }), undefined);
  assert.equal(sources.run('run-1')!.messages[0].text, '你好!');
  assert.throws(() => sources.text('run-1', 8, 'x', { byteOffset: 3, totalBytes: 4, complete: true }), /incomplete/);
  assert.throws(() => sources.text('run-1', 7, '?', { byteOffset: 0, totalBytes: 7, complete: false }), /changed/);
});

test('reconnect appends to the original segment and keeps the observed Run start', () => {
  const sources = new LiveMessageSources(); sources.acceptInput({ id: 'run-1-user', runId: 'run-1', role: 'user', text: 'Q' });
  sources.begin('run-1', 0); sources.text('run-1', 1, 'Known ');
  sources.end('run-1'); sources.begin('run-1', 9); sources.text('run-1', 10, 'tail');
  assert.equal(sources.run('run-1')!.start, true);
  assert.equal(sources.run('run-1')!.messages.at(-1)!.text, 'Known tail');
  assert.equal(sources.run('run-1')!.messages.filter((message: any) => message.role === 'assistant').length, 1);
  sources.text('run-1', 1, 'replayed');
  assert.equal(sources.run('run-1')!.messages.at(-1)!.text, 'Known tail');
});

test('a resumed Run without its first event has no trustworthy start', () => {
  const sources = new LiveMessageSources(); sources.begin('run-1', 30); sources.text('run-1', 31, 'partial');
  assert.equal(sources.run('run-1')!.start, false);
});

test('tool starts create the only boundaries; unknown results do not invent one', () => {
  const sources = new LiveMessageSources(); sources.begin('run-1', 0); sources.text('run-1', 1, 'before');
  sources.tool('run-1', 2, { id: 'run-1-tool-a', runId: 'run-1', role: 'assistant', text: '', tool: { id: 'a', name: 'read', status: 'Completed', content: '' } }, 'tool-end');
  sources.text('run-1', 3, 'after-unknown');
  assert.equal(sources.run('run-1')!.messages.at(-1)!.origin, undefined);
  sources.tool('run-1', 4, { id: 'run-1-tool-b', runId: 'run-1', role: 'assistant', text: '', tool: { id: 'b', name: 'read', status: 'Running', content: '' } }, 'tool-start');
  sources.text('run-1', 5, 'after-b');
  assert.equal(sources.run('run-1')!.messages.at(-1)!.origin, 'b');
  assert.deepEqual([...sources.run('run-1')!.toolStarts], ['b']);
});

test('identity cleanup drops every source record', () => {
  const sources = new LiveMessageSources(); sources.begin('run-1', 0); sources.text('run-1', 1, 'one');
  sources.clear();
  assert.equal(sources.run('run-1'), undefined);
  assert.deepEqual([...sources.entries()], []);
});
