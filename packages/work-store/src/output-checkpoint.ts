import type { DatabaseSync } from 'node:sqlite';

/** Keep each encoded chunk below the history page budget even if JSON escaping
 * expands every byte sixfold. The caller owns the event insertion transaction. */
export const OUTPUT_CHUNK_BYTES = 8192;
export type OutputEventKind = 'text' | 'tool-start' | 'tool-end';
export interface OutputChunk {
  sequence: number;
  part: number;
  kind: OutputEventKind;
  data: string;
}
export interface OutputEventIndex {
  sequence: number;
  kind: OutputEventKind;
  parts: number;
  bytes: number;
}

/** Body-free event index. The high-water mark belongs to the frozen history
 * snapshot; keyset paging bounds memory independently of transcript size. */
export function readOutputEventIndex(db: DatabaseSync, workId: string, sessionId: string, runId: string,
  through: number, after = 0, limit = 100): OutputEventIndex[] {
  if (!Number.isSafeInteger(through) || through < 0 || !Number.isSafeInteger(after) || after < 0 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid output range');
  if (!db.prepare('SELECT 1 FROM runs WHERE work_id=? AND session_id=? AND run_id=?').get(workId,sessionId,runId)) {
    throw Object.assign(new Error('Run not found'),{name:'RunNotFoundError'});
  }
  const rows=db.prepare(`SELECT sequence,MIN(kind) AS kind,COUNT(*) AS parts,
    SUM(length(CAST(json_extract(payload_json,'$.data') AS BLOB))) AS bytes,
    MIN(part) AS first_part,MAX(part) AS last_part,COUNT(DISTINCT kind) AS kinds
    FROM run_output_chunks WHERE run_id=? AND sequence>? AND sequence<=?
    GROUP BY sequence ORDER BY sequence LIMIT ?`).all(runId,after,through,limit);
  return rows.map(row=>{
    const sequence=Number(row.sequence),parts=Number(row.parts),bytes=Number(row.bytes);
    if (!Number.isSafeInteger(sequence) || sequence<1 || !Number.isSafeInteger(parts) || parts<1 ||
      !Number.isSafeInteger(bytes) || bytes<0 || Number(row.first_part)!==0 || Number(row.last_part)!==parts-1 ||
      Number(row.kinds)!==1 || !['text','tool-start','tool-end'].includes(String(row.kind))) throw new Error('WORK_HISTORY_INVALID');
    return {sequence,kind:row.kind as OutputEventKind,parts,bytes};
  });
}

/** Read only one owner's exact Run, in bounded keyset pages. `through`
 * freezes the event boundary so later writes cannot enter a history snapshot. */
export function readOutputChunks(db: DatabaseSync, workId: string, sessionId: string, runId: string,
  through: number, after: {sequence:number;part:number} = {sequence:0,part:0}, limit = 8): OutputChunk[] {
  if (!Number.isSafeInteger(through) || through<0 || !Number.isSafeInteger(after.sequence) || after.sequence<0 ||
    !Number.isSafeInteger(after.part) || after.part<0 || !Number.isInteger(limit) || limit<1 || limit>8) throw new Error('Invalid output range');
  if (!db.prepare('SELECT 1 FROM runs WHERE work_id=? AND session_id=? AND run_id=?').get(workId,sessionId,runId)) {
    throw Object.assign(new Error('Run not found'),{name:'RunNotFoundError'});
  }
  const rows=db.prepare(`SELECT sequence,part,kind,payload_json FROM run_output_chunks WHERE run_id=? AND sequence<=?
    AND (sequence>? OR (sequence=? AND part>?)) ORDER BY sequence,part LIMIT ?`).all(runId,through,after.sequence,after.sequence,after.part,limit);
  return rows.map(row=>{
    if (typeof row.payload_json!=='string' || Buffer.byteLength(row.payload_json)>65536 ||
      !['text','tool-start','tool-end'].includes(String(row.kind))) throw new Error('WORK_HISTORY_INVALID');
    let value:unknown;try {value=JSON.parse(row.payload_json);} catch {throw new Error('WORK_HISTORY_INVALID');}
    if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==1 ||
      typeof (value as {data?:unknown}).data!=='string' || Buffer.byteLength((value as {data:string}).data)>OUTPUT_CHUNK_BYTES) throw new Error('WORK_HISTORY_INVALID');
    return {sequence:Number(row.sequence),part:Number(row.part),kind:row.kind as OutputEventKind,data:(value as {data:string}).data};
  });
}

