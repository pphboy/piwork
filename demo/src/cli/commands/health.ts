import { errorMessage } from "../../common/logger.js";
import type { CliOptions } from "../args.js";
import { callHealth, createDaemonClient } from "../client.js";
import type { CliIo } from "../render.js";

/** Prints the daemon's view of its own model/auth/proxy wiring. */
export async function runHealth(options: CliOptions, io: CliIo): Promise<number> {
  const client = createDaemonClient(options.address);

  try {
    const health = await callHealth(client);

    if (options.json) {
      io.stdout.write(`${JSON.stringify(health)}\n`);
      return 0;
    }

    const rows: Array<[string, string]> = [
      ["address", options.address],
      ["status", health.status],
      ["version", health.version],
      ["model", health.model === "" ? "(unresolved)" : health.model],
      ["provider", health.provider],
      ["authenticated", String(health.authenticated)],
      ["auth source", health.authSource === "" ? "-" : health.authSource],
      ["base url", health.baseUrl === "" ? "-" : health.baseUrl],
      ["sessions", String(health.sessionCount)],
      ["uptime", `${Math.round(health.uptimeMs / 1000)}s`],
      ["agent dir", health.agentDir],
    ];

    const width = Math.max(...rows.map(([label]) => label.length));
    for (const [label, value] of rows) {
      io.stdout.write(`${label.padEnd(width)}  ${value}\n`);
    }
    return 0;
  } catch (error) {
    io.stderr.write(`cannot reach daemon at ${options.address}: ${errorMessage(error)}\n`);
    io.stderr.write("start it with: npm run daemon\n");
    return 1;
  } finally {
    client.close();
  }
}
