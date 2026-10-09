import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@piwork/pi-adapter";
import { AgentRunModels } from "./run-models.js";
import { resolveProductionModel } from "./pi-sdk-executor.js";
import type { ModelApi, RunModelSnapshot } from "@piwork/contracts";
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshManagedChildAgentModel } from './pi-sdk-executor.js';
import type { RunModelResolver } from './run-models.js';

test("managed models preserve SDK Thinking and reject unknown or mismatched capabilities", async () => {
  for(const [provider,id,api] of [["openai","gpt-5.1","openai-responses"],["anthropic","claude-sonnet-4-5","anthropic-messages"]] as const){
    const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
    const native=runtime.getModel(provider,id)!;
    const selected=resolveProductionModel(runtime,{provider,id:"custom-alias",api,baseUrl:"https://fixture.invalid",capabilities:{kind:"sdk",provider,model:id}},true);
    assert.equal(selected.api,api);assert.equal(selected.id,"custom-alias");
    assert.deepEqual(getSupportedThinkingLevels(selected),getSupportedThinkingLevels(native));
    assert.deepEqual(selected.thinkingLevelMap,native.thinkingLevelMap);
  }
  const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
  assert.throws(()=>resolveProductionModel(runtime,{provider:"openai",id:"unknown",api:"openai-responses",baseUrl:"https://fixture.invalid"},true),/unconfirmed/);
  assert.throws(()=>resolveProductionModel(runtime,{provider:"openai",id:"unknown",api:"openai-responses",baseUrl:"https://fixture.invalid",capabilities:{kind:"sdk",provider:"openai",model:"missing-template"}}),/template is unavailable/);
  assert.throws(()=>resolveProductionModel(runtime,{provider:"openai",id:"unknown",api:"openai-responses",baseUrl:"https://fixture.invalid",capabilities:{kind:"sdk",provider:"anthropic",model:"claude-sonnet-4-5"}},true),/another protocol/);
});

test("a revoked Work default still offers another provider without changing Session Thinking", async () => {
  const model:RunModelSnapshot={modelRef:"model-provider-00001",label:"Other / Reasoning",provider:"openai",model:"gpt-5.1",api:"openai-responses",baseUrl:"https://fixture.invalid/v1"};
  const models=new AgentRunModels({provider:"anthropic",id:"claude-sonnet-4-5",deterministic:false}, {
    async models(){return{models:[model],defaultModel:{modelRef:null,label:"",provider:"",model:""},defaultUnavailable:true,checkedAt:new Date().toISOString()};},
    async resolveModel(){return{model,credential:"synthetic-key"};},
  });
  const list=await models.chatList();assert.equal(list.contractVersion,3);assert.equal(list.defaultModel,null);assert.equal(list.models.length,1);
  assert.ok(list.models[0]!.thinkingLevels.includes("high"));
  assert.doesNotMatch(JSON.stringify(list),/synthetic-key|baseUrl|capabilities|executionBindingId/);
});

test('all models disabled is a confirmed empty catalog and reenabling restores the same model',async()=>{
  const model:RunModelSnapshot={modelRef:'model-reenable-0001',label:'Saved / Model',provider:'openai',model:'gpt-5.1',api:'openai-responses'};
  let enabled=false,failed=false;
  const resolver=new AgentRunModels({provider:'openai',id:'gpt-5.1',api:'openai-responses',deterministic:false},{
    async models(){if(failed)throw new Error('private fixture failure');return{models:enabled?[model]:[],defaultModel:{modelRef:null,label:'',provider:'',model:''},defaultUnavailable:true,checkedAt:new Date().toISOString()};},
    async resolveModel(){return{model,credential:'synthetic-key'};},
  });
  const empty=await resolver.chatList();assert.equal(empty.contractVersion,3);assert.equal(empty.availability,'available');assert.equal(empty.defaultModel,null);assert.deepEqual(empty.models,[]);
  assert.match(empty.contractVersion===3?empty.defaultUnavailableReason!:'',/No enabled models.*administrator/);
  enabled=true;const recovered=await resolver.chatList();assert.equal(recovered.models[0]!.modelRef,model.modelRef);assert.ok(recovered.models[0]!.thinkingLevels.includes('high'));
  failed=true;await assert.rejects(resolver.chatList(),error=>error instanceof Error && /could not be loaded/.test(error.message));
});

