import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url).pathname;
const temporary = await mkdtemp(join(tmpdir(), "piwork-acceptance-"));
const dataDirectory = join(temporary, "core");
const configPath = join(temporary, "client.json");
const installationId = `acceptance-${process.pid}-${Date.now()}`;
const adminPassword = `acceptance-password-${process.pid}-sentinel`;
const modelCredential = `acceptance-model-key-${process.pid}-sentinel`;
const capturedProcessOutput = [];
const environment = scrubbedEnvironment({
  PIWORK_CONFIG_PATH: configPath,
  PIWORK_INSTALLATION_ID: installationId,
});
let core;

try {
  prerequisite("docker", ["info"]);
  if (process.env.PIWORK_ACCEPTANCE_SKIP_BUILD !== "1") {
    checked("npm", ["run", "build"]);
    checked("docker", ["build", "-f", "Dockerfile.agentd", "--target", "acceptance", "-t", "piwork-agentd:acceptance", "."]);
  }
  core = await startCore(0);
  const originalUrl = core.url;
  serveCli(["--core", originalUrl, "--data-dir", dataDirectory, "status"]);
  serveCli(["--core", originalUrl, "--data-dir", dataDirectory, "admin", "bootstrap", "--account", "admin", "--password-stdin"], `${adminPassword}\n`);
  serveCli([
    "--core", originalUrl, "--data-dir", dataDirectory, "config", "set",
    "--agent-image", "piwork-agentd:acceptance",
    "--model-provider", "piwork-deterministic", "--model", "fixture-v1", "--api-key-stdin",
  ], `${modelCredential}\n`);
  const importedSkill = join(temporary, "skills", "directory-derived");
  await mkdir(importedSkill, { recursive: true });
  await writeFile(join(importedSkill, "SKILL.md"), "---\nname: frontmatter-name\ndescription: Original acceptance fixture\n---\nUse the supporting file.\n");
  await writeFile(join(importedSkill, "support.txt"), "original-supporting-content\n");
  serveCli(["--core", originalUrl, "--data-dir", dataDirectory, "skills", "add", "--path", importedSkill]);
  await rm(importedSkill, { recursive: true, force: true });

  cli(["--core", originalUrl, "--json", "status"]);
  cli(["--core", originalUrl, "--json", "login", "--account", "admin", "--password-stdin"], `${adminPassword}\n`);
  const identity = firstJson(cli(["--json", "whoami"]));
  assert.equal(identity.account, "admin");
  assert.deepEqual(firstJson(cli(["--json", "work", "list"])), { works: [] });

  const creation = jsonLines(cli(["--json", "work", "create", "--name", "acceptance-work", "--skill", "directory-derived", "--wait"]));
  const workId = creation[0].workId;
  assert.equal(creation.at(-1).state, "succeeded");
  assert.deepEqual(firstJson(cli(["--json", "skills", "show", "directory-derived"])), { name: "directory-derived" });
  assert.deepEqual(firstJson(cli(["--json", "work", "config", "show", workId])).active.skills, ["directory-derived"]);
  const containerBefore = dockerContainer(workId);
  const inspection = JSON.parse(checked("docker", ["inspect", containerBefore]))[0];
  assertNoSensitive(JSON.stringify(inspection), [adminPassword, modelCredential], "Docker inspection");
  assert.equal(JSON.stringify(inspection).includes("-----BEGIN PRIVATE KEY-----"), false);
  assert.equal(inspection.Config.User, "10001:10001");
  assert.deepEqual(inspection.HostConfig.PortBindings, {});
  assert.equal(inspection.Mounts.some((mount) => mount.Destination === "/var/run/docker.sock"), false);
  assert.equal(checked("docker", ["exec", containerBefore, "cat", "/run/piwork/skills/directory-derived/support.txt"]).trim(), "original-supporting-content");

  const first = jsonLines(cli(["--json", "chat", workId, "--message", "acceptance first turn"]));
  assert.equal(first.some(isExpectedText), true);
  const sessionId = first.find((item) => item.type === "session").sessionId;
  const firstRunId = first.find((item) => item.type === "run").runId;
  const run = firstJson(cli(["--json", "run", "show", workId, firstRunId]));
  assert.equal(String(run.finalText), "fixture tool completed");
  assert.equal(firstJson(cli(["--json", "session", "show", workId, sessionId])).messages.length > 0, true);

  await mkdir(importedSkill, { recursive: true });
  await writeFile(join(importedSkill, "SKILL.md"), "---\nname: another-frontmatter-name\ndescription: Updated acceptance fixture\n---\nUse the updated supporting file.\n");
  await writeFile(join(importedSkill, "support.txt"), "updated-supporting-content\n");
  serveCli(["--core", originalUrl, "--data-dir", dataDirectory, "skills", "update", "directory-derived", "--path", importedSkill]);
  await rm(importedSkill, { recursive: true, force: true });
  const creationB = jsonLines(cli(["--json", "work", "create", "--name", "acceptance-work-current", "--skill", "directory-derived", "--wait"]));
  const currentWorkId = creationB[0].workId;
  assert.equal(creationB.at(-1).state, "succeeded");
  assert.equal(checked("docker", ["exec", dockerContainer(currentWorkId), "cat", "/run/piwork/skills/directory-derived/support.txt"]).trim(), "updated-supporting-content");
  serveCli(["--core", originalUrl, "--data-dir", dataDirectory, "skills", "disable", "directory-derived"]);
  serveCli(["--core", originalUrl, "--data-dir", dataDirectory, "skills", "remove", "directory-derived"]);
  assert.deepEqual(firstJson(cli(["--json", "skills", "list"])), { skills: [] });

  await stopCore(core);
  core = undefined;
  assert.equal(checked("docker", ["inspect", "--format", "{{.State.Running}}", containerBefore]).trim(), "true");
  core = await startCore(Number(new URL(originalUrl).port));
  assert.equal(core.url, originalUrl);
  const resumedStatus = firstJson(serveCli(["--core", originalUrl, "--data-dir", dataDirectory, "--json", "status"]));
  if (resumedStatus.ready !== true) throw new Error(`Core restart was not ready: ${safeFailure(`${JSON.stringify(resumedStatus)}\n${core.stderr()}`)}`);
  assert.equal(firstJson(cli(["--json", "whoami"])).account, "admin");
  assert.equal(dockerContainer(workId), containerBefore);
  const second = jsonLines(cli(["--json", "chat", workId, "--session", sessionId, "--message", "acceptance second turn"]));
  assert.equal(second.some(isExpectedText), true);

  assert.equal(jsonLines(cli(["--json", "work", "stop", workId, "--wait"])).at(-1).state, "succeeded");
  assert.equal(jsonLines(cli(["--json", "work", "start", workId, "--wait"])).at(-1).state, "succeeded");
  assert.equal(jsonLines(cli(["--json", "work", "stop", currentWorkId, "--wait"])).at(-1).state, "succeeded");
  assert.equal(jsonLines(cli(["--json", "work", "start", currentWorkId, "--wait"])).at(-1).state, "succeeded");
  assert.equal(checked("docker", ["exec", dockerContainer(workId), "cat", "/run/piwork/skills/directory-derived/support.txt"]).trim(), "original-supporting-content");
  assert.equal(checked("docker", ["exec", dockerContainer(currentWorkId), "cat", "/run/piwork/skills/directory-derived/support.txt"]).trim(), "updated-supporting-content");

  const credential = JSON.parse(await readFile(configPath, "utf8"));
  const agentsB = join(temporary, "agents-b.md");
  const agentsC = join(temporary, "agents-c.md");
  await writeFile(agentsB, "acceptance context B\n");
  await writeFile(agentsC, "acceptance context C\n");
  cli(["--json", "work", "config", "agents", "set", workId, "--file", agentsB]);
  const applyB = api(originalUrl, credential.token, "POST", `/api/v1/works/${workId}/configuration/apply`, {});
  await waitFor(() => latestApplyState(workId) === "running", "apply operation did not enter running state");
  await api(originalUrl, credential.token, "PUT", `/api/v1/works/${workId}/configuration/agents`, { agentsMd: "acceptance context C\n" });
  await applyB;
  const raced = firstJson(cli(["--json", "work", "config", "show", workId]));
  assert.equal(raced.active.agentsMd, "acceptance context B\n");
  assert.equal(raced.desired.agentsMd, "acceptance context C\n");
  assert.equal(raced.pendingApply, true);
  const contextA = await contextIdentity(workId, "");
  const contextB = await contextIdentity(workId, "acceptance context B\n");
  const laterSessionId = firstJson(cli(["--json", "session", "create", workId])).sessionId;
  const bindings = dockerContextBindings(dockerContainer(workId), firstRunId, laterSessionId);
  assert.equal(bindings.runContext, contextA);
  assert.equal(bindings.sessionContext, contextB);

  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assertNoSensitive(capturedProcessOutput.join("\n"), [adminPassword, modelCredential, saved.token], "process output");
  await assertSecretPlacement(temporary, adminPassword, modelCredential, saved.token);
  cli(["--json", "logout"]);
  const rejected = await fetch(`${originalUrl}/api/v1/me`, { headers: { authorization: `Bearer ${saved.token}` } });
  assert.equal(rejected.status, 401);
  assertNoSensitive(await rejected.text(), [saved.token], "HTTP authentication error");
  cli(["--core", originalUrl, "--json", "login", "--account", "admin", "--password-stdin"], `${adminPassword}\n`);
  assert.equal(jsonLines(cli(["--json", "work", "delete", workId, "--wait"])).at(-1).state, "succeeded");
  assert.equal(jsonLines(cli(["--json", "work", "delete", currentWorkId, "--wait"])).at(-1).state, "succeeded");
  assert.equal(dockerIds("container", workId).length, 0);
  assert.equal(dockerIds("network", workId).length, 0);
  assert.equal(dockerIds("volume", workId).length, 1, "delete retains conversation data volume by policy");
  process.stdout.write(`product acceptance passed: ${workId} ${sessionId}\n`);
} finally {
  if (core !== undefined) await stopCore(core).catch(() => {});
  cleanupDocker();
  await rm(temporary, { recursive: true, force: true });
}

