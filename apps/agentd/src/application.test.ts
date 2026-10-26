import assert from "node:assert/strict";
import test from "node:test";
import { status } from "@grpc/grpc-js";
import { AgentApplication, assertAgentPeerIdentity, mcpTools, selectPackageTools, skillVisibility } from "./application.js";
import type { McpBridge } from "@piwork/pi-adapter";

const expected = "core.g3.work-11111111-1111-4111-8111-111111111111.piwork";
const peerScope = { installationId: "installation-native", workId: "work-11111111-1111-4111-8111-111111111111", generation: 3, instanceId: "agent-current" };
const peerUri = "URI:spiffe://piwork/installation/installation-native/work/work-11111111-1111-4111-8111-111111111111/generation/3/instance/agent-current/role/core-client";

test("agent mTLS peer verification rejects plaintext, wrong Work, and stale generation identities", () => {
  assert.doesNotThrow(() => assertAgentPeerIdentity({
    transportSecurityType: "ssl",
    sslPeerCertificate: { subject: { CN: expected }, subjectaltname: `${peerUri}` },
  }, expected, peerScope));

  for (const context of [
    { transportSecurityType: "insecure" },
    { transportSecurityType: "ssl", sslPeerCertificate: { subject: { CN: "core.g3.work-other.piwork" } } },
    { transportSecurityType: "ssl", sslPeerCertificate: { subject: { CN: "core.g2.work-11111111-1111-4111-8111-111111111111.piwork" } } },
    ...["", peerUri.replace("installation-native", "installation-other"), peerUri.replace("work-11111111-1111-4111-8111-111111111111", "work-other"),
      peerUri.replace("generation/3", "generation/2"), peerUri.replace("agent-current", "agent-other"), peerUri.replace("core-client", "agent-service-client"), `${peerUri}, ${peerUri}`]
      .map((subjectaltname) => ({ transportSecurityType: "ssl", sslPeerCertificate: { subject: { CN: expected }, subjectaltname } })),
  ]) {
    assert.throws(
      () => assertAgentPeerIdentity(context, expected, peerScope),
      (error) => (error as { code?: number }).code === status.UNAUTHENTICATED,
    );
  }
});

test("Skill model visibility preserves metadata precedence and effective read policy", () => {
  assert.deepEqual(skillVisibility(true, []), {
    modelVisible: false,
    visibilityReason: "model-invocation-disabled",
  });
  assert.deepEqual(skillVisibility(false, []), {
    modelVisible: false,
    visibilityReason: "read-tools-disabled",
  });
  assert.deepEqual(skillVisibility(false, ["read"]), {
    modelVisible: true,
    visibilityReason: "",
  });
});

test("retained Work tool policy hides a denied built-in service tool", () => {
  const tools = ["service_list", "service_stop", "operation_get"].map((name) => ({ serverId: "work-services", name,
    namespacedName: `work-services.${name}`, modelName: `work-services__${name}`, inputSchema: {} }));
  const bridge = { listTools: () => tools } as unknown as McpBridge;
  assert.deepEqual(mcpTools(bridge, { allowed: [], denied: ["work-services.service_stop"] }).map((tool) => tool.canonicalName),
    ["work-services.service_list", "work-services.operation_get"]);
  assert.deepEqual(mcpTools({ listTools: () => [] } as unknown as McpBridge, { allowed: [], denied: [] }), []);
});

