import { dirname, resolve } from "node:path";
import type { AssistantMessage, AssistantMessageEventStream, TranscriptContext } from "@earendil-works/pi-ai";
import { modelMcpToolName } from "./mcp-bridge.js";

type Result = Extract<TranscriptContext["messages"][number], { role: "toolResult" }>;
const text = (result: Result) => result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
function value(result: Result | undefined): Record<string, any> { try { return result ? JSON.parse(text(result)) : {}; } catch { return {}; } }
function call(stream: AssistantMessageEventStream, output: AssistantMessage, name: string, args: Record<string, unknown>, count: number): void {
  const toolCall = { type: "toolCall" as const, id: `workstation-${count}`, name, arguments: args as any };
  output.content.push(toolCall); stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
  stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output }); output.stopReason = "toolUse";
  stream.push({ type: "done", reason: "toolUse", message: output }); stream.end();
}
function finish(stream: AssistantMessageEventStream, output: AssistantMessage, message: string): void {
  output.content.push({ type: "text", text: message }); stream.push({ type: "text_start", contentIndex: 0, partial: output });
  stream.push({ type: "text_delta", contentIndex: 0, delta: message, partial: output }); stream.push({ type: "text_end", contentIndex: 0, content: message, partial: output });
  output.stopReason = "stop"; stream.push({ type: "done", reason: "stop", message: output }); stream.end();
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const verificationTarget = (key: string) => ({ contractVersion: 1, toolName: "package:piwork-brain:brain_review_probe",
  input: { serviceName: "workstation", expectedPrefix: `${key}: ` }, checkNames: ["completed_review", "review_format"] });
function candidateEdit(key: string, badBehavior: boolean): string {
  const probe = `import { callHost } from './brain.js';
export default function(pi) {
  pi.registerTool({name:'brain_review_probe',label:'Review format',description:'Render and check the actual completed review',
    parameters:{type:'object',properties:{serviceName:{type:'string'},expectedPrefix:{type:'string'}},required:['serviceName','expectedPrefix'],additionalProperties:false},
    async execute(_id,input,signal) {
      const actual=await callHost('brain_service',{operation:'query',serviceName:input.serviceName,name:'review',input:{}},signal);
      const titles=actual.result.value.completed.map(row=>row.title);
      const rendered=titles.map(title=>${JSON.stringify(`${key}: `)}+title.${badBehavior ? "toLowerCase" : "toUpperCase"}());
      const checks=[{name:'completed_review',passed:actual.result.checks.every(c=>c.passed)&&titles.length>0,summary:'Actual completed Todos were read'},
        {name:'review_format',passed:rendered.every((line,n)=>line===input.expectedPrefix+titles[n].toUpperCase()),summary:'Actual rendered review matches the requested new format'}];
      return {content:[{type:'text',text:JSON.stringify({rendered,checks})}],details:{rendered,checks}};
    }});
}`;
  const script = `const fs=require('node:fs');const root='.pi/packages/piwork-brain/';
fs.writeFileSync(root+'extensions/review-probe.js',${JSON.stringify(probe)});
const manifest=JSON.parse(fs.readFileSync(root+'package.json','utf8'));manifest.pi.extensions=[...new Set([...manifest.pi.extensions,'extensions/review-probe.js'])];fs.writeFileSync(root+'package.json',JSON.stringify(manifest));
fs.appendFileSync(root+'brain.md','\\nWorkstation candidate cognition: always verify completed Todos.\\n');`;
  return `node -e ${shellQuote(script)}`;
}

/** Deterministic acceptance behavior exercises the real SDK tools and business protocol. */
export function deterministicWorkstation(stream: AssistantMessageEventStream, output: AssistantMessage, results: readonly Result[], skill: string, prompt: string): boolean {
  const invoke = (name: string, args: Record<string, unknown>) => call(stream, output, name, args, results.length);
  const previous = (name: string) => results.find((result) => result.toolName === name);
  const end = (message: string) => finish(stream, output, message);
  if (prompt === "inspect deterministic sqlite3") {
    if (!previous("bash")) invoke("bash", { command: "sqlite3 --version && sqlite3 -json /var/data/workspace/data/workstation/workstation.sqlite 'SELECT count(*) AS count FROM todos;'" });
    else end("sqlite3-verified:" + text(previous("bash")!));
    return true;
  }
  if (prompt === "add deterministic workstation Todo") {
    const queries = results.filter(result => result.toolName === "brain_service");
    if (!queries.length) invoke("brain_service", { operation: "query", serviceName: "workstation", name: "todos", input: {} });
    else if (queries.length === 1) invoke("brain_service", { operation: "action", serviceName: "workstation", name: "todo_add", id: "agent-live-todo", input: { title: "Agent live Todo" }, expectedStateVersion: value(queries[0]).result.stateVersion });
    else if (queries.length === 2) invoke("brain_service", { operation: "verify", serviceName: "workstation", name: "todos", input: {} });
    else if (!previous("brain_feedback")) {
      const proof = value(queries[2]);
      if (!proof.evidence?.verified || !proof.result?.value.some((row: any) => row.title === "Agent live Todo")) end("workstation-live-todo-unverified");
      else invoke("brain_feedback", { operation: "finish", state: "completed", result: "Agent Todo added and verified", evidenceIds: [proof.evidence.evidenceId] });
    } else end("workstation-live-todo-verified");
    return true;
  }
  if (/^update deterministic workstation (frontend|backend) [A-Za-z0-9-]+$/.test(prompt)) {
    const kind = prompt.split(" ")[3]!, key = prompt.split(" ").at(-1)!;
    const reads = results.filter(result => result.toolName === "read");
    if (!reads.length) invoke("read", { path: "apps/workstation/SPEC.md" });
    else if (!previous("write")) invoke("write", { path: "apps/workstation/SPEC.md", content: text(reads[0]!) + `\nAcceptance update: verify the actual ${kind} version and automatic page adoption.\n` });
    else if (!previous("bash")) {
      const script = kind === "frontend"
        ? `const fs=require('fs');const p='apps/workstation/frontend/src/App.tsx';fs.copyFileSync(p,'apps/workstation/.build/App.checkpoint.tsx');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('Personal workstation','Updated workstation'));`
        : `const fs=require('fs');const p='apps/workstation/review_config.json';fs.copyFileSync(p,'apps/workstation/.build/review.checkpoint.json');const v=JSON.parse(fs.readFileSync(p,'utf8'));v.includeCompleted=true;v.codeVersion='workstation-v2';fs.writeFileSync(p,JSON.stringify(v));`;
      invoke("bash", { command: `node -e ${shellQuote(script)}` });
    } else if (!previous(modelMcpToolName("work-services", "service_list"))) invoke(modelMcpToolName("work-services", "service_list"), {});
    else if (!previous(modelMcpToolName("work-services", "service_restart"))) {
      const service = value(previous(modelMcpToolName("work-services", "service_list"))).services.find((item: any) => item.name === "workstation");
      invoke(modelMcpToolName("work-services", "service_restart"), { serviceId: service.serviceId, idempotencyKey: `web-${kind}-${key}` });
    } else {
      const operation = results.filter(result => result.toolName === modelMcpToolName("work-services", "operation_get")).at(-1);
      if (!operation || ["pending", "running"].includes(value(operation).state)) {
        if (operation && results.at(-1)?.toolName !== "bash") invoke("bash", { command: "sleep 0.5" });
        else invoke(modelMcpToolName("work-services", "operation_get"), { operationId: value(previous(modelMcpToolName("work-services", "service_restart"))).operationId });
      } else if (value(operation).state !== "succeeded") end(`workstation-${kind}-deployment-failed`);
      else if (reads.length === 1) invoke("read", { path: "apps/workstation/.build/checks.json" });
      else if (!value(reads[1]).passed) end(`workstation-${kind}-checks-failed`);
      else if (!previous("brain_service")) invoke("brain_service", { operation: "query", serviceName: "workstation", name: kind === "frontend" ? "todos" : "review", input: {} });
      else {
        const actual = value(previous("brain_service"));
        if (actual.result?.codeVersion !== value(reads[1]).codeVersion || !actual.evidence?.verified) end(`workstation-${kind}-version-unverified`);
        else end(`workstation-${kind}-updated:${actual.result.codeVersion}`);
      }
    }
    return true;
  }
  if (prompt === "hold workstation slot") {
    if (!previous("bash")) invoke("bash", { command: "sleep 6" }); else end("workstation-slot-released");
    return true;
  }
  if (prompt === "reset workstation review") {
    if (!previous("bash")) invoke("bash", { command: 'node -e \'const fs=require("node:fs");const p="apps/workstation/review_config.json";const v=JSON.parse(fs.readFileSync(p,"utf8"));v.includeCompleted=false;v.codeVersion="workstation-v1";fs.writeFileSync(p,JSON.stringify(v));\'' });
    else end("workstation-review-reset"); return true;
  }
  if (prompt === "restore workstation brain source") {
    if (!previous("bash")) invoke("bash", { command: "cp .pi/brain-extension.checkpoint.js .pi/packages/piwork-brain/extensions/brain.js" });
    else end("workstation-brain-source-restored"); return true;
  }
  if (/^configure workstation export wait \d+$/.test(prompt)) {
    const ms = Number(prompt.split(" ").at(-1));
    if (!previous("bash")) invoke("bash", { command: `node -e 'const fs=require("node:fs");const p="apps/workstation/review_config.json";const v=JSON.parse(fs.readFileSync(p,"utf8"));v.exportWaitMs=${ms};fs.writeFileSync(p,JSON.stringify(v));'` });
    else end("workstation-export-wait-configured"); return true;
  }
  if (/^configure workstation recovery (terminal|running|unprovable|reset)$/.test(prompt)) {
    const mode = prompt.split(" ").at(-1)!;
    const script = `const fs=require('node:fs');const p='apps/workstation/review_config.json';const v=JSON.parse(fs.readFileSync(p,'utf8'));v.exportDelayMs=${mode === "terminal" ? 1 : mode === "running" ? 20000 : 8000};v.unavailableOriginalAction=${mode === "unprovable"};fs.writeFileSync(p,JSON.stringify(v));`;
    if (!previous("bash")) invoke("bash", { command: `node -e ${shellQuote(script)}` });
    else end("workstation-recovery-configured"); return true;
  }
  if (/^prove workstation (action idempotency|state conflict) /.test(prompt)) {
    const conflict = prompt.includes("state conflict"), key = prompt.split(" ").at(-1)!;
    const actions = results.filter(result => result.toolName === "brain_service");
    if (!actions.length) invoke("brain_service", { operation: "query", serviceName: "workstation", name: "todos", input: {} });
    else if (actions.length < 3) invoke("brain_service", { operation: "action", serviceName: "workstation", name: "todo_add", id: `proof-${key}`,
      input: { title: `Original Action ${key}` }, expectedStateVersion: conflict ? "-1" : value(actions[0]).result.stateVersion });
    else if (actions.length === 3) invoke("brain_service", { operation: "verify", serviceName: "workstation", name: "todos", input: {} });
    else if (!previous("brain_feedback")) invoke("brain_feedback", { operation: "finish", state: conflict ? "needs_attention" : "completed",
      result: conflict ? "Original Action rejected with ACTION_STATE_CONFLICT; no business effect" : "Repeated original Action reconciled and actual Todo state verified", evidenceIds: [value(actions.at(-1)).evidence.evidenceId] });
    else end(conflict ? "workstation-conflict-verified" : "workstation-idempotency-verified"); return true;
  }
  if (prompt.startsWith("Piwork CoreFlow request ") && prompt.includes("phase=adopting")) {
    const feedback = results.filter(result => result.toolName === "brain_feedback");
    const target = JSON.parse(prompt.match(/Fixed verification target: (.+)\n/)![1]!) as { toolName: string; input: Record<string, unknown> };
    const toolName = target.toolName.split(":").at(-1)!;
    if (!previous(toolName)) invoke(toolName, target.input);
    else if (!feedback.length) invoke("brain_feedback", { operation: "request_get" });
    else if (value(feedback[0]).request.state === "needs_attention") end("workstation-brain-behavior-needs-attention");
    else if (feedback.length === 1) invoke("brain_feedback", { operation: "finish", state: "completed", result: "Actual SDK candidate capability verified",
      evidenceIds: value(feedback[0]).evidence.items.filter((item: any) => item.kind === "sdk" && item.verified).map((item: any) => item.evidenceId) });
    else end("workstation-brain-adopted");
    return true;
  }
  if (prompt === "deploy deterministic workstation" || prompt === "deploy published workstation") {
    const published = prompt === "deploy published workstation";
    const reads = results.filter((result) => result.toolName === "read");
    if (!skill) { end("workstation-deployment-failed:skill-unavailable"); return true; }
    const brain = resolve(dirname(skill), "../..");
    if (!reads.length) invoke("read", { path: skill });
    else if (reads.length === 1) invoke("read", { path: resolve(brain, "references/service-contract.md") });
    else if (reads.length === 2) invoke("read", { path: resolve(brain, "templates/workstation/SPEC.md") });
    else if (published && reads.length === 3) invoke("read", { path: resolve(brain, "references/web-base.json") });
    else if (published && (value(reads[3]).state !== "published" || !/@sha256:[a-f0-9]{64}$/.test(value(reads[3]).reference || ''))) end('workstation-deployment-failed:published-base-unavailable');
    else if (!previous("bash")) invoke("bash", { command: `node ${shellQuote(resolve(brain, 'skills/deploy-work-service/initialize.mjs'))} --template workstation --name workstation` });
    else if (previous("bash")!.isError || !text(previous("bash")!).includes('"initialized":true')) end("workstation-deployment-failed:initialization-refused");
    else if (!previous(modelMcpToolName("work-services", "deployment_context"))) invoke(modelMcpToolName("work-services", "deployment_context"), {});
    else if (!previous(modelMcpToolName("work-services", "service_create"))) invoke(modelMcpToolName("work-services", "service_create"), {
      definition: { name: "workstation", image: { reference: published ? value(reads[3]).reference : "piwork-workstation:acceptance" }, command: "/usr/local/bin/piwork-web",
        args: ["run", "--app", "/var/data/workspace/apps/workstation"],
        environment: { PYTHONDONTWRITEBYTECODE: "1" }, secretRefs: [], workingDirectory: "/var/data/workspace", mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
        ports: [{ name: "web", containerPort: 8080, protocol: "tcp" }], cpuMillis: 500, memoryBytes: 0, enabled: true, required: false,
        readiness: { kind: "http", portName: "web", path: "/health", deadlineMs: 120000, timeoutMs: 2000 }, restartPolicy: "bounded" }, idempotencyKey: "deterministic-workstation-v1" });
    else {
      const receipt = value(previous(modelMcpToolName("work-services", "service_create")));
      const observed = results.filter((result) => result.toolName === modelMcpToolName("work-services", "operation_get")).at(-1);
      if (observed && ["pending", "running"].includes(value(observed).state) && results.at(-1)?.toolName !== "bash") invoke("bash", { command: "sleep 0.5" });
      else if (!observed || ["pending", "running"].includes(value(observed).state)) invoke(modelMcpToolName("work-services", "operation_get"), { operationId: receipt.operationId });
      else if (value(observed).state !== "succeeded") end(`workstation-deployment-failed:${JSON.stringify(value(observed).error)}`);
      else if (!previous("brain_service")) invoke("brain_service", { operation: "discover", serviceName: "workstation" });
      else end(`workstation-deployed:${receipt.serviceId}`);
    }
    return true;
  }
  if (prompt.startsWith("Piwork CoreFlow request ") && prompt.includes("source=service:workstation")) {
    const requestId = prompt.match(/request ([^;]+);/)?.[1] ?? "missing";
    const exporting = /Original goal:.*[Ee]xport/.test(prompt);
    const handling = prompt.includes("phase=handling");
    const queries = results.filter((result) => result.toolName === "brain_service");
    if (!queries.length) invoke("brain_service", { operation: "query", serviceName: "workstation", name: exporting ? "exports" : "review", input: {} });
    else if (handling && exporting && queries.length === 1) invoke("brain_service", { operation: "action", serviceName: "workstation", name: "export_review", id: `export-${requestId}`, input: {}, expectedStateVersion: value(queries[0]).result.stateVersion });
    else if (handling && exporting && /Interrupt before registering wait/.test(prompt) && !previous("bash")) invoke("bash", { command: "sleep 30" });
    else if (handling && exporting && !previous("brain_feedback")) {
      const actual = value(queries.at(-1)); invoke("brain_feedback", { operation: "wait", waitRef: { kind: "job", serviceName: "workstation", id: actual.result.jobId,
        deadlineAt: new Date(Date.now() + 60000).toISOString(), nextPhase: "verifying", verificationGoal: "Verify the original export Job and persistent artifact" } });
    } else if (handling && !exporting && !previous("read") && !value(queries[0]).evidence.verified) invoke("read", {path:"apps/workstation/SPEC.md"});
    else if (handling && !exporting && !previous("write") && !value(queries[0]).evidence.verified) invoke("write", {
      path:"apps/workstation/SPEC.md",content:text(previous("read")!).replace("The initial review configuration intentionally excludes completed Todos as a repair fixture.","The reviewed configuration includes actual completed Todos; omissions remain a failing acceptance result.") });
    else if (handling && !exporting && !previous("bash") && !value(queries[0]).evidence.verified) invoke("bash", {
      command: "cp apps/workstation/review_config.json apps/workstation/review_config.checkpoint.json && node -e 'const fs=require(\"node:fs\"); const p=\"apps/workstation/review_config.json\"; const v=JSON.parse(fs.readFileSync(p,\"utf8\")); v.includeCompleted=true; v.codeVersion=\"workstation-v2\"; fs.writeFileSync(p,JSON.stringify(v));'" });
    else if (handling && !exporting && previous("bash") && !previous(modelMcpToolName("work-services", "service_list"))) invoke(modelMcpToolName("work-services", "service_list"), {});
    else if (handling && !exporting && previous("bash") && !previous(modelMcpToolName("work-services", "service_restart"))) {
      const service = value(previous(modelMcpToolName("work-services", "service_list"))).services.find((s: any) => s.name === "workstation");
      invoke(modelMcpToolName("work-services", "service_restart"), { serviceId: service.serviceId, idempotencyKey: `review-restart-${requestId}` });
    } else if (handling && !exporting && previous(modelMcpToolName("work-services", "service_restart"))) {
      const observed = results.filter(r => r.toolName === modelMcpToolName("work-services", "operation_get")).at(-1);
      if (!observed || ["pending", "running"].includes(value(observed).state)) {
        if (observed && results.at(-1)?.toolName !== "bash") invoke("bash", { command: "sleep 0.5" });
        else invoke(modelMcpToolName("work-services", "operation_get"), { operationId: value(previous(modelMcpToolName("work-services", "service_restart"))).operationId });
      } else if (value(observed).state !== "succeeded") end("workstation-repair-deployment-failed");
      else if (queries.length === 1) invoke("brain_service", { operation: "verify", serviceName: "workstation", name: "review", input: {} });
      else if (!previous("brain_experience")) invoke("brain_experience", { operation: "stage", entry: { entryId: "include-completed-review", scope: "service:workstation", rule: "confirmed-fixture-rule: Personal reviews include actually completed Todos and verify the authoritative review query.", evidenceIds: [value(queries.at(-1)).evidence.evidenceId] } });
      else if (!previous("brain_feedback")) invoke("brain_feedback", { operation: "finish", state: "completed", result: "Completed Todos now appear in the personal review", evidenceIds: [value(queries.at(-1)).evidence.evidenceId] });
      else end("workstation-feedback-verified");
    } else if (handling && !exporting && queries.length === 1) invoke("brain_service", { operation: "verify", serviceName: "workstation", name: "review", input: {} });
    else if (!previous("brain_experience")) {
      const proof = value(queries.at(-1)).evidence;
      invoke("brain_experience", { operation: "stage", entry: { entryId: exporting ? "verify-original-export" : "include-completed-review", scope: "service:workstation",
        rule: exporting ? "Verify original export Job and the persistent artifact before reporting completion." : "confirmed-fixture-rule: Personal reviews include actually completed Todos and verify the authoritative review query.", evidenceIds: [proof.evidenceId] } });
    } else if (!previous("brain_feedback")) invoke("brain_feedback", { operation: "finish", state: "completed", result: exporting ? "Original export and artifact verified" : "Completed Todos now appear in the personal review", evidenceIds: [value(queries.at(-1)).evidence.evidenceId] });
    else end(exporting && handling ? "workstation-waiting-original-export" : "workstation-feedback-verified");
    return true;
  }
  if (/^(remember|revise|invalidate) deterministic preference(?: (.*))?$/.test(prompt)) {
    const match=/^(remember|revise|invalidate) deterministic preference(?: (.*))?$/.exec(prompt)!;
    const memory=results.filter(result=>result.toolName==="brain_experience");
    if(!memory.length)invoke("brain_experience",{operation:"status"});
    else if(memory.length===1){
      const base=value(memory[0]).adoptedExperienceVersion;
      if(match[1]==="invalidate")invoke("brain_experience",{operation:"invalidate",entryId:"ui-preference",expectedVersion:base,reason:"The user explicitly invalidated the previous preference",evidenceIds:[],userPreference:true});
      else invoke("brain_experience",{operation:match[1]==="revise"?"revise":"stage",expectedVersion:base,userPreference:true,entry:{entryId:"ui-preference",scope:"work",rule:match[2]??"Use dark theme",evidenceIds:[]}});
    }else if(memory.length===2)invoke("brain_experience",{operation:"commit",evidenceIds:value(memory[1]).evidenceIds});
    else end(`memory-effective:${value(memory[2]).memoryCommit?.version??"missing"}`);
    return true;
  }
  if (prompt.startsWith("prepare broken workstation brain candidate ")) {
    const key = prompt.slice("prepare broken workstation brain candidate ".length);
    if (!previous("bash")) invoke("bash", { command: "cp .pi/packages/piwork-brain/extensions/brain.js .pi/brain-extension.checkpoint.js && printf '%s\\n' 'export default function() { throw new Error(\"Deterministic broken brain fixture\"); }' > .pi/packages/piwork-brain/extensions/brain.js" });
    else if (!previous("brain_package_update")) invoke("brain_package_update", { operation: "prepare", submissionKey: key, verificationGoal: "Verify the actually loaded replacement brain", verificationTarget: verificationTarget(key) });
    else end("workstation-broken-brain-candidate-prepared");
    return true;
  }
  if (/^prepare (?:bad behavior )?workstation brain candidate /.test(prompt)) {
    const badBehavior = prompt.startsWith("prepare bad behavior"), key = prompt.replace(/^prepare (?:bad behavior )?workstation brain candidate /, "");
    if (!previous("bash")) invoke("bash", { command: candidateEdit(key, badBehavior) });
    else if (!previous("brain_package_update")) invoke("brain_package_update", { operation: "prepare", submissionKey: key, verificationGoal: "Render the actual completed review with the requested new uppercase prefix format", verificationTarget: verificationTarget(key) });
    else end("workstation-brain-candidate-prepared");
    return true;
  }
  return false;
}
