import {
  appendAssistantMessage,
  appendUserMessage,
  createPersistentSession,
  loadPersistentSession,
  readPersistentSession,
} from "./session-persistence.js";

const [operation, cwd, sessionRoot, sessionId, message] = process.argv.slice(2);
if (operation === undefined || cwd === undefined || sessionRoot === undefined || message === undefined) {
  throw new Error("usage: session-process <create|load> <cwd> <session-root> <session-id|-> <message>");
}

const session = operation === "create"
  ? createPersistentSession({ cwd, sessionRoot, ...(sessionId === "-" ? {} : { sessionId }) })
  : loadPersistentSession({ cwd, sessionRoot, sessionId: requireSessionId(sessionId) });

appendUserMessage(session, message);
appendAssistantMessage(session, `ack:${message}`);
process.stdout.write(`${JSON.stringify(readPersistentSession(session))}\n`);

function requireSessionId(value: string | undefined): string {
  if (value === undefined || value === "-") throw new Error("load requires a session id");
  return value;
}
