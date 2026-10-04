import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { modelMcpToolName } from "./mcp-bridge.js";

const PROVIDER_ID = "piwork-deterministic";
import { deterministicWorkstation } from "./deterministic-workstation.js";

const MODEL_ID = "fixture-v1";
const serviceTool = (name: string) => modelMcpToolName("work-services", name);

export async function createDeterministicRuntime(modelId = MODEL_ID): Promise<{
  readonly runtime: ModelRuntime;
  readonly model: Model<any>;
}> {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider(PROVIDER_ID, {
    name: "piwork deterministic fixture",
    baseUrl: "http://fixture.invalid",
    apiKey: "fixture-key",
    api: "openai-completions",
    streamSimple: streamDeterministic,
    models: [
      {
        id: modelId,
        name: "piwork deterministic fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_384,
        maxTokens: 1_024,
      },
    ],
  });
  const model = runtime.getModel(PROVIDER_ID, modelId);
  if (model === undefined) throw new Error("deterministic model registration failed");
  return { runtime, model };
}

function streamDeterministic(
  model: Model<any>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output = emptyMessage(model);

  void (async () => {
    stream.push({ type: "start", partial: output });
    const latestUserIndex = context.messages.findLastIndex((message) => message.role === "user");
    const latestUser = context.messages[latestUserIndex];
    const prompt = latestUser?.role === "user"
      ? typeof latestUser.content === "string"
        ? latestUser.content
        : latestUser.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
      : "";

    if (prompt.trim() === "identify current model") { emitText(stream, output, `${model.provider}/${model.id}`); return; }

    if (prompt.includes("wait for abort")) {
      await waitForAbort(options?.signal);
      output.stopReason = "aborted";
      output.errorMessage = "deterministic execution aborted";
      stream.push({ type: "error", reason: "aborted", error: output });
      stream.end();
      return;
    }

    const systemPrompt = context.messages
      .filter((message) => message.role === "system")
      .flatMap((message) => message.role === "system"
        ? [typeof message.content === "string" ? message.content : message.content.map((part) => part.text).join(""), ...Object.values(message.sections ?? {}).filter((section): section is string => typeof section === "string")]
        : [])
      .join("\n");
    const skillLocations = [...systemPrompt.matchAll(/<location>([^<]*\/SKILL\.md)<\/location>/g)].map((match) => decodeXml(match[1]!));
    const manifestPath = skillLocations.find((path) => !path.includes("piwork-brain") && !path.includes("/skills/deploy-work-service/")) ?? "";
    const toolResults = context.messages.slice(latestUserIndex + 1).filter((message) => message.role === "toolResult");
    const brainSkill = [...systemPrompt.matchAll(/<location>([^<]*\/SKILL\.md)<\/location>/g)].map((match) => decodeXml(match[1]!)).find((path) => path.includes("deploy-work-service")) ?? manifestPath;
    if (deterministicWorkstation(stream, output, toolResults, brainSkill, prompt.trim())) return;
    if (prompt.includes("deploy deterministic service")) {
      deterministicDeployment(stream, output, toolResults, brainSkill);
      return;
    }
    if (prompt.includes("inspect restored web service")) {
      const listed = toolResults.find((result) => result.toolName === serviceTool("service_list"));
      if (!listed) { emitToolCall(stream, output, "snapshot-read-list", serviceTool("service_list"), {}); return; }
      const services = parseToolJson(listed).services;
      const web = Array.isArray(services) ? services.find((item) => item && typeof item === "object" && (item as { name?: string }).name === "web") as { serviceId?: string } | undefined : undefined;
      if (!web?.serviceId) { emitText(stream, output, "snapshot-service-missing"); return; }
      const observed = toolResults.find((result) => result.toolName === serviceTool("service_get"));
      if (!observed) { emitToolCall(stream, output, "snapshot-read-get", serviceTool("service_get"), { serviceId: web.serviceId }); return; }
      emitText(stream, output, parseToolJson(observed).observedState === "ready" ? `snapshot-service-observed:${web.serviceId}` : "snapshot-service-not-ready");
      return;
    }
    if (prompt.includes("verify restored web service")) {
      deterministicRestoredService(stream, output, toolResults);
      return;
    }
    const packageInvocation = /^invoke package tool ([A-Za-z0-9_-]{1,64})(?: with (\{.*\}))?$/.exec(prompt.trim());
    const packageTool = packageInvocation?.[1];
    if (packageTool !== undefined) {
      if (toolResults.length === 0) emitToolCall(stream, output, `package-${packageTool}`, packageTool, packageInvocation?.[2] ? JSON.parse(packageInvocation[2]) as Record<string, unknown> : {});
      else emitText(stream, output, `package-tool-result:${packageTool}:${toolResultText(toolResults[0]!).trim()}`);
      return;
    }
    if (prompt.trim() === "inspect piwork brain candidate cognition") {
      emitText(stream, output, `brain-candidate-new:${systemPrompt.includes("Workstation candidate cognition")}`); return;
    }
    if (prompt.trim() === "inspect piwork brain cognition") {
      emitText(stream, output, systemPrompt.includes("Piwork workstation cognition")
        ? `brain-cognition:${[...systemPrompt.matchAll(/experience adopted for this Run \(version (\d+)\)/g)].at(-1)?.[1] ?? "missing"}:${systemPrompt.includes("confirmed-fixture-rule")}` : "brain-cognition:disabled"); return;
    }
    if (toolResults.length === 0 && manifestPath !== "") {
      emitToolCall(stream, output, "fixture-read-manifest", "read", { path: manifestPath });
      return;
    }
    if (toolResults.length === 1 && manifestPath !== "") {
      const manifest = toolResultText(toolResults[0]!);
      const reference = manifest.match(/(?:supporting file|support)\s*:\s*([a-zA-Z0-9._/-]+)/i)?.[1]
        ?? manifest.match(/\[[^\]]+\]\(([^)]+)\)/)?.[1];
      if (reference === undefined || reference.startsWith("/") || reference.includes("..")) throw new Error("deterministic Skill fixture has no safe supporting-file reference");
      emitToolCall(stream, output, "fixture-read-support", "read", { path: resolve(dirname(manifestPath), reference) });
      return;
    }

    const text = manifestPath === "" ? "skill-read:none" : `skill-read:${createHash("sha256")
      .update(toolResultText(toolResults[0]!)).update("\0").update(toolResultText(toolResults[1]!)).digest("hex").slice(0, 16)}`;
    output.content.push({ type: "text", text });
    stream.push({ type: "text_start", contentIndex: 0, partial: output });
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
    output.stopReason = "stop";
    stream.push({ type: "done", reason: "stop", message: output });
    stream.end();
  })().catch((error: unknown) => {
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = error instanceof Error ? error.message : String(error);
    stream.push({ type: "error", reason: output.stopReason, error: output });
    stream.end();
  });

  return stream;
}

