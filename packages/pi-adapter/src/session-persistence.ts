import { SessionManager } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { toolResultPreview, type ToolResultPreview } from "./tool-preview.js";

export type PersistentContentBlock =
  | { blockId: string; type: "text"; text: string }
  | { blockId: string; type: "tool-call"; toolCallId: string; toolName: string }
  | { blockId: string; type: "tool-result"; toolCallId: string; toolName: string; result: ToolResultPreview };

export interface PersistentSessionOptions {
  readonly cwd: string;
  readonly sessionRoot: string;
  readonly sessionId?: string;
}

export interface PersistentSessionEntry {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly blocks: readonly PersistentContentBlock[];
  readonly runId?: string;
}

export interface PersistentSession {
  readonly sessionId: string;
  readonly historyPath: string;
  readonly entries: readonly PersistentSessionEntry[];
}

export function createPersistentSession(options: PersistentSessionOptions): SessionManager {
  return SessionManager.create(options.cwd, options.sessionRoot, {
    ...(options.sessionId === undefined ? {} : { id: options.sessionId }),
  });
}

export function initializePersistentSession(options: PersistentSessionOptions): SessionManager {
  const session = createPersistentSession(options);
  const historyPath = session.getSessionFile();
  if (historyPath === undefined) throw new Error("persistent session has no history path");
  // SDK 0.86 defers writing its v3 header until an assistant message exists.
  // Work creation needs a durable empty Session before any Run is submitted.
  writeFileSync(historyPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: session.getSessionId(),
    timestamp: new Date().toISOString(),
    cwd: options.cwd,
  })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return session;
}

export function loadPersistentSession(options: PersistentSessionOptions & { readonly sessionId: string }): SessionManager {
  const historyPath = SessionManager.findById(options.cwd, options.sessionId, options.sessionRoot);
  if (historyPath === undefined) {
    throw new Error(`session ${options.sessionId} does not exist`);
  }
  return SessionManager.open(historyPath, options.sessionRoot, options.cwd);
}

export function appendUserMessage(session: SessionManager, text: string, timestamp = Date.now()): string {
  return session.appendMessage({ role: "user", content: text, timestamp });
}

export function appendAssistantMessage(session: SessionManager, text: string, timestamp = Date.now()): string {
  return session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "piwork-fixture",
    provider: "piwork-fixture",
    model: "deterministic",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  });
}

export function readPersistentSession(session: SessionManager): PersistentSession {
  const historyPath = session.getSessionFile();
  if (historyPath === undefined) {
    throw new Error("persistent session has no history path");
  }

  const entries = session.getEntries(), byId = new Map(entries.map(entry => [entry.id, entry]));
  const runFor = (parentId: string | null): string | undefined => {
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.type === "custom" && parent.customType === "piwork-run") {
        const data = parent.data as { runId?: unknown } | undefined;
        return typeof data?.runId === "string" ? data.runId : "";
      }
      parentId = parent.parentId;
    }
    return undefined;
  };
  return {
    sessionId: session.getSessionId(),
    historyPath,
    entries: entries.flatMap((entry): PersistentSessionEntry[] => {
      if (entry.type !== "message") return [];
      const role = entry.message.role;
      const content = "content" in entry.message ? entry.message.content : undefined;
      const safeText = (text: string) => role === "user" ? text.replace(/(<skill name="[^"]*") location="[^"]*"(>)/g, "$1$2").replace(/^References are relative to .+\n/gm, "") : text;
      const blocks: PersistentContentBlock[] = [];
      if (role === "toolResult") {
        const message = entry.message as { toolCallId: string; toolName: string; isError: boolean };
        blocks.push({ blockId: `${entry.id}-0`, type: "tool-result", toolCallId: message.toolCallId, toolName: message.toolName, result: toolResultPreview(entry.message, message.isError) });
      } else if (typeof content === "string") blocks.push({ blockId: `${entry.id}-0`, type: "text", text: safeText(content) });
      else if (Array.isArray(content)) content.forEach((part, index) => {
        if (part.type === "text") blocks.push({ blockId: `${entry.id}-${index}`, type: "text", text: safeText(part.text) });
        else if (part.type === "toolCall") blocks.push({ blockId: `${entry.id}-${index}`, type: "tool-call", toolCallId: part.id, toolName: part.name });
      });
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
          : "";
      const runId = runFor(entry.parentId);
      return [{ id: entry.id, role, text: role === "toolResult" ? blocks.flatMap(block => block.type === "tool-result" && block.result.kind === "text" ? [block.result.text] : []).join("") : safeText(text), blocks, ...(runId === undefined ? {} : { runId }) }];
    }),
  };
}
