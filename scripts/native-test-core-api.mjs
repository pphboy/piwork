// Test driver only: exercise the retained operator HTTP API, never a retired
// product command. Fixture credentials stay in memory and out of diagnostics.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function operatorAPI(base,directory) {
 const credential=(await readFile(join(directory,'operator.credential'),'utf8')).trim();
 return async(method,path,body)=>{
  const response=await fetch(base+'/control/'+path,{method,headers:{Authorization:'Operator '+credential,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert(response.ok,`Operator API ${method} ${path} failed (${response.status})`);
  return response.status===204?null:response.json();
 };
}
