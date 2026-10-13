import test from 'node:test';
import assert from 'node:assert/strict';
const { WorkspacePanelsStore, splitGeometry, keyboardSplit, executionAnchors } = await import(new URL('../browser/workspace-layout.js',import.meta.url).href);
test('page-local panels isolate Work preferences and clear at identity changes',()=>{
 const store=new WorkspacePanelsStore();const a=store.get('a');a.ratio=.6;a.collapsed=true;a.narrowChat=true;
 assert.deepEqual(store.get('b'),{ratio:.7,collapsed:false,narrowChat:false});assert.equal(store.get('a'),a);
 store.clear();assert.deepEqual(store.get('a'),{ratio:.7,collapsed:false,narrowChat:false});
});
test('split preserves readable minimum widths without replacing stored wide ratio',()=>{
 const width=1200,ratio=.7,g=splitGeometry(width,ratio);assert.equal(g.service,1192*.7);
 assert.equal(splitGeometry(width,0).service,400);assert.equal(splitGeometry(width,1).service,872);
 for(const width of [500,360,899])assert.equal(splitGeometry(width,ratio).narrow,true);
 assert.equal(splitGeometry(1440,ratio).ratio,ratio);assert.equal(splitGeometry(1200,NaN).ratio,.7);
});
test('separator keys use pixel steps, bounds, and explicit reset',()=>{
 const width=1200,available=1192;
 assert.equal(keyboardSplit('ArrowLeft',false,width,.7),(.7*available-16)/available);
 assert.equal(keyboardSplit('ArrowRight',true,width,.7),Math.min(872,.7*available+64)/available);
 assert.equal(keyboardSplit('Home',false,width,.7),400/available);assert.equal(keyboardSplit('End',false,width,.7),872/available);
 assert.equal(keyboardSplit('Enter',false,width,.5),.7);assert.equal(keyboardSplit('Escape',false,width,.7),undefined);
 assert.equal(keyboardSplit('ArrowLeft',false,500,.7),undefined);
});
test('run detail anchors deduplicate separated prose and activity using only true run IDs',()=>{
 const grouped=[{messages:[{runId:'a'}]},{messages:[{runId:'a'},{runId:'a'}]},{messages:[{}]},{messages:[{runId:'b'}]},{messages:[{runId:'a'}]}];
 assert.deepEqual([...executionAnchors(grouped)],[[4,['a']],[3,['b']]]);
 assert.equal(executionAnchors([{messages:[{},{}]}]).size,0);
});
