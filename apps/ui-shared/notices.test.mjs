import test from 'node:test';
import assert from 'node:assert/strict';
import { NoticeStore } from './notices.js';

const event = (overrides = {}) => ({ identity: 'core:alice:1', key: 'unknown', object: 'work:a', task: 'save', generation: 1, tone: 'unknown', message: () => 'Unconfirmed', ...overrides });
function store() {
  const value = new NoticeStore();
  value.setIdentity('core:alice:1');
  return value;
}

test('deduplicates events, including dismissed events, without business callbacks', () => {
  const value = store();
  let writes = 0;
  const notice = event({ recovery: { label: () => 'Check', run: () => writes++ } });
  assert.equal(value.publish(notice), true);
  assert.equal(value.publish(notice), false);
  value.dismiss(value.items()[0].id);
  assert.equal(value.publish(notice), false);
  assert.equal(writes, 0);
  value.destroy();
});

test('unrelated success cannot replace unknown; matching task confirmation can', () => {
  const value = store();
  value.publish(event());
  value.publish(event({ key: 'saved', task: 'rename', tone: 'success' }));
  value.publish(event({ key: 'saved', object: 'work:b', tone: 'success' }));
  assert.equal(value.items().length, 3);
  assert.equal(value.items()[0].tone, 'unknown');
  value.publish(event({ key: 'checked', tone: 'success' }));
  assert.equal(value.items().length, 3);
  assert.equal(value.items().some(item => item.tone === 'unknown'), false);
  value.destroy();
});

test('language is evaluated at display time without republishing', () => {
  const value = store();
  let language = 'en';
  value.publish(event({ message: () => language === 'en' ? 'Unknown' : '未确认' }));
  language = 'zh';
  assert.equal(value.items()[0].message(), '未确认');
  assert.equal(value.items().length, 1);
  value.destroy();
});

test('errors and unknown never have expiration; success is at most three seconds', () => {
  const value = store();
  value.publish(event());
  value.publish(event({ key: 'failed', task: 'read', tone: 'error' }));
  value.publish(event({ key: 'saved', task: 'rename', tone: 'success' }));
  assert.equal(value.items()[0].expires, undefined);
  assert.equal(value.items()[1].expires, undefined);
  assert.ok(value.items()[2].expires <= Date.now() + 3000);
  value.destroy();
});

test('identity reset drops content and refuses late results', () => {
  const value = store();
  value.publish(event());
  value.setIdentity('core:bob:2');
  assert.equal(value.items().length, 0);
  assert.equal(value.publish(event()), false);
  value.destroy();
});

test('different task generations cannot confirm an old unknown', () => {
  const value = store();
  value.publish(event());
  value.publish(event({ key: 'saved', generation: 2, tone: 'success' }));
  assert.equal(value.items()[0].tone, 'unknown');
  value.destroy();
});

test('read recovery silently resolves only its exact owner and identity', () => {
  const value = store();
  value.publish(event());
  value.resolve({ ...event(), generation: 2 });
  value.resolve({ ...event(), identity: 'other' });
  assert.equal(value.items().length, 1);
  value.resolve(event());
  assert.equal(value.items().length, 0);
  value.destroy();
});

test('confirmed read recovery permits a later failure but dismissal does not', () => {
  const value = store();
  const read = event({ task: 'runtime-read', key: '503', tone: 'error' });
  value.publish(event());
  value.publish(read);
  value.dismiss(value.items().find(item => item.task === read.task).id);
  assert.equal(value.publish(read), false);
  value.resolve(read);
  assert.equal(value.publish(read), true);
  assert.equal(value.items().length, 2);
  assert.equal(value.items()[0].tone, 'unknown');
  value.resolve(read);
  assert.equal(value.items().length, 1);
  assert.equal(value.publish(read), true);
  value.destroy();
});

test('same task state transitions can recover without replaying unchanged or dismissed events', () => {
  const value = store();
  const confirmed = event({ key: 'confirmed', tone: 'success' });
  const refreshFailed = event({ key: 'refresh-failed', tone: 'error' });
  assert.equal(value.publish(confirmed), true);
  assert.equal(value.publish(confirmed), false);
  assert.equal(value.publish(refreshFailed), true);
  assert.equal(value.publish(confirmed), true);
  assert.equal(value.items().length, 1);
  assert.equal(value.items()[0].tone, 'success');
  value.dismiss(value.items()[0].id);
  assert.equal(value.publish(confirmed), false);
  value.destroy();
});
