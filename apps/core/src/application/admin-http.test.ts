import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CoreApplication, readAdminRequestBody } from "./core-application.js";
import { ensureCorePaths } from "./paths.js";
import { PiworkClient } from "@piwork/client-sdk";
import { packPiPackageDirectory } from "@piwork/pi-package";
import type { DockerRuntime } from "@piwork/runtime-docker";

async function call(base: string, path: string, method = "GET", token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { ...(token === undefined ? {} : { authorization: token }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
test("admin JSON intake closes a slow body at its absolute deadline", async () => {
  const input = new PassThrough();
  input.write("{");
  await assert.rejects(readAdminRequestBody(input as unknown as import("node:http").IncomingMessage, 25), (error: { code?: string; status?: number }) =>
    error.code === "REQUEST_TIMEOUT" && error.status === 408);
  assert.equal(input.destroyed, true);
});

test("admin HTTP guard, user management, revocation and operator isolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-admin-http-"));
  const paths = ensureCorePaths(root);
  const application = await CoreApplication.create({ paths,
    initialization: { administrator: { account: "root", password: "correct horse battery" } } });
  try {
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const operator = (await readFile(paths.operatorCredentialPath, "utf8")).trim();
    const login = await call(base, "/api/v1/login", "POST", undefined, { account: "root", password: "correct horse battery" });
    assert.equal(login.status, 200);
    const admin = `Bearer ${login.body.token}`;
    assert.equal((await call(base, "/api/v1/admin/status")).status, 401);
    assert.equal((await call(base, "/api/v1/admin/status", "GET", `Operator ${operator}`)).status, 401);
    assert.equal((await call(base, "/control/status", "GET", admin)).status, 200); // Public control status remains public.
    assert.equal((await call(base, "/control/users", "GET", admin)).status, 401);
    const status = await call(base, "/api/v1/admin/status", "GET", admin);
    assert.equal(status.status, 200);
    assert.equal(status.body.adminApiVersion, 1);
    assert.equal(status.body.state, "RUNTIME_NOT_CONFIGURED");
    assert.equal((await call(base, "/api/v1/admin/no-such-resource", "GET", admin)).status, 404);
    assert.equal((await call(base, "/api/v1/admin/status", "PUT", admin, {})).status, 405);
    const uninitializedDefault = await call(base, "/api/v1/admin/default-work", "PATCH", admin, { agentsMd: "hello" });
    assert.equal(uninitializedDefault.status, 409);
    assert.equal(uninitializedDefault.body.code, "DEFAULT_WORK_NOT_CONFIGURED");
    assert.equal((await call(base, "/api/v1/admin/bootstrap", "POST", admin, {})).status, 404);
    const user = await call(base, "/api/v1/admin/users", "POST", admin,
      { account: "alice", password: "alice correct battery" });
    assert.equal(user.status, 201);
    assert.equal(user.body.role, "user");
    assert.equal("passwordDigest" in user.body, false);
    assert.equal((await call(base, "/api/v1/admin/users", "POST", admin,
      { account: "alice", password: "alice correct battery" })).status, 409);
    const aliceLogin = await call(base, "/api/v1/login", "POST", undefined, { account: "alice", password: "alice correct battery" });
    assert.equal(aliceLogin.status, 200);
    assert.equal((await call(base, "/api/v1/admin/users", "GET", `Bearer ${aliceLogin.body.token}`)).status, 403);
    assert.equal((await call(base, "/api/v1/admin/users", "GET", admin)).status, 200);
    assert.equal((await call(base, `/api/v1/admin/users/${user.body.id}/disable`, "POST", admin, {})).status, 200);
    assert.equal((await call(base, "/api/v1/me", "GET", `Bearer ${aliceLogin.body.token}`)).status, 401);
    assert.equal((await call(base, `/api/v1/admin/users/${user.body.id}/enable`, "POST", admin, {})).status, 200);
    const aliceAgain = await call(base, "/api/v1/login", "POST", undefined, { account: "alice", password: "alice correct battery" });
    assert.equal(aliceAgain.status, 200);
    assert.equal((await call(base, `/api/v1/admin/users/${user.body.id}/reset-credential`, "POST", admin,
      { password: "alice changed battery" })).status, 200);
    assert.equal((await call(base, "/api/v1/me", "GET", `Bearer ${aliceAgain.body.token}`)).status, 401);
    assert.equal((await call(base, `/api/v1/admin/users/${(login.body.user as { id: string }).id}/disable`, "POST", admin, {})).body.code, "LAST_ADMINISTRATOR");
    const secondAdmin = await call(base, "/api/v1/admin/users", "POST", admin,
      { account: "second", password: "second correct battery", role: "admin" });
    assert.equal(secondAdmin.status, 201);
    const resetSelf = await call(base, `/api/v1/admin/users/${(login.body.user as { id: string }).id}/reset-credential`, "POST", admin,
      { password: "root changed battery" });
    assert.equal(resetSelf.status, 200);
    assert.equal((await call(base, "/api/v1/admin/status", "GET", admin)).status, 401);
    const secondLogin = await call(base, "/api/v1/login", "POST", undefined, { account: "second", password: "second correct battery" });
    assert.equal((await call(base, "/api/v1/admin/users", "GET", `Bearer ${secondLogin.body.token}`)).status, 200);
    const rootAgain = await call(base, "/api/v1/login", "POST", undefined, { account: "root", password: "root changed battery" });
    const firstId = (login.body.user as { id: string }).id;
    const [disableRoot, disableSecond] = await Promise.all([
      call(base, `/api/v1/admin/users/${firstId}/disable`, "POST", `Bearer ${rootAgain.body.token}`, {}),
      call(base, `/api/v1/admin/users/${secondAdmin.body.id}/disable`, "POST", `Bearer ${secondLogin.body.token}`, {}),
    ]);
    assert.deepEqual([disableRoot.status, disableSecond.status].sort(), [200, 409]);
    assert.equal(application.store.listManagedUsers().filter((item) => item.role === "admin" && item.enabled).length, 1);
    const surviving = disableRoot.status === 200 ? String(secondLogin.body.token) : String(rootAgain.body.token);
    const sessionId = application.identity.authenticate(surviving).sessionId;
    application.store.exec(`UPDATE login_sessions SET expires_at = '2020-01-01T00:00:00Z' WHERE id = '${sessionId}'`);
    assert.equal((await call(base, "/api/v1/admin/status", "GET", `Bearer ${surviving}`)).status, 401);
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("admin runtime returns saved configuration when dependency recovery fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-admin-runtime-"));
  let available = false, probes = 0;
  const running = new Set<string>();
  const application = await CoreApplication.create({ paths: ensureCorePaths(root),
    initialization: { administrator: { account: "root", password: "correct horse battery" } },
    dependencyCheck: async () => { probes += 1; if (!available) throw new Error("private runtime failure"); },
    runtimeFactory: async () => ({ async resolveImageIdentity() { return `sha256:${"a".repeat(64)}`; },
      async prepare() {}, async start(work, generation) { running.add(work.id); return { instanceId: `instance-${generation}`, generation }; },
      async inspect(workId) { const ready = running.has(workId); return { exists: ready, running: ready, ready }; },
      async drain() {}, async stop(workId) { running.delete(workId); }, async remove(workId) { running.delete(workId); },
      async listManagedInstances() { return []; } }),
  });
  try {
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const login = await call(base, "/api/v1/login", "POST", undefined, { account: "root", password: "correct horse battery" });
    const token = `Bearer ${login.body.token}`;
    assert.deepEqual((await call(base, "/api/v1/admin/runtime", "GET", token)).body, { configured: false });
    const input = { agentImage: "piwork-agentd:test", provider: "anthropic", model: "claude-test", credential: "model-secret" };
    const invalid = await call(base, "/api/v1/admin/runtime", "PUT", token, { ...input, provider: "invalid space" });
    assert.equal(invalid.status, 400);
    assert.equal(JSON.stringify(invalid.body).includes(input.credential), false);
    assert.deepEqual((await call(base, "/api/v1/admin/runtime", "GET", token)).body, { configured: false });
    const saved = await call(base, "/api/v1/admin/runtime", "PUT", token, input);
    assert.equal(saved.status, 200);
    assert.equal((saved.body.status as { state: string }).state, "RUNTIME_UNAVAILABLE");
    const view = (await call(base, "/api/v1/admin/runtime", "GET", token)).body;
    assert.equal(view.agentImage, input.agentImage);
    assert.equal(JSON.stringify(view).includes("model-secret"), false);
    assert.equal("revision" in view, false);
    assert.equal("version" in view, false);
    available = true;
    const beforeRecovery = probes;
    const recovered = await Promise.all([call(base, "/api/v1/admin/status", "GET", token), call(base, "/api/v1/admin/status", "GET", token)]);
    assert.ok(recovered.every((item) => item.body.state === "READY"));
    assert.equal(probes - beforeRecovery, 1, "concurrent status checks share one recovery probe");
    const work = await call(base, "/api/v1/works", "POST", token, { name: "original-work", idempotencyKey: "original-work" });
    assert.equal(work.status, 202, JSON.stringify(work.body));
    const originalProfile = application.store.getWorkConfigRevision(String(work.body.workId), 1)?.runtimeProfileJson;
    assert.equal((JSON.parse(originalProfile!) as { model: { id: string } }).model.id, "claude-test");
    const [runtimeTwo, runtimeThree] = await Promise.all([
      call(base, "/api/v1/admin/runtime", "PUT", token, { ...input, model: "claude-two" }),
      call(base, "/api/v1/admin/runtime", "PUT", token, { ...input, model: "claude-three" }),
    ]);
    assert.equal(runtimeTwo.status, 200); assert.equal(runtimeThree.status, 200);
    assert.equal((application.runtimeProfiles.inspect() as { revision: number }).revision, 3);
    assert.equal(application.store.getWorkConfigRevision(String(work.body.workId), 1)?.runtimeProfileJson, originalProfile);
    const initialDefault = await call(base, "/api/v1/admin/default-work", "GET", token);
    assert.equal(initialDefault.status, 200);
    assert.equal(initialDefault.body.baseImage, input.agentImage);
    const agentsPatch = await call(base, "/api/v1/admin/default-work", "PATCH", token, { agentsMd: "# Notes\n" });
    assert.equal(agentsPatch.status, 200);
    assert.equal((agentsPatch.body.configuration as { agentsMd: string }).agentsMd, "# Notes\n");
    const imagePatch = await call(base, "/api/v1/admin/default-work", "PATCH", token, { baseImage: "piwork-agentd:other" });
    assert.equal(imagePatch.status, 200);
    assert.equal(imagePatch.body.baseImage, "piwork-agentd:other");
    assert.equal((imagePatch.body.configuration as { agentsMd: string }).agentsMd, "# Notes\n");
    const rejected = await call(base, "/api/v1/admin/default-work", "PATCH", token,
      { baseImage: "piwork-agentd:rejected", skills: ["unknown-skill"] });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.field, "skills.0");
    const afterRejected = (await call(base, "/api/v1/admin/default-work", "GET", token)).body;
    assert.equal(afterRejected.baseImage, "piwork-agentd:other");
    assert.equal((afterRejected.configuration as { agentsMd: string }).agentsMd, "# Notes\n");
    const rejectedId = `image-${createHash("sha256").update("piwork-agentd:rejected").digest("hex").slice(0, 24)}`;
    assert.equal(application.store.getCatalogEntry(rejectedId), undefined, "failed patch rolls back catalog registration");
    const [imageEdit, agentsEdit] = await Promise.all([
      call(base, "/api/v1/admin/default-work", "PATCH", token, { baseImage: "piwork-agentd:concurrent" }),
      call(base, "/api/v1/admin/default-work", "PATCH", token, { agentsMd: "concurrent notes" }),
    ]);
    assert.equal(imageEdit.status, 200); assert.equal(agentsEdit.status, 200);
    const merged = (await call(base, "/api/v1/admin/default-work", "GET", token)).body;
    assert.equal(merged.baseImage, "piwork-agentd:concurrent");
    assert.equal((merged.configuration as { agentsMd: string }).agentsMd, "concurrent notes");
    const [imageWithPackages, packagesEdit] = await Promise.all([
      call(base, "/api/v1/admin/default-work", "PATCH", token, { baseImage: "piwork-agentd:with-packages" }),
      call(base, "/api/v1/admin/default-work", "PATCH", token, { packages: [] }),
    ]);
    assert.equal(imageWithPackages.status, 200); assert.equal(packagesEdit.status, 200);
    const afterPackages = (await call(base, "/api/v1/admin/default-work", "GET", token)).body;
    assert.equal(afterPackages.baseImage, "piwork-agentd:with-packages");
    assert.deepEqual((afterPackages.configuration as { packages: unknown[] }).packages, []);
    assert.equal((await call(base, "/api/v1/admin/default-work", "PATCH", token, { agentsMd: "first" })).status, 200);
    assert.equal((await call(base, "/api/v1/admin/default-work", "PATCH", token, { agentsMd: "second" })).status, 200);
    assert.equal(((await call(base, "/api/v1/admin/default-work", "GET", token)).body.configuration as { agentsMd: string }).agentsMd, "second");
    assert.equal((await call(base, "/api/v1/admin/default-work", "PATCH", token, { agentsMd: "" })).status, 200);
    const cleared = await call(base, "/api/v1/admin/default-work", "PATCH", token, { skills: [], packages: [], agentsMd: "" });
    assert.equal(cleared.status, 200);
    assert.deepEqual((cleared.body.configuration as { skills: string[] }).skills, []);
    const operator = (await readFile(application.paths.operatorCredentialPath, "utf8")).trim();
    const operatorImage = await call(base, "/control/default-work", "PUT", `Operator ${operator}`,
      { patch: { baseImage: "piwork-agentd:operator" } });
    assert.equal(operatorImage.status, 200);
    assert.equal((await call(base, "/api/v1/admin/default-work", "GET", token)).body.baseImage, "piwork-agentd:operator");
    const boundary = "界".repeat(87_381) + "x";
    assert.equal(Buffer.byteLength(boundary), 256 * 1024);
    assert.equal((await call(base, "/api/v1/admin/default-work", "PATCH", token, { agentsMd: boundary })).status, 200);
    const escapedBody = JSON.stringify({ agentsMd: boundary }).replaceAll("界", "\\u754c");
    assert.ok(Buffer.byteLength(escapedBody) > 256 * 1024 && Buffer.byteLength(escapedBody) < 2 * 1024 * 1024);
    const escapedResponse = await fetch(`${base}/api/v1/admin/default-work`, { method: "PATCH",
      headers: { authorization: token, "content-type": "application/json" }, body: escapedBody });
    assert.equal(escapedResponse.status, 200);
    const tooLarge = await call(base, "/api/v1/admin/default-work", "PATCH", token, { agentsMd: `${boundary}x` });
    assert.equal(tooLarge.status, 400);
    assert.equal(tooLarge.body.field, "agentsMd");
    assert.equal((await call(base, "/api/v1/admin/default-work", "PATCH", token,
      { agentsMd: "still valid", unknown: "x" })).status, 400);
    assert.equal((await call(base, "/api/v1/admin/default-work", "PATCH", token,
      { agentsMd: "x".repeat(2 * 1024 * 1024) })).status, 413);
    assert.equal((await call(base, "/api/v1/admin/default-work", "GET", token)).body.baseImage, "piwork-agentd:operator");
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("admin Skill content upload preserves directory identity and rejects unsafe trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-admin-skill-"));
  const paths = ensureCorePaths(root);
  await mkdir(join(paths.dataDirectory, "skill-uploads", "orphan"), { recursive: true });
  await writeFile(join(paths.dataDirectory, "skill-uploads", "orphan", "partial"), "unfinished");
  const application = await CoreApplication.create({ paths,
    initialization: { administrator: { account: "root", password: "correct horse battery" } } });
  try {
    assert.deepEqual(await readdir(join(paths.dataDirectory, "skill-uploads")), []);
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const login = await call(base, "/api/v1/login", "POST", undefined, { account: "root", password: "correct horse battery" });
    const token = String(login.body.token);
    const client = new PiworkClient({ coreUrl: base, token });
    const files = async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () { yield Buffer.from("# Skill\n"); })() };
      yield { relativePath: "references/说明.md", content: (async function* () { yield Buffer.from("rules\n"); })() };
    };
    const uploaded = await client.adminUploadSkill("code-review", files());
    assert.equal(uploaded.name, "code-review");
    assert.equal(uploaded.fileCount, 2);
    assert.equal((await client.adminSkill("code-review")).enabled, true);
    assert.equal((await call(base, "/api/v1/skills", "GET", `Bearer ${token}`)).status, 200);
    await assert.rejects(client.adminUploadSkill("code-review", files()), (error) =>
      (error as { code?: string }).code === "SKILL_ALREADY_EXISTS");
    const originalIdentity = application.store.getManagedSkill("code-review")!.currentIdentity;
    assert.equal((await client.adminSetSkillEnabled("code-review", false)).enabled, false);
    await assert.rejects(client.adminUploadSkill("other-skill", files(), "code-review"), (error) =>
      (error as { code?: string }).code === "SKILL_NAME_MISMATCH");
    assert.equal(application.store.getManagedSkill("code-review")!.currentIdentity, originalIdentity);
    const updated = await client.adminUploadSkill("code-review", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () { yield Buffer.from("updated content\n"); })() };
    })(), "code-review");
    assert.equal(updated.enabled, false);
    assert.notEqual(application.store.getManagedSkill("code-review")!.currentIdentity, originalIdentity);
    assert.equal((await client.adminSkill("code-review")).enabled, false);
    const empty = await client.adminUploadSkill("empty-skill", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () {})() };
    })());
    assert.equal(empty.fileCount, 1);
    assert.equal(empty.totalBytes, 0);
    const managed = await client.adminSkills();
    assert.ok(managed.skills.some((item) => item.name === "code-review" && !item.enabled));
    const publicSkills = await call(base, "/api/v1/skills", "GET", `Bearer ${token}`);
    assert.equal((publicSkills.body.skills as Array<{ name: string }>).some((item) => item.name === "code-review"), false);
    application.store.setControlMetadata("default_work_configuration", { version: 1,
      configuration: { skills: ["code-review"] } }, new Date().toISOString());
    assert.equal((await call(base, "/api/v1/admin/skills/code-review/disable", "POST", `Bearer ${token}`, {})).status, 400);
    assert.equal((await fetch(`${base}/api/v1/admin/skills/code-review`, { method: "DELETE",
      headers: { authorization: `Bearer ${token}` } })).status, 400);
    application.store.setControlMetadata("default_work_configuration", { version: 1,
      configuration: { skills: [] } }, new Date().toISOString());
    const invalid = async (fileName: string) => {
      const boundary = "piwork-fixture";
      const payload = `--${boundary}\r\nContent-Disposition: form-data; name="directoryName"\r\n\r\nunsafe\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="SKILL.md"\r\n\r\nx\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\n\r\ny\r\n` +
        `--${boundary}--\r\n`;
      const response = await fetch(`${base}/api/v1/admin/skills`, { method: "POST", headers: {
        authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` }, body: payload });
      return response.status;
    };
    assert.equal(await invalid("..%2Foutside"), 400);
    assert.equal(await invalid("SKILL.md"), 400);
    assert.equal(await invalid("SKILL.md%2Fchild"), 400);
    assert.equal(await invalid("%2Foutside"), 400);
    assert.equal(await invalid("C%3Afile"), 400);
    assert.equal(await invalid(encodeURIComponent(`${"nested/".repeat(64)}file`)), 400);
    assert.equal(await invalid("bad%ZZ"), 400);
    assert.equal((await client.adminSkill("code-review")).fileCount, 1);
    await assert.rejects(client.adminUploadSkill("too-large-file", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () { yield Buffer.from("valid"); })() };
      yield { relativePath: "large.bin", content: (async function* () { yield Buffer.alloc(8 * 1024 * 1024 + 1); })() };
    })()), (error) => (error as { status?: number }).status === 413);
    await assert.rejects(client.adminUploadSkill("too-many-files", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () {})() };
      for (let index = 0; index < 2048; index++) yield { relativePath: `files/${index}.txt`, content: (async function* () {})() };
    })()), (error) => (error as { status?: number }).status === 413);
    await assert.rejects(client.adminUploadSkill("too-much-content", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () {})() };
      for (let index = 0; index < 4; index++) yield { relativePath: `files/${index}.bin`,
        content: (async function* () { yield Buffer.alloc(8 * 1024 * 1024); })() };
      yield { relativePath: "files/extra.bin", content: (async function* () { yield Buffer.from("x"); })() };
    })()), (error) => (error as { status?: number }).status === 413);
    const boundarySkill = await client.adminUploadSkill("limit-skill", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () {})() };
      for (let index = 0; index < 4; index++) yield { relativePath: `files/${index}.bin`,
        content: (async function* () { yield Buffer.alloc(8 * 1024 * 1024); })() };
      for (let index = 4; index < 2047; index++) yield { relativePath: `files/${index}.txt`,
        content: (async function* () {})() };
    })());
    assert.equal(boundarySkill.fileCount, 2048);
    await client.adminRemoveSkill("limit-skill");
    assert.equal(application.store.getManagedSkill("too-large-file"), undefined);
    assert.equal(application.store.getManagedSkill("too-many-files"), undefined);
    assert.equal(application.store.getManagedSkill("too-much-content"), undefined);
    assert.deepEqual(await readdir(join(application.paths.dataDirectory, "skill-uploads")), []);
    let releaseConcurrent!: () => void, twoStarted!: () => void;
    const concurrentGate = new Promise<void>((resolve) => { releaseConcurrent = resolve; });
    const concurrentStarted = new Promise<void>((resolve) => { twoStarted = resolve; });
    let activeGenerators = 0;
    const heldFiles = () => (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () {
        yield Buffer.from("start"); activeGenerators += 1;
        if (activeGenerators === 2) twoStarted();
        await concurrentGate; yield Buffer.from("end");
      })() };
    })();
    const firstHeld = client.adminUploadSkill("held-one", heldFiles());
    const secondHeld = client.adminUploadSkill("held-two", heldFiles());
    await concurrentStarted;
    try {
      await assert.rejects(client.adminUploadSkill("held-third", files()), (error) =>
        (error as { status?: number; code?: string }).status === 429 && (error as { code?: string }).code === "SKILL_UPLOAD_BUSY");
    } finally { releaseConcurrent(); }
    assert.equal((await firstHeld).name, "held-one");
    assert.equal((await secondHeld).name, "held-two");
    await client.adminRemoveSkill("held-one");
    await client.adminRemoveSkill("held-two");
    const aborter = new AbortController();
    let abortStarted!: () => void, releaseAborted!: () => void;
    const startedAborted = new Promise<void>((resolve) => { abortStarted = resolve; });
    const abortedGate = new Promise<void>((resolve) => { releaseAborted = resolve; });
    const interrupted = client.adminUploadSkill("interrupted-skill", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () {
        yield Buffer.from("partial"); abortStarted(); await abortedGate; yield Buffer.from("more");
      })() };
    })(), undefined, { signal: aborter.signal });
    await startedAborted;
    await new Promise((resolve) => setTimeout(resolve, 20));
    aborter.abort(); releaseAborted();
    await assert.rejects(interrupted);
    for (let attempt = 0; attempt < 40 && (await readdir(join(application.paths.dataDirectory, "skill-uploads"))).length > 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(application.store.getManagedSkill("interrupted-skill"), undefined);
    assert.deepEqual(await readdir(join(application.paths.dataDirectory, "skill-uploads")), []);
    await client.adminRemoveSkill("empty-skill");
    await assert.rejects(client.adminSkill("empty-skill"), (error) => (error as { status?: number }).status === 404);
    assert.equal((await call(base, "/api/v1/admin/skills", "POST", `Bearer ${token}`, { path: "/tmp/private" })).status, 415);
    let releaseUpload!: () => void, uploadStarted!: () => void;
    const waiting = new Promise<void>((resolve) => { releaseUpload = resolve; });
    const started = new Promise<void>((resolve) => { uploadStarted = resolve; });
    const pending = client.adminUploadSkill("revoked-skill", (async function* () {
      yield { relativePath: "SKILL.md", content: (async function* () {
        yield Buffer.from("first part"); uploadStarted(); await waiting; yield Buffer.from("second part");
      })() };
    })());
    await started;
    const reset = await call(base, `/api/v1/admin/users/${(login.body.user as { id: string }).id}/reset-credential`,
      "POST", `Bearer ${token}`, { password: "root changed battery" });
    assert.equal(reset.status, 200);
    releaseUpload();
    await assert.rejects(pending);
    assert.equal(application.store.getManagedSkill("revoked-skill"), undefined);
    assert.deepEqual(await readdir(join(application.paths.dataDirectory, "skill-uploads")), []);
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("admin package uploads and idempotency are scoped to the authenticated actor", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-admin-package-"));
  const paths = ensureCorePaths(join(root, "core"));
  const application = await CoreApplication.create({ paths,
    dependencyCheck: async () => undefined,
    runtimeFactory: async () => ({
      async resolveImageIdentity() { return `sha256:${"a".repeat(64)}`; },
      async prepare() {}, async start(_work, generation) { return { instanceId: `instance-${generation}`, generation }; },
      async inspect() { return { exists: false, running: false, ready: false }; },
      async drain() {}, async stop() {}, async remove() {}, async listManagedInstances() { return []; },
    }),
    packageDockerFactory: () => ({
      async prepareImage() { return { imageId: `sha256:${"a".repeat(64)}` }; },
      async inspectPiPackageHelperContract() {},
      async inspectPiPackageEnvironment() { return { os: "linux", architecture: "x64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" }; },
    } as unknown as DockerRuntime),
    initialization: { administrator: { account: "owner", password: "correct horse battery" },
      runtime: { agentImage: "piwork-agentd:test", provider: "anthropic", model: "fixture", credential: "fixture-secret" } },
  });
  try {
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const login = async (account: string, password: string) => String((await call(base, "/api/v1/login", "POST", undefined, { account, password })).body.token);
    const ownerToken = await login("owner", "correct horse battery");
    const owner = new PiworkClient({ coreUrl: base, token: ownerToken });
    await owner.adminCreateUser({ account: "second", password: "second correct battery", role: "admin" });
    const secondToken = await login("second", "second correct battery");
    const other = new PiworkClient({ coreUrl: base, token: secondToken });
    const operatorCredential = (await readFile(paths.operatorCredentialPath, "utf8")).trim();
    const source = join(root, "local-source");
    await mkdir(source);
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "@example/admin-package", version: "1.0.0" }));
    const zip = join(root, "package.zip");
    const packed = await packPiPackageDirectory(source, zip);
    const upload = await owner.adminUploadPiPackage((async function* () { yield await readFile(zip); })(), packed.digest,
      packed.bytes, "local-source", "local");
    assert.equal(application.store.packages.getUpload(upload.uploadId)?.actorId,
      (await call(base, "/api/v1/me", "GET", `Bearer ${ownerToken}`)).body.id);
    const sourceRef = { kind: "upload" as const, uploadId: upload.uploadId };
    await assert.rejects(other.adminInstallPackage(sourceRef, "shared-key"), (error) =>
      (error as { code?: string }).code === "PI_PACKAGE_NOT_FOUND");
    const operatorUse = await call(base, "/control/packages", "POST", `Operator ${operatorCredential}`,
      { source: sourceRef, idempotencyKey: "shared-key" });
    assert.equal(operatorUse.status, 404);
    const accepted = await owner.adminInstallPackage(sourceRef, "shared-key", false);
    assert.equal(accepted.reused, false);
    const replay = await owner.adminInstallPackage(sourceRef, "shared-key", false);
    assert.equal(replay.reused, true);
    assert.equal(replay.operationId, accepted.operationId);
    const ownerAgain = new PiworkClient({ coreUrl: base, token: await login("owner", "correct horse battery") });
    assert.equal((await ownerAgain.adminInstallPackage(sourceRef, "shared-key", false)).operationId, accepted.operationId);
    const otherAccepted = await other.adminInstallPackage({ kind: "npm", spec: "@example/admin-package@1.0.0" }, "shared-key");
    assert.notEqual(otherAccepted.operationId, accepted.operationId);
    const operatorAccepted = await call(base, "/control/packages", "POST", `Operator ${operatorCredential}`,
      { source: { kind: "npm", spec: "@example/admin-package@1.0.0" }, idempotencyKey: "shared-key" });
    assert.equal(operatorAccepted.status, 409, JSON.stringify(operatorAccepted.body));
    assert.equal(operatorAccepted.body.code, "PI_PACKAGE_BUSY", "operator key cannot replay an admin operation");
    assert.equal((await other.adminOperation(accepted.operationId)).workId, null);
    await assert.rejects(other.adminOperation("missing-operation"), (error) => (error as { status?: number }).status === 404);
    const work = await call(base, "/api/v1/works", "POST", `Bearer ${ownerToken}`,
      { name: "private-work", idempotencyKey: "private-work" });
    assert.equal(work.status, 202);
    assert.equal((await call(base, `/api/v1/admin/operations/${work.body.operationId}`, "GET", `Bearer ${secondToken}`)).status, 404);
    assert.equal((await call(base, "/control/operations/" + accepted.operationId, "GET", `Operator ${operatorCredential}`)).status, 200);
    const operatorCatalog = await call(base, "/control/packages", "GET", `Operator ${operatorCredential}`);
    assert.deepEqual((await owner.adminPackages()).packages, operatorCatalog.body.packages);
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});
