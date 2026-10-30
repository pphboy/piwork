import test from 'node:test';
import assert from 'node:assert/strict';
const { LegacyHistoryProjection } = await import(new URL('../browser/legacy-history-projection.js', import.meta.url).href);

const message = (entryId: string, runId: string, role: string, text: string) => ({
  entryId, runId, role, text, blocks: [{ type: 'text', blockId: `${entryId}-0`, text }],
});

test('legacy sending and durable SDK identities converge to one user turn and one answer', () => {
  const projection = new LegacyHistoryProjection();
  const input = { id: 'run-a-user', runId: 'run-a', role: 'user', text: 'Hello' };
  projection.acceptInput(input);
  projection.begin('run-a', 0);
  projection.text('run-a', 9, 'Answer');
  const raw = [message('sdk-user', 'run-a', 'user', 'Hello'), message('sdk-answer', 'run-a', 'assistant', 'Answer')];
  const result = projection.merge(raw, [input]);
  assert.deepEqual(result.map((item: any) => item.text), ['Hello', 'Answer']);
  assert.equal(result[0].id, 'run-a-user');
  assert.deepEqual(projection.merge(raw, result).map((item: any) => item.text), ['Hello', 'Answer']);
});

test('a unique accepted text/image input combines its blocks but independent SDK inputs stay distinct', () => {
  const projection = new LegacyHistoryProjection();
  const image = { imageIndex: 0, mimeType: 'image/png', byteSize: 70, sha256: 'a'.repeat(64) };
  const input = { id: 'r-user', runId: 'r', role: 'user', text: 'Hello world', images: [image], submission: { key: 'original', phase: 'accepted' } };
  projection.acceptInput(input);
  const raw = [{ entryId: 'sdk-input', runId: 'r', role: 'user', blocks: [{ type: 'text', blockId: 't1', text: 'Hello ' }, { type: 'text', blockId: 't2', text: 'world' }, { type: 'image', blockId: 'image', image }] }];
  const result = projection.merge(raw, [input]);
  assert.equal(result.length, 1); assert.equal(result[0].text, 'Hello world'); assert.equal(result[0].id, 'r-user');
  assert.deepEqual(result[0].images, [image]); assert.equal(result[0].submission.key, 'original');
  const separate = new LegacyHistoryProjection().merge([message('one', 'r', 'user', 'Same'), message('two', 'r', 'user', 'Same')], []);
  assert.equal(separate.length, 2); assert.notEqual(separate[0].id, separate[1].id);
});

test('partial SDK coverage keeps one tail while subsequent deltas append to the uncut source', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0); projection.text('r', 2, '你好世界');
  const prefix = [message('sdk', 'r', 'assistant', '你好')];
  let result = projection.merge(prefix, []); assert.deepEqual(result.map((m: any) => m.text), ['你好', '世界']);
  result = projection.merge(prefix, result); assert.deepEqual(result.map((m: any) => m.text), ['你好', '世界']);
  projection.text('r', 3, '！'); result = projection.project(result); assert.deepEqual(result.map((m: any) => m.text), ['你好', '世界！']);
  const complete = [message('sdk', 'r', 'assistant', '你好世界！')];
  result = projection.merge(complete, result, undefined, ['r']); projection.end('r', true);
  assert.deepEqual(result.map((m: any) => m.text), ['你好世界！']);
  assert.deepEqual(projection.project(result).map((m: any) => m.text), ['你好世界！']);
});

const tool = (id: string, status = 'Running') => ({ id: `r-tool-${id}`, runId: 'r', role: 'assistant', text: '', tool: { id, name: 'read', status, content: status === 'Completed' ? 'done' : '' } });
const call = (id: string) => ({ entryId: `entry-${id}`, runId: 'r', role: 'assistant', blocks: [{ blockId: `call-${id}`, type: 'tool-call', toolCallId: id, toolName: 'read' }] });
const done = (id: string) => ({ entryId: `result-${id}`, runId: 'r', role: 'toolResult', blocks: [{ blockId: `result-${id}`, type: 'tool-result', toolCallId: id, toolName: 'read', result: { kind: 'text', text: 'done', isError: false } }] });

test('equal prose around a real tool boundary remains twice while each live copy is covered', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0); projection.text('r', 2, 'Same');
  projection.tool('r', 3, tool('a'), 'tool-start'); projection.tool('r', 4, tool('a', 'Completed'), 'tool-end'); projection.text('r', 5, 'Same');
  const raw = [message('before', 'r', 'assistant', 'Same'), call('a'), done('a'), message('after', 'r', 'assistant', 'Same')];
  const result = projection.merge(raw, []);
  assert.deepEqual(result.map((m: any) => m.tool?.id ?? m.text), ['Same', 'a', 'Same']);
  assert.equal(result[1].tool.status, 'Completed'); assert.deepEqual(projection.merge(raw, result), result);
});

