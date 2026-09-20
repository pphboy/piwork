import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { loadDaemonConfig } from "../common/config.js";
import { createLogger, errorMessage } from "../common/logger.js";
import { applyModelsJson, planModelsJson, readIfExists } from "./models-json.js";
import { PiBackend } from "./pi-backend.js";
import { startServer } from "./server.js";
import { createPiDaemonService } from "./service.js";

const VERSION = "0.1.0";
const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadDotEnv(path: string): boolean {
  try {
    loadEnvFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function main(): Promise<void> {
  const dotEnvPath = join(DEMO_ROOT, ".env");
  const envLoaded = loadDotEnv(dotEnvPath);
  const config = loadDaemonConfig(process.env, DEMO_ROOT);
  const log = createLogger(config.logLevel);
  if (!envLoaded) {
    log.warn(".env not found, relying on the ambient environment", { path: dotEnvPath });
  }

  // pi hardcodes each provider's base url, so a proxy address only takes effect
  // through models.json.
  const modelsPath = join(config.agentDir, "models.json");
  const plan = planModelsJson({
    modelsPath,
    provider: config.provider,
    baseUrl: config.baseUrl,
    existing: await readIfExists(modelsPath),
  });
  if (plan.action === "write") {
    await applyModelsJson(plan);
    log.info("models.json written", { path: modelsPath, baseUrl: config.baseUrl ?? null });
  } else {
    log.warn("models.json left untouched", { path: modelsPath, reason: plan.reason });
  }

  await mkdir(config.workspace, { recursive: true });

  const backend = new PiBackend({
    agentDir: config.agentDir,
    workspace: config.workspace,
    provider: config.provider,
    model: config.model,
    tools: config.tools,
    apiKey: config.apiKey,
    log,
  });

  const server = await startServer({
    host: config.host,
    port: config.port,
    implementation: createPiDaemonService({ backend, version: VERSION, startedAt: Date.now(), log }),
    log,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    await server.shutdown();
    await backend.dispose();
    log.info("daemon stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log.info("daemon ready", {
    agentDir: config.agentDir,
    workspace: config.workspace,
    model: config.model ?? null,
    tools: config.tools,
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`daemon failed to start: ${errorMessage(error)}\n`);
  process.exit(1);
});
