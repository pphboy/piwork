import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function closeFixture() {
 const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8');
 class Element {
  isConnected=true;open=true;className='modal';innerHTML='body';style:any={};inert=false;listeners=new Map<string,Function>();children:Element[]=[];attrs=new Map();focusCount=0;
  getClientRects(){return [1];}closest(){return null;}focus(){this.focusCount++;}getBoundingClientRect(){return {left:10,top:20,width:500,height:200};}
  setAttribute(k:string,v:string){this.attrs.set(k,v);}removeAttribute(k:string){this.attrs.delete(k);}querySelectorAll(){return [];}contains(){return false;}
  append(n:Element){this.children.push(n);n.isConnected=true;}remove(){this.isConnected=false;}close(){this.open=false;}
  addEventListener(k:string,f:Function){this.listeners.set(k,f);}removeEventListener(k:string){this.listeners.delete(k);}
 }
 const dialog=new Element(),trigger=new Element(),body=new Element();let live:any=dialog;
 const c:any={HTMLElement:Element,HTMLTextAreaElement:class {},view:{modal:'file-transfer',data:{},modalError:'',modalNameError:null},adapter:{identityEpoch:7},modalChoice:1,areaChoice:1,location:{hash:'#/work/a'},lastFocus:trigger,focusReturn:'',pendingWebCommand:undefined,requestNavigation:undefined,sourceGuardReturn:undefined,
 root:{querySelector:()=>live,querySelectorAll:()=>[]},document:{body,activeElement:trigger,fullscreenElement:null,createElement:()=>new Element()},matchMedia:()=>({matches:false}),nonmodalDialog:()=>false,isRequestInspector:()=>false,chatSettingsContextCurrent:()=>false,render:()=>{live=null;},clearNameFieldError:()=>{}};
 vm.createContext(c);for(const name of ['closeModal']){const f=source.match(new RegExp('^function '+name+'\\([\\s\\S]*?^}', 'm'));assert.ok(f);vm.runInContext(f[0],c);}
 return {c,dialog,trigger,body,setLive:(node:any)=>live=node,Element};
}
test('production dismissal immediately closes native presentation and restores its launcher',()=>{
 const {c,dialog,body,trigger}=closeFixture();c.document.activeElement=dialog;c.closeModal();
 assert.equal(dialog.open,false);assert.equal(c.view.modal,'');assert.equal(c.modalChoice,2);assert.equal(body.children.length,0);assert.equal(trigger.focusCount,1);
});
test('repeated close is a no-op and cannot steal later focus',()=>{
 const {c,trigger,Element}=closeFixture();c.document.activeElement=new Element();c.closeModal();const before=trigger.focusCount;const fresh=new Element();c.document.activeElement=fresh;c.closeModal();
 assert.equal(trigger.focusCount,before);assert.equal(c.document.activeElement,fresh);assert.equal(c.modalChoice,2);
});
test('an already focused launcher is not focused a second time',()=>{
 const {c,trigger}=closeFixture();c.closeModal();assert.equal(trigger.focusCount,0);
});
test('removed launcher is never focused by closing its dialog',()=>{
 const {c,trigger}=closeFixture();trigger.isConnected=false;c.closeModal();assert.equal(trigger.focusCount,0);
});
test('modal transitions contain no animation, exit snapshot, timer or late focus owner',()=>{
 const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8'),css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.doesNotMatch(source,/ModalExit|closingModal|modalExit|modal-closing|modal-exit-layer|modal-exit-backdrop/);
 assert.doesNotMatch(css,/modal-in|modal-out|modal-backdrop-in|modal-backdrop-out|modal-closing|modal-exit-/);
 const close=source.match(/^function closeModal\([\s\S]*?^}/m)![0];assert.doesNotMatch(close,/setTimeout|animationend|requestAnimationFrame/);
 assert.match(source,/syncDialogPresentation\(dialog, nonmodalDialog\(\)\)/);
});
test('footer geometry stays scoped and real destructive confirmation is preserved',()=>{
 const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8'),css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(css,/\.modal \.modal-footer > \.button \{ min-height:40px/);assert.match(source,/id="delete-confirm" type="checkbox"/);assert.match(source,/<div class="impact-box">Entire Work · Services · Agent · Files<\/div>/);
});
