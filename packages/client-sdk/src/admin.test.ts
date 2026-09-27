import assert from "node:assert/strict";
import test from "node:test";
import { PiworkApiError, PiworkClient, type AdminSkillFile } from "./index.js";

test("admin SDK uses the complete bearer management route table", async () => {
  const calls: Array<{ path: string; method: string; body?: unknown; authorization: string | null }> = [];
  const client = new PiworkClient({ coreUrl: "http://core.test", token: "admin-token", fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET",
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
      authorization: new Headers(init?.headers).get("authorization") });
    return init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({});
  } });
  await client.adminStatus();
  await client.adminUsers();
  await client.adminCreateUser({ account: "alice", password: "long-password" });
  await client.adminSetUserEnabled("user-1", true);
  await client.adminSetUserEnabled("user-1", false);
  await client.adminResetUserCredential("user-1", "new-password-long");
  await client.adminRuntime();
  await client.adminConfigureRuntime({ agentImage: "image", provider: "provider", model: "model", credential: "key" });
  await client.adminDefaultWork();
  await client.adminPatchDefaultWork({ agentsMd: "", packages: [] });
  await client.adminSkills();
  await client.adminSkill("code-review");
  await client.adminSetSkillEnabled("code-review", true);
  await client.adminSetSkillEnabled("code-review", false);
  await client.adminRemoveSkill("code-review");
  await client.adminPackages();
  await client.adminPackage("@scope/tools");
  await client.adminInstallPackage({ kind: "npm", spec: "tools" }, "key", true);
  await client.adminUpdatePackage("@scope/tools", { kind: "git", spec: "https://example.test/repo" }, "key");
  await client.adminSetPackageEnabled("@scope/tools", true);
  await client.adminSetPackageEnabled("@scope/tools", false);
  await client.adminRemovePackage("@scope/tools");
  await client.adminOperation("operation-1");
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /api/v1/admin/status", "GET /api/v1/admin/users", "POST /api/v1/admin/users",
    "POST /api/v1/admin/users/user-1/enable", "POST /api/v1/admin/users/user-1/disable",
    "POST /api/v1/admin/users/user-1/reset-credential", "GET /api/v1/admin/runtime", "PUT /api/v1/admin/runtime",
    "GET /api/v1/admin/default-work", "PATCH /api/v1/admin/default-work", "GET /api/v1/admin/skills",
    "GET /api/v1/admin/skills/code-review", "POST /api/v1/admin/skills/code-review/enable",
    "POST /api/v1/admin/skills/code-review/disable", "DELETE /api/v1/admin/skills/code-review",
    "GET /api/v1/admin/packages", "GET /api/v1/admin/packages/%40scope%2Ftools", "POST /api/v1/admin/packages",
    "POST /api/v1/admin/packages/%40scope%2Ftools/update", "POST /api/v1/admin/packages/%40scope%2Ftools/enable",
    "POST /api/v1/admin/packages/%40scope%2Ftools/disable", "DELETE /api/v1/admin/packages/%40scope%2Ftools",
    "GET /api/v1/admin/operations/operation-1",
  ]);
  assert.ok(calls.every((call) => call.authorization === "Bearer admin-token"));
  assert.deepEqual(calls[9]!.body, { agentsMd: "", packages: [] });
  assert.deepEqual(calls[17]!.body, { source: { kind: "npm", spec: "tools" }, idempotencyKey: "key", addToDefaults: true });
  assert.deepEqual(calls[18]!.body, { source: { kind: "git", spec: "https://example.test/repo" }, idempotencyKey: "key" });
  const operator = new PiworkClient({ coreUrl: "http://core.test", operatorToken: "operator", fetch: async () => { throw new Error("should not fetch"); } });
  await assert.rejects(operator.adminStatus(), /requires a bearer token/);
  const absent = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => { throw new Error("should not fetch"); } });
  await assert.rejects(absent.adminStatus(), /requires a bearer token/);
  const bad = new PiworkClient({ coreUrl: "http://core.test", token: "admin", operatorToken: "operator" });
  await assert.rejects(bad.adminStatus(), /requires a bearer token/);
});

