import { errorMessage } from "../../common/logger.js";
import type { CliOptions } from "../args.js";
import { askStream, createDaemonClient } from "../client.js";
import { AskRenderer, formatSummary, type CliIo } from "../render.js";

/** One-shot ask, for scripts and quick checks. */
export async function runAsk(options: CliOptions, io: CliIo): Promise<number> {
  const prompt = options.prompt;
  if (prompt === undefined) {
    io.stderr.write("ask requires a prompt\n");
    return 2;
  }

  const client = createDaemonClient(options.address);
  const controller = new AbortController();
  const onSigint = (): void => {
    controller.abort();
  };
  process.on("SIGINT", onSigint);

  const renderer = new AskRenderer({ showThinking: options.showThinking, json: options.json, io });

  try {
    for await (const event of askStream(
      client,
      { sessionId: options.sessionId ?? "", prompt, cwd: options.cwd ?? "" },
      controller.signal,
    )) {
      renderer.handle(event);
    }
  } catch (error) {
    if (!options.json) io.stdout.write("\n");
    io.stderr.write(controller.signal.aborted ? "cancelled\n" : `error: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
    client.close();
  }

  if (!options.json) io.stdout.write("\n");
  if (renderer.failed) return 1;
  io.stderr.write(`${formatSummary(renderer)}\n`);
  return 0;
}
