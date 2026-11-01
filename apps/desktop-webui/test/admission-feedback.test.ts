import assert from 'node:assert/strict';
import test from 'node:test';
const { preferenceFeedback, sessionFeedback } = await import(new URL('../browser/admission-feedback.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
type PreferenceFeedbackFacts = { revision: number; confirmedRevision: number; phase: string; reading: boolean; error: string; notice: string };
const recovery = { label: () => 'Read original state', run: () => {} };
const facts = (extra: Partial<PreferenceFeedbackFacts> = {}): PreferenceFeedbackFacts => ({
  revision: 1, confirmedRevision: -1, phase: 'idle', reading: false, error: '', notice: '', ...extra,
});
function apply(store: InstanceType<typeof NoticeStore>, projection: ReturnType<typeof preferenceFeedback>) {
  if (projection.recovered) store.resolve(projection.owner);
  if (projection.event) store.publish(projection.event);
}

test('preferences feedback keeps unknown during pending/failed read and resolves only actual confirmation', () => {
  const store = new NoticeStore();
  store.setIdentity('one');
  apply(store, preferenceFeedback(facts({ phase: 'unconfirmed', error: 'Reply lost' }), 'one', recovery));
  assert.equal(store.items()[0].tone, 'unknown');
  apply(store, preferenceFeedback(facts({ revision: 2, phase: 'unconfirmed', reading: true }), 'one', recovery));
  assert.equal(store.items().length, 1);
  apply(store, preferenceFeedback(facts({ revision: 2, phase: 'unconfirmed', error: 'Read timed out' }), 'one', recovery));
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].tone, 'unknown');
  apply(store, preferenceFeedback(facts({ revision: 2, confirmedRevision: 1 }), 'one', recovery));
  assert.equal(store.items().length, 1, 'idle alone is not confirmation');
  apply(store, preferenceFeedback(facts({ revision: 2, confirmedRevision: 2 }), 'one', recovery));
  assert.equal(store.items().length, 0);
  store.destroy();
});

test('preference success is one three-second notice and dismissal never replays it on render', () => {
  let now = 0;
  const store = new NoticeStore({ now: () => now });
  store.setIdentity('one');
  const projection = preferenceFeedback(facts({ confirmedRevision: 1, notice: 'Saved' }), 'one', recovery);
  apply(store, projection);
  assert.equal(store.items()[0].expires, 3000);
  store.dismiss(store.items()[0].id);
  apply(store, projection);
  assert.equal(store.items().length, 0);
  now = 3001;
  apply(store, preferenceFeedback(facts({ confirmedRevision: 1 }), 'one', recovery));
  apply(store, preferenceFeedback(facts({ revision: 2, confirmedRevision: 2, notice: 'Saved' }), 'one', recovery));
  assert.equal(store.items().length, 1);
  store.destroy();
});

test('session recovery cannot resolve preference uncertainty and obsolete identity cannot publish', () => {
  const store = new NoticeStore();
  store.setIdentity('one');
  apply(store, preferenceFeedback(facts({ phase: 'unconfirmed', error: 'Unknown save' }), 'one', recovery));
  apply(store, sessionFeedback({ revision: 2, state: 'unavailable', error: 'Session unavailable' }, 'one', recovery));
  assert.equal(store.items().length, 2);
  apply(store, sessionFeedback({ revision: 3, state: 'ready', error: '' }, 'one', recovery));
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].object, 'default-core-preferences');
  store.setIdentity('two');
  apply(store, sessionFeedback({ revision: 2, state: 'unavailable', error: 'Obsolete session' }, 'one', recovery));
  assert.equal(store.items().length, 0);
  store.destroy();
});

test('localized messages remain live without changing preference or session event identity', () => {
  let language = 'en';
  const translated = { toString: () => language === 'en' ? 'Read failed' : '读取失败' } as unknown as string;
  const store = new NoticeStore();
  store.setIdentity('one');
  const first = preferenceFeedback(facts({ error: translated }), 'one', recovery);
  apply(store, first);
  const id = store.items()[0].id;
  assert.equal(store.items()[0].message(), 'Read failed');
  language = 'zh';
  const next = preferenceFeedback(facts({ error: translated }), 'one', recovery);
  apply(store, next);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].id, id);
  assert.equal(store.items()[0].message(), '读取失败');
  store.dismiss(id);
  apply(store, next);
  assert.equal(store.items().length, 0);
  const session = sessionFeedback({ revision: 1, state: 'unavailable', error: translated }, 'one', recovery);
  language = 'en';
  assert.equal(session.event.message(), 'Read failed');
  assert.equal(session.event.key, sessionFeedback({ revision: 1, state: 'unavailable', error: '读取失败' }, 'one', recovery).event.key);
  store.destroy();
});

test('sign-in unknown without a receipt is source-owned; dismissal and read error never unlock it', async () => {
  const { signInFeedback } = await import(new URL('../browser/admission-feedback.js', import.meta.url).href);
  const store = new NoticeStore();
  store.setIdentity('one');
  const facts = Object.freeze({ unknown: true, revision: 4, readRevision: 5 });
  apply(store, signInFeedback(facts, 'one', () => 'Original sign-in unconfirmed', recovery));
  assert.equal(store.items()[0].tone, 'unknown');
  const id = store.items()[0].id;
  store.dismiss(id);
  apply(store, signInFeedback(facts, 'one', () => 'Original sign-in unconfirmed', recovery));
  assert.equal(store.items().length, 0);
  assert.equal(facts.unknown, true);
  apply(store, signInFeedback({ ...facts, readRevision: 6 }, 'one', () => 'Read failed; original sign-in unconfirmed', recovery));
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].tone, 'unknown');
  apply(store, preferenceFeedback({ revision: 2, confirmedRevision: 2, phase: 'idle', reading: false, error: '', notice: '' }, 'one', recovery));
  assert.equal(store.items().length, 1);
  apply(store, signInFeedback({ ...facts, unknown: false, readRevision: 7 }, 'one', () => '', recovery));
  assert.equal(store.items().length, 0);
  store.destroy();
});

test('only resolved source-owned sign-in inline feedback retires; mismatched account uncertainty stays visible', async () => {
  const { signInActionFeedbackVisible } = await import(new URL('../browser/admission-feedback.js', import.meta.url).href);
  const original = Object.freeze({ action: 'sign-in', notificationProjection: 'sign-in-owner', error: 'Original response unknown' });
  assert.equal(signInActionFeedbackVisible(original, true), true);
  assert.equal(signInActionFeedbackVisible(original, false), false);
  assert.equal(signInActionFeedbackVisible({ action: 'sign-in' }, false), true);
  assert.equal(signInActionFeedbackVisible({ action: 'save-file', notificationProjection: 'sign-in-owner' }, false), true);
  assert.equal(signInActionFeedbackVisible({ action: 'sign-in', notificationProjection: 'ledger-secondary' }, false), true);
  assert.equal(original.error, 'Original response unknown');
});
