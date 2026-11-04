import assert from 'node:assert/strict';
import test from 'node:test';
const { thinkingOptions } = await import(new URL('../browser/thinking-options.js', import.meta.url).href);
const model = {modelRef:null,label:'Model',provider:'anthropic',model:'alias',thinkingLevels:['off','low','high'],defaultThinkingLevel:'off',compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['off','low','medium','high','xhigh','max']},{profile:'messages-budget-v1',levels:['off','minimal','low','medium','high']}]};

test('one Thinking option per level, preferring SDK mapping then declared protocol order', () => {
  const options=thinkingOptions(model,5);
  assert.deepEqual(options.map((v:{level:string})=>v.level),['off','minimal','low','medium','high','xhigh','max']);
  assert.equal(options.find((v:{level:string})=>v.level==='high').profile,undefined);
  assert.equal(options.find((v:{level:string})=>v.level==='minimal').profile,'messages-budget-v1');
  assert.equal(options.find((v:{level:string})=>v.level==='medium').profile,'messages-adaptive-v1');
});

test('unknown model has one Normal and the same unique declared protocol levels', () => {
  const options=thinkingOptions({...model,thinkingLevels:[],defaultThinkingLevel:null,thinkingAvailability:'unknown'},5);
  assert.deepEqual(options.map((v:{level:string|null})=>v.level),[null,'off','minimal','low','medium','high','xhigh','max']);
  assert.equal(options.find((v:{level:string})=>v.level==='high').profile,'messages-adaptive-v1');
});

test('older capabilities do not invent mappings and saved legacy grade remains accessible once', () => {
  assert.deepEqual(thinkingOptions(model,3).map((v:{level:string})=>v.level),['off','low','high']);
  assert.deepEqual(thinkingOptions(model,4).map((v:{level:string})=>v.level),['off','low','high']);
  const saved=thinkingOptions(model,4,{level:'max',profile:'messages-adaptive-v1'});
  assert.deepEqual(saved.map((v:{level:string})=>v.level),['off','low','high','max']);
  assert.deepEqual(thinkingOptions(model,0),[]);
});
