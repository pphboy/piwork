import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {Server,ServerCredentials,ChannelCredentials} from '@grpc/grpc-js';
import {WorkServicesClient,WorkServicesService} from '@piwork/contracts';
import {WorkPrivateClient} from './work-private-client.js';

test('private reads wait for connection authority within the original deadline without replaying an accepted call',async t=>{
 const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const address=listener.address();assert(address&&typeof address!=='string');const endpoint=`127.0.0.1:${address.port}`;await new Promise<void>(r=>listener.close(()=>r()));
 const channel=new WorkServicesClient(endpoint,ChannelCredentials.createInsecure(),{'grpc.initial_reconnect_backoff_ms':50,'grpc.min_reconnect_backoff_ms':50});
 const control=Object.assign(Object.create(WorkPrivateClient.prototype),{client:channel}) as WorkPrivateClient;
 const server=new Server();let calls=0;t.after(()=>{control.close();server.forceShutdown()});
 server.addService(WorkServicesService,{listRunModels:(_call:any,done:any)=>{calls++;done(null,{valueJson:JSON.stringify({models:[],defaultModel:{modelRef:null,label:'Default',provider:'fixture',model:'one'},checkedAt:'2026-10-04T00:00:00Z'})});}});
 const pending=control.models();await new Promise(r=>setTimeout(r,100));
 await new Promise<void>((resolve,reject)=>server.bindAsync(endpoint,ServerCredentials.createInsecure(),error=>error?reject(error):resolve()));
 const result=await pending;assert.equal(result.defaultModel.model,'one');assert.equal(calls,1);
});