function cli(args, input) { return checked("node", ["apps/cli/dist/main.js", ...args], input); }
function serveCli(args, input) { return checked("node", ["apps/core/dist/cli.js", ...args], input); }
function checked(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, env: environment, input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed (${result.status}): ${safeFailure(`${result.stderr}\n${result.stdout}`)}`);
  capturedProcessOutput.push(result.stdout, result.stderr);
  assertNoSensitive(`${result.stdout}\n${result.stderr}`, [adminPassword, modelCredential], `${command} output`);
  return result.stdout;
}
function prerequisite(command, args) { checked(command, args); }
function jsonLines(value) { return value.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
function firstJson(value) { return jsonLines(value)[0]; }
function isExpectedText(item) { return item?.kind?.$case === "text" && item.kind.text?.delta === "fixture tool completed"; }
function safeFailure(value) { return String(value).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 2_000); }

async function startCore(port) {
  const child = spawn("node", ["apps/core/dist/cli.js", "serve", "--data-dir", dataDirectory, "--listen", `127.0.0.1:${port}`], {
    cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const line = await Promise.race([
    readLine(child.stdout),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Core startup timed out")), 20_000)),
    new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`Core exited during startup (${code}): ${safeFailure(stderr)}`)))),
  ]);
  const record = JSON.parse(line);
  assert.equal(record.event, "core.listening");
  return { child, url: record.url, stderr: () => stderr };
}
function readLine(stream) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const data = (chunk) => { buffered += String(chunk); const index = buffered.indexOf("\n"); if (index >= 0) { cleanup(); resolve(buffered.slice(0, index)); } };
    const end = () => { cleanup(); reject(new Error("Core closed stdout before startup record")); };
    const cleanup = () => { stream.off("data", data); stream.off("end", end); };
    stream.on("data", data); stream.once("end", end);
  });
}
async function stopCore(value) {
  value.child.kill("SIGTERM");
  const code = await Promise.race([
    new Promise((resolve) => value.child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Core shutdown exceeded 10 seconds")), 10_000)),
  ]);
  assert.equal(code, 0);
}
function dockerContainer(workId) {
  const ids = dockerIds("container", workId);
  assert.equal(ids.length, 1);
  return ids[0];
}
function dockerIds(kind, workId) {
  const noun = kind === "container" ? ["ps", "-aq"] : [kind, "ls", "-q"];
  const output = checked("docker", [...noun, "--filter", `label=piwork.installation_id=${installationId}`, "--filter", `label=piwork.work_id=${workId}`]);
  return output.trim().split("\n").filter(Boolean);
}
function cleanupDocker() {
  for (const kind of ["container", "network", "volume"]) {
    const noun = kind === "container" ? ["ps", "-aq"] : [kind, "ls", "-q"];
    const ids = spawnSync("docker", [...noun, "--filter", `label=piwork.installation_id=${installationId}`], { cwd: root, encoding: "utf8" }).stdout?.trim().split("\n").filter(Boolean) ?? [];
    if (ids.length > 0) spawnSync("docker", [kind, "rm", ...(kind === "container" ? ["-f"] : []), ...ids], { cwd: root, encoding: "utf8" });
  }
}

async function api(base, token, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safeFailure(JSON.stringify(value))}`);
  return value;
}

