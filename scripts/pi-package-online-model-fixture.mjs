import { createServer } from "node:http";

const expectedKey = process.env.PIWORK_FIXTURE_MODEL_KEY;
if (!expectedKey) throw new Error("model fixture key is required");

const events = [];
let sequence = 0;
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/events") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(events));
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${expectedKey}`) {
    events.push({ kind: "unauthorized" });
    response.writeHead(401).end();
    return;
  }
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 2_000_000) { response.writeHead(413).end(); return; }
  }
  const body = JSON.parse(raw);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userText = messages.filter((message) => message.role === "user")
    .map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join(" ");
  const isChild = userText.includes("CHILD_FOREGROUND") || userText.includes("CHILD_BACKGROUND_HOLD")
    || userText.includes("CHILD_BACKGROUND_COMPLETE");
  const background = userText.includes("ONLINE_BACKGROUND") || userText.includes("CHILD_BACKGROUND_");
  const mode = background ? "background" : "foreground";
  events.push({ kind: isChild ? "child-request" : "parent-request", mode,
    hasSubagentTool: Array.isArray(body.tools) && body.tools.some((tool) => tool.function?.name === "subagent"),
    hasEnableTool: Array.isArray(body.tools) && body.tools.some((tool) => tool.function?.name === "subagents_enable") });
  if (userText.includes("SDK_PROBE")) {
    sendStream(response, { text: "probe-ok" });
    return;
  }
  if (isChild && userText.includes("CHILD_BACKGROUND_HOLD")) {
    events.push({ kind: "child-holding", mode });
    response.on("close", () => events.push({ kind: "child-disconnected", mode }));
    return;
  }
  const toolUsed = messages.some((message) => message.role === "tool" && message.name === "subagent")
    || messages.some((message) => message.role === "assistant" && Array.isArray(message.tool_calls)
      && message.tool_calls.some((call) => call.function?.name === "subagent"));
  if (!isChild && !toolUsed) {
    if (!body.tools?.some((tool) => tool.function?.name === "subagent")) {
      if (body.tools?.some((tool) => tool.function?.name === "subagents_enable")) {
        sendStream(response, { tool: { name: "subagents_enable", arguments: "{}" } });
        events.push({ kind: "subagents-enabled", mode });
      } else {
        events.push({ kind: "missing-subagent", mode });
        response.writeHead(422).end();
      }
      return;
    }
    const args = mode === "background"
      ? { agent: "worker", task: userText.includes("ONLINE_BACKGROUND_HOLD") ? "CHILD_BACKGROUND_HOLD" : "CHILD_BACKGROUND_COMPLETE", async: true }
      : { agent: "worker", task: "CHILD_FOREGROUND reply child-ok:foreground", async: false };
    sendStream(response, { tool: { name: "subagent", arguments: JSON.stringify(args) } });
    events.push({ kind: "subagent-tool-issued", mode });
    return;
  }
  sendStream(response, { text: isChild ? `child-ok:${mode}` : `parent-ok:${mode}` });
  events.push({ kind: isChild ? "child-completed" : "parent-completed", mode });
});

server.listen(8080, "0.0.0.0");

function sendStream(response, output) {
  const id = `fixture-${++sequence}`;
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const chunk = (delta, finishReason = null) => response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000), model: "llama-3.1-8b-instant", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
  if (output.tool) {
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call-${sequence}`, type: "function", function: output.tool }] });
    chunk({}, "tool_calls");
  } else {
    chunk({ role: "assistant", content: output.text });
    chunk({}, "stop");
  }
  response.end("data: [DONE]\n\n");
}
