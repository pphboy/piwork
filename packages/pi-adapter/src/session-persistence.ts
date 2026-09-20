import { SessionManager } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

export interface PersistentSessionOptions {
  readonly cwd: string;
  readonly sessionRoot: string;
  readonly sessionId?: string;
}

export interface PersistentSessionEntry {
  readonly id: string;
  readonly role: string;
  readonly text: string;
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

  return {
    sessionId: session.getSessionId(),
    historyPath,
    entries: session.getEntries().flatMap((entry): PersistentSessionEntry[] => {
      if (entry.type !== "message") return [];
      const role = entry.message.role;
      const content = "content" in entry.message ? entry.message.content : undefined;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
          : "";
      return [{ id: entry.id, role, text }];
    }),
  };
}
