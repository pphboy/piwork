import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const required = ["PIWORK_REAL_AGENT_IMAGE", "PIWORK_REAL_MODEL_PROVIDER", "PIWORK_REAL_MODEL_ID", "PIWORK_REAL_MODEL_API_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  process.stderr.write(`real-model smoke requires: ${missing.join(", ")}\n`);
  process.exit(2);
}

const root = new URL("../", import.meta.url).pathname;
const temporary = await mkdtemp(join(tmpdir(), "piwork-real-model-"));
const dataDirectory = join(temporary, "core");
const installationId = `real-smoke-${process.pid}-${Date.now()}`;
const adminPassword = `real-smoke-password-${process.pid}`;
const environment = { ...process.env, PIWORK_CONFIG_PATH: join(temporary, "client.json"), PIWORK_INSTALLATION_ID: installationId };
let core;
try {
  if (process.env.PIWORK_REAL_SKIP_BUILD !== "1") run("npm", ["run", "build"]);
  core = await startCore();
  run("node", ["apps/core/dist/cli.js", "--core", core.url, "--data-dir", dataDirectory, "admin", "bootstrap", "--account", "admin", "--password-stdin"], `${adminPassword}\n`);
  const configure = ["apps/core/dist/cli.js", "--core", core.url, "--data-dir", dataDirectory, "config", "set", "--agent-image", process.env.PIWORK_REAL_AGENT_IMAGE, "--model-provider", process.env.PIWORK_REAL_MODEL_PROVIDER, "--model", process.env.PIWORK_REAL_MODEL_ID, "--api-key-stdin"];
  if (process.env.PIWORK_REAL_MODEL_BASE_URL) configure.push("--model-base-url", process.env.PIWORK_REAL_MODEL_BASE_URL);
  run("node", configure, `${process.env.PIWORK_REAL_MODEL_API_KEY}\n`);
  run("node", ["apps/cli/dist/main.js", "--core", core.url, "--json", "login", "--account", "admin", "--password-stdin"], `${adminPassword}\n`);
  const creation = lines(run("node", ["apps/cli/dist/main.js", "--json", "work", "create", "--name", "real-model-smoke", "--wait"]));
  const workId = creation[0].workId;
  assert.equal(creation.at(-1).state, "succeeded");
  const chat = lines(run("node", ["apps/cli/dist/main.js", "--json", "chat", workId, "--message", "Reply with a short confirmation that the model is reachable."]));
  const runId = chat.find((item) => item.type === "run")?.runId;
  assert.equal(typeof runId, "string");
  const result = lines(run("node", ["apps/cli/dist/main.js", "--json", "run", "show", workId, runId]))[0];
  assert.equal(typeof result.finalText, "string");
  assert.notEqual(result.finalText.trim(), "");
  run("node", ["apps/cli/dist/main.js", "--json", "work", "delete", workId, "--wait"]);
  process.stdout.write(`real-model smoke passed: ${workId}\n`);
} finally {
  if (core) await stopCore(core).catch(() => {});
  cleanupDocker();
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, env: environment, input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed (${result.status}): ${redact(result.stderr)}`);
  return result.stdout;
}
function lines(output) { return output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
function redact(value) { return String(value).split(process.env.PIWORK_REAL_MODEL_API_KEY).join("[redacted]").slice(0, 2_000); }
async function startCore() {
  const child = spawn("node", ["apps/core/dist/cli.js", "serve", "--data-dir", dataDirectory, "--listen", "127.0.0.1:0"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const line = await Promise.race([readLine(child.stdout), new Promise((_, reject) => setTimeout(() => reject(new Error("Core startup timed out")), 20_000)), new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`Core exited (${code}): ${redact(stderr)}`))))]);
  return { child, url: JSON.parse(line).url };
}
function readLine(stream) { return new Promise((resolve, reject) => { let value = ""; const data = (chunk) => { value += String(chunk); const index = value.indexOf("\n"); if (index >= 0) { stream.off("data", data); resolve(value.slice(0, index)); } }; stream.on("data", data); stream.once("end", () => reject(new Error("Core closed stdout"))); }); }
async function stopCore(value) { value.child.kill("SIGTERM"); const code = await Promise.race([new Promise((resolve) => value.child.once("exit", resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error("Core shutdown timed out")), 10_000))]); assert.equal(code, 0); }
function cleanupDocker() {
  for (const kind of ["container", "network", "volume"]) {
    const list = kind === "container" ? ["ps", "-aq"] : [kind, "ls", "-q"];
    const ids = spawnSync("docker", [...list, "--filter", `label=piwork.installation_id=${installationId}`], { encoding: "utf8" }).stdout?.trim().split("\n").filter(Boolean) ?? [];
    if (ids.length) spawnSync("docker", [kind, "rm", ...(kind === "container" ? ["-f"] : []), ...ids], { encoding: "utf8" });
  }
}
