import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { registerRuntimeProfileCatalog, resolveRuntimeProfileFromWorkConfig } from "./runtime-catalog.js";
import type { RuntimeProfile } from "./runtime-profile.js";

test("global runtime revisions become immutable Work-selectable image and model references", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-runtime-catalog-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    registerRuntimeProfileCatalog(store, profile(1, "image:a", "model-a", "a.secret"));
    registerRuntimeProfileCatalog(store, profile(2, "image:b", "model-b", "b.secret"));
    registerRuntimeProfileCatalog(store, profile(1, "image:a", "model-a", "a.secret"));

    const resolved = resolveRuntimeProfileFromWorkConfig(store, config("runtime-image-00000001", "runtime-model-00000002"));
    assert.equal(resolved.profile.agentImage, "image:a");
    assert.equal(resolved.profile.model.id, "model-b");
    assert.equal(resolved.profile.model.credentialRef, "b.secret");
    assert.equal(resolved.sourceRuntimeRevision, 2);
    assert.equal(JSON.stringify(config("runtime-image-00000001", "runtime-model-00000002")).includes("b.secret"), false);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

function profile(revision: number, agentImage: string, model: string, credentialRef: string): RuntimeProfile {
  return {
    version: 1,
    revision,
    agentImage,
    model: { provider: "anthropic", id: model, credentialRef },
    updatedAt: `2026-09-20T00:00:0${revision}Z`,
  };
}

function config(image: string, model: string): WorkConfig {
  return {
    agentImage: { catalogId: image },
    skills: [], packages: [],
    agentsMd: "",
    modelRef: model,
    mcpServers: [],
    resources: { cpuMillis: 1_000, memoryBytes: 805_306_368, agentCpuMillis: 1_000, agentMemoryBytes: 805_306_368, maxServices: 0, maxRetainedVolumes: 1 },
    tools: { allowed: [], denied: [] },
  };
}
