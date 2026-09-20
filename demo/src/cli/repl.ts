import { createInterface } from "node:readline/promises";
import { errorMessage } from "../common/logger.js";
import type { HealthResponse } from "../generated/piwork.js";
import type { CliOptions } from "./args.js";
import { askStream, callHealth, createDaemonClient } from "./client.js";
import { AskRenderer, formatSummary, type CliIo } from "./render.js";

const HELP_LINES = [
  "  /new       start a new session on the next question",
  "  /session   show the current session id and model",
  "  /exit      leave (also /quit or Ctrl-D)",
  "  /help      show this list",
  "",
  "  Ctrl-C while answering cancels that answer; at the prompt it exits.",
];

/**
 * The interactive Q&A loop. Conversation state lives in the daemon, so the loop
 * only has to carry the session id between questions.
 */
export async function runRepl(options: CliOptions, io: CliIo): Promise<number> {
  const client = createDaemonClient(options.address);

  let health: HealthResponse;
  try {
    health = await callHealth(client);
  } catch (error) {
    io.stderr.write(`cannot reach daemon at ${options.address}: ${errorMessage(error)}\n`);
    io.stderr.write("start it with: npm run daemon\n");
    client.close();
    return 1;
  }

  let sessionId = options.sessionId;
  const modelLabel = health.model === "" ? "(unresolved)" : health.model;
  io.stderr.write(`piwork · ${options.address} · model ${modelLabel}\n`);
  if (!health.authenticated) {
    io.stderr.write("warning: daemon reports no credentials; questions will fail until demo/.env is set\n");
  }
  io.stderr.write("type /help for commands\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let activeController: AbortController | undefined;
  let closing = false;

  rl.on("SIGINT", () => {
    // Mid-answer Ctrl-C cancels that answer; at the prompt it leaves.
    if (activeController !== undefined) {
      activeController.abort();
      return;
    }
    io.stdout.write("\n");
    closing = true;
    rl.close();
  });
  rl.on("close", () => {
    closing = true;
  });

  try {
    while (!closing) {
      let line: string;
      try {
        line = await rl.question(sessionId === undefined ? "piwork> " : `piwork:${sessionId.slice(0, 8)}> `);
      } catch {
        break; // the interface closed (Ctrl-D)
      }

      const input = line.trim();
      if (input === "") continue;

      if (input.startsWith("/")) {
        const [name] = input.split(/\s+/, 1);
        switch (name) {
          case "/exit":
          case "/quit":
            closing = true;
            break;
          case "/new":
            sessionId = undefined;
            io.stderr.write("next question starts a new session\n");
            break;
          case "/session":
            io.stdout.write(`session  ${sessionId ?? "(none yet)"}\nmodel    ${modelLabel}\n`);
            break;
          case "/help":
            for (const helpLine of HELP_LINES) io.stdout.write(`${helpLine}\n`);
            break;
          default:
            io.stderr.write(`unknown command ${String(name)}; try /help\n`);
        }
        continue;
      }

      const controller = new AbortController();
      activeController = controller;
      const renderer = new AskRenderer({ showThinking: options.showThinking, json: options.json, io });

      try {
        for await (const event of askStream(
          client,
          { sessionId: sessionId ?? "", prompt: input, cwd: options.cwd ?? "" },
          controller.signal,
        )) {
          renderer.handle(event);
          if (event.sessionStarted !== undefined) sessionId = event.sessionStarted.sessionId;
        }
        if (!options.json) io.stdout.write("\n");
        if (!renderer.failed) io.stderr.write(`${formatSummary(renderer)}\n`);
      } catch (error) {
        if (!options.json) io.stdout.write("\n");
        io.stderr.write(controller.signal.aborted ? "cancelled\n" : `error: ${errorMessage(error)}\n`);
      } finally {
        activeController = undefined;
      }
    }
  } finally {
    rl.close();
    client.close();
  }

  return 0;
}
