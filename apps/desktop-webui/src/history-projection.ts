import { historyMessages } from './chat-projection.js';
import type { Message } from './models.js';
type Data = Record<string, any>;
interface Range { offset: number; bytes: Uint8Array }
interface Block { value: Data; ranges: Range[] }
interface Entry { id: string; order: number; role: string; runId: string; count: number; blocks: Map<string, Block> }
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const invalid = (): never => { throw new Error('Saved history contains a missing or conflicting content range.'); };

/** The cache contains only content explicitly read by this page. Range overlap
 * is validated by bytes, never inferred from equal messages or tool names. */
export class HistoryProjection {
  private entries = new Map<string, Entry>();
  private suppressed = new Set<string>();
  private resultTargets = new Map<string,string>();
  private visibleResults = new Map<string,string>();
  suppress(runId: string) { this.suppressed.add(runId); }
  reveal(runId: string) { this.suppressed.delete(runId); }
  clear() { this.entries.clear(); this.suppressed.clear(); this.resultTargets.clear(); this.visibleResults.clear(); }
  covers(part: Data) {
    const block = this.entries.get(part.entryId)?.blocks.get(part.blockId);
    if (!block) return false;
    const start = part.byteOffset, end = start + encoder.encode(part.text).length;
    if (start === end) return block.value.totalBytes === part.totalBytes;
    let cursor = start;
    for (const range of [...block.ranges].sort((a,b)=>a.offset-b.offset)) {
      if (range.offset > cursor) break;
      if (range.offset + range.bytes.length > cursor) cursor = range.offset + range.bytes.length;
      if (cursor >= end) return true;
    }
    return false;
  }
  merge(page: Data) {
    if (page.contractVersion !== 1 || !Array.isArray(page.segments) || !Array.isArray(page.runs)) invalid();
    for(const run of page.runs){
      const ref=run.resultRef;if(!ref?.entryId)continue;
      if(ref.runId!==run.runId||ref.workId!==page.session?.workId||ref.sessionId!==page.session?.sessionId)invalid();
      // A replayed old snapshot may still name the durable fallback. It must
      // not undo an explicit SDK target learned from a newer snapshot.
      if(ref.entryId!==`${run.runId}-final`||!this.resultTargets.has(run.runId))this.resultTargets.set(run.runId,ref.entryId);
    }
    for (const part of page.segments) {
      const raw = encoder.encode(part.text);
      if (!part.entryId || !part.blockId || !Number.isSafeInteger(part.byteOffset) || !Number.isSafeInteger(part.totalBytes) || part.byteOffset < 0 || part.totalBytes < part.byteOffset + raw.length || raw.length > 32768 || part.complete !== (part.byteOffset+raw.length===part.totalBytes) || !Number.isSafeInteger(part.blockIndex) || part.blockIndex<0 || part.blockIndex>=part.blockCount) invalid();
      let entry = this.entries.get(part.entryId);
      if (!entry) { entry={id:part.entryId,order:part.entryOrder,role:part.role,runId:part.runId,count:part.blockCount,blocks:new Map()};this.entries.set(entry.id,entry); }
      if (entry.role!==part.role || entry.runId!==part.runId) invalid();
      entry.order=part.entryOrder;entry.count=part.blockCount;
      if(part.type!=='empty')for(const [id,b]of entry.blocks)if(b.value.type==='empty')entry.blocks.delete(id);
      let block=entry.blocks.get(part.blockId);
      if(!block){block={value:{...part,text:undefined},ranges:[]};entry.blocks.set(part.blockId,block);}
      if(block.value.totalBytes!==part.totalBytes || block.value.type!==part.type)invalid();
      block.value={...part,text:undefined};
      let covered=false;
      for(const old of block.ranges){
        const begin=Math.max(old.offset,part.byteOffset),end=Math.min(old.offset+old.bytes.length,part.byteOffset+raw.length);
        for(let at=begin;at<end;at++)if(old.bytes[at-old.offset]!==raw[at-part.byteOffset])invalid();
        if(old.offset<=part.byteOffset&&old.offset+old.bytes.length>=part.byteOffset+raw.length)covered=true;
      }
      if(!covered) {block.ranges=block.ranges.filter(old=>!(part.byteOffset<=old.offset&&part.byteOffset+raw.length>=old.offset+old.bytes.length));block.ranges.push({offset:part.byteOffset,bytes:raw});}
    }
  }
  private text(block: Block) {
    const ranges=[...block.ranges].sort((a,b)=>a.offset-b.offset);
    if(!ranges.length)return {text:'',complete:block.value.totalBytes===0};
    const start=ranges[0]!.offset;let end=start;const pieces:Uint8Array[]=[];
    for(const range of ranges){if(range.offset>end)break;const skip=Math.max(0,end-range.offset);if(skip<range.bytes.length){pieces.push(range.bytes.subarray(skip));end=range.offset+range.bytes.length;}}
    const bytes=new Uint8Array(end-start);let at=0;for(const part of pieces){bytes.set(part,at);at+=part.length;}
    return {text:decoder.decode(bytes),complete:start===0&&end===block.value.totalBytes};
  }
  project(previous: Message[], replaceRuns: Set<string> = new Set()): Message[] {
    const raw:Data[]=[],incomplete=new Set<string>();
    const hiddenResultText=new Set<string>();
    const complete=(entry:Entry)=>entry.blocks.size===entry.count&&[...entry.blocks.values()].every(block=>this.text(block).complete);
    for(const [runId,targetId]of this.resultTargets){
      const target=this.entries.get(targetId),fallback=this.entries.get(`${runId}-final`);
      if(!target||target.runId!==runId)continue;
      if(!fallback||fallback===target||fallback.runId!==runId||![...fallback.blocks.values()].some(block=>block.value.type==='run-result')){this.visibleResults.set(runId,target.id);continue;}
      const visible=complete(target)?target.id:complete(fallback)?fallback.id:this.visibleResults.get(runId)??fallback.id;
      this.visibleResults.set(runId,visible);
      hiddenResultText.add(visible===target.id?fallback.id:target.id);
    }
    for(const entry of [...this.entries.values()].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))){
      if(this.suppressed.has(entry.runId)&&entry.role!=='user')continue;
      const blocks:Data[]=[];let complete=entry.blocks.size===entry.count;
      for(const block of [...entry.blocks.values()].sort((a,b)=>a.value.blockIndex-b.value.blockIndex)){
        const part=block.value,value=this.text(block);complete=complete&&value.complete;
        if(hiddenResultText.has(entry.id)&&(part.type==='text'||part.type==='run-result'))continue;
        if(part.type==='text'||part.type==='run-result')blocks.push({blockId:part.blockId,type:'text',text:value.text});
        else if(part.type==='image')blocks.push({blockId:part.blockId,type:'image',image:part.image});
        else if(part.type==='tool-call')blocks.push({blockId:part.blockId,type:part.type,toolCallId:part.toolCallId,toolName:part.toolName});
        else if(part.type==='tool-result')blocks.push({blockId:part.blockId,type:part.type,toolCallId:part.toolCallId,toolName:part.toolName,result:{kind:part.resultKind,...(part.resultKind==='text'?{text:value.text}:{}),truncated:part.truncated,isError:part.isError}});
      }
      if(hiddenResultText.has(entry.id)&&!blocks.length)continue;
      if(!complete) {incomplete.add(entry.id);for(const block of blocks){incomplete.add(block.blockId);if(block.toolCallId&&entry.runId)incomplete.add(`${entry.runId}-tool-${block.toolCallId}`);}}
      raw.push({entryId:entry.id,runId:entry.runId,role:entry.role,blocks,text:''});
    }
    // A user turn keeps its accepted identity when text blocks become durable,
    // just as an image turn does. Several SDK text blocks are one user turn.
    const userIds=new Map<string,string>();for(const entry of raw)if(entry.role==='user')for(const block of entry.blocks)userIds.set(block.blockId,entry.entryId);
    const saved:Message[]=[],users=new Map<string,Message>();
    for(const message of historyMessages(raw)){
      const id=message.role==='user'?userIds.get(message.id??'')??message.id:message.id;
      const value={...message,id,historyStored:true,historyIncomplete:incomplete.has(id??'')||incomplete.has(message.id??'')};
      const previous=message.role==='user'&&id?users.get(id):undefined;
      if(previous){previous.text+=value.text;previous.historyIncomplete ||= value.historyIncomplete;}
      else{saved.push(value);if(message.role==='user'&&id)users.set(id,value);}
    }
    const ids=new Set(saved.map(m=>m.id)),tools=new Set(saved.filter(m=>m.tool&&m.runId).map(m=>`${m.runId}:${m.tool!.id}`));
    const anchors=new Map<string,number>();
    previous.forEach((message,index)=>{if(message.runId&&(ids.has(message.id)||message.tool&&tools.has(`${message.runId}:${message.tool.id}`)))anchors.set(message.runId,index);});
    const live=previous.filter((message,index)=>!message.historyStored&&!ids.has(message.id)&&!(message.runId&&replaceRuns.has(message.runId))&&!(message.runId&&index<=(anchors.get(message.runId)??-1)));
    return [...saved,...live];
  }
}
