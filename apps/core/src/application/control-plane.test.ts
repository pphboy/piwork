import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreApplication } from "./core-application.js";
import { ensureCorePaths } from "./paths.js";
import type { WorkRuntimeAdapter } from "../work-management/lifecycle.js";

const runtime: WorkRuntimeAdapter = {
  async prepare() {},
  async start(_work, generation) { return { instanceId: `instance-${generation}`, generation }; },
  async inspect() { return { exists: false, running: false, ready: false }; },
  async drain() {},
  async stop() {},
  async remove() {},
  async listManagedInstances() { return []; },
};

test("empty Core listens, reports staged readiness, and separates operator from user authorization", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-control-plane-"));
  const paths = ensureCorePaths(root);
  const application = await CoreApplication.create({ paths, runtimeFactory: async () => runtime });
  try {
    assert.equal(application.status().state, "ADMIN_REQUIRED");
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await json(base, "/healthz")).response.status, 200);
    const unready = await json(base, "/readyz");
    assert.equal(unready.response.status, 503);
    assert.equal(unready.body.reason, "ADMIN_REQUIRED");
    assert.deepEqual(application.lifecycle.list({ userId: "nobody", role: "admin" }), []);

    const operator = (await readFile(paths.operatorCredentialPath, "utf8")).trim();
    const rejectedUserCredential = await json(base, "/control/users", { authorization: "Bearer user-token" });
    assert.equal(rejectedUserCredential.response.status, 401);

    const bootstrapped = await json(base, "/control/admin/bootstrap", {
      method: "POST",
      authorization: `Operator ${operator}`,
      body: { account: "admin", password: "correct horse battery" },
    });
    assert.equal(bootstrapped.response.status, 201);
    assert.equal(application.status().state, "RUNTIME_NOT_CONFIGURED");

    const configured = await json(base, "/control/runtime", {
      method: "PUT",
      authorization: `Operator ${operator}`,
      body: { agentImage: "piwork-agentd:test", provider: "anthropic", model: "claude-test", credential: "model-secret" },
    });
    assert.equal(configured.response.status, 200);
    assert.equal(application.status().state, "READY");
    assert.equal(JSON.stringify(configured.body).includes("model-secret"), false);

    const login = await json(base, "/api/v1/login", {
      method: "POST",
      body: { account: "admin", password: "correct horse battery" },
    });
    assert.equal(login.response.status, 200);
    const token = String(login.body.token);
    const forbiddenControl = await json(base, "/control/runtime", { authorization: `Bearer ${token}` });
    assert.equal(forbiddenControl.response.status, 401);
    const forbiddenConversation = await json(base, "/api/v1/works", { authorization: `Operator ${operator}` });
    assert.equal(forbiddenConversation.response.status, 401);
    const invalidUser = await json(base, "/control/users", {
      method: "POST",
      authorization: `Operator ${operator}`,
      body: { account: "short-password", password: "too-short" },
    });
    assert.equal(invalidUser.response.status, 400);
    assert.equal(invalidUser.body.code, "INVALID_REQUEST");
    const works = await json(base, "/api/v1/works", { authorization: `Bearer ${token}` });
    assert.deepEqual(works.body, { works: [] });

    const workA = await json(base, "/api/v1/works", {
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { name: "work-a", idempotencyKey: "create-a" },
    });
    assert.equal(workA.response.status, 202);
    const profileA = application.store.getWorkConfigRevision(String(workA.body.workId), 1)?.runtimeProfileJson;
    assert.equal((JSON.parse(profileA!) as { model: { id: string } }).model.id, "claude-test");

    await json(base, "/control/runtime", {
      method: "PUT",
      authorization: `Operator ${operator}`,
      body: { agentImage: "piwork-agentd:test", provider: "anthropic", model: "claude-next", credential: "new-model-secret" },
    });
    const workB = await json(base, "/api/v1/works", {
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { name: "work-b", idempotencyKey: "create-b" },
    });
    assert.equal(workB.response.status, 202);
    const profileB = application.store.getWorkConfigRevision(String(workB.body.workId), 1)?.runtimeProfileJson;
    assert.equal((JSON.parse(profileA!) as { model: { id: string } }).model.id, "claude-test");
    assert.equal((JSON.parse(profileB!) as { model: { id: string } }).model.id, "claude-next");

    const configurationA = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, { authorization: `Bearer ${token}` });
    const desiredA = configurationA.body.desired as Record<string, unknown>;
    const updatedA = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, {
      method: "PUT",
      authorization: `Bearer ${token}`,
      body: { expectedRevision: 1, configuration: { ...desiredA, modelRef: "runtime-model-00000002" } },
    });
    assert.equal(updatedA.response.status, 200, JSON.stringify(updatedA.body));
    assert.equal(updatedA.body.desiredRevision, 2);
    assert.equal(updatedA.body.pendingRestart, true);
    const desiredProfileA = application.store.getWorkConfigRevision(String(workA.body.workId), 2)?.runtimeProfileJson;
    assert.equal((JSON.parse(desiredProfileA!) as { model: { id: string } }).model.id, "claude-next");
    assert.equal((JSON.parse(profileA!) as { model: { id: string } }).model.id, "claude-test");

    const invalidConfiguration = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, {
      method: "PUT",
      authorization: `Bearer ${token}`,
      body: { expectedRevision: 2, configuration: { ...desiredA, modelRef: "missing-model" } },
    });
    assert.equal(invalidConfiguration.response.status, 400);
    assert.equal(invalidConfiguration.body.code, "INVALID_CONFIGURATION");
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted administrator and runtime default win over later environment initialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-persisted-precedence-"));
  const paths = ensureCorePaths(root);
  const first = await CoreApplication.create({
    paths,
    initialization: {
      administrator: { account: "original", password: "original password value" },
      runtime: { agentImage: "image:original", provider: "anthropic", model: "model-original", credential: "credential-original" },
    },
  });
  await first.close();
  const second = await CoreApplication.create({
    paths,
    initialization: {
      administrator: { account: "replacement", password: "replacement password value" },
      runtime: { agentImage: "image:replacement", provider: "anthropic", model: "model-replacement", credential: "credential-replacement" },
    },
  });
  try {
    assert.equal(second.store.getAuthenticationUserByAccount("original")?.account, "original");
    assert.equal(second.store.getAuthenticationUserByAccount("replacement"), undefined);
    assert.equal(second.runtimeProfiles.inspect().configured, true);
    assert.equal(second.runtimeProfiles.load().model.id, "model-original");
    const loggedIn = await second.identity.login("original", "original password value", "127.0.0.1");
    assert.equal(loggedIn.user.account, "original");
    assert.equal(second.store.listWorks().length, 0);
  } finally {
    await second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime-unavailable status remains healthy and retries recovery idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-runtime-retry-"));
  const paths = ensureCorePaths(root);
  let attempts = 0;
  const application = await CoreApplication.create({
    paths,
    initialization: {
      administrator: { account: "admin", password: "correct horse battery" },
      runtime: { agentImage: "image:test", provider: "anthropic", model: "model-test", credential: "credential-test" },
    },
    dependencyCheck: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Docker is temporarily unavailable");
    },
    runtimeFactory: async () => runtime,
  });
  try {
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal(application.status().state, "RUNTIME_UNAVAILABLE");
    assert.equal((await json(base, "/healthz")).response.status, 200);
    const retried = await json(base, "/control/status");
    assert.equal(retried.response.status, 200);
    assert.equal(retried.body.state, "READY");
    assert.equal(attempts, 2);
    const stable = await json(base, "/control/status");
    assert.equal(stable.body.state, "READY");
    assert.equal(attempts, 2);
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function json(
  base: string,
  path: string,
  options: { readonly method?: string; readonly authorization?: string; readonly body?: unknown } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: options.method,
    headers: {
      ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}
