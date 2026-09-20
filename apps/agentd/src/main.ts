#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { AgentApplication } from "./application.js";

export const AGENTD_VERSION = "0.1.0";

export function agentdBanner(): string {
  return `piwork-agentd ${AGENTD_VERSION}`;
}

export async function runAgentd(args: readonly string[]): Promise<void> {
  if (args.length !== 2 || args[0] !== "--config") throw new Error("usage: piwork-agentd --config <path>");
  const application = await AgentApplication.create(args[1]!);
  try {
    await application.start();
    process.stdout.write(`${JSON.stringify({ event: "agent.ready", workId: application.config.workId, generation: application.config.generation })}\n`);
    await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  } finally {
    await application.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentd(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