/** Exercise the real pi-agentd SDK -> built-in MCP -> Core service path in snapshot acceptance. */
function deterministicRestoredService(
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  results: readonly Extract<TranscriptContext["messages"][number], { role: "toolResult" }>[],
): void {
  const listed = results.find((result) => result.toolName === serviceTool("service_list"));
  if (!listed) { emitToolCall(stream, output, "snapshot-list", serviceTool("service_list"), {}); return; }
  const services = parseToolJson(listed).services;
  const web = Array.isArray(services) ? services.find((item) => item && typeof item === "object" && (item as { name?: string }).name === "web") as { serviceId?: string } | undefined : undefined;
  const serviceId = web?.serviceId;
  if (!serviceId) { emitText(stream, output, "snapshot-service-missing"); return; }
  const stop = results.find((result) => result.toolName === serviceTool("service_stop"));
  if (!stop) { emitToolCall(stream, output, "snapshot-stop", serviceTool("service_stop"), { serviceId, idempotencyKey: `snapshot-stop-${serviceId}` }); return; }
  const stopId = String(parseToolJson(stop).operationId ?? "");
  const observations = results.filter((result) => result.toolName === serviceTool("operation_get"));
  const stopObservation = observations.filter((result) => parseToolJson(result).operationId === stopId).at(-1);
  if (!stopObservation || ["pending", "running"].includes(String(parseToolJson(stopObservation).state))) {
    emitToolCall(stream, output, `snapshot-stop-observe-${observations.length}`, serviceTool("operation_get"), { operationId: stopId }); return;
  }
  if (parseToolJson(stopObservation).state !== "succeeded") { emitText(stream, output, "snapshot-service-stop-failed"); return; }
  const start = results.find((result) => result.toolName === serviceTool("service_start"));
  if (!start) { emitToolCall(stream, output, "snapshot-start", serviceTool("service_start"), { serviceId, idempotencyKey: `snapshot-start-${serviceId}` }); return; }
  const startId = String(parseToolJson(start).operationId ?? "");
  const startObservation = observations.filter((result) => parseToolJson(result).operationId === startId).at(-1);
  if (!startObservation || ["pending", "running"].includes(String(parseToolJson(startObservation).state))) {
    emitToolCall(stream, output, `snapshot-start-observe-${observations.length}`, serviceTool("operation_get"), { operationId: startId }); return;
  }
  emitText(stream, output, parseToolJson(startObservation).state === "succeeded" ? `snapshot-service-restored:${serviceId}` : "snapshot-service-start-failed");
}

