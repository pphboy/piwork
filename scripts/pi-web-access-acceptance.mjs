import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repository = new URL("../", import.meta.url).pathname;
const temporary = await mkdtemp(join(tmpdir(), "piwork-web-access-"));
const dataDirectory = join(temporary, "core");
const installationId = `webaccess-${randomUUID().slice(0, 12)}`;
const password = randomUUID();
const apiKey = randomUUID();
const environment = { ...process.env, PIWORK_INSTALLATION_ID: installationId,
  PIWORK_PACKAGE_HELPER_IMAGE: "piwork-agentd:acceptance" };
let core;

async function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, env: environment, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}

async function serve(args, input = "") {
  return run("node", ["apps/core/dist/cli.js", "--core", core.url, "--data-dir", dataDirectory, "--json", ...args], input);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function startCore() {
  const grpcPort = await freePort();
  const child = spawn("node", ["apps/core/dist/cli.js", "serve", "--data-dir", dataDirectory,
    "--listen", "127.0.0.1:0", "--agent-grpc-listen", `0.0.0.0:${grpcPort}`,
    "--agent-grpc-advertise", `piwork-core:${grpcPort}`],
  { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "", stdout = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const listening = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      try { resolve(JSON.parse(stdout.slice(0, newline))); } catch (error) { reject(error); }
    });
    child.once("exit", (status) => reject(new Error(`Core exited ${status}: ${stderr}`)));
  });
  const timer = setTimeout(() => { child.kill("SIGTERM"); }, 20_000);
  try {
    const event = await listening;
    assert.equal(event.event, "core.listening");
    return { child, url: event.url, stderr: () => stderr };
  } finally { clearTimeout(timer); }
}

async function cleanupDocker() {
  for (const kind of ["container", "network", "volume"]) {
    const listing = kind === "container" ? ["ps", "-aq"] : [kind, "ls", "-q"];
    const result = await run("docker", [...listing, "--filter", `label=piwork.installation_id=${installationId}`]);
    if (result.status !== 0 || !result.stdout) continue;
    const ids = result.stdout.split("\n").filter(Boolean);
    if (ids.length) await run("docker", [kind, "rm", ...(kind === "container" ? ["-f"] : []), ...ids]);
  }
}

try {
  core = await startCore();
  const bootstrap = await serve(["admin", "bootstrap", "--account", "admin", "--password-stdin"], `${password}\n`);
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  const configured = await serve(["config", "set", "--agent-image", "piwork-agentd:acceptance",
    "--model-provider", "groq", "--model", "llama-3.1-8b-instant", "--model-base-url", "http://127.0.0.1:8080/v1",
    "--api-key-stdin"], `${apiKey}\n`);
  assert.equal(configured.status, 0, configured.stderr);
  process.stderr.write("Installing pi-web-access@0.31.0 through the temporary Core...\n");
  const installed = await serve(["packages", "install", "npm:pi-web-access@0.31.0", "--default", "--wait",
    ...(process.env.PIWORK_PACKAGE_VERBOSE === "1" ? ["--verbose"] : [])]);
  const operation = JSON.parse(installed.stdout);
  process.stdout.write(`${JSON.stringify({ status: installed.status, operation, progress: installed.stderr })}\n`);
  assert.equal(installed.status, 0);
  assert.equal(operation.state, "succeeded");
  const shown = await serve(["packages", "show", "pi-web-access"]);
  assert.equal(shown.status, 0, shown.stderr);
  const entry = JSON.parse(shown.stdout);
  assert.equal(entry.version, "0.31.0");
  assert.equal(entry.enabled, true);
  assert.equal(entry.isDefault, true);
  process.stdout.write(`${JSON.stringify({ result: "passed", entry })}\n`);
} finally {
  if (core) {
    core.child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => core.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 45_000))]);
  }
  await cleanupDocker();
  if (process.env.PIWORK_KEEP_WEB_ACCESS_TEMP !== "1") await rm(temporary, { recursive: true, force: true });
}
