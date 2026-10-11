import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunModels } from './run-models.js';
import type { RunModelSnapshot } from '@piwork/contracts';
test('image capability follows explicit input, independently of Thinking and model names',async()=>{
 const models=new AgentRunModels({provider:'fixture',id:'model',deterministic:false});
 const model:RunModelSnapshot={modelRef:null,label:'Image-looking name',provider:'fixture',model:'custom-vision-name',api:'openai-responses',baseUrl:'http://127.0.0.1:1',capabilities:{kind:'explicit',definition:{reasoning:false,input:['text','image'],contextWindow:10000,maxTokens:100}}};
 assert.equal(await models.images(model),'supported');
 assert.equal(await models.images({...model,capabilities:{kind:'explicit',definition:{reasoning:true,input:['text'],contextWindow:10000,maxTokens:100}}}),'unsupported');
 assert.equal(await models.images({...model,capabilities:undefined}),'unknown');
});
