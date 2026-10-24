// Local-only wire fixture: real SDK/store, projections and Agent RPC handlers.
import {Server,ServerCredentials} from '@grpc/grpc-js';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {AgentServiceService} from '@piwork/contracts';
import {WorkStore} from '@piwork/work-store';
import {AgentApplication} from '../dist/application.js';
import {AgentSessionService} from '../dist/sessions.js';
import {SessionHistoryReader} from '../dist/session-history.js';
import {populateLongHistory} from '../dist/history-fixture.js';
const root=process.argv[2];mkdirSync(join(root,'workspace'));
const store=WorkStore.open(join(root,'work.sqlite'),{workId:'work-wire'});
const sessions=new AgentSessionService('work-wire',store,join(root,'workspace'),join(root,'sessions'));
const session=sessions.create(),sdk=sessions.continue(session.sessionId);
const run=store.acceptRun({workId:'work-wire',sessionId:session.sessionId,submissionKey:'original',requestDigest:'digest',promptDigest:'digest'}).run;
const expected=populateLongHistory(sdk,run.runId,7*1024*1024);
store.appendEvent(run.runId,'text',JSON.stringify({delta:expected.finalText}));store.completeRun(run.runId,'succeeded',expected.finalText,null);
const mixedSession=sessions.create(),mixedSdk=sessions.continue(mixedSession.sessionId);
const mixedRun=store.acceptRun({workId:'work-wire',sessionId:mixedSession.sessionId,submissionKey:'mixed-final',requestDigest:'digest',promptDigest:'digest'}).run;
mixedSdk.appendCustomEntry('piwork-run',{runId:mixedRun.runId});
mixedSdk.appendMessage({role:'assistant',content:[{type:'text',text:'Before'},{type:'toolCall',id:'call-mixed',name:'read',arguments:{}},{type:'text',text:'After'}],
 api:'piwork-fixture',provider:'piwork-fixture',model:'deterministic',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'aborted',timestamp:Date.now()});
store.completeRun(mixedRun.runId,'cancelled','BeforeAfter',null);
const empty=[];
for(const sample of [
 {name:'tools-only',content:[{type:'toolCall',id:'call-empty',name:'read',arguments:{}}],hasText:false},
 {name:'nonpublic',content:[{type:'thinking',thinking:'private reasoning fixture'}],hasText:false},
 {name:'explicit-empty',content:[{type:'text',text:''}],hasText:true},
 {name:'mixed-empty',content:[{type:'toolCall',id:'call-empty',name:'read',arguments:{}},{type:'text',text:''}],hasText:true},
]){
 const value=sessions.create(),manager=sessions.continue(value.sessionId);
 const accepted=store.acceptRun({workId:'work-wire',sessionId:value.sessionId,submissionKey:sample.name,requestDigest:'digest',promptDigest:'digest'}).run;
 manager.appendCustomEntry('piwork-run',{runId:accepted.runId});
 manager.appendMessage({role:'assistant',content:sample.content,api:'piwork-fixture',provider:'piwork-fixture',model:'deterministic',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'aborted',timestamp:Date.now()});
 store.completeRun(accepted.runId,'cancelled','',null);
 empty.push({session:value.sessionId,run:accepted.runId,name:sample.name,hasText:sample.hasText});
}
const app=Object.create(AgentApplication.prototype);app.config={workId:'work-wire'};app.authenticate=()=>{};app.sessions=sessions;app.store=store;app.history=new SessionHistoryReader('work-wire',store);
app.runs={get:id=>store.getRun(id),watch:(id,after)=>store.readEvents(id,after)};
const handlers=app.handlers();handlers.readSession=(_call,callback)=>callback(new Error('Whole-session RPC must not be called'));
const server=new Server();server.addService(AgentServiceService,handlers);
const port=await new Promise((done,fail)=>server.bindAsync('127.0.0.1:0',ServerCredentials.createInsecure(),(err,port)=>err?fail(err):done(port)));
console.log(JSON.stringify({port,session:session.sessionId,run:run.runId,mixedSession:mixedSession.sessionId,mixedRun:mixedRun.runId,empty}));
process.once('SIGTERM',()=>{server.forceShutdown();store.close();process.exit(0);});
