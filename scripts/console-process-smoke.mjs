import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "piwork-console-process-"));
const freePort = async () => {
  const listener = createServer();
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
};
const [corePort, grpcPort, consolePort] = await Promise.all([freePort(), freePort(), freePort()]);
const coreUrl = `http://127.0.0.1:${corePort}`;
const consoleOrigin = `https://127.0.0.1:${consolePort}`;
const coreData = join(root, "core"), consoleData = join(root, "console");
let core, consoleProcess;

function cli(file, args, input, env = process.env) {
  const result = spawnSync(process.execPath, [file, ...args], { input, encoding: "utf8", env });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  return result.stdout;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((done) => child.once("exit", done));
}
async function waitFor(check, name) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await check()) return; } catch { /* Listener may still be starting. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`${name} did not become ready`);
}

try {
  core = spawn(process.execPath, ["apps/core/dist/cli.js", "serve", "--data-dir", coreData,
    "--listen", `127.0.0.1:${corePort}`, "--agent-grpc-listen", `127.0.0.1:${grpcPort}`,
    "--agent-grpc-advertise", `127.0.0.1:${grpcPort}`], { stdio: "ignore" });
  await waitFor(async () => (await fetch(`${coreUrl}/healthz`)).ok, "Core");
  cli("apps/core/dist/cli.js", ["--core", coreUrl, "--data-dir", coreData,
    "admin", "bootstrap", "--account", "admin", "--password-stdin"], "correct horse battery\n");

  const cert = join(root, "cert.pem"), key = join(root, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", key, "-out", cert, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  await mkdir(consoleData, { mode: 0o700 });
  consoleProcess = spawn(process.execPath, ["apps/console/dist/cli.js", "serve", "--core", coreUrl,
    "--listen", `127.0.0.1:${consolePort}`, "--public-origin", consoleOrigin,
    "--tls-cert", cert, "--tls-key", key, "--data-dir", consoleData], { stdio: "ignore" });
  const ca = await readFile(cert);
  await waitFor(() => new Promise((resolve, reject) => {
    const check = request(`${consoleOrigin}/healthz`, { ca }, (response) => {
      response.resume(); response.on("end", () => resolve(response.statusCode === 200));
    });
    check.on("error", reject); check.end();
  }), "console");

  await stop(consoleProcess); consoleProcess = undefined;
  assert.ok((await fetch(`${coreUrl}/healthz`)).ok, "Core continues after console closes");
  assert.match(cli("apps/core/dist/cli.js", ["--core", coreUrl, "--data-dir", coreData, "status"]), /RUNTIME_NOT_CONFIGURED/);
  const clientEnv = { ...process.env, PIWORK_CONFIG_PATH: join(root, "client.json") };
  cli("apps/cli/dist/main.js", ["--core", coreUrl, "login", "--account", "admin", "--password-stdin"],
    "correct horse battery\n", clientEnv);
  assert.match(cli("apps/cli/dist/main.js", ["--core", coreUrl, "whoami"], undefined, clientEnv), /admin/);
  process.stdout.write("Core, console, operator CLI, and user CLI process smoke passed\n");
} finally {
  await stop(consoleProcess);
  await stop(core);
  await rm(root, { recursive: true, force: true });
}