test('Chat reports safe recovery for unconfirmed capabilities and an incompatible SDK definition',async()=>{
  const model:RunModelSnapshot={modelRef:null,label:'Default',provider:'openai',model:'gpt-5.1',api:'openai-responses'};
  const unknown:RunModelSnapshot={...model,modelRef:'model-unknown-0001',label:'Provider / Unknown',model:'custom-unknown',baseUrl:'https://private-fixture.invalid/v1',executionBindingId:'model-execution-private1'};
  const mismatch:RunModelSnapshot={...unknown,modelRef:'model-mismatch-0001',label:'Provider / Incompatible',capabilities:{kind:'sdk',provider:'anthropic',model:'claude-sonnet-4-5'}};
  const resolver=new AgentRunModels({provider:'openai',id:'gpt-5.1',api:'openai-responses',deterministic:false},{
    async models(){return{models:[unknown,mismatch],defaultModel:model,checkedAt:new Date().toISOString()};},async resolveModel(){return{model,credential:'synthetic-private-key'};},
  });
  const list=await resolver.chatList();assert.equal(list.contractVersion,3);assert.ok(list.defaultModel);assert.equal(list.models.length,1);assert.equal(list.models[0]!.model,'custom-unknown');assert.equal(list.models[0]!.defaultThinkingLevel,null);assert.deepEqual(list.models[0]!.thinkingLevels,[]);
  if(list.contractVersion!==3)throw new Error('expected recovery contract');
  assert.deepEqual(list.unavailableModels!.map(m=>m.reason),['sdk-unsupported']);
  assert.match(list.unavailableModels![0]!.recovery,/Agent image.*Apply/);
  assert.doesNotMatch(JSON.stringify(list),/private-fixture|executionBindingId|synthetic-private|thinkingLevelMap|capabilities"/);
  const unsupportedDefault=new AgentRunModels({provider:unknown.provider,id:unknown.model,api:unknown.api,baseUrl:unknown.baseUrl,deterministic:false},{
    async models(){return{models:[],defaultModel:{...unknown,modelRef:null},checkedAt:new Date().toISOString()};},async resolveModel(){return{model:unknown,credential:'synthetic-key'};},
  });
  const unavailable=await unsupportedDefault.chatList();assert.equal(unavailable.defaultModel!.model,'custom-unknown');assert.equal(unavailable.defaultModel!.defaultThinkingLevel,null);
});

test('managed child defaults refresh authorization and remove stale files when default is revoked',async()=>{
  const root=await mkdtemp(join(tmpdir(),'piwork-managed-child-'));let key='synthetic-old',available=true;
  const model:RunModelSnapshot={modelRef:null,label:'Default',provider:'openai',model:'gpt-5.1',api:'openai-responses',baseUrl:'https://fixture.invalid/v1',executionBindingId:'model-execution-fixture1'};
  const resolver:RunModelResolver={async list(){throw new Error('unused');},async resolve(){if(!available)throw new Error('unavailable');return model;},async credential(){if(!available)throw new Error('unavailable');return key;}};
  try{
    assert.equal(await refreshManagedChildAgentModel(resolver,model,root),true);assert.equal(JSON.parse(await readFile(join(root,'auth.json'),'utf8')).openai.key,key);
    key='synthetic-new';assert.equal(await refreshManagedChildAgentModel(resolver,model,root),true);assert.equal(JSON.parse(await readFile(join(root,'auth.json'),'utf8')).openai.key,key);
    available=false;assert.equal(await refreshManagedChildAgentModel(resolver,{...model,modelRef:'model-selected-00001'},root),false);await assert.rejects(readFile(join(root,'auth.json')));
  }finally{await rm(root,{recursive:true,force:true});}
});

test("actual SDK sends managed Responses and Messages Thinking to the selected HTTP provider", async () => {
  const captured:Array<{path:string;body:Record<string,any>;authorization:string;key:string}>=[];
  const server=createServer(async(request,response)=>{
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());captured.push({path:request.url!.split("?")[0]!,body,authorization:String(request.headers.authorization??""),key:String(request.headers["x-api-key"]??"")});
    response.writeHead(200,{"content-type":"text/event-stream"});
    const emit=(type:string,payload:unknown)=>response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    if(request.url?.split("?")[0]==="/v1/messages"){
      emit("message_start",{type:"message_start",message:{id:"synthetic-message",type:"message",role:"assistant",model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
      emit("content_block_start",{type:"content_block_start",index:0,content_block:{type:"text",text:""}});
      emit("content_block_delta",{type:"content_block_delta",index:0,delta:{type:"text_delta",text:"OK"}});
      emit("content_block_stop",{type:"content_block_stop",index:0});
      emit("message_delta",{type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}});emit("message_stop",{type:"message_stop"});
    }else{
      const item={id:"synthetic-item",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"OK",annotations:[]}]};
      emit("response.created",{type:"response.created",response:{id:"synthetic-response",status:"in_progress",model:body.model,output:[]}});
      emit("response.output_item.added",{type:"response.output_item.added",output_index:0,item:{...item,status:"in_progress",content:[]}});
      emit("response.content_part.added",{type:"response.content_part.added",output_index:0,content_index:0,part:{type:"output_text",text:"",annotations:[]}});
      emit("response.output_text.delta",{type:"response.output_text.delta",output_index:0,content_index:0,delta:"OK"});
      emit("response.output_item.done",{type:"response.output_item.done",output_index:0,item});
      emit("response.completed",{type:"response.completed",response:{id:"synthetic-response",status:"completed",model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});
    }
    response.end();
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");
  try{
    const cases:[string,string,ModelApi][]=[["openai","gpt-5.1","openai-responses"],["anthropic","claude-sonnet-4-5","anthropic-messages"],["anthropic","claude-sonnet-4-6","anthropic-messages"]];
    for(const [provider,id,api] of cases){
      for(const level of ["off","high"] as const){
        const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
        const baseUrl=`http://127.0.0.1:${address.port}${provider==="openai"?"/v1":""}`;
        const model=resolveProductionModel(runtime,{provider,id:"managed-alias",api,baseUrl,capabilities:{kind:"sdk",provider,model:id}},true);
        if(!getSupportedThinkingLevels(model).includes(level))continue;
        await runtime.setRuntimeApiKey(provider,`synthetic-${provider}`);
        const result=await runtime.completeSimple(model,{messages:[{role:"user",content:"Reply OK",timestamp:Date.now()}]},level==="off"?{}:{reasoning:level});
        assert.notEqual(result.stopReason,"error",result.errorMessage??"");assert.equal(result.content.find(part=>part.type==="text")?.text,"OK");
        const request=captured.at(-1)!;assert.equal(request.body.model,"managed-alias");
        if(provider==="openai"){assert.equal(request.path,"/v1/responses");assert.equal(request.authorization,"Bearer synthetic-openai");assert.equal(request.body.reasoning.effort,level==="off"?model.thinkingLevelMap?.off??"none":model.thinkingLevelMap?.high??"high");}
        else{assert.equal(request.path,"/v1/messages");assert.equal(request.key,"synthetic-anthropic");if(level==="off")assert.equal(request.body.thinking.type,"disabled");else if((model.compat as {forceAdaptiveThinking?:boolean}|undefined)?.forceAdaptiveThinking){assert.equal(request.body.thinking.type,"adaptive");assert.equal(request.body.output_config.effort,model.thinkingLevelMap?.high??"high");}else{assert.equal(request.body.thinking.type,"enabled");assert.ok(request.body.thinking.budget_tokens>0);}}
      }
    }
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
