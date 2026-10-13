import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {ModalExit}=await import(new URL('../browser/modal-presentation.js',import.meta.url).href);
test('visual exit completes once by event or fallback without delaying logical invalidation',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const exit=new ModalExit();let choice=1,completed=0;const original=choice;const finish=exit.start(()=>choice===original,()=>completed++);
 t.mock.timers.tick(139);assert.equal(completed,0);finish();assert.equal(completed,1);t.mock.timers.tick(1000);finish();assert.equal(completed,1);exit.cancel();
});
test('old callbacks cannot close a reopened dialog or restore its focus',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const exit=new ModalExit();let first=0,second=0;const old=exit.start(()=>true,()=>first++);const fresh=exit.start(()=>true,()=>second++);
 old();t.mock.timers.tick(140);assert.equal(first,0);assert.equal(second,1);fresh();assert.equal(second,1);exit.cancel();
});
for(const boundary of ['choice','epoch','node','route'])test(`exit guard rejects changed ${boundary}`,t=>{
 t.mock.timers.enable({apis:['setTimeout']});const exit=new ModalExit();const state:any={choice:1,epoch:1,node:{},route:'work-a'},original={...state};let completed=0;
 exit.start(()=>Object.keys(original).every(key=>state[key]===original[key as keyof typeof original]),()=>completed++);state[boundary]=boundary==='node'?{}:'different';t.mock.timers.tick(140);assert.equal(completed,0);exit.cancel();
});
test('reduced motion reaches the terminal state synchronously without animation events',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const exit=new ModalExit();let complete=0;const finish=exit.start(()=>true,()=>complete++,0);assert.equal(complete,1);finish();t.mock.timers.tick(1000);assert.equal(complete,1);
});
test('cancel removes exit eligibility even if a stale animation event arrives',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const exit=new ModalExit();let complete=0;const finish=exit.start(()=>true,()=>complete++);exit.cancel();finish();t.mock.timers.tick(1000);assert.equal(complete,0);
});
test('production dismissal has one focus owner and preserves modal versus Export presentation',()=>{
 const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8');
 assert.match(source,/copy\.inert = true/);assert.match(source,/closing\.choice === modalChoice/);assert.match(source,/closing\.epoch === adapter\.identityEpoch/);assert.match(source,/dialog === root\.querySelector\('#modal'\)/);
 assert.match(source,/closingModal\?\.html/);assert.match(source,/closingModal\?\.nonmodal \?\? nonmodalDialog\(\)/);
 assert.doesNotMatch(source,/const key = \['chat-response-settings', 'pi-requests', 'pi-request-detail'\]/);
 assert.match(source,/target !== document\.activeElement/);
});
test('footer geometry and motion rules are scoped; Stop impact is text while Delete keeps its checkbox',()=>{
 const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8'),css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(css,/\.modal \.modal-footer > \.button \{ min-height:40px/);assert.match(css,/@keyframes modal-out/);assert.match(css,/modal-in 140ms/);assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(source,/<div class="impact-box">Entire Work · Services · Agent · Files<\/div>/);assert.doesNotMatch(source,/<div class="impact-box">\$\{icon\("stop"\)/);assert.match(source,/id="delete-confirm" type="checkbox"/);
});
