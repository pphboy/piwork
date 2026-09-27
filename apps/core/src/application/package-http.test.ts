import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packPiPackageDirectory, validatePiPackageArtifact } from "@piwork/pi-package";
import { CoreApplication } from "./core-application.js";
import { ensureCorePaths } from "./paths.js";
import type { WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import { PiPackageHelperIncompatibleError, type DockerRuntime } from "@piwork/runtime-docker";
import type { RuntimeSkillStateGateway } from "../runtime/docker-work-runtime.js";
import { UserAdministrationService } from "../identity/user-administration.js";

test("package catalog and ZIP upload authenticate before reading body", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-http-"));
  const paths = ensureCorePaths(join(root, "core"));
  const app = await CoreApplication.create({ paths, initialization: { administrator: { account: "owner", password: "correct horse battery" } } });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const operator = (await readFile(paths.operatorCredentialPath, "utf8")).trim();
    const operatorHeaders = { authorization: `Operator ${operator}` };
    assert.equal((await fetch(`${base}/control/packages`)).status, 401);
    assert.deepEqual(await (await fetch(`${base}/control/packages`, { headers: operatorHeaders })).json(), { packages: [] });
    const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
    const token = (await login.json() as { token: string }).token;
    assert.deepEqual(await (await fetch(`${base}/api/v1/packages`, { headers: { authorization: `Bearer ${token}` } })).json(), { packages: [] });
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "package.json"), '{"name":"@example/pi-tools","version":"1.0.0"}');
    const zip = join(root, "tools.zip");
    await packPiPackageDirectory(source, zip);
    const body = await readFile(zip);
    const headers = { "content-type": "application/zip", "content-length": String(body.length),
      "x-piwork-sha256": createHash("sha256").update(body).digest("hex"),
      "x-piwork-package-source": "zip", "x-piwork-package-name": encodeURIComponent("tools.zip") };
    const uploadRequest = (auth: string | undefined, contentType = "application/zip") => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const wire = httpRequest(`${base}/control/package-uploads`, { method: "POST", headers: {
        ...headers, "content-type": contentType, ...(auth ? { authorization: auth } : {}),
      } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      });
      wire.on("error", reject);
      wire.end(Buffer.from(body));
    });
    assert.equal((await uploadRequest(undefined)).status, 401);
    assert.equal((await uploadRequest(operatorHeaders.authorization, "text/plain")).status, 415);
    const upload = await uploadRequest(operatorHeaders.authorization);
    assert.equal(upload.status, 201);
    const result = JSON.parse(upload.body) as { uploadId: string; expiresAt: string };
    assert.match(result.uploadId, /^upload-[a-f0-9-]+$/);
    assert.equal(app.store.packages.getUpload(result.uploadId)?.sourceKind, "zip");
    const scoped = await fetch(`${base}/control/packages/${encodeURIComponent("@example/pi-tools")}`, { headers: operatorHeaders });
    assert.equal(scoped.status, 404);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("new Works capture the selected Core head while old Works retain their own package bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-default-"));
  const paths = ensureCorePaths(join(root, "core"));
  let observedPackageState: "ready" | "failed" | "unavailable" = "ready";
  let helperIncompatible = false;
  let agentSdkVersion = "0.86.0";
  let selectedImageIdentity = `sha256:${"a".repeat(64)}`;
  const running = new Set<string>();
  const runtime: WorkRuntimeAdapter & RuntimeSkillStateGateway = { async resolveImageIdentity() { return selectedImageIdentity; },
    async prepare() {}, async start(work, generation) { running.add(work.id); return { instanceId: `instance-${generation}`, generation }; },
    async inspect(workId) { const ready = running.has(workId); return { exists: ready, running: ready, ready }; },
    async drain() {}, async stop(workId) { running.delete(workId); }, async remove(workId) { running.delete(workId); }, async listManagedInstances() { return []; },
    async runtimeSkillState() { return { state: observedPackageState, checkedAt: null, skills: [],
      packages: observedPackageState === "unavailable" ? [] : [{ name: "@example/pi-tools", loaded: observedPackageState === "ready",
        diagnostics: observedPackageState === "failed" ? ["PACKAGE_LOAD_FAILED"] : [] }] }; } };
  const app = await CoreApplication.create({ paths, runtimeFactory: async () => runtime,
    packageDockerFactory: () => ({ async prepareImage() { return { imageId: `sha256:${"b".repeat(64)}` }; },
      async inspectPiPackageHelperContract() { if (helperIncompatible) {
        throw Object.assign(new PiPackageHelperIncompatibleError(), { detail: "secret helper output /workspace/sensitive" });
      } },
      async inspectPiPackageEnvironment() { return { os: "linux", architecture: "x64", variant: null, nodeAbi: "137", piSdkVersion: agentSdkVersion }; } } as unknown as DockerRuntime),
    initialization: { administrator: { account: "owner", password: "correct horse battery" },
      runtime: { agentImage: "piwork-agentd:test", provider: "anthropic", model: "fixture", credential: "fixture-secret" } } });
  const name = "@example/pi-tools";
  const preparedEnvironment = { os: "linux" as const, architecture: "x64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" };
  const heads: Array<{ directory: string; digest: string }> = [];
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const operator = (await readFile(paths.operatorCredentialPath, "utf8")).trim();
    const installFixture = async (version: string) => {
      const directory = join(root, `package-${version}`);
      await mkdir(directory);
      await writeFile(join(directory, "package.json"), JSON.stringify({ name, version }));
      await writeFile(join(directory, "version.txt"), version);
      const metadata = (await validatePiPackageArtifact({ root: directory, sourceKind: "local", resolvedSource: `fixture:${version}`, preparedEnvironment })).metadata;
      const digest = metadata.contentDigest;
      app.store.exec(`INSERT INTO pi_package_artifacts(id,scope_kind,work_id,name,content_digest,metadata_json,storage_path,created_at) VALUES ('${digest}','core',NULL,'${name}','${digest}','${JSON.stringify(metadata)}','${directory}','2026-09-25T00:00:00Z')`);
      app.store.exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES ('${name}',1,'${digest}',1,'2026-09-25T00:00:00Z','2026-09-25T00:00:00Z') ON CONFLICT(name) DO UPDATE SET head_artifact_id = excluded.head_artifact_id, generation = generation + 1`);
      heads.push({ directory, digest });
    };
    await installFixture("1.0.0");
    const patch = await fetch(`${base}/control/default-work`, { method: "PUT", headers: { authorization: `Operator ${operator}`, "content-type": "application/json" },
      body: JSON.stringify({ patch: { packages: [{ name, enabled: true }] } }) });
    assert.equal(patch.status, 200, await patch.text());
    const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
    const token = (await login.json() as { token: string }).token;
    const create = async (idempotencyKey: string, configuration?: unknown) => {
      const response = await fetch(`${base}/api/v1/works`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name: idempotencyKey, idempotencyKey, ...(configuration === undefined ? {} : { configuration }) }) });
      const result = (await response.json()) as { workId: string };
      assert.equal(response.status, 202, JSON.stringify(result));
      return result;
    };
    agentSdkVersion = "0.86.1";
    const incompatible = await fetch(`${base}/api/v1/works`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "incompatible", idempotencyKey: "incompatible" }) });
    assert.equal(incompatible.status, 409);
    assert.equal((await incompatible.json() as { code: string }).code, "PI_PACKAGE_ENVIRONMENT_MISMATCH");
    agentSdkVersion = "0.86.0";
    const first = await create("first");
    const firstImage = app.workContexts.load(first.workId, app.store.getWorkConfiguration(first.workId)!.desiredContextId!).metadata.imageIdentity;
    selectedImageIdentity = `sha256:${"c".repeat(64)}`;
    assert.equal(app.workContexts.load(first.workId, app.store.getWorkConfiguration(first.workId)!.desiredContextId!).metadata.imageIdentity,
      firstImage, "an existing Work keeps its captured image when the configured image tag moves");
    selectedImageIdentity = firstImage;
    helperIncompatible = true;
    const packageJobsBefore = app.store.packages.listJobs().length;
    for (const [url, authorization] of [
      [`${base}/control/packages`, `Operator ${operator}`],
      [`${base}/api/v1/works/${first.workId}/packages`, `Bearer ${token}`],
    ]) {
      const response = await fetch(url!, { method: "POST", headers: { authorization: authorization!, "content-type": "application/json" },
        body: JSON.stringify({ source: { kind: "npm", spec: "tools@1.0.0" }, idempotencyKey: `missing-helper-${url}` }) });
      const body = await response.text();
      assert.equal(response.status, 409, body);
      assert.equal(JSON.parse(body).code, "PI_PACKAGE_HELPER_INCOMPATIBLE");
      assert.doesNotMatch(body, /secret helper output|\/workspace\/sensitive/);
    }
    assert.equal(app.store.packages.listJobs().length, packageJobsBefore);
    helperIncompatible = false;
    app.store.packages.insertUpload({ id: "upload-cross-scope", actorId: "operator", scopeKind: "core", workId: null,
      sourceKind: "zip", displayName: "other.zip", digest: `sha256:${"b".repeat(64)}`, size: 10,
      state: "ready", expiresAt: "2099-01-01T00:00:00.000Z", leaseCount: 0, createdAt: "2026-09-25T00:00:00.000Z" });
    const crossScope = await fetch(`${base}/api/v1/works/${first.workId}/packages`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: { kind: "upload", uploadId: "upload-cross-scope" }, idempotencyKey: "cross-scope" }) });
    assert.notEqual(crossScope.status, 202, "a Core upload must not be consumed by a Work package job");
    const firstState = app.store.getWorkConfiguration(first.workId)!;
    const firstContext = app.workContexts.load(first.workId, firstState.desiredContextId!);
    assert.equal(firstContext.metadata.packageBindings[0]?.artifact.contentDigest, heads[0]!.digest);
    await installFixture("2.0.0");
    const second = await create("second");
    const secondState = app.store.getWorkConfiguration(second.workId)!;
    const secondContext = app.workContexts.load(second.workId, secondState.desiredContextId!);
    assert.equal(secondContext.metadata.packageBindings[0]?.artifact.contentDigest, heads[1]!.digest);
    await rm(heads[0]!.directory, { recursive: true });
    const edited = await fetch(`${base}/api/v1/works/${first.workId}/configuration/agents`, { method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ agentsMd: "edited" }) });
    assert.equal(edited.status, 200, await edited.text());
    const retained = app.workContexts.load(first.workId, app.store.getWorkConfiguration(first.workId)!.desiredContextId!);
    assert.equal(retained.metadata.packageBindings[0]?.artifact.contentDigest, heads[0]!.digest);
    const packagePath = `${base}/api/v1/works/${first.workId}/packages/${encodeURIComponent(name)}`;
    const shown = await fetch(packagePath, { headers: { authorization: `Bearer ${token}` } });
    const shownEntry = await shown.json() as { desired: { version: string; enabled: boolean }; runtime: { loaded: boolean | null; diagnostics: string[] } };
    assert.deepEqual(shownEntry.desired, { version: "1.0.0", enabled: true });
    assert.equal(shownEntry.runtime.loaded, true);
    observedPackageState = "failed";
    const failedEntry = await (await fetch(packagePath, { headers: { authorization: `Bearer ${token}` } })).json() as { runtime: { loaded: boolean | null; diagnostics: string[] } };
    assert.deepEqual(failedEntry.runtime, { availability: "unavailable", loaded: null, diagnostics: ["PACKAGE_LOAD_FAILED"] });
    observedPackageState = "unavailable";
    const staleEntry = await (await fetch(packagePath, { headers: { authorization: `Bearer ${token}` } })).json() as { runtime: { loaded: boolean | null; diagnostics: string[] } };
    assert.equal(staleEntry.runtime.loaded, null);
    observedPackageState = "ready";
    const administrator = app.store.listManagedUsers()[0]!;
    await new UserAdministrationService(app.store).createUser({ userId: administrator.id, role: "admin" },
      { account: "another-owner", password: "another correct horse battery" });
    const anotherLogin = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "another-owner", password: "another correct horse battery" }) });
    const otherToken = (await anotherLogin.json() as { token: string }).token;
    assert.equal((await fetch(`${base}/api/v1/works/${first.workId}/packages`, { headers: { authorization: `Bearer ${otherToken}` } })).status, 404);
    assert.equal((await fetch(`${base}/control/packages`, { headers: { authorization: `Bearer ${otherToken}` } })).status, 401);
    const doubleEncoded = `${base}/api/v1/works/${first.workId}/packages/${encodeURIComponent(encodeURIComponent(name))}`;
    assert.equal((await fetch(doubleEncoded, { headers: { authorization: `Bearer ${token}` } })).status, 400,
      "a scoped name path must be decoded exactly once");
    const disabled = await fetch(`${packagePath}/disable`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    assert.equal(disabled.status, 200);
    assert.equal((await disabled.json() as { desired: { enabled: boolean } }).desired.enabled, false);
    const disabledRevision = app.store.getWorkConfiguration(first.workId)!.desiredRevision;
    assert.equal((await fetch(`${packagePath}/disable`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).status, 200);
    assert.equal(app.store.getWorkConfiguration(first.workId)!.desiredRevision, disabledRevision, "repeating disable is a no-op");
    assert.equal(app.store.packages.getCatalog(name)?.enabled, true);
    const removed = await fetch(packagePath, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    assert.equal(removed.status, 200);
    const history = await fetch(`${base}/api/v1/works/${first.workId}/packages`, { headers: { authorization: `Bearer ${token}` } });
    const entries = (await history.json() as { packages: Array<{ name: string; desired: unknown }> }).packages;
    assert.equal(entries.find((item) => item.name === name)?.desired, null);
    const reselectRemoved = await fetch(`${base}/api/v1/works/${first.workId}/configuration/packages`, { method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ packages: [{ name, enabled: true }] }) });
    assert.equal(reselectRemoved.status, 400, "generic configuration cannot silently reinstall a removed package");
    const defaultConfig = (await (await fetch(`${base}/control/default-work`, { headers: { authorization: `Operator ${operator}` } })).json() as { configuration: Record<string, unknown> }).configuration;
    const third = await create("third", { ...defaultConfig, packages: [] });
    assert.deepEqual(app.workContexts.load(third.workId, app.store.getWorkConfiguration(third.workId)!.desiredContextId!).metadata.packageBindings, []);
    const importedFromCore = await fetch(`${base}/api/v1/works/${third.workId}/packages`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: { kind: "core", name }, idempotencyKey: "from-core" }) });
    const accepted = await importedFromCore.json() as { operationId: string; workId: string };
    assert.equal(importedFromCore.status, 202, JSON.stringify(accepted));
    for (let attempt = 0; attempt < 50 && app.store.packages.getJob(accepted.operationId)?.phase !== "succeeded"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(app.store.packages.getJob(accepted.operationId)?.phase, "succeeded");
    const owned = app.workContexts.load(third.workId, app.store.getWorkConfiguration(third.workId)!.desiredContextId!);
    assert.equal(owned.metadata.packageBindings[0]?.artifact.contentDigest, heads[1]!.digest);
    assert.equal(owned.configuration.packages[0]?.enabled, true);
    const thirdPackagePath = `${base}/api/v1/works/${third.workId}/packages/${encodeURIComponent(name)}`;
    assert.equal((await fetch(`${thirdPackagePath}/disable`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).status, 200);
    await installFixture("3.0.0");
    const updateRequest = fetch(`${thirdPackagePath}/update`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: { kind: "core", name }, idempotencyKey: "update-from-core" }) });
    const editRequest = fetch(`${base}/api/v1/works/${third.workId}/configuration/agents`, { method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ agentsMd: "concurrent unrelated edit" }) });
    const [updated, unrelatedEdit] = await Promise.all([updateRequest, editRequest]);
    assert.equal(unrelatedEdit.status, 200, await unrelatedEdit.text());
    const updateAccepted = await updated.json() as { operationId: string };
    assert.equal(updated.status, 202, JSON.stringify(updateAccepted));
    for (let attempt = 0; attempt < 50 && app.store.packages.getJob(updateAccepted.operationId)?.phase !== "succeeded"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(app.store.packages.getJob(updateAccepted.operationId)?.phase, "succeeded");
    const updatedContext = app.workContexts.load(third.workId, app.store.getWorkConfiguration(third.workId)!.desiredContextId!);
    assert.equal(updatedContext.metadata.packageBindings[0]?.artifact.contentDigest, heads[2]!.digest);
    assert.equal(updatedContext.configuration.packages[0]?.enabled, false);
    assert.equal(updatedContext.configuration.agentsMd, "concurrent unrelated edit");
    assert.equal(app.workContexts.load(second.workId, secondState.desiredContextId!).metadata.packageBindings[0]?.artifact.contentDigest, heads[1]!.digest);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
