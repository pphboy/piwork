import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { PersistentSession } from "./session-persistence.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "session-process.js");

test("the SDK reloads the same session ID and history in another process", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-sdk-session-"));
  const cwd = join(root, "workspace");
  const sessionRoot = join(root, "sessions");
  await mkdir(cwd, { recursive: true });

  try {
    const created = runFixture(["create", cwd, sessionRoot, "-", "first turn"]);
    const loaded = runFixture(["load", cwd, sessionRoot, created.sessionId, "second turn"]);

    assert.equal(loaded.sessionId, created.sessionId);
    assert.equal(loaded.historyPath, created.historyPath);
    assert.deepEqual(
      loaded.entries.map(({ role, text }) => ({ role, text })),
      [
        { role: "user", text: "first turn" },
        { role: "assistant", text: "ack:first turn" },
        { role: "user", text: "second turn" },
        { role: "assistant", text: "ack:second turn" },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runFixture(args: readonly string[]): PersistentSession {
  const result = spawnSync(process.execPath, [fixture, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as PersistentSession;
}

test('ordered public blocks follow ancestor Run markers and bound UTF-8 previews without changing SDK originals',async()=>{
 const {initializePersistentSession,appendUserMessage,appendAssistantMessage,readPersistentSession}=await import('./session-persistence.js');
 const {readFile}=await import('node:fs/promises');const root=await mkdtemp(join(tmpdir(),'piwork-blocks-'));await mkdir(join(root,'workspace'));
 try {const initial=initializePersistentSession({cwd:join(root,'workspace'),sessionRoot:join(root,'sessions')});const {SessionManager}=await import('@earendil-works/pi-coding-agent');const session=SessionManager.open(initial.getSessionFile()!,join(root,'sessions'),join(root,'workspace'));
  appendUserMessage(session,'legacy');session.appendCustomEntry('piwork-run',{runId:'run-1'});appendUserMessage(session,'new prompt');
  session.appendMessage({role:'assistant',content:[{type:'text',text:'before'},{type:'toolCall',id:'call-1',name:'read',arguments:{path:'/private/argument'}},{type:'text',text:'after'}],api:'openai-completions',provider:'fixture',model:'one',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:Date.now()});
  const full='汉'.repeat(30000);session.appendMessage({role:'toolResult',toolCallId:'call-1',toolName:'read',content:[{type:'text',text:full}],isError:false,timestamp:Date.now()});
  appendAssistantMessage(session,'done');session.appendCustomEntry('piwork-run',{runId:42});appendUserMessage(session,'invalid marker');
  const entries=readPersistentSession(session).entries;assert.equal(entries[0]?.runId,undefined);assert.equal(entries[1]?.runId,'run-1');assert.deepEqual(entries[2]?.blocks.map(b=>b.type),['text','tool-call','text']);
  const result=entries[3]!.blocks[0]!;assert.equal(result.type,'tool-result');if(result.type==='tool-result' && result.result.kind==='text'){assert.ok(Buffer.byteLength(result.result.text)<=65536);assert.equal(result.result.truncated,true);assert.ok(!result.result.text.includes('\ufffd'));}
  assert.equal(entries.at(-1)?.runId,'');assert.doesNotMatch(JSON.stringify(entries),/private\/argument/);assert.ok((await readFile(session.getSessionFile()!,'utf8')).includes(full));
 }finally{await rm(root,{recursive:true,force:true});}
});