test("temporary Service tools bind the actual Run and fail closed when capability or policy is absent", async () => {
  const discovered = { serverId: "work-services", name: "service_create", namespacedName: "work-services.service_create", modelName: "work-services__service_create", inputSchema: {} };
  const calls: Array<{ args: unknown; metadata: unknown }> = [];
  const bridge = { listTools: () => [discovered], async callTool(_name: string, args: unknown, metadata: unknown) { calls.push({ args, metadata }); return { content: [{ type: "text", text: "accepted" }] }; } } as unknown as McpBridge;
  let supported = false, opens = 0;
  const control = { async temporaryServicesSupported() { return supported; }, async openTemporaryRunLease(runId: string) { opens++; assert.equal(runId, "run-actual"); return "lease-private"; } };
  const attempted = new Set<string>();
  const run = { workId: "work-actual", sessionId: "session-actual", runId: "run-actual", prompt: "probe", signal: new AbortController().signal, emit() {} };
  const context = { run, generation: 3, instanceId: "agent-current", control, attempted };
  assert.equal(mcpTools(bridge, { allowed: [], denied: ["work-services.service_create"] }, context).length, 0);
  const tool = mcpTools(bridge, { allowed: [], denied: [] }, context)[0]!.definition;
  const execute = tool.execute as (...args: any[]) => Promise<any>;
  const unavailable = await execute("call-1", { temporaryMode: "once" });
  assert.equal(unavailable.details.isError, true);
  assert.equal(opens, 0); assert.equal(calls.length, 0); assert.equal(attempted.size, 0);
  supported = true;
  const result = await execute("call-2", { temporaryMode: "once" });
  assert.equal(result.details.isError, false);
  assert.deepEqual(calls[0]!.metadata, { "piwork.run": { runId: "run-actual", generation: "3", instanceId: "agent-current", leaseId: "lease-private" } });
  assert.deepEqual([...attempted], ["run-actual"]);
  assert.equal(JSON.stringify(result).includes("lease-private"), false);
  await execute("call-3", { definition: {}, idempotencyKey: "ordinary" });
  assert.equal(calls[1]!.metadata, undefined);
});

test("package tool policy maps canonical keys to native SDK names with deny precedence", () => {
  const tools = new Map([["package:@example/tools:hello", "hello"], ["package:@example/tools:other", "other"]]);
  assert.deepEqual(selectPackageTools(tools, { allowed: [], denied: ["package:@example/tools:other"] }, new Set(["read"])),
    [["package:@example/tools:hello", "hello"]]);
  assert.deepEqual(selectPackageTools(tools, { allowed: ["package:@example/tools:hello"], denied: ["package:@example/tools:hello"] }, new Set()), []);
  assert.throws(() => selectPackageTools(tools, { allowed: [], denied: [] }, new Set(["hello"])), /conflicts with existing tool/);
});


test("Retry lookup RPC authenticates the original scope and never wakes or submits",async()=>{
  let reads=0;
  const app=Object.create(AgentApplication.prototype) as any;
  app.installationId=peerScope.installationId;
  app.config={...peerScope,tls:{expectedClientCommonName:expected}};
  app.store={feedback:{
    lookupRetrySubmission:(work:string,id:string,key:string)=>{reads++;assert.equal(work,peerScope.workId);assert.equal(id,"original");assert.equal(key,"original-key");return undefined;},
    retry:()=>assert.fail("readback must not Retry"),
  }};
  app.brainLoop={wake:()=>assert.fail("readback must not wake processing")};
  app.runs={submit:()=>assert.fail("readback must not submit a Run")};
  const auth={transportSecurityType:"ssl",sslPeerCertificate:{subject:{CN:expected},subjectaltname:peerUri}};
  const handler=app.handlers().lookupAgentRequestRetrySubmission;
  const invoke=(request:unknown,identity=auth)=>new Promise<any>((resolve,reject)=>handler({request,getAuthContext:()=>identity},(error:unknown,value:unknown)=>error?reject(error):resolve(value)));
  const query={workId:peerScope.workId,objectId:"original",inputJson:JSON.stringify({submissionKey:"original-key"})};
  const result=JSON.parse((await invoke(query)).valueJson);
  assert.deepEqual({...result,checkedAt:undefined},{workId:peerScope.workId,requestId:"original",submissionKey:"original-key",status:"not-found",request:null,checkedAt:undefined});
  await assert.rejects(invoke({...query,workId:"work-foreign"}),(error:any)=>error.code===status.PERMISSION_DENIED);
  await assert.rejects(invoke({...query,inputJson:'{"submissionKey":""}'}),(error:any)=>error.code===status.INVALID_ARGUMENT);
  const stale={...auth,sslPeerCertificate:{...auth.sslPeerCertificate,subjectaltname:peerUri.replace("generation/3","generation/2")}};
  await assert.rejects(invoke(query,stale),(error:any)=>error.code===status.UNAUTHENTICATED);
  assert.equal(reads,1);
});
