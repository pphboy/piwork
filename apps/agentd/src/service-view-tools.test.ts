import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { SERVICE_VIEW_TOOLS, isServiceViewRequest } from "@piwork/contracts";
import { createDeterministicRuntime, mapSdkEvent } from "@piwork/pi-adapter";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { serviceViewToolNames, serviceViewTools } from "./service-view-tools.js";
import { createPackageResourceLoader, packageNameKey } from "./package-resources.js";
import { selectPackageTools } from "./application.js";

test("Service view tools respect policy, reserve disabled names and reject invalid or cancelled calls", async () => {
  assert.deepEqual(serviceViewToolNames({ allowed: [], denied: [] }), [...SERVICE_VIEW_TOOLS]);
  assert.deepEqual(serviceViewToolNames({ allowed: ["service_select"], denied: ["service_select"] }), []);
  assert.deepEqual(serviceViewToolNames({ allowed: [], denied: ["service_refresh"] }), ["service_select"]);
  assert.throws(() => selectPackageTools(new Map([["package:test:service_refresh", "service_refresh"]]),
    { allowed: [], denied: ["service_refresh"] }, new Set(SERVICE_VIEW_TOOLS)), /conflicts/);
  const controller = new AbortController();
  const tool = serviceViewTools(["service_select"], { signal: controller.signal })[0]!;
  const execute = tool.execute as (...args: any[]) => Promise<any>;
  await assert.rejects(execute("bad", { serviceId: "service-a", workId: "foreign" }), /Invalid/);
  const value = await execute("valid", { serviceId: "service-a" });
  assert.equal(isServiceViewRequest(JSON.parse(value.content[0].text)), true);
  controller.abort();
  await assert.rejects(execute("cancelled", { serviceId: "service-a" }));
});

for (const brain of [false, true]) {
  test(`Service view tools execute through the real SDK with brain=${brain}`, async t => {
    const root = mkdtempSync(join(tmpdir(), "piwork-service-view-sdk-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workspace = join(root, "workspace"), agentDirectory = join(root, "agent");
    mkdirSync(workspace);
    mkdirSync(agentDirectory);
    const key = packageNameKey("piwork-brain"), packageRoot = join(root, "packages", key);
    const bindings = [];
    if (brain) {
      cpSync(new URL("../../../internal/coreassets/piwork-brain/", import.meta.url), packageRoot, { recursive: true });
      const { metadata } = await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "piwork-brain",
        preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" } });
      bindings.push({ name: "piwork-brain", nameKey: key, artifact: metadata });
    }
    const { loader } = await createPackageResourceLoader({ root: join(root, "packages"), bindings,
      selection: brain ? [{ name: "piwork-brain", enabled: true }] : [], standaloneSkills: [], agentsMd: "", workspace, agentDirectory });
    const { runtime, model } = await createDeterministicRuntime();
    const { session } = await createAgentSession({ cwd: workspace, agentDir: agentDirectory, modelRuntime: runtime, model,
      resourceLoader: loader, sessionManager: SessionManager.inMemory(workspace), tools: [...SERVICE_VIEW_TOOLS],
      customTools: serviceViewTools(SERVICE_VIEW_TOOLS, { signal: new AbortController().signal }) });
    t.after(() => session.dispose());
    assert.match(session.systemPrompt, /best-effort view request/);
    assert.deepEqual(session.getActiveToolNames().sort(), [...SERVICE_VIEW_TOOLS].sort());
    const requests: unknown[] = [];
    session.subscribe(event => {
      const mapped = mapSdkEvent(event);
      if (mapped?.type === "tool-end") requests.push(mapped.payload);
    });
    for (const action of ["select", "refresh"]) await session.prompt(`service view ${action} service-b 3000`);
    assert.equal(requests.length, 2);
    for (const payload of requests as any[]) {
      assert.equal(payload.isError, false);
      assert.equal(payload.result.truncated, false);
      assert.equal(isServiceViewRequest(JSON.parse(payload.result.text)), true);
    }
  });
}
