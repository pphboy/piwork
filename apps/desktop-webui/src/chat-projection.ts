import type { Message } from './models.js';
import { t } from './locale.js';
export function memoryResultSummary(result: any,toolName?: string): string | undefined {
  if (!['brain_experience','brain_feedback','package:piwork-brain:brain_experience','package:piwork-brain:brain_feedback'].includes(toolName??'')||result?.kind!=='text') return;
  if(result.isError) return t('d.chat.memoryFailed');
  try {
    const value=JSON.parse(result.text),version=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
    if(value.memoryCommit?.status==='effective'&&version(value.memoryCommit.version)) return t('d.chat.memoryEffective', { version: value.memoryCommit.version });
    if(value.status==='staged'&&version(value.version)) return t('d.chat.memoryCandidate', { version: value.version });
    if(value.status==='invalidated'&&version(value.version)) return t('d.chat.memoryInvalidated', { version: value.version });
    if(version(value.adoptedExperienceVersion)&&version(value.effectiveVersion)) return t('d.chat.memoryAdopted', { adopted: value.adoptedExperienceVersion, effective: value.effectiveVersion });
    if(version(value.version)&&Array.isArray(value.items))return t('d.chat.memoryEntries', { match: t(value.items.length ? 'd.chat.memoryMatching' : 'd.chat.memoryNoMatch'), version: value.version, limited: value.truncated ? t('d.chat.memoryLimited') : '' });
  }catch{/* Unknown or truncated results remain the actual bounded preview. */}
}
export function resultText(result: any,toolName?: string) {
  const summary=memoryResultSummary(result,toolName);
  return result?.kind === 'text' ? `${summary?`${summary}\n`:''}${result.text}${result.truncated ? t('d.chat.previewLimited') : ''}` : result?.kind === 'non-text' ? t('d.chat.nonTextResult') : t('d.chat.resultUnconfirmed');
}
export function upsertTool(messages: Message[], incoming: Message) {
  const existing = incoming.runId && incoming.tool?.id ? messages.find(message => message.runId === incoming.runId && message.tool?.id === incoming.tool?.id) : undefined;
  if (!existing) { messages.push(incoming); return; }
  if (existing.tool?.status === 'Completed' || existing.tool?.status === 'Failed') return;
  existing.tool = incoming.tool;
}
export function historyMessages(raw: any[]): Message[] {
  const messages: Message[] = [];
  for (const message of raw) {
    if (!['user', 'assistant', 'toolResult'].includes(message.role)) continue;
    if(message.role==='user' && message.blocks?.some((block:any)=>block.type==='image')) {
      messages.push({id:message.runId?`${message.runId}-user`:message.entryId,runId:message.runId || undefined,role:'user',text:message.blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(''),images:message.blocks.filter((b:any)=>b.type==='image').map((b:any)=>b.image)});continue;
    }
    if (!message.blocks?.length) {
      messages.push(message.role === 'toolResult' ? { id: message.entryId, runId:message.runId || undefined, role: 'assistant', text: '', tool: { name: t('d.chat.toolResult'), status: t('d.chat.toolUnconfirmed'), content: resultText(undefined) } } : { id: message.entryId, runId:message.runId || undefined, role: message.role, text: message.text ?? '' }); continue;
    }
    for (const block of message.blocks) {
      if (block.type === 'text') messages.push({ id: block.blockId, runId: message.runId || undefined, role: message.role, text: block.text });
      else upsertTool(messages, { id: message.runId ? `${message.runId}-tool-${block.toolCallId}` : block.blockId, runId: message.runId || undefined, role: 'assistant', text: '', tool: { id: block.toolCallId, name: block.toolName, status: block.type === 'tool-call' ? 'Result not confirmed' : block.result?.isError ? 'Failed' : 'Completed', isError: block.result?.isError, content: resultText(block.result,block.toolName) } }); // i18n-exempt: internal tool status compared and rendered separately
    }
  }
  return messages;
}

/** Older Agents provide whole SDK history without event coordinates. Preserve
 * unmatched live content and align only on actual message or tool identity. */
