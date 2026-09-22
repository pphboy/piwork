import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import {
  ArtifactPreparationError,
  ArtifactPreparationService,
  type ArtifactResolver,
  type ResolvedImage,
} from "./artifacts.js";

const NOW = "2026-09-20T00:00:00Z";
const IMAGE_A = `sha256:${"a".repeat(64)}`;
const IMAGE_B = `sha256:${"b".repeat(64)}`;

test("mutable image tag resolves once and original revision stays pinned after tag drift", async () => {
  await withArtifacts(async ({ store, resolver }) => {
    const service = new ArtifactPreparationService(store, resolver);
    const first = await service.prepare("work-1", 1);
    assert.equal(first.image.digest, IMAGE_A);
    assert.deepEqual(first.skills, []);
    resolver.image = { digest: IMAGE_B, entrypoint: ["piwork-agentd"] };
    const second = await service.prepare("work-1", 1);
    assert.equal(second.image.digest, IMAGE_A);
    assert.equal(resolver.imageCalls, 1);
    assert.equal(store.getWorkConfigRevision("work-1", 1)?.resolvedImageDigest, IMAGE_A);
  });
});

test("incompatible image entrypoint is rejected before binding", async () => {
  await withArtifacts(async ({ store, resolver }) => {
    resolver.image = { digest: IMAGE_A, entrypoint: ["node", "server.js"] };
    await assert.rejects(
      new ArtifactPreparationService(store, resolver).prepare("work-1", 1),
      (error) => error instanceof ArtifactPreparationError && /incompatible entrypoint/.test(error.message),
    );
    assert.deepEqual(store.listWorkConfigArtifactBindings("work-1", 1), []);
  });
});

class FixtureResolver implements ArtifactResolver {
  image: ResolvedImage = { digest: IMAGE_A, entrypoint: ["piwork-agentd"] };
  imageCalls = 0;

  async resolveImage(): Promise<ResolvedImage> {
    this.imageCalls += 1;
    return this.image;
  }

}

async function withArtifacts(
  run: (fixture: { store: CoreStore; resolver: FixtureResolver }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-artifacts-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  seed(store);
  try {
    await run({ store, resolver: new FixtureResolver() });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}

function seed(store: CoreStore): void {
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
    VALUES ('user-1', 'alice', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  store.exec(`INSERT INTO works(
    id, owner_user_id, name, desired_state, observed_state,
    desired_revision, active_revision, control_version, created_at, updated_at
  ) VALUES ('work-1', 'user-1', 'fixture', 'stopped', 'stopped', 1, NULL, 1, '${NOW}', '${NOW}')`);
  const configuration: WorkConfig = {
    agentImage: { catalogId: "agent_image-0199abcd" },
    skills: ["skill-0199e6d8abcd"],
    agentsMd: "",
    modelRef: "model-0199e6d8abcd",
    mcpServers: [],
  resources: { cpuMillis: 1_000, memoryBytes: 1_073_741_824, agentCpuMillis: 500, agentMemoryBytes: 536_870_912, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: ["read"], denied: [] },
  };
  store.exec(`INSERT INTO work_config_revisions(
    work_id, revision, config_json, created_by_user_id, created_at
  ) VALUES ('work-1', 1, '${JSON.stringify(configuration)}', 'user-1', '${NOW}')`);
  store.createCatalogEntry({
    id: "agent_image-0199abcd",
    kind: "agent_image",
    name: "agent",
    mutableReference: "registry.example/agent:latest",
    resolvedDigest: null,
    metadataJson: "{}",
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  store.createCatalogEntry({
    id: "skill-0199e6d8abcd",
    kind: "skill",
    name: "fixture",
    mutableReference: "artifact://fixture-skill",
    resolvedDigest: `sha256:${"c".repeat(64)}`,
    metadataJson: "{}",
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
}