function deterministicDeployment(
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  results: readonly Extract<TranscriptContext["messages"][number], { role: "toolResult" }>[],
  manifestPath: string,
): void {
  const has = (name: string) => results.some((result) => result.toolName === name);
  const reads = results.filter((result) => result.toolName === "read");
  if (manifestPath === "") {
    emitText(stream, output, "service-deployment-failed:skill-unavailable");
    return;
  }
  if (reads.length === 0) {
    emitToolCall(stream, output, "deploy-read-skill", "read", { path: manifestPath });
    return;
  }
  if (reads.length === 1) {
    emitToolCall(stream, output, "deploy-read-reference", "read", { path: resolve(dirname(manifestPath), "reference.md") });
    return;
  }
  if (!has(serviceTool("deployment_context"))) {
    emitToolCall(stream, output, "deploy-context", serviceTool("deployment_context"), {});
    return;
  }
  if (!has("write")) {
    emitToolCall(stream, output, "deploy-write", "write", {
      path: "apps/demo/server.py",
      content: `from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import base64, hashlib, json, os, struct, threading
from urllib.parse import parse_qs

DATA = Path("/var/data/workspace/data/demo/counter.json")
LOCK = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = b"ok"
        elif self.path == "/login":
            body = b'<form method="post" action="/login"><label>Password<input name="password" type="password"></label><button>Sign in</button></form>'
            self.send_response(200); self.send_header("Content-Type", "text/html")
            self.end_headers(); self.wfile.write(body); return
        elif self.path == "/private":
            if "demo_auth=1" not in self.headers.get("Cookie", ""):
                self.send_response(401); self.end_headers(); self.wfile.write(b"Sign in to the app"); return
            body = b"private-ok"
        elif self.path == "/events":
            body = b"data: first\\n\\ndata: second\\n\\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body[:13]); self.wfile.flush()
            self.wfile.write(body[13:]); self.wfile.flush()
            return
        elif self.path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
            key = self.headers["Sec-WebSocket-Key"]
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            self.send_response(101)
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.end_headers()
            head = self.rfile.read(2)
            size = head[1] & 127
            if size == 126: size = struct.unpack("!H", self.rfile.read(2))[0]
            elif size == 127: size = struct.unpack("!Q", self.rfile.read(8))[0]
            mask = self.rfile.read(4)
            payload = self.rfile.read(size)
            echo = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            self.wfile.write(bytes([0x81, len(echo)]) + echo); self.wfile.flush()
            return
        else:
            with LOCK:
                DATA.parent.mkdir(parents=True, exist_ok=True)
                try: count = json.loads(DATA.read_text())["count"]
                except (FileNotFoundError, KeyError, ValueError): count = 0
                count += 1
                temporary = DATA.with_suffix(".tmp")
                temporary.write_text(json.dumps({"count": count}))
                os.replace(temporary, DATA)
            body = json.dumps({"count": count}).encode()
        self.send_response(200); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        if self.path != "/login":
            self.send_response(404); self.end_headers(); return
        size = min(int(self.headers.get("Content-Length", "0")), 1024)
        values = parse_qs(self.rfile.read(size).decode())
        if values.get("password") != ["service-secret"]:
            self.send_response(401); self.end_headers(); return
        self.send_response(303)
        self.send_header("Set-Cookie", "demo_auth=1; Path=/; HttpOnly; SameSite=Lax")
        self.send_header("Location", "/private")
        self.end_headers()
    def log_message(self, format, *args): pass
ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
`,
    });
    return;
  }
  if (reads.length === 2) {
    emitToolCall(stream, output, "deploy-read-source", "read", { path: "apps/demo/server.py" });
    return;
  }
  if (!toolResultText(reads[2]!).includes("ThreadingHTTPServer")) {
    emitText(stream, output, "service-deployment-failed:workspace-write");
    return;
  }
  if (!has(serviceTool("service_create"))) {
    emitToolCall(stream, output, "deploy-create", serviceTool("service_create"), {
      definition: {
        name: "demo", image: { reference: "python:3.13-slim" }, command: "python3",
        args: ["/var/data/workspace/apps/demo/server.py"], environment: {}, secretRefs: [],
        workingDirectory: "/var/data/workspace",
        mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
        ports: [{ name: "http", containerPort: 8000, protocol: "tcp" }],
        cpuMillis: 250, memoryBytes: 134217728, enabled: true, required: false,
        readiness: { kind: "http", portName: "http", path: "/health", deadlineMs: 120000, timeoutMs: 2000 },
        restartPolicy: "bounded",
      },
      idempotencyKey: "deterministic-demo-v1",
    });
    return;
  }
  const acceptance = parseToolJson(results.find((result) => result.toolName === serviceTool("service_create"))!);
  const operationId = String(acceptance.operationId ?? "");
  const serviceId = String(acceptance.serviceId ?? "");
  const operations = results.filter((result) => result.toolName === serviceTool("operation_get"));
  const latestOperation = operations.length === 0 ? undefined : parseToolJson(operations.at(-1)!);
  if (latestOperation === undefined || latestOperation.state === "pending" || latestOperation.state === "running") {
    emitToolCall(stream, output, `deploy-operation-${operations.length}`, serviceTool("operation_get"), { operationId });
    return;
  }
  if (latestOperation.state !== "succeeded") {
    emitText(stream, output, `service-deployment-failed:${serviceId}:${String(latestOperation.state)}`);
    return;
  }
  if (!has(serviceTool("service_get"))) {
    emitToolCall(stream, output, "deploy-inspect", serviceTool("service_get"), { serviceId });
    return;
  }
  if (!has("bash")) {
    emitToolCall(stream, output, "deploy-request", "bash", {
      command: "node -e 'Promise.all([fetch(\"http://svc-demo:8000/\").then(r=>r.json()),fetch(\"http://svc-demo:8000/\").then(r=>r.json())]).then(v=>console.log(JSON.stringify(v)))'",
    });
    return;
  }
  const request = results.find((result) => result.toolName === "bash")!;
  emitText(stream, output, `service-deployed:${serviceId}:${toolResultText(request).trim()}`);
}