export function mergeLegacyMessages(raw: any[], previous: Message[], final?: Message): Message[] {
  // Legacy entries without IDs have no cross-snapshot identity. A coordinate
  // is reusable only when the complete old response is exactly the same.
  const snapshot=JSON.stringify(raw);
  const saved=historyMessages(raw).map((message,index)=>({...message,historyStored:true,...(!message.id?{historyLegacySnapshot:snapshot,historyLegacyIndex:index}:{})}));
  const key=(message:Message):string|undefined => message.runId && message.tool?.id
    ? JSON.stringify(['tool',message.runId,message.tool.id])
    : message.id ? JSON.stringify(['message',message.runId??'',message.role,message.id])
    : message.historyLegacySnapshot===snapshot && message.historyLegacyIndex!==undefined ? JSON.stringify(['snapshot',message.historyLegacyIndex]) : undefined;
  const initialFinalKey=final&&key(final);
  const savedFinal=initialFinalKey?saved.find(message=>key(message)===initialFinalKey):undefined;
  if(final && savedFinal && savedFinal.text!==final.text){
    if(final.text.startsWith(savedFinal.text))savedFinal.text=final.text;
    else if(savedFinal.text.startsWith(final.text))savedFinal.historyRecoveryUnconfirmed=true;
    else {savedFinal.historyRecoveryUnconfirmed=true;final={...final,id:`${final.id}-result-unconfirmed`,historyRecoveryUnconfirmed:true};}
  }
  const finalKey=final&&key(final);
  if(final && !saved.some(message=>key(message)===finalKey)) {
    const last=saved.findLastIndex(message=>message.runId===final.runId);
    const finalRunId=final.runId;
    const uncertain=[...saved,...previous].some(message=>message.role==='assistant'&&!message.tool&&!!message.text&&(!message.runId||message.runId===finalRunId)&&key(message)!==finalKey);
    let position=last+1;
    if(last<0){
      const lastPrevious=previous.findLastIndex(message=>message.runId===final.runId);
      position=saved.length;
      if(lastPrevious>=0)for(const message of previous.slice(lastPrevious+1)){
        const identity=key(message),next=identity?saved.findIndex(item=>key(item)===identity):-1;
        if(next>=0){position=next;break;}
      }
    }
    saved.splice(position,0,{...final,historyStored:true,...(uncertain?{historyRecoveryUnconfirmed:true}:{}),...(last<0?{historyOrderUnconfirmed:true}:{})});
  }
  const positions=new Map<string,number>(),lastRun=new Map<string,number>();
  saved.forEach((message,index)=>{const id=key(message);if(id&&!positions.has(id))positions.set(id,index);if(message.runId)lastRun.set(message.runId,index);});
  const matches=new Map<number,number>(),conflicts=new Set<number>();
  previous.forEach((message,index)=>{
    const id=key(message),position=id?positions.get(id):undefined;if(position===undefined)return;
    const target=saved[position]!;
    if(message.tool&&target.tool){
      if(['Completed','Failed'].includes(message.tool.status)&&!['Completed','Failed'].includes(target.tool.status))target.tool=message.tool;
      matches.set(index,position);return;
    }
    if(!message.tool&&message.text!==target.text){
      if(message.text.startsWith(target.text)){target.text=message.text;target.historyStored=false;target.historyRecoveryUnconfirmed=true;}
      else if(!target.text.startsWith(message.text)){conflicts.add(index);target.historyRecoveryUnconfirmed=true;return;}
    }
    matches.set(index,position);
  });
  const following=new Array<number|undefined>(previous.length);let next:number|undefined;
  for(let i=previous.length-1;i>=0;i--){following[i]=next;const match=matches.get(i);if(match!==undefined)next=match;}
  const before=new Map<number,Message[]>();let prior:number|undefined;
  previous.forEach((message,index)=>{
    const match=matches.get(index);if(match!==undefined){prior=match;return;}
    const nextMatch=following[index],runLast=message.runId?lastRun.get(message.runId)??-1:-1;
    const boundary=nextMatch!==undefined?nextMatch:runLast>=0?Math.max((prior??-1)+1,runLast+1):saved.length;
    const ambiguous=message.role==='assistant'&&!message.tool&&!!message.text;
    const retained:Message={...message,...(conflicts.has(index)?{id:`${message.id}-live-unconfirmed`}:{}),
      ...(ambiguous?{historyRecoveryUnconfirmed:true}:{}),...((boundary>(prior??-1)+1)?{historyOrderUnconfirmed:true}:{})};
    const bucket=before.get(boundary)??[];bucket.push(retained);before.set(boundary,bucket);
  });
  return [...saved.flatMap((message,index)=>[...(before.get(index)??[]),message]),...(before.get(saved.length)??[])];
}
type ActivityGroup = { key: string; messages: Message[]; activity: boolean };
export function activityGroups(messages: Message[], previous: ActivityGroup[] = []): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  messages.forEach((message, index) => {
    if (!message.text && !message.tool && !message.images?.length && !message.pendingImages?.length) return;
    const last = groups.at(-1);
    if (message.tool && message.runId && last?.activity && last.messages[0]?.runId === message.runId) last.messages.push(message);
    else groups.push({ key: message.id ?? `${message.runId || 'legacy'}-${index}`, messages: [message], activity: !!message.tool });
  });
  // A page may prepend older calls to an already expanded Activity. Reuse its
  // identity through a surviving call, rather than changing it to the new head.
  const identity = (message: Message) => message.runId && message.tool?.id
    ? JSON.stringify([message.runId,message.tool.id])
    : message.id ? JSON.stringify([message.runId??null,message.id]) : undefined;
  const prior = new Map<string,string>();
  for(const group of previous)if(group.activity)for(const message of group.messages){const id=identity(message);if(id)prior.set(id,group.key);}
  const used = new Set<string>();
  for(const group of groups)if(group.activity){
    const retained=group.messages.map(message=>{const id=identity(message);return id?prior.get(id):undefined;}).find(key=>key!==undefined&&!used.has(key));
    if(retained!==undefined)group.key=retained;
    const base=group.key;let suffix=0;
    while(used.has(group.key))group.key=`${base}:activity-${++suffix}`;
    used.add(group.key);
  }
  return groups;
}