function latestApplyState(workId) {
  const database = new DatabaseSync(join(dataDirectory, "core.sqlite"), { readOnly: true });
  try {
    return database.prepare(`SELECT state FROM operations
      WHERE work_id = ? AND kind = 'apply-work-configuration'
      ORDER BY created_at DESC, id DESC LIMIT 1`).get(workId)?.state;
  } finally {
    database.close();
  }
}

async function waitFor(check, message) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

async function contextIdentity(workId, agentsMd) {
  const contexts = join(dataDirectory, "works", workId, "contexts");
  for (const name of await readdir(contexts)) {
    if (name.startsWith(".staging-")) continue;
    const configuration = JSON.parse(await readFile(join(contexts, name, "config.json"), "utf8"));
    if (configuration.agentsMd !== agentsMd) continue;
    return JSON.parse(await readFile(join(contexts, name, "metadata.json"), "utf8")).snapshotId;
  }
  throw new Error("expected Work context was not found");
}

function dockerContextBindings(container, runId, sessionId) {
  const source = `
    import { DatabaseSync } from "node:sqlite";
    const [runId, sessionId] = process.argv.slice(-2);
    const database = new DatabaseSync("/var/data/work.sqlite", { readOnly: true });
    const run = database.prepare("SELECT context_identity FROM runs WHERE run_id = ?").get(runId);
    const session = database.prepare("SELECT active_context_identity FROM sessions WHERE session_id = ?").get(sessionId);
    process.stdout.write(JSON.stringify({ runContext: run?.context_identity, sessionContext: session?.active_context_identity }));
  `;
  const result = spawnSync("docker", ["exec", container, "node", "--no-warnings", "--input-type=module", "-e", source, runId, sessionId], { cwd: root, env: environment, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Docker context query failed: ${safeFailure(result.stderr)}`);
  return JSON.parse(result.stdout);
}
function scrubbedEnvironment(extra) {
  const blocked = /(?:OPENAI|ANTHROPIC|GOOGLE|GEMINI|MISTRAL|GROQ|XAI|MODEL).*?(?:KEY|TOKEN|CREDENTIAL)|(?:KEY|TOKEN|CREDENTIAL).*?(?:OPENAI|ANTHROPIC|MODEL)/i;
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !blocked.test(key))), ...extra };
}

function assertNoSensitive(value, sentinels, source) {
  if (sentinels.some((sentinel) => typeof sentinel === "string" && sentinel !== "" && value.includes(sentinel))) {
    throw new Error(`sensitive value leaked through ${source}`);
  }
}

async function assertSecretPlacement(directory, password, modelKey, bearerToken) {
  for (const path of await regularFiles(directory)) {
    const relative = path.slice(directory.length + 1);
    const content = await readFile(path);
    if (content.includes(Buffer.from(password))) throw new Error(`password leaked into temporary artifact: ${relative}`);
    if (content.includes(Buffer.from(modelKey))
      && !(/^core\/secrets\/[^/]+\.secret$/.test(relative) || /^core\/runtime\/work-[^/]+\/model-credential\.secret$/.test(relative))) {
      throw new Error(`model credential leaked into temporary artifact: ${relative}`);
    }
    if (content.includes(Buffer.from(bearerToken)) && relative !== "client.json") {
      throw new Error(`bearer token leaked into temporary artifact: ${relative}`);
    }
    if (content.includes(Buffer.from("-----BEGIN PRIVATE KEY-----"))
      && !(/^core\/runtime\/pki\//.test(relative) || /^core\/runtime\/work-[^/]+\/tls-generation-[^/]+\//.test(relative))) {
      throw new Error(`certificate private key leaked into temporary artifact: ${relative}`);
    }
  }
}

async function regularFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
