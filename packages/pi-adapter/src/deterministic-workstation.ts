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
  if (prompt === "deploy deterministic workstation") {
    const reads = results.filter((result) => result.toolName === "read");
    if (!skill) { end("workstation-deployment-failed:skill-unavailable"); return true; }
    const brain = resolve(dirname(skill), "../..");
    if (!reads.length) invoke("read", { path: skill });
    else if (reads.length === 1) invoke("read", { path: resolve(brain, "references/service-contract.md") });
    else if (reads.length === 2) invoke("read", { path: resolve(brain, "templates/workstation/app.py") });
    else if (!previous("bash")) invoke("bash", { command: `mkdir -p apps/workstation data/workstation .pi/services && cp -R '${brain}/templates/workstation/.' apps/workstation/ && chmod -R u+rwX apps/workstation && printf '%s' '{"contractVersion":1,"serviceName":"workstation","apiPortName":"web","mode":"pi-managed"}' > .pi/services/workstation.json` });
    else if (!previous(modelMcpToolName("work-services", "deployment_context"))) invoke(modelMcpToolName("work-services", "deployment_context"), {});
    else if (!previous(modelMcpToolName("work-services", "service_create"))) invoke(modelMcpToolName("work-services", "service_create"), {
      definition: { name: "workstation", image: { reference: "piwork-workstation:acceptance" }, command: "sh",
        args: ["-c", "cd /var/data/workspace/apps/workstation; if [ ! -x .venv/bin/python ]; then mkdir -p wheels; cp /opt/workstation/wheels/*.whl wheels/; sh prepare.sh; fi; exec .venv/bin/python app.py"],
        environment: { PYTHONDONTWRITEBYTECODE: "1" }, secretRefs: [], workingDirectory: "/var/data/workspace", mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
        ports: [{ name: "web", containerPort: 8080, protocol: "tcp" }], cpuMillis: 500, memoryBytes: 536870912, enabled: true, required: false,
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
    } else if (handling && !exporting && !previous("bash") && !value(queries[0]).evidence.verified) invoke("bash", {
      command: "cp apps/workstation/review_config.json apps/workstation/review_config.checkpoint.json && node -e 'const fs=require(\"node:fs\"); const p=\"apps/workstation/review_config.json\"; const v=JSON.parse(fs.readFileSync(p,\"utf8\")); v.includeCompleted=true; v.codeVersion=\"workstation-v2\"; fs.writeFileSync(p,JSON.stringify(v));'" });
    else if (handling && !exporting && queries.length === 1) invoke("brain_service", { operation: "verify", serviceName: "workstation", name: "review", input: {} });
    else if (!previous("brain_experience")) {
      const proof = value(queries.at(-1)).evidence;
      invoke("brain_experience", { operation: "stage", entry: { entryId: exporting ? "verify-original-export" : "include-completed-review", scope: "service:workstation",
        rule: exporting ? "Verify original export Job and the persistent artifact before reporting completion." : "confirmed-fixture-rule: Personal reviews include actually completed Todos and verify the authoritative review query.", evidenceIds: [proof.evidenceId] } });
    } else if (!previous("brain_feedback")) invoke("brain_feedback", { operation: "finish", state: "completed", result: exporting ? "Original export and artifact verified" : "Completed Todos now appear in the personal review", evidenceIds: [value(queries.at(-1)).evidence.evidenceId] });
    else end(exporting && handling ? "workstation-waiting-original-export" : "workstation-feedback-verified");
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
