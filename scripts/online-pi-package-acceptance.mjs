import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const repository = new URL("../", import.meta.url).pathname;
const temporary = await mkdtemp(join(tmpdir(), "piwork-online-package-"));
const dataDirectory = join(temporary, "core");
const clientConfig = join(temporary, "client.json");
const installationId = `online-pkg-${process.pid}-${Date.now()}`;
const packageSource = "npm:pi-subagents@0.71.0";
const packageName = "pi-subagents";
const fixtureKey = `online-fixture-${process.pid}`;
const adminPassword = `online-admin-${process.pid}`;
const environment = { ...process.env, PIWORK_CONFIG_PATH: clientConfig,
  PIWORK_INSTALLATION_ID: installationId, PIWORK_PACKAGE_HELPER_IMAGE: "piwork-agentd:acceptance" };
let core;
let fixtureName;
let lastAgentContainer;
let pendingChat;

try {
  run("docker", ["info"]);
  if (process.env.PIWORK_ONLINE_SKIP_BUILD !== "1") {
    run("npm", ["run", "build"]);
    run("npm", ["run", "agent:image:acceptance"]);
  }
  const grpcPort = await freePort();
  core = await startCore(grpcPort);
  serve(["--core", core.url, "--data-dir", dataDirectory, "admin", "bootstrap", "--account", "admin", "--password-stdin"], `${adminPassword}\n`);
  serve(["--core", core.url, "--data-dir", dataDirectory, "config", "set", "--agent-image", "piwork-agentd:acceptance",
    "--model-provider", "groq", "--model", "llama-3.1-8b-instant", "--model-base-url", "http://127.0.0.1:8080/v1",
    "--api-key-stdin"], `${fixtureKey}\n`);
  user(["--core", core.url, "--json", "login", "--account", "admin", "--password-stdin"], `${adminPassword}\n`);
  const installed = first(serve(["--core", core.url, "--data-dir", dataDirectory, "--json", "packages", "install", packageSource, "--wait"]));
  assert.equal(installed.state, "succeeded", JSON.stringify(installed.error));
  assert.equal(first(serve(["--core", core.url, "--data-dir", dataDirectory, "--json", "packages", "show", packageName])).resolvedSource,
    "pi-subagents@0.71.0");
  const created = records(user(["--json", "work", "create", "--name", "online-package", "--no-skills", "--no-packages", "--wait"]));
  const workId = created[0].workId;
  assert.equal(created.at(-1).state, "succeeded");
  let agentContainer = singleAgentContainer(workId);
  const copied = first(user(["--json", "work", "packages", "install", workId, "--from-core", packageName, "--wait"]));
  assert.equal(copied.state, "succeeded", JSON.stringify(copied.error));
  const applied = records(user(["--json", "work", "config", "apply", workId, "--wait"]));
  assert.equal(applied.at(-1).state, "succeeded");
  const shown = first(user(["--json", "work", "packages", "show", workId, packageName]));
  assert.equal(shown.runtime.loaded, true, JSON.stringify(shown.runtime));
  agentContainer = singleAgentContainer(workId);
  lastAgentContainer = agentContainer;
  fixtureName = `piwork-online-model-${process.pid}`;
  run("docker", ["run", "-d", "--name", fixtureName, "--label", `piwork.installation_id=${installationId}`,
    "--network", `container:${agentContainer}`, "--env", `PIWORK_FIXTURE_MODEL_KEY=${fixtureKey}`,
    "--mount", `type=bind,source=${join(repository, "scripts/pi-package-online-model-fixture.mjs")},target=/fixture.mjs,readonly`,
    "node:24-bookworm-slim", "node", "/fixture.mjs"]);
  await waitFor(() => fixtureEvents().then(() => true), "model fixture startup");
  const agentRuntime = JSON.parse(run("docker", ["exec", agentContainer, "cat", "/etc/piwork/runtime.json"]));
  assert.equal(agentRuntime.model.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(JSON.parse(run("docker", ["exec", agentContainer, "node", "-e",
    "fetch('http://127.0.0.1:8080/events').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"])).length, 0);
  const probe = run("docker", ["exec", agentContainer, "node", "--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    import { ModelRuntime } from '/workspace/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
    const config=JSON.parse(readFileSync('/etc/piwork/runtime.json','utf8'));
    const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false});
    runtime.registerProvider(config.model.provider,{baseUrl:config.model.baseUrl});
    await runtime.setRuntimeApiKey(config.model.provider,readFileSync(config.model.credentialPath,'utf8').trim());
    const model=runtime.getModel(config.model.provider,config.model.id);
    const result=await runtime.completeSimple(model,{messages:[{role:'user',content:[{type:'text',text:'SDK_PROBE'}]}]});
    console.log(result.content.filter(part=>part.type==='text').map(part=>part.text).join(''));
  `]);
  assert.equal(probe, "probe-ok");
  const foreground = records(user(["--json", "chat", workId, "--message", "ONLINE_FOREGROUND invoke the subagent tool"]));
  assertToolCompleted(foreground, "subagents_enable");
  assertToolCompleted(foreground, "subagent");
  assert.equal((await fixtureEvents()).some((event) => event.kind === "child-completed" && event.mode === "foreground"), true);
  const foregroundSession = first(user(["--json", "session", "show", workId, foreground.find((event) => event.type === "session")?.sessionId]));
  assert.match(JSON.stringify(foregroundSession.messages), /child-ok:foreground/,
    "foreground SDK Session must retain the child's tool result");
  const backgroundComplete = records(user(["--json", "chat", workId, "--message", "ONLINE_BACKGROUND_COMPLETE invoke the subagent tool"]));
  assertToolCompleted(backgroundComplete, "subagent");
  assert.equal((await fixtureEvents()).some((event) => event.kind === "child-completed" && event.mode === "background"), true);
  pendingChat = startUser(["--json", "chat", workId, "--message", "ONLINE_BACKGROUND_HOLD invoke the subagent tool"]);
  await waitFor(async () => (await fixtureEvents()).some((event) => event.kind === "child-holding"), "background child request");
  assertToolCompleted(pendingChat.output().split("\n").slice(0, -1).filter(Boolean).map((line) => JSON.parse(line)), "subagent");
  const inspected = JSON.parse(run("docker", ["inspect", agentContainer]))[0];
  assert.equal(inspected.Mounts.some((mount) => mount.Destination === "/var/run/docker.sock"), false);
  assert.equal(inspected.Mounts.some((mount) => mount.Destination.startsWith("/core") || mount.Destination.includes("other-work")), false);
  const childFiles = run("docker", ["exec", agentContainer, "node", "-e",
    "const f=require('fs');const p='/tmp/piwork-child-agent';console.log(JSON.stringify(['models.json','auth.json'].map(n=>({name:n,mode:f.statSync(p+'/'+n).mode&511}))))"]);
  assert.deepEqual(JSON.parse(childFiles).map((item) => item.mode), [0o600, 0o600]);
  const stopped = records(user(["--json", "work", "stop", workId, "--wait"]));
  assert.equal(stopped.at(-1).state, "succeeded");
  await pendingChat.done;
  const containerState = JSON.parse(run("docker", ["inspect", "--format", "{{json .State}}", agentContainer]));
  assert.equal(containerState.Running, false);
  const afterStop = await fixtureEvents();
  assert.equal(afterStop.some((event) => event.kind === "child-disconnected" && event.mode === "background"), true);
  assert.equal(afterStop.filter((event) => event.kind === "child-completed" && event.mode === "background").length, 1);
  for (const relative of await regularFiles(dataDirectory)) {
    const bytes = await readFile(join(dataDirectory, relative));
    if (bytes.includes(Buffer.from(fixtureKey)) && !/^secrets\/[^/]+\.secret$|^runtime\/work-[^/]+\/model-credential\.secret$/.test(relative)) {
      throw new Error(`model credential persisted outside the approved secret files: ${relative}`);
    }
  }
  process.stdout.write(`online Pi package acceptance passed: ${workId}\n`);
} catch (error) {
  if (fixtureName) {
    const observed = spawnSync("docker", ["exec", fixtureName, "node", "-e",
      "fetch('http://127.0.0.1:8080/events').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"],
    { cwd: repository, encoding: "utf8" });
    process.stderr.write(`model fixture events: ${safe(observed.stdout ?? observed.stderr)}\n`);
  }
  if (lastAgentContainer) {
    const logs = spawnSync("docker", ["logs", "--tail", "80", lastAgentContainer], { cwd: repository, encoding: "utf8" });
    process.stderr.write(`agent logs: ${safe(logs.stderr ?? logs.stdout)}\n`);
  }
  throw error;
} finally {
  pendingChat?.kill();
  if (core) await stopCore(core).catch(() => undefined);
  for (const kind of ["container", "network", "volume"]) {
    const listing = kind === "container" ? ["ps", "-aq"] : [kind, "ls", "-q"];
    const ids = spawnSync("docker", [...listing, "--filter", `label=piwork.installation_id=${installationId}`],
      { cwd: repository, encoding: "utf8" }).stdout?.trim().split("\n").filter(Boolean) ?? [];
    if (ids.length) spawnSync("docker", [kind, "rm", ...(kind === "container" ? ["-f"] : []), ...ids],
      { cwd: repository, encoding: "utf8" });
  }
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: repository, env: environment, encoding: "utf8", input, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed (${result.status}): ${safe(result.stderr)} ${safe(result.stdout)} ${safe(core?.stderr() ?? "")}`);
  return result.stdout.trim();
}
function serve(args, input) { return run("node", ["apps/core/dist/cli.js", ...args], input); }
function user(args, input) { return run("node", ["apps/cli/dist/main.js", ...args], input); }
function startUser(args) {
  const child = spawn("node", ["apps/cli/dist/main.js", ...args], { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise((resolve) => child.once("close", (status) => resolve({ status, stdout, stderr })));
  return { output: () => stdout, done, kill: () => child.kill("SIGTERM") };
}
function records(output) { return output.split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
function first(output) { return records(output)[0]; }
function safe(value) { return String(value).replaceAll(fixtureKey, "[REDACTED]").replaceAll(adminPassword, "[REDACTED]").slice(-8000); }
function assertToolCompleted(events, toolName) {
  assert.equal(events.some((event) => event.kind?.$case === "tool" && event.kind.tool.toolName === toolName && event.kind.tool.phase === "tool-start"), true);
  assert.equal(events.some((event) => event.kind?.$case === "tool" && event.kind.tool.toolName === toolName && event.kind.tool.phase === "tool-end" && !event.kind.tool.isError), true);
}
function singleAgentContainer(workId) {
  const ids = run("docker", ["ps", "-aq", "--filter", `label=piwork.installation_id=${installationId}`,
    "--filter", `label=piwork.work_id=${workId}`, "--filter", "label=piwork.resource_kind=agent"]).split("\n").filter(Boolean);
  assert.equal(ids.length, 1);
  return ids[0];
}
async function fixtureEvents() {
  return JSON.parse(run("docker", ["exec", fixtureName, "node", "-e",
    "fetch('http://127.0.0.1:8080/events').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"]));
}
async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) {
    try { if (await check()) return; } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} timed out`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}
async function startCore(grpcPort) {
  const child = spawn("node", ["apps/core/dist/cli.js", "serve", "--data-dir", dataDirectory, "--listen", "127.0.0.1:0",
    "--agent-grpc-listen", `0.0.0.0:${grpcPort}`, "--agent-grpc-advertise", `piwork-core:${grpcPort}`],
  { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const line = await Promise.race([readLine(child.stdout), new Promise((_, reject) => setTimeout(() => reject(new Error("Core startup timeout")), 20000)),
    new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`Core exited ${code}`))))]);
  const record = JSON.parse(line);
  assert.equal(record.event, "core.listening");
  return { child, url: record.url, stderr: () => stderr };
}
function readLine(stream) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const onData = (chunk) => { buffered += String(chunk); const end = buffered.indexOf("\n"); if (end >= 0) { stream.off("data", onData); resolve(buffered.slice(0, end)); } };
    stream.on("data", onData);
    stream.once("end", () => reject(new Error("Core closed before startup")));
  });
}
async function stopCore(value) {
  value.child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => value.child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Core shutdown timeout")), 45000))]);
}
async function regularFiles(root, prefix = "") {
  const names = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) names.push(...await regularFiles(root, relative));
    else if (entry.isFile()) names.push(relative);
  }
  return names;
}
