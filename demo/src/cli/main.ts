import { errorMessage } from "../common/logger.js";
import { parseCliArgs, UsageError, USAGE, type CliOptions } from "./args.js";
import { runAsk } from "./commands/ask.js";
import { runHealth } from "./commands/health.js";
import { runRepl } from "./repl.js";
import type { CliIo } from "./render.js";
import { installEpipeGuard } from "./stdio.js";

async function main(): Promise<void> {
  installEpipeGuard(process.stdout);
  installEpipeGuard(process.stderr);
  const io: CliIo = { stdout: process.stdout, stderr: process.stderr };

  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2), process.env);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${error.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  if (options.command === "help") {
    io.stdout.write(USAGE);
    return;
  }

  if (options.command === "health") {
    process.exitCode = await runHealth(options, io);
    return;
  }

  if (options.command === "ask") {
    process.exitCode = await runAsk(options, io);
    return;
  }

  process.exitCode = await runRepl(options, io);
}

main().catch((error: unknown) => {
  process.stderr.write(`piwork-cli failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
