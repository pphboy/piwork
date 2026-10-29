import { randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import { SessionHistoryIndex, type IndexedHistorySnapshot, type HistoryEntryLocation, type PersistentSessionEntry } from "@piwork/pi-adapter";
import { HISTORY_LIMITS, HistoryError, HistoryQuerySchema, HistoryPageSchema, historyJSON, validateChatImages, chatInputDigest,
  type HistoryPage, type HistoryQuery, type HistoryRunSummary, type HistorySegment } from "@piwork/contracts";
import { type HistoryRunRecord, type WorkStore } from "@piwork/work-store";
import { historyRunView, historySessionView } from "./history-projection.js";

type Block = Pick<HistorySegment,"type"> & Partial<Pick<HistorySegment,"toolCallId"|"toolName"|"image"|"resultKind"|"truncated"|"isError"|"blockIndex"|"blockCount"|"streamId"|"streamOffset">> & {text:string;blockId:string};
interface Entry { id:string;order:number;role:string;runId:string;location?:HistoryEntryLocation;blocks?:Block[];result?:HistoryRunRecord;recoveryUnconfirmed?:boolean;streams?:Map<string,{streamId:string;streamOffset:number}>;checkpoint?:{events:{sequence:number;bytes:number}[];bytes:number;skip?:number}; }
interface Snapshot { id:string;session:HistoryPage["session"];source:IndexedHistorySnapshot;entries:Entry[];runs:HistoryRunRecord[];byRun:Map<string,HistoryRunRecord>;lastAssistant:Map<string,Entry>;resultMatches:Map<string,boolean>;used:number; }
interface Position { item:number;block:number;offset:number; }
interface Cursor { snapshot:string;scope:string;position:Position; }
const fail = (code: ConstructorParameters<typeof HistoryError>[0], message:string):never => { throw new HistoryError(code,message); };
const scopeOf = (q:HistoryQuery) => JSON.stringify([q.direction ?? "older",q.content ?? "messages",q.runId ?? "",q.imageProfile ?? ""]);

export class SessionHistoryReader {
  private indexes = new Map<string,SessionHistoryIndex>();
  private snapshots = new Map<string,Snapshot>();
  private cursors = new Map<string,Cursor>();
  constructor(private readonly workId:string,private readonly store:WorkStore,private readonly now=()=>Date.now()) {}

  page(sessionId:string, query:HistoryQuery):HistoryPage {
    if (!Check(HistoryQuerySchema,query) || query.content === "result" && !query.runId) return fail("INVALID_HISTORY_CURSOR","Invalid history range.");
    const record=this.store.getSession(this.workId,sessionId);
    if (!record) throw Object.assign(new Error("Session not found"),{name:"SessionNotFoundError"});
    this.prune();
    const scope=scopeOf(query), cursor=query.cursor?this.cursors.get(query.cursor):undefined;
    if (query.cursor && !cursor) return fail("HISTORY_CURSOR_EXPIRED","The history cursor expired; reread the Session.");
    if (cursor && (cursor.scope!==scope || query.snapshot && query.snapshot!==cursor.snapshot)) return fail("INVALID_HISTORY_CURSOR","The cursor belongs to another history range.");
    const id=cursor?.snapshot ?? query.snapshot;
    const snapshot=id?this.snapshots.get(id):this.capture(sessionId);
    if (!snapshot) return fail("HISTORY_CURSOR_EXPIRED","The history snapshot expired; reread the Session.");
    if (snapshot.session.sessionId!==sessionId || snapshot.session.workId!==this.workId) return fail("INVALID_HISTORY_CURSOR","The snapshot belongs to another Session.");
    snapshot.used=this.now();
    // Validate the frozen source even for metadata/result pages.
    snapshot.source.validate();
    const run=query.runId?snapshot.byRun.get(query.runId):undefined;
    if (query.runId && !run) throw Object.assign(new Error("Run not found in Session"),{name:"RunNotFoundError"});
    const older=(query.direction ?? "older")==="older", content=query.content ?? "messages";
    const entries=content==="result"?[this.resultEntry(snapshot,run!)]:snapshot.entries.filter(e=>!query.runId||e.runId===query.runId);
    const runs=content==="runs"?snapshot.runs.filter(r=>!query.runId||r.runId===query.runId):[];
    let position:Position=cursor?{...cursor.position}:{item:older?(content==="runs"?runs.length:entries.length)-1:0,block:older?-1:0,offset:older?-1:0};
    const page:HistoryPage={contractVersion:1,session:snapshot.session,snapshotId:snapshot.id,segments:[],runs:[],nextCursor:null,hasMore:false};
    if(content==='messages'){
      const active=snapshot.runs.findLast(run=>['accepted','running','cancelling'].includes(run.state)&&(!query.runId||run.runId===query.runId));
      if(active)page.runs.push(this.runView(snapshot,active));
    }
    const seen=new Set<string>(),limit=query.limit ?? HISTORY_LIMITS.defaultEntries;
    let activeEntry:Entry|undefined,activeBlocks:Block[]=[];
    const inRange=()=>position.item>=0&&position.item<(content==="runs"?runs.length:entries.length);
    while(inRange()) {
      const prior={...position}; let segment:HistorySegment|undefined;let summary:HistoryRunSummary|undefined;
      if(content==="runs") { summary=this.runView(snapshot,runs[position.item]!);position.item+=older?-1:1; }
      else {
        const entry=entries[position.item]!;
        // A durable result may survive without the final SDK turn. Resolve the
        // candidate only when this page reaches it; matched SDK text is emitted
        // through its original entry once, without loading every Run result.
        if(content==='messages'&&entry.result&&!this.resultEntry(snapshot,entry.result).result){position={item:position.item+(older?-1:1),block:older?-1:0,offset:older?-1:0};continue;}
        if(!seen.has(entry.id)&&seen.size>=limit)break;
        // Resolve only the final candidate being read, so its summary can map a
        // previously read durable result to this SDK entry across snapshots.
        const saved=entry.runId?snapshot.byRun.get(entry.runId):undefined;
        if(saved&&saved.resultBytes!==null&&snapshot.lastAssistant.get(entry.runId)===entry&&!snapshot.resultMatches.has(entry.runId))this.resultEntry(snapshot,saved);
        if(activeEntry!==entry){activeEntry=entry;activeBlocks=this.blocks(snapshot,entry,query.imageProfile!==undefined);}
        const blocks=activeBlocks;
        const blockIndex=position.block<0?blocks.length-1:position.block,block=blocks[blockIndex]!;
        const total=entry.result?entry.result.resultBytes ?? 0:entry.checkpoint?.bytes ?? Buffer.byteLength(block.text);
        const boundary=position.offset<0?total:position.offset;
        let offset:number,text:string;
        if(entry.result) {
          offset=older?Math.max(0,boundary-HISTORY_LIMITS.fragmentBytes):boundary;
          let raw=this.store.historyResult(this.workId,sessionId,entry.runId,offset,Math.max(1,older?boundary-offset:Math.min(HISTORY_LIMITS.fragmentBytes,total-offset)));
          if(older&&offset>0) {while(raw.length&&(raw[0]!&0xc0)===0x80){offset++;raw=raw.subarray(1);}}
          while(raw.length&&!Buffer.from(raw.toString("utf8")).equals(raw))raw=raw.subarray(0,raw.length-1);
          text=raw.toString("utf8");
        } else if(entry.checkpoint) {
          offset=older?Math.max(0,boundary-HISTORY_LIMITS.fragmentBytes):boundary;
          const end=older?boundary:Math.min(total,boundary+HISTORY_LIMITS.fragmentBytes);
          let raw=this.checkpointRange(sessionId,entry,offset,end-offset);
          if(older&&offset>0)while(raw.length&&(raw[0]!&0xc0)===0x80){offset++;raw=raw.subarray(1);}
          while(raw.length&&!Buffer.from(raw.toString('utf8')).equals(raw))raw=raw.subarray(0,raw.length-1);
          text=raw.toString('utf8');
        } else {
          const raw=Buffer.from(block.text); offset=older?Math.max(0,boundary-HISTORY_LIMITS.fragmentBytes):boundary;
          if(older)while(offset<boundary&&(raw[offset]!&0xc0)===0x80)offset++;
          let end=older?boundary:Math.min(total,boundary+HISTORY_LIMITS.fragmentBytes);
          if(!older&&end<total)while(end>boundary&&(raw[end]!&0xc0)===0x80)end--;
          text=raw.subarray(offset,end).toString("utf8");
        }
        const length=Buffer.byteLength(text);
        if(total>0&&!length) return fail("HISTORY_CORRUPT","The history range could not advance.");
        segment={...block,...(entry.recoveryUnconfirmed?{recoveryUnconfirmed:true}:{}),entryId:entry.id,entryOrder:entry.order,role:entry.role,runId:entry.runId,blockIndex:block.blockIndex??blockIndex,blockCount:block.blockCount??blocks.length,
          byteOffset:offset,totalBytes:total,text,complete:offset+length===total};
        const done=older?offset===0:offset+length===total;
        if(!done)position={item:position.item,block:blockIndex,offset:older?offset:offset+length};
        else if(older?blockIndex>0:blockIndex+1<blocks.length)position={item:position.item,block:blockIndex+(older?-1:1),offset:older?-1:0};
        else position={item:position.item+(older?-1:1),block:older?-1:0,offset:older?-1:0};
        if(entry.runId)summary=this.runView(snapshot,snapshot.byRun.get(entry.runId)!);
        seen.add(entry.id);
      }
      const previousRuns=page.runs;
      if(summary){const existing=page.runs.findIndex(r=>r.runId===summary!.runId);
        page.runs=existing<0?[...page.runs,summary]:page.runs.map((run,index)=>index===existing?summary!:run);}
      if(segment)page.segments.push(segment);
      // Reserve the longest possible cursor and check real Go-compatible JSON.
      const encoded=historyJSON({...page,nextCursor:"x".repeat(256),hasMore:true});
      if(Buffer.byteLength(encoded)>HISTORY_LIMITS.pageBytes || Buffer.byteLength(encoded)+16>HISTORY_LIMITS.rpcBytes) {
        if(segment)page.segments.pop();page.runs=previousRuns;position=prior;
        if(!page.segments.length&&!page.runs.length)return fail("RESPONSE_TOO_LARGE","History metadata exceeds its declared budget.");
        break;
      }
      if(content==="runs"&&page.runs.length>=limit)break;
    }
    if(older){page.segments.reverse();page.runs.reverse();}
    page.hasMore=inRange();
    if(page.hasMore) { const token=randomUUID();this.cursors.set(token,{snapshot:snapshot.id,scope,position});page.nextCursor=token; }
    if(!Check(HistoryPageSchema,page)||Buffer.byteLength(historyJSON(page))>HISTORY_LIMITS.pageBytes)return fail("HISTORY_CORRUPT","History projection is invalid.");
    return page;
  }

  private capture(sessionId:string):Snapshot {
    const record=this.store.getSession(this.workId,sessionId)!;
    let index=this.indexes.get(sessionId);if(!index){index=new SessionHistoryIndex(record.sdkHistoryPath,sessionId);this.indexes.set(sessionId,index);}
    const source=index.snapshot(),runs:HistoryRunRecord[]=[];
    let after:{acceptedAt:string;runId:string}|undefined;
    while(true){const batch=this.store.historyRuns(this.workId,sessionId,after);if(!batch.length)break;runs.push(...batch);const last=batch.at(-1)!;after={acceptedAt:last.acceptedAt,runId:last.runId};}
    const byRun=new Map(runs.map(r=>[r.runId,r])),owners=new Map<string,Set<string>>();
    if(source.entries.some(e=>source.runFor(e)===undefined&&e.calls.length))for(const value of this.store.historyToolCalls(this.workId,sessionId)){
      const ids=owners.get(value.callId)??new Set<string>();ids.add(value.runId);owners.set(value.callId,ids);
    }
    const userRuns=new Set<string>();
    const entries:Entry[]=source.entries.map(ref=>{
      let rid=source.runFor(ref);
      if(rid===undefined&&ref.calls.length){const matches=ref.calls.map(c=>owners.get(c));const ids=new Set(matches.flatMap(v=>v?.size===1?[...v]:[]));if(matches.every(v=>v?.size===1)&&ids.size===1)rid=[...ids][0];}
      const runId=rid&&byRun.has(rid)?rid:"";
      const id=ref.role==="user"&&runId&&!userRuns.has(runId)?`${runId}-user`:ref.id;
      if(ref.role==="user"&&runId)userRuns.add(runId);
      return {id,order:ref.order,role:ref.role!,runId,location:ref};
    });
    for(const run of runs){const input=this.store.privateInput(run.runId);if(!input||userRuns.has(run.runId))continue;
      const id=`${run.runId}-user`,images=validateChatImages(input.images);
      const blocks:Block[]=[...(input.prompt?[{type:"text" as const,blockId:`${id}-0`,text:input.prompt}]:[]),...images.map((image,imageIndex)=>({type:"image" as const,blockId:`${run.runId}-image-${imageIndex}`,text:"",image:{...image,imageIndex}}))];
      const entry:Entry={id,order:0,role:"user",runId:run.runId,blocks};
      const next=entries.findIndex(e=>e.runId&&(byRun.get(e.runId)?.acceptedAt ?? "")>run.acceptedAt);
      if(next<0)entries.push(entry);else entries.splice(next,0,entry);
    }
    const recoveredRuns=new Set<string>();
    for(const run of runs)if(['succeeded','cancelled','failed','interrupted'].includes(run.state)) {
      const saved=entries.filter(e=>e.runId===run.runId&&e.role!=='user');
      const recovered=this.uncoveredCheckpoints(sessionId,source,saved,this.checkpointEntries(sessionId,run));
      if(!recovered.length)continue;
      recoveredRuns.add(run.runId);
      const last=entries.findLastIndex(e=>e.runId===run.runId);
      const next=entries.findIndex(e=>e.runId&&(byRun.get(e.runId)?.acceptedAt ?? '')>run.acceptedAt);
      entries.splice(last>=0?last+1:next>=0?next:entries.length,0,...recovered);
    }
    // A Run can fail before the SDK writes its first message. Give it a
    // paginated metadata anchor so its real state and Details remain visible;
    // do not invent a prompt or a reply that was never saved.
    for(const run of runs)if(run.resultBytes===null&&!entries.some(entry=>entry.runId===run.runId)){
      const id=`${run.runId}-empty`,entry:Entry={id,order:0,role:'assistant',runId:run.runId,blocks:[{type:'empty',blockId:id,text:''}]};
      const next=entries.findIndex(item=>item.runId&&(byRun.get(item.runId)?.acceptedAt ?? '')>run.acceptedAt);
      entries.splice(next>=0?next:entries.length,0,entry);
    }
    for(const run of runs)if(run.resultBytes!==null && !(run.resultBytes===0 && recoveredRuns.has(run.runId))){
      const result:Entry={id:`${run.runId}-final`,order:0,role:"assistant",runId:run.runId,result:run,blocks:[{type:"run-result",blockId:`${run.runId}-final-0`,text:""}]};
      const last=entries.findLastIndex(entry=>entry.runId===run.runId);
      if(last>=0)entries.splice(last+1,0,result);else entries.push(result);
    }
    entries.forEach((entry,order)=>entry.order=order);
    const lastAssistant=new Map(entries.filter(entry=>entry.role==='assistant'&&!entry.result&&entry.runId).map(entry=>[entry.runId,entry]));
    const snapshot:Snapshot={id:randomUUID(),session:historySessionView(record),source,entries,runs,byRun,lastAssistant,resultMatches:new Map(),used:this.now()};
    this.snapshots.set(snapshot.id,snapshot);this.prune();return snapshot;
  }
  private checkpointEntries(sessionId:string,run:HistoryRunRecord):Entry[] {
    const entries:Entry[]=[],started=new Set<string>();let after=0,group:Entry|undefined;
    while(true){const batch=this.store.historyOutputEventIndex(this.workId,sessionId,run.runId,run.latestSequence,after);if(!batch.length)break;
      for(const event of batch){after=event.sequence;
        if(event.kind==='text'){
          if(event.bytes===0)continue;
          if(!group){const id=`${run.runId}-text-${event.sequence}`;group={id,order:0,role:'assistant',runId:run.runId,blocks:[{type:'text',blockId:id,text:''}],checkpoint:{events:[],bytes:0}};entries.push(group);}
          group.checkpoint!.events.push({sequence:event.sequence,bytes:event.bytes});group.checkpoint!.bytes+=event.bytes;
          if(!Number.isSafeInteger(group.checkpoint!.bytes))return fail('HISTORY_CORRUPT','A saved text range is too large.');continue;
        }
        group=undefined;
        // Tool previews are bounded when generated by the Agent. Reject a
        // forged oversized event rather than assembling an unbounded body.
        if(event.bytes>512*1024)return fail('HISTORY_CORRUPT','A saved tool event exceeds its history budget.');
        const parts:string[]=[];let cursor={sequence:event.sequence-1,part:Number.MAX_SAFE_INTEGER},count=0;
        while(count<event.parts){const chunks=this.store.historyOutputChunks(this.workId,sessionId,run.runId,event.sequence,cursor,8);if(!chunks.length)return fail('HISTORY_CORRUPT','A saved tool event is incomplete.');
          for(const chunk of chunks){if(chunk.sequence!==event.sequence||chunk.kind!==event.kind||chunk.part!==count++)return fail('HISTORY_CORRUPT','A saved tool event is inconsistent.');parts.push(chunk.data);cursor={sequence:chunk.sequence,part:chunk.part};}}
        let value:any;try{value=JSON.parse(parts.join(''));}catch{return fail('HISTORY_CORRUPT','A saved tool event is invalid.');}
        if(!value || typeof value.toolName!=='string'||!value.toolName||typeof value.toolCallId!=='string'||!value.toolCallId)return fail('HISTORY_CORRUPT','A saved tool identity is invalid.');
        if(event.kind==='tool-start'){if(started.has(value.toolCallId))continue;started.add(value.toolCallId);}
        const id=`${run.runId}-checkpoint-${event.sequence}`,base={blockId:id,text:'',toolName:value.toolName,toolCallId:value.toolCallId};
        if(event.kind==='tool-start')entries.push({id,order:0,role:'assistant',runId:run.runId,blocks:[{...base,type:'tool-call'}]});
        else {const result=value.result ?? {kind:'unavailable',truncated:false,isError:value.isError===true},kind=result?.kind;
          if(!['text','non-text','unavailable'].includes(kind)||kind==='text'&&typeof result.text!=='string'||typeof result.truncated!=='boolean'||typeof result.isError!=='boolean')return fail('HISTORY_CORRUPT','A saved tool result is invalid.');
          entries.push({id,order:0,role:'toolResult',runId:run.runId,blocks:[{...base,type:'tool-result',text:kind==='text'?result.text:'',resultKind:kind,truncated:result.truncated,isError:result.isError}]});
        }
      }
    }
    return entries;
  }
  private checkpointRange(sessionId:string,entry:Entry,offset:number,length:number):Buffer {
    offset+=entry.checkpoint!.skip??0;
    const result:Buffer[]=[];let position=0,remaining=length;
    for(const event of entry.checkpoint!.events){const start=Math.max(0,offset-position),available=Math.min(event.bytes-start,remaining);
      if(available>0){const part=this.store.historyOutputTextRange(this.workId,sessionId,entry.runId,event.sequence,start,available);if(part.length!==available)return fail('HISTORY_CORRUPT','A saved text range is incomplete.');result.push(part);remaining-=available;}
      position+=event.bytes;if(!remaining)break;
    }
    if(remaining)return fail('HISTORY_CORRUPT','A saved text range is incomplete.');return Buffer.concat(result);
  }
  /** Match only a verified prefix in the same Run. Tool call identities
   * establish the intervening boundaries; text is checked byte-for-byte. */
  private uncoveredCheckpoints(sessionId:string,source:IndexedHistorySnapshot,saved:Entry[],checkpoints:Entry[]):Entry[] {
    if(!saved.length||!checkpoints.length)return checkpoints;
    let index=0,offset=0;
    const remaining=(uncertain:boolean):Entry[]=>{
      const rest=checkpoints.slice(index).map(entry=>uncertain?{...entry,recoveryUnconfirmed:true}:entry);
      if(!offset||!rest.length)return rest;
      const current=rest[0]!;if(!current.checkpoint)return rest;
      const id=`${current.id}-remaining-${offset}`;
      rest[0]={...current,id,blocks:[{type:'text',blockId:id,text:'',streamId:current.id,streamOffset:offset}],checkpoint:{...current.checkpoint,skip:offset,bytes:current.checkpoint.bytes-offset}};
      return rest;
    };
    for(const entry of saved){if(!entry.location)return remaining(true);
      const value=source.read(entry.location);
      for(const block of value.blocks){
        if(block.type==='image')continue;
        if(block.type==='text'){
          const raw=Buffer.from(block.text);let at=0;
          const origin=checkpoints[index],originOffset=offset;
          while(at<raw.length){const current=checkpoints[index];if(!current?.checkpoint)return remaining(true);
            const size=Math.min(raw.length-at,current.checkpoint.bytes-offset,HISTORY_LIMITS.fragmentBytes);
            if(size<=0)return remaining(true);
            if(!this.checkpointRange(sessionId,current,offset,size).equals(raw.subarray(at,at+size)))return remaining(true);
            at+=size;offset+=size;if(offset===current.checkpoint.bytes){index++;offset=0;}
          }
          // A block is associated only when every byte was checked against
          // one event group; equal prose by itself does not establish identity.
          if(raw.length&&origin?.checkpoint&&originOffset+raw.length<=origin.checkpoint.bytes){
            entry.streams??=new Map();entry.streams.set(block.blockId,{streamId:origin.id,streamOffset:originOffset});
          }
        } else {
          if(offset!==0)return remaining(true);
          const current=checkpoints[index]?.blocks?.[0];
          if(!current||current.type!==block.type||current.toolCallId!==block.toolCallId||current.toolName!==block.toolName)return remaining(true);
          index++;
        }
      }
    }
    return remaining(false);
  }
  private blocks(snapshot:Snapshot,entry:Entry,images:boolean):Block[] {
    let blocks=entry.blocks;
    if(!blocks){const value=snapshot.source.read(entry.location!);
      if(value.role==="user"&&value.blocks.some(b=>b.type==="image")){
        const input=value.blocks.flatMap(b=>b.type==="image"?[b.input]:[]);
        if(!entry.runId||chatInputDigest(value.originalText ?? value.text,input)!==snapshot.byRun.get(entry.runId)?.promptDigest) return fail("HISTORY_CORRUPT","The saved image input could not be verified.");
      }
      blocks=value.blocks.map((block,i)=>{
        const blockId=entry.id!==value.id?`${entry.id}-${i}`:block.blockId;
        if(block.type==="text")return {type:block.type,blockId,text:block.text,...entry.streams?.get(block.blockId)};
        if(block.type==="image")return {type:block.type,blockId:`${entry.runId}-image-${block.image.imageIndex}`,text:"",image:block.image};
        const base={type:block.type,blockId,text:"",toolCallId:block.toolCallId,toolName:block.toolName};
        return block.type==="tool-result"?{...base,text:block.result.kind==="text"?block.result.text:"",resultKind:block.result.kind,truncated:block.result.truncated,isError:block.result.isError}:base;
      });
    }
    const visible=blocks.filter(b=>b.type!=="image"||images);
    return visible.length?visible:[{type:"empty",blockId:`${entry.id}-empty`,text:""}];
  }
  private resultEntry(snapshot:Snapshot,run:HistoryRunRecord):Entry {
    if(run.resultBytes===null)return fail("HISTORY_CORRUPT","The Run has no saved final result.");
    const last=snapshot.lastAssistant.get(run.runId);
    if(last?.checkpoint&&snapshot.resultMatches.get(run.runId)!==false){
      if(snapshot.resultMatches.get(run.runId)===true)return last;
      if(last.checkpoint.bytes===run.resultBytes){let same=true;
        for(let start=0;start<run.resultBytes;start+=HISTORY_LIMITS.fragmentBytes){const size=Math.min(HISTORY_LIMITS.fragmentBytes,run.resultBytes-start);
          if(!this.checkpointRange(run.sessionId,last,start,size).equals(this.store.historyResult(this.workId,run.sessionId,run.runId,start,size))){same=false;break;}}
        if(same){snapshot.resultMatches.set(run.runId,true);return last;}
      }
    }
    if(last&&!last.checkpoint&&snapshot.resultMatches.get(run.runId)!==false){const blocks=this.blocks(snapshot,last,true);
      // The result range omits tool blocks but keeps the original SDK shape.
      // Cursor positions still index the filtered text array locally.
      const texts=blocks.flatMap((block,blockIndex)=>block.type==='text'?[{...block,blockIndex,blockCount:blocks.length}]:[]);
      if(texts.length&&snapshot.resultMatches.get(run.runId)===true)return {...last,blocks:texts};
      const text=texts.map(b=>b.text).join("");
      // No public text block is different from an explicitly empty text block.
      // Keep a missing SDK result on the independent durable result entry.
      if(texts.length&&Buffer.byteLength(text)===run.resultBytes){const raw=Buffer.from(text);let same=true;
        for(let start=0;start<raw.length;start+=HISTORY_LIMITS.fragmentBytes)if(!this.store.historyResult(this.workId,run.sessionId,run.runId,start,Math.min(HISTORY_LIMITS.fragmentBytes,raw.length-start)).equals(raw.subarray(start,start+HISTORY_LIMITS.fragmentBytes))){same=false;break;}
        if(same){snapshot.resultMatches.set(run.runId,true);return {...last,blocks:texts};}
      }
    }
    snapshot.resultMatches.set(run.runId,false);
    return {id:`${run.runId}-final`,order:snapshot.entries.find(e=>e.result?.runId===run.runId)?.order??snapshot.entries.length,role:"assistant",runId:run.runId,result:run,blocks:[{type:"run-result",blockId:`${run.runId}-final-0`,text:""}]};
  }
  private runView(snapshot:Snapshot,run:HistoryRunRecord):HistoryRunSummary {
    const matched=snapshot.resultMatches.get(run.runId);
    const entryId=matched===undefined?undefined:matched?snapshot.lastAssistant.get(run.runId)!.id:`${run.runId}-final`;
    return historyRunView(run,snapshot.id,entryId?{entryId}:undefined);
  }
  private prune() {
    for(const [id,s] of this.snapshots)if(this.now()-s.used>10*60*1000)this.snapshots.delete(id);
    while(this.snapshots.size>16)this.snapshots.delete(this.snapshots.keys().next().value!);
    for(const [id,c]of this.cursors)if(!this.snapshots.has(c.snapshot))this.cursors.delete(id);
    while(this.cursors.size>4096)this.cursors.delete(this.cursors.keys().next().value!);
    while(this.indexes.size>8)this.indexes.delete(this.indexes.keys().next().value!);
  }
}
