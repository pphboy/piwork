// Acceptance fixture only: real SDK writes, Python tests, Service and browser.
import {dirname,resolve} from "node:path";
import type {AssistantMessage,AssistantMessageEventStream,TranscriptContext} from "@earendil-works/pi-ai";
import {modelMcpToolName} from "./mcp-bridge.js";

const SPEC=`# Kanban Spec
## Intent
Create a small board and move card A through its columns using UI or Agent.
## Objects
Card A, column and monotonic state version.
## State
SQLite is authoritative. Initial column Todo; allowed columns Todo, Doing, Done.
## Business Flow
Read board -> move with stable Action ID and expected version -> read actual board.
## Agent-operable Capabilities
Query board; Action move; read original Action result. UI calls the same Board.move.
## Implementation Map
apps/kanban/app.py: Board.query, Board.move, Handler; columns.json: allowed columns/codeVersion.
apps/kanban/test_kanban.py: mutation, replay, conflict and rejected-column checks.
## Acceptance Criteria
UI and Agent move the same A. Replay does not duplicate changes; stale versions and invalid columns preserve state.
Run affected Python tests and query actual Service; readiness alone does not prove completion.
`;
const APP=String.raw`import json,os,uuid,subprocess,sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from piwork_protocol import WorkProtocol,ProtocolError,now

class Board:
 def __init__(self,directory,code,identity=None):
  Path(directory).mkdir(parents=True,exist_ok=True);self.code=Path(code)
  self.protocol=WorkProtocol(Path(directory)/'board.sqlite','kanban-v1',identity=identity)
  with self.protocol.transaction() as db:
   db.executescript("CREATE TABLE IF NOT EXISTS board(id INTEGER PRIMARY KEY,column TEXT NOT NULL,version INTEGER NOT NULL);INSERT OR IGNORE INTO board VALUES(1,'Todo',1);")
 def config(self):return json.loads((self.code/'columns.json').read_text())
 def state(self,db):return str(db.execute('SELECT version FROM board').fetchone()[0])
 def query(self,value):
  with self.protocol.transaction() as db:
   row=db.execute('SELECT column,version FROM board').fetchone()
   return {'stateVersion':str(row['version']),'codeVersion':self.config()['codeVersion'],'observedAt':now(),'value':{'A':row['column']},'checks':[{'name':'column_matches','passed':'column' not in value or row['column']==value['column'],'summary':'Read authoritative card A'}]}
 def move(self,action_id,value,expected):
  self.protocol.code_version=self.config()['codeVersion']
  def handler(db):
   if set(value)!={'column'} or value['column'] not in self.config()['columns']:raise ProtocolError('COLUMN_INVALID',400)
   db.execute('UPDATE board SET column=?,version=version+1 WHERE id=1',(value['column'],))
   return {'state':'succeeded','result':{'A':value['column']},'jobId':None}
  return self.protocol.action('move',action_id,value,expected,self.state,handler)
 def test(self,mode):
  names={'initial':['test_kanban.KanbanTests.test_move','test_kanban.KanbanTests.test_reject'],'review':['test_kanban.KanbanTests.test_review'],'all':['test_kanban']}[mode]
  result=subprocess.run([sys.executable,'-m','unittest',*names],cwd=self.code,text=True,capture_output=True,timeout=10)
  state=self.query({})
  return {**state,'value':{'exitCode':result.returncode,'output':result.stderr[-8192:]},'checks':[{'name':'unit_tests_passed','passed':result.returncode==0,'summary':'Actual Python unittest exit code '+str(result.returncode)}]}
 def capabilities(self):
  obj={'type':'object','properties':{'column':{'type':'string','enum':self.config()['columns']}},'additionalProperties':False}
  action={**obj,'required':['column']}
  return {'contractVersion':1,'logicalServiceName':'kanban','codeVersion':self.config()['codeVersion'],'stateVersion':self.query({})['stateVersion'],'queries':{'board':{'inputSchema':obj,'description':'Read card A'},'selftest':{'inputSchema':{'type':'object','properties':{'mode':{'type':'string','enum':['initial','review','all']}},'required':['mode'],'additionalProperties':False},'description':'Acceptance fixture runs its existing Python unittest cases'}},'actions':{'move':{'inputSchema':action,'description':'Move card A','mutation':True,'requiresExpectedStateVersion':True,'verificationQuery':'board','mode':'sync','maxWaitMs':60000}},'events':{'facts':[],'requestReasons':[]},'jobs':False}

class Handler(BaseHTTPRequestHandler):
 def send(self,value,status=200):
  raw=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(raw)
 def authorized(self):
  if self.path.startswith('/pi/') and not board.protocol.authorized(self.headers.get('Authorization')):raise ProtocolError('SERVICE_AUTH_REQUIRED',401)
 def do_GET(self):
  try:
   self.authorized()
   if self.path=='/':
    self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<title>Kanban</title><div id="card"></div><button id="move">Move A to Doing</button><script>async function refresh(){card.textContent=(await(await fetch("/ui/board")).json()).value.A}move.onclick=async()=>{await fetch("/ui/move",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({column:"Doing"})});await refresh()};refresh()</script>');return
   if self.path=='/health':self.send({'ready':True})
   elif self.path=='/pi/v1/capabilities':self.send(board.capabilities())
   elif self.path=='/ui/board':self.send(board.query({}))
   elif self.path.startswith('/pi/v1/actions/'):self.send(board.protocol.action_get(self.path.split('/')[-1]))
   else:self.send({'code':'NOT_FOUND'},404)
  except ProtocolError as e:self.send({'code':e.code},e.status)
 def do_POST(self):
  try:
   self.authorized();size=int(self.headers.get('Content-Length',0))
   if size>8192:raise ProtocolError('INPUT_TOO_LARGE',413)
   body=json.loads(self.rfile.read(size))
   if self.path=='/ui/move':self.send(board.move('ui-'+uuid.uuid4().hex,body,board.query({})['stateVersion']))
   elif self.path=='/pi/v1/actions/move':self.send(board.move(body['actionId'],body['input'],body.get('expectedStateVersion')))
   elif self.path=='/pi/v1/queries/board':self.send(board.query(body['input']))
   elif self.path=='/pi/v1/queries/selftest':self.send(board.test(body['input']['mode']))
   else:self.send({'code':'NOT_FOUND'},404)
  except ProtocolError as e:self.send({'code':e.code},e.status)
if __name__=='__main__':
 board=Board('/var/data/workspace/data/kanban',Path(__file__).parent)
 ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
`;
const TEST=String.raw`import unittest,tempfile,json
from pathlib import Path
from app import Board,ProtocolError
class KanbanTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.board=Board(self.temp.name,Path(__file__).parent,{'contractVersion':1,'workId':'work-unit-fixture','serviceId':'service-unit-fixture','serviceName':'kanban','token':'a'*64})
 def test_move(self):
  first=self.board.move('move-a',{'column':'Doing'},'1');self.assertEqual(first['state'],'succeeded')
  self.assertEqual(self.board.move('move-a',{'column':'Doing'},'1'),first)
  self.assertEqual(self.board.query({})['value']['A'],'Doing')
  self.assertEqual(self.board.move('stale',{'column':'Done'},'1')['state'],'failed')
  self.assertEqual(self.board.query({})['stateVersion'],'2')
 def test_reject(self):
  with self.assertRaises(ProtocolError):self.board.move('bad',{'column':'missing'},'1')
  self.assertEqual(self.board.query({})['value']['A'],'Todo')
 def test_review(self):
  self.assertEqual(self.board.move('review',{'column':'Review'},'1')['state'],'succeeded')
  self.assertTrue(self.board.query({'column':'Review'})['checks'][0]['passed'])
`;
type Result=Extract<TranscriptContext['messages'][number],{role:'toolResult'}>;
const value=(result:Result|undefined):any=>{try{return JSON.parse(result?.content.flatMap(p=>p.type==='text'?[p.text]:[]).join('')??'{}')}catch{return {}}};
export function deterministicKanban(stream:AssistantMessageEventStream,output:AssistantMessage,results:readonly Result[],skill:string,prompt:string):boolean{
 if(!['deploy deterministic kanban','modify deterministic kanban'].includes(prompt)&&!prompt.startsWith('move deterministic kanban card '))return false;
 const call=(name:string,args:Record<string,unknown>)=>{const toolCall={type:'toolCall' as const,id:`kanban-${results.length}`,name,arguments:args as any};output.content.push(toolCall);output.stopReason='toolUse';stream.push({type:'toolcall_start',contentIndex:0,partial:output});stream.push({type:'toolcall_end',contentIndex:0,toolCall,partial:output});stream.push({type:'done',reason:'toolUse',message:output});stream.end()};
 const end=(text:string)=>{output.content.push({type:'text',text});output.stopReason='stop';stream.push({type:'text_start',contentIndex:0,partial:output});stream.push({type:'text_delta',contentIndex:0,delta:text,partial:output});stream.push({type:'text_end',contentIndex:0,content:text,partial:output});stream.push({type:'done',reason:'stop',message:output});stream.end()};
 const seen=(name:string)=>results.find(r=>r.toolName===name),writes=results.filter(r=>r.toolName==='write'),commands=results.filter(r=>r.toolName==='bash'),queries=results.filter(r=>r.toolName==='brain_service');
 if(prompt==='deploy deterministic kanban'){
  if(!seen('read'))call('read',{path:skill});
  else if(!writes.length)call('write',{path:'apps/kanban/SPEC.md',content:SPEC});
  else if(writes.length===1)call('write',{path:'apps/kanban/app.py',content:APP});
  else if(writes.length===2)call('write',{path:'apps/kanban/test_kanban.py',content:TEST});
  else if(writes.length===3)call('write',{path:'apps/kanban/columns.json',content:JSON.stringify({codeVersion:'kanban-v1',columns:['Todo','Doing','Done']})});
  else if(!commands.length)call('bash',{command:`cp '${resolve(dirname(skill),'../../templates/workstation/piwork_protocol.py')}' apps/kanban/ && mkdir -p data/kanban .pi/services && printf '%s' '{"contractVersion":1,"serviceName":"kanban","apiPortName":"web","mode":"pi-managed"}' > .pi/services/kanban.json`});
  else if(!seen(modelMcpToolName('work-services','service_create')))call(modelMcpToolName('work-services','service_create'),{definition:{name:'kanban',image:{reference:'piwork-workstation:acceptance'},command:'python',args:['-u','app.py'],environment:{PYTHONDONTWRITEBYTECODE:'1'},secretRefs:[],workingDirectory:'/var/data/workspace/apps/kanban',mounts:[{source:'workspace',target:'/var/data/workspace',readOnly:false}],ports:[{name:'web',containerPort:8080,protocol:'tcp'}],cpuMillis:500,memoryBytes:268435456,enabled:true,required:false,readiness:{kind:'http',portName:'web',path:'/health',deadlineMs:60000,timeoutMs:2000},restartPolicy:'bounded'},idempotencyKey:'deterministic-kanban'});
  else if(!seen(modelMcpToolName('work-services','operation_get'))||['pending','running'].includes(value(results.filter(r=>r.toolName===modelMcpToolName('work-services','operation_get')).at(-1)).state))call(modelMcpToolName('work-services','operation_get'),{operationId:value(seen(modelMcpToolName('work-services','service_create'))).operationId});
  else if(!seen('brain_service'))call('brain_service',{operation:'query',serviceName:'kanban',name:'selftest',input:{mode:'initial'}});
  else if(results.filter(r=>r.toolName==='brain_service').length===1)call('brain_service',{operation:'query',serviceName:'kanban',name:'board',input:{column:'Todo'}});
  else end('kanban-runnable');
 }else if(prompt==='modify deterministic kanban'){
  if(!seen('read'))call('read',{path:'apps/kanban/SPEC.md'});
  else if(!writes.length)call('write',{path:'apps/kanban/SPEC.md',content:SPEC.replace('Todo, Doing, Done.','Todo, Doing, Done, Review.').replace('Run affected Python tests','A can move to Review. Run affected Python tests')});
  else if(!queries.length)call('brain_service',{operation:'query',serviceName:'kanban',name:'selftest',input:{mode:'review'}});
  else if(writes.length===1)call('write',{path:'apps/kanban/columns.json',content:JSON.stringify({codeVersion:'kanban-v2',columns:['Todo','Doing','Done','Review']})});
  else if(queries.length===1)call('brain_service',{operation:'query',serviceName:'kanban',name:'selftest',input:{mode:'all'}});
  else end('kanban-modified-tests-passed');
 }else{
  const column=prompt.slice('move deterministic kanban card '.length),tools=results.filter(r=>r.toolName==='brain_service');
  if(!tools.length)call('brain_service',{operation:'discover',serviceName:'kanban'});
  else if(tools.length===1)call('brain_service',{operation:'query',serviceName:'kanban',name:'board',input:{}});
  else if(tools.length===2)call('brain_service',{operation:'action',serviceName:'kanban',name:'move',id:`agent-move-${column}`,input:{column},expectedStateVersion:value(tools[1]).result.stateVersion});
  else if(tools.length===3)call('brain_service',{operation:'query',serviceName:'kanban',name:'board',input:{column}});
  else if(!seen('brain_feedback'))call('brain_feedback',{operation:'finish',state:'completed',result:`Card A is actually in ${column}`,evidenceIds:[value(tools[3]).evidence.evidenceId]});
  else end(`kanban-card:${value(tools[3]).result.value.A}`);
 }
 return true;
}
