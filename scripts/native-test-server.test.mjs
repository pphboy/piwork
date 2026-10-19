import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureServerBuild} from './native-test-server.mjs';
import {readFileSync} from 'node:fs';

test('fixture server binds fixed dependencies at build time and preserves source/UI identity',()=>{
 const images={agent:'fixture/agent:v1',packageHelper:'fixture/agent:v1',fileHelper:'fixture/file:v1',snapshotHelper:'fixture/snapshot:v1'};
 const metadata={releaseVersion:'0.1.0',sourceCommit:'a'.repeat(40),sourceModified:true,desktopUIHash:'b'.repeat(64),consoleUIHash:'c'.repeat(64)};
 const args=fixtureServerBuild('/tmp/piwork-fixture',images,metadata);
 assert.equal(args.at(-1),'./cmd/piwork-serve');
 const flags=args[args.indexOf('-ldflags')+1];
 assert.deepEqual(JSON.parse(Buffer.from(flags.match(/EncodedImages=([^ ]+)/)[1],'base64')),images);
 for(const value of [metadata.sourceCommit,metadata.desktopUIHash,metadata.consoleUIHash,'Modified=true'])assert(flags.includes(value));
 for(const value of ['fixture:latest','bad image','a;command'])assert.throws(()=>fixtureServerBuild('/tmp/piwork-fixture',{...images,agent:value},metadata));
});
test('active initialization drivers use embedded defaults, without the removed operator image flag',()=>{
 for(const file of ['check-web-base-core.mjs','check-web-base-core-dependencies.mjs','native-host-acceptance.mjs','measure-work-latency.mjs']) {
   const source=readFileSync(new URL(file,import.meta.url),'utf8');
   assert(!source.includes("'--agent-image'"),file);
   assert(!/PIWORK_(?:PACKAGE|FILE|SNAPSHOT)_HELPER_IMAGE[=:]/.test(source),file);
 }
});