/** Read a bounded byte range of one text event without materializing a large
 * event body. The event sequence is part of the caller's frozen high-water. */
export function readOutputTextRange(db: DatabaseSync, workId: string, sessionId: string, runId: string,
  sequence: number, offset: number, length: number): Buffer {
  if (!Number.isSafeInteger(sequence) || sequence<1 || !Number.isSafeInteger(offset) || offset<0 ||
      !Number.isInteger(length) || length<1 || length>65536) throw new Error('Invalid output range');
  const pieces:Buffer[]=[]; let position=0, remaining=length, after={sequence:sequence-1,part:Number.MAX_SAFE_INTEGER}, seen=false, expectedPart=0;
  while(remaining>0) {
    const page=readOutputChunks(db,workId,sessionId,runId,sequence,after,8);
    if(!page.length)break;
    for(const chunk of page) {
      if(chunk.sequence!==sequence || chunk.kind!=='text' || chunk.part!==expectedPart++)throw new Error('WORK_HISTORY_INVALID');
      seen=true;const bytes=Buffer.from(chunk.data,'utf8'),start=Math.max(0,offset-position);
      if(start<bytes.length && position+bytes.length>offset) {
        const part=bytes.subarray(start,Math.min(bytes.length,start+remaining));pieces.push(part);remaining-=part.length;
      }
      position+=bytes.length;after={sequence:chunk.sequence,part:chunk.part};
      if(!remaining)break;
    }
  }
  if(!seen || offset>position)throw new Error('WORK_HISTORY_INVALID');
  return Buffer.concat(pieces);
}

export function recordOutputChunks(db: DatabaseSync, runId: string, sequence: number, kind: OutputEventKind, payloadJson: string): void {
  if (!db.isTransaction) throw new Error('Output checkpoint requires the event transaction');
  if (!runId || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid output event identity');
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid output event');
  if (kind === 'text' && typeof payload.delta !== 'string') throw new Error('Invalid text output');
  if (kind !== 'text' && (typeof payload.toolName !== 'string' || typeof payload.toolCallId !== 'string')) throw new Error('Invalid tool output');
  // Tool arguments may contain private data and are not part of the public
  // history projection; retain only the same fields as the event projection.
  const safe = kind === 'text' ? payload.delta as string : JSON.stringify({
    toolName: payload.toolName, toolCallId: payload.toolCallId,
    ...(kind === 'tool-end' ? { isError: payload.isError === true, ...(payload.result === undefined ? {} : {result:payload.result}) } : {}),
  });
  // Store text directly so history pages can read even a single very large
  // delta without assembling and parsing its entire JSON representation.
  const bytes = Buffer.from(safe, 'utf8');
  const insert = db.prepare('INSERT INTO run_output_chunks(run_id,sequence,part,kind,payload_json) VALUES(?,?,?,?,?)');
  if (!bytes.length) insert.run(runId,sequence,0,kind,JSON.stringify({data:''}));
  for (let offset=0, part=0; offset<bytes.length; part++) {
    let end=Math.min(offset+OUTPUT_CHUNK_BYTES,bytes.length);
    if (end<bytes.length) while(end>offset && (bytes[end]!&0xc0)===0x80) end--;
    if (end===offset) throw new Error('Output checkpoint cannot advance');
    insert.run(runId,sequence,part,kind,JSON.stringify({data:bytes.subarray(offset,end).toString('utf8')}));
    offset=end;
  }
}
