import test from 'node:test';
import assert from 'node:assert/strict';

const moduleURL = new URL('../browser/action-state.js', import.meta.url).href;
const { ActionState } = await import(moduleURL);
const intent = (key: string, kind = 'files', work = 'one', resource = 'file') => ({ key, kind, work, resource, target: `${work}/${resource}`, label: 'Saving' });

test('actions publish before confirmation, use real elapsed time and release only their own lock', () => {
  let now = 0, renders = 0;
  const actions = new ActionState(() => renders++, () => now);
  const first = actions.begin(intent('save'));
  assert.ok(first.pending); assert.equal(renders, 1);
  assert.ok(actions.conflict(intent('delete')));
  assert.equal(actions.conflict(intent('other', 'files', 'two')), undefined);
  assert.equal(actions.conflict(intent('read', 'read')), undefined);
  now = 11000; assert.match(actions.message(first), /Still waiting \(11s\)/);
  actions.confirm(first, 'Saved'); assert.equal(actions.conflict(intent('delete')), undefined);
  const next = actions.begin(intent('save'));
  actions.finish(first); assert.equal(next.pending, true);
  actions.clear(); assert.equal(actions.records.size, 0);
});

test('lifecycle conflict is symmetric; acceptance allows Stop during Start observation', () => {
  const actions = new ActionState();
  const write = actions.begin(intent('write'));
  assert.ok(actions.conflict(intent('stop', 'lifecycle')));
  actions.finish(write);
  const start = actions.begin(intent('start', 'lifecycle'));
  assert.ok(actions.conflict(intent('write')));
  actions.confirm(start, 'Accepted op-start');
  assert.ok(actions.begin(intent('stop', 'lifecycle')));
  actions.clear();
});

test('different Services are independent and refresh failure retains confirmed mutation', async () => {
  const actions = new ActionState();
  const service = actions.begin(intent('start-a', 'service', 'one', 'a'));
  assert.equal(actions.conflict(intent('start-b', 'service', 'one', 'b')), undefined);
  actions.confirm(service, 'Accepted op-a');
  let release!: () => void;
  const waiting = actions.refresh(service, () => new Promise<void>((resolve) => { release = resolve; }));
  assert.equal(service.refresh, 'refreshing'); assert.equal(service.result, 'Accepted op-a');
  release(); await waiting;
  await actions.refresh(service, async () => { throw new Error('offline'); });
  assert.equal(service.result, 'Accepted op-a'); assert.equal(service.refresh, 'failed');
  assert.match(actions.message(service), /Confirmed result retained/); actions.clear();
});

test('identity clear discards late failure/refresh and never releases a new identity lock', async () => {
  const actions = new ActionState(); const old = actions.begin(intent('save'));
  actions.clear(); const fresh = actions.begin(intent('save'));
  actions.fail(old, new Error('old')); actions.finish(old);
  assert.equal(fresh.pending, true); assert.equal(fresh.error, undefined);
  assert.ok(actions.conflict(intent('switch', 'identity', 'local')));
  actions.clear();
});

test('unknown submissions remain guarded until matching object and view readback; a new intent cannot erase them',()=>{
  const actions=new ActionState();const old=actions.begin({...intent('save-one','configuration','one'),view:'settings',anchor:'save'});
  actions.fail(old,Object.assign(new Error('response lost'),{code:'RESULT_UNKNOWN'}));
  actions.begin({...intent('save-two','configuration','two'),view:'settings',anchor:'save'});
  assert.ok(actions.conflict({...intent('save-one','configuration','one'),view:'settings',anchor:'save'}));
  actions.reviewed('one',['configuration'],'another');assert.equal(old.blocked,true);
  actions.reviewed('two',['configuration'],'settings');assert.equal(old.blocked,true);
  actions.reviewed('one',['configuration'],'settings');assert.equal(old.blocked,false);actions.clear();
});

test('reviewing one original record retains unrelated unknown locks and rejects an old identity record', () => {
  const actions = new ActionState();
  const start = actions.begin(intent('start', 'lifecycle'));
  actions.fail(start, Object.assign(new Error('lost Start'), { code: 'RESULT_UNKNOWN' }));
  const transfer = actions.begin(intent('download', 'transfer', 'one', 'snapshot'));
  actions.fail(transfer, Object.assign(new Error('lost transfer'), { code: 'RESULT_UNKNOWN' }));
  const agent = actions.begin(intent('send', 'agent', 'one', 'session'));
  actions.fail(agent, Object.assign(new Error('lost Run'), { code: 'RESULT_UNKNOWN' }));
  actions.review(start);
  assert.equal(start.blocked, false); assert.equal(transfer.blocked, true); assert.equal(agent.blocked, true);
  assert.match(start.phase, /Previous result unknown/);
  actions.clear();
  const fresh = actions.begin(intent('start', 'lifecycle'));
  actions.fail(fresh, Object.assign(new Error('lost new Start'), { code: 'RESULT_UNKNOWN' }));
  actions.review(start); assert.equal(fresh.blocked, true); actions.clear();
});

test('DWUI-019 successful navigation disappears; brief confirmation expiry preserves unknown lock and original ID', () => {
  let now = 0;
  const actions = new ActionState(() => {}, () => now);
  const read = actions.begin({ ...intent('directory', 'read'), action: 'file-path' });
  actions.finish(read); assert.equal(actions.visible(read), false);
  assert.doesNotMatch(actions.message(read), /1970-/);
  const check = actions.begin({ ...intent('check', 'read'), action: 'check-work' });
  actions.finish(check); assert.equal(actions.visible(check), true);
  now = 3000; assert.equal(actions.visible(check), false);
  const unknown = actions.begin(intent('lost', 'lifecycle'));
  unknown.businessId = 'original-id';
  actions.fail(unknown, Object.assign(new Error('lost reply'), { code: 'RESULT_UNKNOWN' }));
  now = 100000; assert.equal(actions.visible(unknown), true);
  assert.ok(actions.conflict(intent('lost', 'lifecycle'))); assert.equal(unknown.businessId, 'original-id'); actions.clear();
});