test("admin SDK preserves public error field and correlationId", async () => {
  const response = { code: "INVALID_REQUEST", message: "invalid value", correlationId: "correlation-0199e6d8abcd", field: "agentsMd" };
  const client = new PiworkClient({ coreUrl: "http://core.test", token: "admin", fetch: async () => Response.json(response, { status: 400 }) });
  await assert.rejects(client.adminPatchDefaultWork({ agentsMd: "x" }), (error) => error instanceof PiworkApiError
    && error.status === 400 && error.code === "INVALID_REQUEST" && error.details?.field === "agentsMd"
    && error.details?.correlationId === response.correlationId);
});

test("admin uploads stream Skill multipart and package ZIP with distinct authorization", async () => {
  const seen: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  const client = new PiworkClient({ coreUrl: "http://core.test", token: "admin", fetch: async (input, init) => {
    let body = "";
    if (init?.body instanceof ReadableStream) {
      for await (const chunk of init.body) body += Buffer.from(chunk).toString("utf8");
    }
    seen.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body });
    return Response.json(String(input).endsWith("package-uploads") ? { uploadId: "upload-0199e6d8abcd", expiresAt: "2026-09-20T00:00:00Z" } : {});
  } });
  async function* files(): AsyncGenerator<AdminSkillFile> {
    yield { relativePath: "SKILL.md", content: (async function* () { yield Buffer.from("# Skill"); })() };
    yield { relativePath: "references/说明.md", content: (async function* () { yield Buffer.from("ok"); })() };
  }
  await client.adminUploadSkill("code-review", files());
  await client.adminUploadSkill("code-review", files(), "code-review");
  await client.adminUploadPiPackage((async function* () { yield Buffer.from("zip"); })(), "a".repeat(64), 3, "tools.zip", "zip");
  assert.ok(seen[0]!.url.endsWith("/api/v1/admin/skills"));
  assert.equal(seen[0]!.method, "POST");
  assert.match(seen[0]!.headers.get("content-type") ?? "", /^multipart\/form-data; boundary=piwork-[a-f0-9]{36}$/);
  assert.match(seen[0]!.body, /name="directoryName"\r\n\r\ncode-review/);
  assert.match(seen[0]!.body, /filename="references%2F%E8%AF%B4%E6%98%8E.md"/);
  assert.ok(seen[1]!.url.endsWith("/api/v1/admin/skills/code-review"));
  assert.equal(seen[1]!.method, "PUT");
  assert.ok(seen[2]!.url.endsWith("/api/v1/admin/package-uploads"));
  assert.equal(seen[2]!.headers.get("content-length"), "3");
  assert.equal(seen[2]!.headers.get("x-piwork-sha256"), "a".repeat(64));
  assert.equal(seen[2]!.headers.get("x-piwork-package-source"), "zip");
  assert.equal(seen[2]!.headers.get("x-piwork-package-name"), "tools.zip");
  assert.ok(seen.every((call) => call.headers.get("authorization") === "Bearer admin"));
});

test("admin upload aborts a stalled stream and maps Core errors", async () => {
  const controller = new AbortController();
  const stalled = new PiworkClient({ coreUrl: "http://core.test", token: "admin", fetch: async (_input, init) => {
    assert.equal(init?.signal, controller.signal);
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const pending = stalled.adminUploadPiPackage((async function* () { yield Buffer.from("zip"); })(), "a".repeat(64), 3, "tools.zip", "zip", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof PiworkApiError && error.code === "NETWORK_ERROR");
  const failed = new PiworkClient({ coreUrl: "http://core.test", token: "admin", fetch: async () =>
    Response.json({ code: "SKILL_INVALID", message: "invalid tree", correlationId: "correlation-0199e6d8abcd", field: "files" }, { status: 400 }) });
  await assert.rejects(failed.adminUploadSkill("code-review", (async function* () {
    yield { relativePath: "SKILL.md", content: (async function* () { yield Buffer.from("x"); })() };
  })()), (error) => error instanceof PiworkApiError && error.status === 400 && error.details?.field === "files");
});
