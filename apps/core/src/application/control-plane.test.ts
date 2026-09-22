import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreApplication } from "./core-application.js";
import { ensureCorePaths } from "./paths.js";
import type { WorkRuntimeAdapter } from "../work-management/lifecycle.js";

let resolvedImageIdentity = `sha256:${"a".repeat(64)}`;
const runtime: WorkRuntimeAdapter = {
  async resolveImageIdentity() { return resolvedImageIdentity; },
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
  const skillSource = join(root, "source", "code-review");
  await mkdir(skillSource, { recursive: true });
  await writeFile(join(skillSource, "SKILL.md"), "---\nname: deliberately-different\n---\nUse refs/rules.md.\n");
  await mkdir(join(skillSource, "refs"));
  await writeFile(join(skillSource, "refs", "rules.md"), "review carefully\n");
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
    const defaultWork = await json(base, "/control/default-work", { authorization: `Operator ${operator}` });
    assert.equal(defaultWork.response.status, 200);
    assert.equal(defaultWork.body.revision, undefined);
    assert.equal((defaultWork.body.configuration as Record<string, unknown>).agentsMd, "");

    const login = await json(base, "/api/v1/login", {
      method: "POST",
      body: { account: "admin", password: "correct horse battery" },
    });
    assert.equal(login.response.status, 200);
    const token = String(login.body.token);
    const otherPassword = "other correct battery";
    const otherUser = await json(base, "/control/users", {
      method: "POST", authorization: `Operator ${operator}`,
      body: { account: "other-user", password: otherPassword, role: "user" },
    });
    assert.equal(otherUser.response.status, 201);
    const otherLogin = await json(base, "/api/v1/login", {
      method: "POST", body: { account: "other-user", password: otherPassword },
    });
    assert.equal(otherLogin.response.status, 200);
    const otherToken = String(otherLogin.body.token);
    const importedSkill = await json(base, "/control/skills", {
      method: "POST", authorization: `Operator ${operator}`, body: { path: skillSource },
    });
    assert.equal(importedSkill.response.status, 201, JSON.stringify(importedSkill.body));
    assert.equal(importedSkill.body.name, "code-review");
    assert.equal("path" in importedSkill.body || "identity" in importedSkill.body || "content" in importedSkill.body, false);
    const operatorSkills = await json(base, "/control/skills", { authorization: `Operator ${operator}` });
    assert.deepEqual((operatorSkills.body.skills as Array<Record<string, unknown>>).map((skill) => skill.name), ["code-review", "deploy-work-service"]);
    const userSkills = await json(base, "/api/v1/skills", { authorization: `Bearer ${token}` });
    assert.deepEqual(userSkills.body, { skills: [{ name: "code-review" }, { name: "deploy-work-service" }] });
    const currentDefault = (defaultWork.body.configuration as Record<string, unknown>);
    const selectedDefault = await json(base, "/control/default-work", {
      method: "PUT", authorization: `Operator ${operator}`, body: { configuration: { ...currentDefault, skills: ["code-review"] } },
    });
    assert.equal(selectedDefault.response.status, 200, JSON.stringify(selectedDefault.body));
    const protectedDisable = await json(base, "/control/skills/code-review/disable", { method: "POST", authorization: `Operator ${operator}`, body: {} });
    assert.equal(protectedDisable.response.status, 400);
    await rm(join(root, "source"), { recursive: true, force: true });
    const forbiddenControl = await json(base, "/control/runtime", { authorization: `Bearer ${token}` });
    assert.equal(forbiddenControl.response.status, 401);
    const forbiddenDefault = await json(base, "/control/default-work", { authorization: `Bearer ${token}` });
    assert.equal(forbiddenDefault.response.status, 401);
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
    const crossOwnerConfiguration = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, {
      authorization: `Bearer ${otherToken}`,
    });
    assert.equal(crossOwnerConfiguration.response.status, 404);
    assert.deepEqual(crossOwnerConfiguration.body, { code: "NOT_FOUND", message: "resource was not found", correlationId: crossOwnerConfiguration.body.correlationId });
    const crossOwnerOperation = await json(base, `/api/v1/operations/${String(workA.body.operationId)}`, {
      authorization: `Bearer ${otherToken}`,
    });
    assert.equal(crossOwnerOperation.response.status, 404);
    assert.equal(crossOwnerOperation.body.code, "NOT_FOUND");
    assert.equal(JSON.stringify(crossOwnerOperation.body).includes("code-review"), false);
    assert.deepEqual(application.store.getWorkConfiguration(String(workA.body.workId)) === undefined ? [] : JSON.parse(application.store.getWorkConfiguration(String(workA.body.workId))!.desiredConfigJson).skills, ["code-review"]);
    const initialContextA = application.store.getWorkConfiguration(String(workA.body.workId))!.desiredContextId!;
    const initialSkillIdentityA = application.store.getWorkContextSnapshot(String(workA.body.workId), initialContextA) === undefined
      ? undefined
      : application.workContexts.load(String(workA.body.workId), initialContextA).metadata.skills[0]?.identity;
    assert.ok(initialSkillIdentityA);
    const profileA = application.store.getWorkConfigRevision(String(workA.body.workId), 1)?.runtimeProfileJson;
    assert.equal((JSON.parse(profileA!) as { model: { id: string } }).model.id, "claude-test");

    const otherWork = await json(base, "/api/v1/works", {
      method: "POST", authorization: `Bearer ${otherToken}`,
      body: { name: "service-routes", idempotencyKey: "service-routes-work" },
    });
    const otherWorkId = String(otherWork.body.workId);
    const serviceDefinition = {
      name: "route-demo", image: { reference: "python:3.13-slim" }, command: "/bin/true",
      args: [], environment: {}, secretRefs: [], workingDirectory: "/", mounts: [], ports: [],
      cpuMillis: 250, memoryBytes: 134_217_728, enabled: false, required: false, restartPolicy: "bounded",
    };
    const serviceCreate = await json(base, `/api/v1/works/${otherWorkId}/services`, {
      method: "POST", authorization: `Bearer ${otherToken}`,
      body: { definition: serviceDefinition, idempotencyKey: "service-route-create" },
    });
    assert.equal(serviceCreate.response.status, 202, JSON.stringify(serviceCreate.body));
    assert.equal(serviceCreate.body.workId, otherWorkId);
    assert.equal(serviceCreate.body.correlationId, serviceCreate.body.operationId);
    const serviceId = String(serviceCreate.body.serviceId);
    assert.equal((await json(base, `/api/v1/works/${otherWorkId}/services`, { authorization: `Bearer ${token}` })).response.status, 200);
    assert.equal((await json(base, `/api/v1/works/${otherWorkId}/services/${serviceId}`, { authorization: `Bearer ${token}` })).response.status, 200);
    assert.equal((await json(base, `/api/v1/works/${otherWorkId}/services/${serviceId}/logs`, { authorization: `Bearer ${token}` })).response.status, 403);
    assert.equal((await json(base, `/api/v1/works/${otherWorkId}/services/${serviceId}/revisions`, { authorization: `Bearer ${otherToken}` })).response.status, 200);
    assert.equal((await json(base, `/api/v1/operations/${String(serviceCreate.body.operationId)}`, { authorization: `Bearer ${otherToken}` })).response.status, 200);
    const serviceUpdate = await json(base, `/api/v1/works/${otherWorkId}/services/${serviceId}`, {
      method: "PUT", authorization: `Bearer ${otherToken}`,
      body: { expectedRevision: 1, definition: { ...serviceDefinition, args: ["--help"] }, idempotencyKey: "service-route-update" },
    });
    assert.equal(serviceUpdate.response.status, 202, JSON.stringify(serviceUpdate.body));
    const serviceDisable = await json(base, `/api/v1/works/${otherWorkId}/services/${serviceId}/disable`, {
      method: "POST", authorization: `Bearer ${otherToken}`, body: { idempotencyKey: "service-route-disable" },
    });
    assert.equal(serviceDisable.response.status, 202, JSON.stringify(serviceDisable.body));
    const serviceRemove = await json(base, `/api/v1/works/${otherWorkId}/services/${serviceId}/remove`, {
      method: "POST", authorization: `Bearer ${otherToken}`, body: { idempotencyKey: "service-route-remove" },
    });
    assert.equal(serviceRemove.response.status, 202, JSON.stringify(serviceRemove.body));
    await application.services.waitForIdle();

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

    const explicitWork = await json(base, "/api/v1/works", {
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { name: "work-explicit", skills: ["code-review"], idempotencyKey: "create-explicit" },
    });
    assert.equal(explicitWork.response.status, 202);
    assert.deepEqual(JSON.parse(application.store.getWorkConfiguration(String(explicitWork.body.workId))!.desiredConfigJson).skills, ["code-review"]);
    const emptyWork = await json(base, "/api/v1/works", {
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { name: "work-empty", skills: [], idempotencyKey: "create-empty" },
    });
    assert.equal(emptyWork.response.status, 202);
    const emptyContext = application.store.getWorkConfiguration(String(emptyWork.body.workId))!.desiredContextId!;
    assert.deepEqual(application.workContexts.load(String(emptyWork.body.workId), emptyContext).metadata.skills, []);

    const configurationA = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, { authorization: `Bearer ${token}` });
    const desiredA = configurationA.body.desired as Record<string, unknown>;
    const rejectedRevision = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, {
      method: "PUT",
      authorization: `Bearer ${token}`,
      body: { expectedRevision: 1, configuration: { ...desiredA, modelRef: "runtime-model-00000002" } },
    });
    assert.equal(rejectedRevision.response.status, 400);
    const updatedA = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, {
      method: "PUT",
      authorization: `Bearer ${token}`,
      body: { configuration: { ...desiredA, modelRef: "runtime-model-00000002" } },
    });
    assert.equal(updatedA.response.status, 200, JSON.stringify(updatedA.body));
    assert.equal(updatedA.body.desiredRevision, undefined);
    assert.equal(updatedA.body.pendingApply, true);
    const desiredProfileA = application.store.getWorkConfigRevision(String(workA.body.workId), 2)?.runtimeProfileJson;
    assert.equal((JSON.parse(desiredProfileA!) as { model: { id: string } }).model.id, "claude-next");
    assert.equal((JSON.parse(profileA!) as { model: { id: string } }).model.id, "claude-test");
    const genericContextA = application.store.getWorkConfiguration(String(workA.body.workId))!.desiredContextId!;
    assert.equal(application.workContexts.load(String(workA.body.workId), genericContextA).metadata.skills[0]?.identity, initialSkillIdentityA);

    resolvedImageIdentity = `sha256:${"b".repeat(64)}`;
    await mkdir(join(skillSource, "refs"), { recursive: true });
    await writeFile(join(skillSource, "SKILL.md"), "---\nname: deliberately-different\n---\nUpdated instructions.\n");
    await writeFile(join(skillSource, "refs", "rules.md"), "updated rules\n");
    const updatedManagedSkill = await json(base, "/control/skills/code-review", {
      method: "PUT",
      authorization: `Operator ${operator}`,
      body: { path: skillSource },
    });
    assert.equal(updatedManagedSkill.response.status, 200, JSON.stringify(updatedManagedSkill.body));
    const skillsA = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration/skills`, {
      method: "PUT",
      authorization: `Bearer ${token}`,
      body: { skills: ["code-review"] },
    });
    assert.equal(skillsA.response.status, 200, JSON.stringify(skillsA.body));
    const skillsContextId = application.store.getWorkConfiguration(String(workA.body.workId))!.desiredContextId!;
    assert.equal(application.store.getWorkContextSnapshot(String(workA.body.workId), skillsContextId)?.imageIdentity, `sha256:${"a".repeat(64)}`);
    const reselectedSkillIdentityA = application.workContexts.load(String(workA.body.workId), skillsContextId).metadata.skills[0]?.identity;
    assert.notEqual(reselectedSkillIdentityA, initialSkillIdentityA);

    const agentsA = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration/agents`, {
      method: "PUT",
      authorization: `Bearer ${token}`,
      body: { agentsMd: "# retained image" },
    });
    assert.equal(agentsA.response.status, 200, JSON.stringify(agentsA.body));
    const agentsContextId = application.store.getWorkConfiguration(String(workA.body.workId))!.desiredContextId!;
    assert.equal(application.store.getWorkContextSnapshot(String(workA.body.workId), agentsContextId)?.imageIdentity, `sha256:${"a".repeat(64)}`);
    assert.equal(application.workContexts.load(String(workA.body.workId), agentsContextId).metadata.skills[0]?.identity, reselectedSkillIdentityA);

    const invalidConfiguration = await json(base, `/api/v1/works/${String(workA.body.workId)}/configuration`, {
      method: "PUT",
      authorization: `Bearer ${token}`,
      body: { configuration: { ...desiredA, modelRef: "missing-model" } },
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
