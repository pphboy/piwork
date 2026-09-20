# pi SDK adapter decisions

The product adapter pins `@earendil-works/pi-coding-agent` to `0.86.0`.

Persistent history uses the SDK's public `SessionManager` surface:

- `SessionManager.create(cwd, sessionRoot, { id? })` creates the JSONL history.
- `SessionManager.findById(cwd, id, sessionRoot)` resolves an exact stable ID.
- `SessionManager.open(path, sessionRoot, cwd)` reloads the same history.
- `appendMessage()` records user and assistant messages. The SDK intentionally
  creates the JSONL file only after an assistant message exists, so a stable
  history path does not by itself prove that data has reached disk.

The Work Store will retain the stable SDK session ID and history path as an
index. The JSONL transcript remains the conversation source of truth. Tests run
creation and loading in separate Node processes so an in-memory registry cannot
accidentally satisfy the recovery check.

The SDK smoke path uses these additional public interfaces:

- `loadSkillsFromDir()` plus an isolated `ResourceLoader` loads only the Skills
  materialized for the active Work configuration.
- `defineTool()` and `createAgentSession({ customTools })` register Work tools.
- `AgentSession.abort()` is the explicit cancellation boundary; observer loss
  never calls it.
- A local `ModelRuntime.registerProvider()` fixture drives deterministic tool
  calls and aborts without model credentials or network access.

The MCP fixtures use the official TypeScript MCP SDK. Both stdio and Streamable
HTTP servers expose an `echo` tool with transport-specific results so later
namespace and lifecycle tests can distinguish their routing.
