import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { ConfigurationValidationError, WorkConfigurationValidator } from "./validation.js";

const NOW = "2026-09-20T00:00:00Z";

test("valid references, MCP parameters, resources, and owner secrets pass", async () => {
  await withValidator(async ({ validator }) => {
    const validated = validator.validate({ workOwnerUserId: "user-1", configuration: config() });
    assert.equal(validated.modelRef, "model-0199e6d8abcd");
    assert.equal(validated.mcpServers[0]?.serverId, "local-tools");
  });
});

test("invalid catalog references and secret ownership are rejected", async () => {
  await withValidator(async ({ validator }) => {
    const badModel = { ...config(), modelRef: "model-0199missing" };
    assert.throws(
      () => validator.validate({ workOwnerUserId: "user-1", configuration: badModel }),
      (error) => error instanceof ConfigurationValidationError && error.code === "INVALID_REFERENCE" && error.field === "modelRef",
    );
    assert.throws(
      () => validator.validate({ workOwnerUserId: "user-2", configuration: config() }),
      (error) => error instanceof ConfigurationValidationError && error.code === "SECRET_OWNERSHIP",
    );
  });
});

test("MCP transport mismatches and duplicate server IDs are rejected", async () => {
  await withValidator(async ({ validator }) => {
    const invalidTransport = config();
    invalidTransport.mcpServers[0] = {
      ...invalidTransport.mcpServers[0]!,
      transport: "streamable-http",
      url: "http://remote.example/mcp",
    };
    assert.throws(
      () => validator.validate({ workOwnerUserId: "user-1", configuration: invalidTransport }),
      (error) => error instanceof ConfigurationValidationError && error.code === "INVALID_CONFIGURATION",
    );
    const duplicate = config();
    duplicate.mcpServers.push({ ...duplicate.mcpServers[0]! });
    assert.throws(
      () => validator.validate({ workOwnerUserId: "user-1", configuration: duplicate }),
      /duplicate MCP server_id/,
    );
  });
});

test("the built-in work-services adapter cannot be substituted or depend on a service", async () => {
  await withValidator(async ({ validator }) => {
    const base = config();
    base.mcpServers = [{
      serverId: "work-services", transport: "stdio", required: true,
      command: "/usr/local/bin/piwork-service-mcp", args: [],
    }];
    assert.equal(validator.validate({ workOwnerUserId: "user-1", configuration: base }).mcpServers[0]?.serverId, "work-services");
    for (const replacement of [
      { ...base.mcpServers[0]!, command: "other" },
      { ...base.mcpServers[0]!, required: false },
      { ...base.mcpServers[0]!, requiredServiceId: "service-0199e6d8other" },
    ]) {
      assert.throws(
        () => validator.validate({ workOwnerUserId: "user-1", configuration: { ...base, mcpServers: [replacement] } }),
        /reserved built-in MCP adapter/,
      );
    }
  });
});

test("UNSUPPORTED_LIMIT is returned before runtime creation", async () => {
  await withValidator(async ({ validator }) => {
    let runtimeCreates = 0;
    const unsupported = {
      ...config(),
      resources: { ...config().resources, storageBytes: 10_000_000 },
    };
    await assert.rejects(
      validator.validateBeforeRuntime(
        { workOwnerUserId: "user-1", configuration: unsupported },
        async () => {
          runtimeCreates += 1;
          return "runtime";
        },
      ),
      (error) => error instanceof ConfigurationValidationError
        && error.code === "UNSUPPORTED_LIMIT"
        && error.field === "resources.storageBytes",
    );
    assert.equal(runtimeCreates, 0);
  });
});

function config(): WorkConfig {
  return {
    agentImage: { catalogId: "image-0199e6d8abcd" },
    skills: ["fixture-skill"],
    agentsMd: "",
    modelRef: "model-0199e6d8abcd",
    mcpServers: [
      {
        serverId: "local-tools",
        transport: "stdio",
        required: true,
        command: "node",
        args: ["server.js"],
        secretRefs: [{ secretId: "secret-0199e6d8abcd" }],
      },
    ],
  resources: { cpuMillis: 1_000, memoryBytes: 1_073_741_824, agentCpuMillis: 500, agentMemoryBytes: 536_870_912, maxServices: 8, maxRetainedVolumes: 16 },
    tools: { allowed: ["read"], denied: [] },
  };
}

async function withValidator(
  run: (fixture: { store: CoreStore; validator: WorkConfigurationValidator }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-config-validation-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
    VALUES ('user-1', 'alice', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  for (const [id, kind] of [
    ["image-0199e6d8abcd", "agent_image"],
    ["model-0199e6d8abcd", "model"],
  ] as const) {
    store.createCatalogEntry({
      id,
      kind,
      name: id,
      mutableReference: `${kind}://fixture`,
      resolvedDigest: null,
      metadataJson: "{}",
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }
  store.addManagedSkill({
    name: "fixture-skill",
    identity: `sha256:${"a".repeat(64)}`,
    fileCount: 1,
    totalBytes: 1,
    now: NOW,
  });
  store.createSecretReference({
    id: "secret-0199e6d8abcd",
    ownerUserId: "user-1",
    name: "fixture-secret",
    storagePath: join(root, "secret"),
    now: NOW,
  });
  try {
    await run({ store, validator: new WorkConfigurationValidator(store) });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