test('parallel tool completion order does not move the following text boundary', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0);
  projection.tool('r', 2, tool('a'), 'tool-start'); projection.tool('r', 3, tool('b'), 'tool-start');
  projection.tool('r', 4, tool('b', 'Completed'), 'tool-end'); projection.tool('r', 5, tool('a', 'Completed'), 'tool-end'); projection.text('r', 6, 'After both');
  const result = projection.merge([call('a'), call('b'), done('b'), done('a'), message('after', 'r', 'assistant', 'After both')], []);
  assert.deepEqual(result.map((m: any) => m.tool?.id ?? m.text), ['a', 'b', 'After both']);
});

test('SDK block splits cover one observed stream without deleting either saved block', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0); projection.text('r', 9, 'Hello');
  const raw = [{ entryId: 'sdk', runId: 'r', role: 'assistant', blocks: [{ blockId: 'first', type: 'text', text: 'Hel' }, { blockId: 'second', type: 'text', text: 'lo' }] }];
  const result = projection.merge(raw, []); assert.deepEqual(result.map((m: any) => m.id), ['first', 'second']); assert.equal(result.map((m: any) => m.text).join(''), 'Hello');
});

test('without an observed origin equal strings do not prove a source identity', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 8); projection.text('r', 9, 'Same');
  const raw = [message('sdk', 'r', 'assistant', 'Same')];
  const first = projection.merge(raw, []), repeat = projection.merge(raw, first);
  assert.equal(first.length, 2); assert.equal(repeat.length, 2); assert.equal(repeat[1].historyRecoveryUnconfirmed, true);
});

test('conflicting bytes and uncovered failed output remain readable without accumulating copies', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0); projection.text('r', 9, 'Observed partial');
  const raw = [message('sdk', 'r', 'assistant', 'Different source')];
  let result = projection.merge(raw, [], undefined, ['r']); projection.end('r', true);
  for (let i = 0; i < 3; i++) result = projection.merge(raw, result);
  assert.deepEqual(result.map((m: any) => m.text), ['Different source', 'Observed partial']);
  assert.equal(result[1].historyRecoveryUnconfirmed, true);
});

test('same prose in separate Runs remains separate and reconnect replay does not double the raw source', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0); projection.text('r', 9, 'Same');
  let result = projection.merge([message('sdk-r', 'r', 'assistant', 'Sa'), message('sdk-other', 'other', 'assistant', 'Same')], []);
  projection.end('r'); projection.begin('r', 0); projection.text('r', 9, 'Same'); projection.text('r', 10, ' plus');
  result = projection.project(result);
  assert.equal(result.filter((m: any) => m.runId === 'r').map((m: any) => m.text).join(''), 'Same plus');
  assert.equal(result.find((m: any) => m.runId === 'other').text, 'Same');
});

test('an explicit terminal result joins only its last SDK answer after tool boundaries', () => {
  const projection = new LegacyHistoryProjection();
  const raw = [message('before', 'r', 'assistant', 'Same'), call('a'), done('a'), message('last', 'r', 'assistant', 'Same')];
  const final = { id: 'r-final', runId: 'r', role: 'assistant', text: 'Same' };
  const result = projection.merge(raw, [], final, ['r']);
  assert.deepEqual(result.map((m: any) => m.tool?.id ?? m.text), ['Same', 'a', 'Same']);
  assert.deepEqual(projection.merge(raw, result), result);
});

test('a terminal event does not add a second copy before the SDK answer is saved', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0); projection.text('r', 9, 'Answer');
  const before = projection.project([]);
  projection.result({ id: 'r-final', runId: 'r', role: 'assistant', text: 'Answer' });
  assert.deepEqual(projection.project(before).map((m: any) => m.text), ['Answer']);
});

test('stopping observation keeps the uncovered tail for a later history read', () => {
  const projection = new LegacyHistoryProjection(); projection.begin('r', 0); projection.text('r', 9, 'Known and uncovered');
  const raw = [message('sdk', 'r', 'assistant', 'Known')];
  const before = projection.merge(raw, []); projection.stop();
  const after = projection.merge(raw, before);
  assert.equal(after.map((m: any) => m.text).join(''), 'Known and uncovered'); assert.equal(after.length, 2);
});