function parseToolJson(message: Extract<TranscriptContext["messages"][number], { role: "toolResult" }>): Record<string, unknown> {
  try { return JSON.parse(toolResultText(message)) as Record<string, unknown>; }
  catch { return {}; }
}

function emitToolCall(stream: AssistantMessageEventStream, output: AssistantMessage, id: string, name: string, args: Record<string, unknown>): void {
  const toolCall = { type: "toolCall" as const, id, name, arguments: args as any };
  output.content.push(toolCall);
  stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
  stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
  output.stopReason = "toolUse";
  stream.push({ type: "done", reason: "toolUse", message: output });
  stream.end();
}

function emitText(stream: AssistantMessageEventStream, output: AssistantMessage, text: string): void {
  output.content.push({ type: "text", text });
  stream.push({ type: "text_start", contentIndex: 0, partial: output });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
  output.stopReason = "stop";
  stream.push({ type: "done", reason: "stop", message: output });
  stream.end();
}

function toolResultText(message: TranscriptContext["messages"][number]): string {
  return message.role === "toolResult" ? message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("") : "";
}

function decodeXml(value: string): string {
  return value.replace(/&apos;/g, "'").replace(/&quot;/g, "\"").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

function emptyMessage(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return;
  if (signal === undefined) throw new Error("deterministic wait requires an AbortSignal");
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
