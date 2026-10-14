import assert from 'node:assert/strict';
import test from 'node:test';
const { restoreSelection, initialWorkArea, unavailableServicesReason, parentDirectory, missingFileTarget } = await import(new URL('../browser/work-navigation.js', import.meta.url).href);
test('first Work visit defaults to Services without another Work selection', () => {
  assert.deepEqual(restoreSelection(), { area: 'Services', path: '/', file: '', service: '', port: 0, session: '' });
});
for (const area of ['Chat', 'Files', 'Services']) test(`restore ${area} with exact path file and per-Work context`, () => {
  const saved = { area, path: '/tree/中文', file: '/tree/中文/.env', service: 'service-a', port: 3001, session: 'session-a' };
  assert.deepEqual(restoreSelection(saved), saved); assert.notEqual(restoreSelection(saved), saved);
});
test('Settings and unknown areas are not restored as a workspace area', () => {
  for (const area of ['Settings', 'Future', '']) assert.equal(restoreSelection({ area }).area, 'Services');
});
test('missing directories walk to nearest parent, preserve literal percent text', () => {
  for (const [path, parent] of [['/tree/a', '/tree'], ['/tree/a/', '/tree'], ['/tree', '/'], ['/', '/'], ['/目录/%2F/file', '/目录/%2F']]) assert.equal(parentDirectory(path), parent);
});
test('only authoritative missing statuses permit path fallback', () => {
  for (const status of [404, 410]) assert.equal(missingFileTarget(status), true);
  for (const status of [undefined, 401, 403, 408, 429, 500, 503]) assert.equal(missingFileTarget(status), false);
});

for (const services of [[], [{name:'Worker',enabled:true,observed:'Ready',ports:[]}], ...['Starting','Stopped','Failed'].map(observed=>[{name:'App',enabled:true,observed,ports:[80]}]), [{name:'Disabled',enabled:false,observed:'Ready',ports:[80]}]]) test(`confirmed first visit promotes Chat for ${JSON.stringify(services)}`,()=>{
 const work:any={services,resourceChecked:{services:'now',agent:'now'},resourceErrors:{}};
 assert.equal(initialWorkArea(undefined,work,true,true),'Chat');assert.ok(unavailableServicesReason(work));
 for(const area of ['Services','Files','Chat'])assert.equal(initialWorkArea({area},work,true,true),area);
 assert.equal(initialWorkArea(undefined,work,false,true),'Services');assert.equal(initialWorkArea(undefined,work,true,false),'Services');
 for(const key of ['services','agent']){work.resourceErrors={[key]:'Denied'};assert.equal(initialWorkArea(undefined,work,true,true),'Services');}work.resourceErrors={};work.resourceChecked={};assert.equal(initialWorkArea(undefined,work,true,true),'Services');
});
test('a confirmed Ready Web Service keeps first visit in Services',()=>{
 const work={services:[{name:'App',enabled:true,observed:'Ready',ports:[80]}],resourceChecked:{services:'now',agent:'now'}};
 assert.equal(initialWorkArea(undefined,work,true,true),'Services');assert.equal(unavailableServicesReason(work),'');
});
