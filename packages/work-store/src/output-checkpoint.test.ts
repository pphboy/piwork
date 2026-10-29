import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { WORK_SCHEMA_V6_SQL } from './schema-v6.js';
import { OUTPUT_CHUNK_BYTES, readOutputChunks, readOutputEventIndex, readOutputTextRange, recordOutputChunks } from './output-checkpoint.js';

test('output chunks preserve event order and Unicode across a committed transaction',()=>{
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
 try {
  db.exec(WORK_SCHEMA_V6_SQL);
  db.prepare("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at) VALUES('w','s','/var/data/sessions/s.jsonl','2026-01-01','2026-01-01')").run();
  db.prepare("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at) VALUES('w','s','r','k','d','running','2026-01-01')").run();
  const delta='a'.repeat(OUTPUT_CHUNK_BYTES-2)+'中文🙂'.repeat(2000);
  assert.throws(()=>recordOutputChunks(db,'r',1,'text',JSON.stringify({delta})),/transaction/);
  db.exec('BEGIN IMMEDIATE');
  recordOutputChunks(db,'r',1,'text',JSON.stringify({delta}));
  recordOutputChunks(db,'r',2,'tool-start',JSON.stringify({toolName:'read',toolCallId:'call',args:{secret:'not retained'}}));
  recordOutputChunks(db,'r',3,'tool-end',JSON.stringify({toolName:'read',toolCallId:'call',result:{kind:'text',text:'ok',truncated:false,isError:false}}));
  db.exec('COMMIT');
  const rows=db.prepare('SELECT sequence,part,kind,payload_json FROM run_output_chunks ORDER BY sequence,part').all();
  assert.ok(rows.filter(row=>row.sequence===1).length>1);
  assert.ok(rows.every(row=>Buffer.byteLength(String(row.payload_json))<65536));
  const data=(sequence:number)=>rows.filter(row=>row.sequence===sequence).map(row=>JSON.parse(String(row.payload_json)).data).join('');
  const output=(sequence:number)=>JSON.parse(data(sequence));
  assert.equal(data(1),delta);assert.equal(output(2).toolCallId,'call');assert.equal(output(2).args,undefined);assert.equal(output(3).result.text,'ok');
  let cursor={sequence:0,part:0},collected:ReturnType<typeof readOutputChunks>=[];
  while(true){const page=readOutputChunks(db,'w','s','r',2,cursor,1);if(!page.length)break;collected.push(...page);cursor={sequence:page[0]!.sequence,part:page[0]!.part};}
  assert.deepEqual(collected.map(row=>[row.sequence,row.part]),rows.filter(row=>Number(row.sequence)<=2).map(row=>[Number(row.sequence),Number(row.part)]));
  assert.equal(collected.filter(row=>row.sequence===1).map(row=>row.data).join(''),delta);
  const bytes=Buffer.from(delta);
  for(const offset of [0,8190,8192,bytes.length-3,bytes.length]) {
    assert.deepEqual(readOutputTextRange(db,'w','s','r',1,offset,23),bytes.subarray(offset,offset+23));
  }
  assert.throws(()=>readOutputTextRange(db,'w','s','r',2,0,1),/WORK_HISTORY_INVALID/);
  assert.throws(()=>readOutputTextRange(db,'other','s','r',1,0,1),/Run not found/);
  assert.throws(()=>readOutputTextRange(db,'w','s','r',1,bytes.length+1,1),/WORK_HISTORY_INVALID/);
  const index=readOutputEventIndex(db,'w','s','r',2,0,1);
  assert.deepEqual(index,[{sequence:1,kind:'text',parts:rows.filter(row=>row.sequence===1).length,bytes:Buffer.byteLength(delta)}]);
  assert.equal(readOutputEventIndex(db,'w','s','r',2,index[0]!.sequence,1)[0]?.sequence,2);
  assert.deepEqual(readOutputEventIndex(db,'w','s','r',2,2),[]);
  assert.throws(()=>readOutputEventIndex(db,'other','s','r',3),/Run not found/);
  assert.throws(()=>readOutputEventIndex(db,'w','s','r',3,0,101),/Invalid output range/);
  db.exec('BEGIN IMMEDIATE');
  for(let sequence=4;sequence<=154;sequence++) recordOutputChunks(db,'r',sequence,'text',JSON.stringify({delta:`第${sequence}段`}));
  db.exec('COMMIT');
  // An already captured high-water mark never includes later writes.
  assert.deepEqual(readOutputEventIndex(db,'w','s','r',2).map(item=>item.sequence),[1,2]);
  const first=readOutputEventIndex(db,'w','s','r',154,0,100);
  const second=readOutputEventIndex(db,'w','s','r',154,first.at(-1)!.sequence,100);
  assert.equal(first.length,100);assert.equal(second.length,54);
  assert.deepEqual([...first,...second].map(item=>item.sequence),Array.from({length:154},(_,i)=>i+1));
  assert.throws(()=>readOutputChunks(db,'other','s','r',3),/Run not found/);
  assert.throws(()=>readOutputChunks(db,'w','other','r',3),/Run not found/);
  assert.throws(()=>readOutputChunks(db,'w','s','r',3,cursor,9),/Invalid output range/);
  db.exec('BEGIN IMMEDIATE');recordOutputChunks(db,'r',155,'text',JSON.stringify({delta:'rolled back'}));db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM run_output_chunks WHERE sequence=155').get()?.n,0);
 } finally {db.close();}
});

test('large text event supports bounded range reads and rejects missing chunks',()=>{
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
 try {
  db.exec(WORK_SCHEMA_V6_SQL);
  db.exec("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at) VALUES('w','s','/var/data/sessions/s.jsonl','2026-01-01','2026-01-01'); INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at) VALUES('w','s','r','k','d','running','2026-01-01')");
  const text='文字🙂'.repeat(180000),raw=Buffer.from(text);
  db.exec('BEGIN IMMEDIATE');recordOutputChunks(db,'r',1,'text',JSON.stringify({delta:text}));recordOutputChunks(db,'r',2,'text',JSON.stringify({delta:'第二条'}));db.exec('COMMIT');
  for(const offset of [0,8191,65535,524287,raw.length-10,raw.length]) {
    assert.deepEqual(readOutputTextRange(db,'w','s','r',1,offset,32768),raw.subarray(offset,offset+32768));
  }
  assert.equal(readOutputTextRange(db,'w','s','r',2,0,100).toString(),'第二条');
  db.exec('DELETE FROM run_output_chunks WHERE sequence=1 AND part=2');
  assert.throws(()=>readOutputTextRange(db,'w','s','r',1,30000,20),/WORK_HISTORY_INVALID/);
 } finally {db.close();}
});
