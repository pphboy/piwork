import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import type { WorkBindingRequirements } from "@piwork/contracts";
import { registerRuntimeProfileCatalog } from "../configuration/runtime-catalog.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { autoResolveWorkBindings, captureImportedRuntimeProfile, revalidateCapturedWorkBindings, resolveWorkBindings, WorkBindingError } from "./bindings.js";

const NOW = "2026-09-23T00:00:00.000Z", OWNER = "recipient-user-00000001", OTHER = "recipient-user-00000002";
const requirements: WorkBindingRequirements = { models: [{ key: "m-1", provider: "deterministic", model: "fixture-model", baseUrl: "http://localhost/" }],
  secrets: [{ key: "b-1", uses: [{ contextKey: "c-1", serverId: "tools", key: "TOKEN" }] }] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-bindings-")), secrets = join(root, "secrets"); mkdirSync(secrets);
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  for (const id of [OWNER, OTHER]) store.createManagedUser({ id, account: id, passwordDigest: "password", role: "user", enabled: true, createdAt: NOW, updatedAt: NOW });
  const profiles = new RuntimeProfileStore(join(root, "runtime.json"), secrets, () => new Date(NOW));
  profiles.configure({ agentImage: "recipient:default-not-used", provider: "deterministic", model: "fixture-model", baseUrl: "http://localhost", credential: "RECIPIENT_PLATFORM_SECRET" });
  registerRuntimeProfileCatalog(store, profiles.load());
  const secretFile = join(secrets, "user.secret"); writeFileSync(secretFile, "RECIPIENT_MCP_SECRET", { mode: 0o600 });
  for (const [id, owner] of [["secret-owned-00000001", OWNER], ["secret-other-00000001", OTHER], ["secret-shared-00000001", null]] as const) {
    const storagePath = owner === OWNER ? secretFile : join(secrets, id);
    writeFileSync(storagePath, "RECIPIENT_MCP_SECRET", { mode: 0o600 });
    store.createSecretReference({ id, ownerUserId: owner, name: id, storagePath, now: NOW });
  }
  const input = { models: { "m-1": "runtime-model-00000001" }, secrets: { "b-1": "secret-owned-00000001" } };
  return { root, store, profiles, input, secretFile,
    resolve(req = requirements, binding: unknown = input) { return resolveWorkBindings(store, profiles, OWNER, req, binding); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("bindings capture recipient immutable credentials and package image, never global image/default fallback", () => {
  const f = fixture();
  try {
    const resolved = f.resolve(), image = `sha256:${"a".repeat(64)}`, captured = captureImportedRuntimeProfile(resolved, "m-1", image);
    assert.equal(captured.agentImage, image); assert.equal(captured.model.credentialRef, f.profiles.load().model.credentialRef);
    assert.equal(JSON.stringify(resolved.bindings).includes("SECRET"), false);
    f.profiles.configure({ agentImage: "new:image", provider: "other", model: "changed-default", credential: "NEW_SECRET" });
    assert.deepEqual(captureImportedRuntimeProfile(f.resolve(), "m-1", image), captured);
    assert.equal(f.resolve(requirements, { ...f.input, secrets: { "b-1": "secret-shared-00000001" } }).secrets.get("b-1"), "secret-shared-00000001");
  } finally { f.close(); }
});

test("missing, extra, duplicate requirements and mismatching model or endpoint fail closed", () => {
  const f = fixture();
  try {
    for (const binding of [undefined, null, {}, { ...f.input, models: {} }, { ...f.input, source: "fallback" },
      { ...f.input, secrets: { ...f.input.secrets, extra: "secret-owned-00000001" } },
      { ...f.input, models: { "m-1": "missing-model-00000001" } }, { ...f.input, secrets: { "b-1": "secret-other-00000001" } }])
      assert.throws(() => resolveWorkBindings(f.store, f.profiles, OWNER, requirements, binding), WorkBindingError);
    for (const patch of [{ provider: "other" }, { model: "other" }, { baseUrl: null }, { baseUrl: "http://localhost/other" }])
      assert.throws(() => f.resolve({ ...requirements, models: [{ ...requirements.models[0]!, ...patch }] }), WorkBindingError);
    assert.throws(() => f.resolve({ ...requirements, models: [requirements.models[0]!, requirements.models[0]!] }), WorkBindingError);
    assert.throws(() => captureImportedRuntimeProfile(f.resolve(), "missing", `sha256:${"a".repeat(64)}`), WorkBindingError);
    assert.deepEqual(resolveWorkBindings(f.store, f.profiles, OWNER, { models: [], secrets: [] }, {}).bindings, { models: {}, secrets: {} });
  } finally { f.close(); }
});

test("revalidation detects disabled owner, withdrawn catalog and missing or linked secret files without reading their content", () => {
  const f = fixture();
  try {
    f.resolve();
    f.store.setUserEnabled(OWNER, false, NOW); assert.throws(() => f.resolve(), WorkBindingError); f.store.setUserEnabled(OWNER, true, NOW);
    rmSync(f.secretFile); assert.throws(() => f.resolve(), WorkBindingError);
    symlinkSync(f.profiles.credentialPath(), f.secretFile); assert.throws(() => f.resolve(), WorkBindingError);
    rmSync(f.secretFile); writeFileSync(f.secretFile, "replacement", { mode: 0o600 });
    rmSync(f.profiles.credentialPath()); assert.throws(() => f.resolve(), WorkBindingError);
    const entry = f.store.getCatalogEntry("runtime-model-00000001")!;
    f.store.createCatalogEntry({ ...entry, id: "disabled-model-00000001", name: "Disabled model", enabled: false });
    assert.throws(() => f.resolve(requirements, { ...f.input, models: { "m-1": "disabled-model-00000001" } }), WorkBindingError);
  } finally { f.close(); }
});

test("automatic model choice uses the newest readable matching revision and pins the captured profile", () => {
  const f = fixture();
  try {
    const requirement = { models: [requirements.models[0]!, { ...requirements.models[0]!, key: "m-2" }], secrets: [] };
    const original = f.store.getCatalogEntry("runtime-model-00000001")!;
    f.store.createCatalogEntry({ ...original, id: "model-newer-00000001", name: "newer",
      metadataJson: JSON.stringify({ ...JSON.parse(original.metadataJson), sourceRuntimeRevision: 2 }) });
    f.store.createCatalogEntry({ ...original, id: "model-tie-00000001", name: "tie",
      metadataJson: JSON.stringify({ ...JSON.parse(original.metadataJson), sourceRuntimeRevision: 2 }) });
    const resolved = autoResolveWorkBindings(f.store, f.profiles, OWNER, requirement);
    assert.equal(resolved.models.get("m-1")?.catalogId, "model-newer-00000001");
    assert.equal(resolved.models.get("m-2")?.catalogId, "model-newer-00000001");
    assert.deepEqual(revalidateCapturedWorkBindings(f.store, f.profiles, OWNER, requirement, resolved).bindings, resolved.bindings);
    f.store.createCatalogEntry({ ...original, id: "unreadable-00000001", name: "unreadable",
      metadataJson: JSON.stringify({ ...JSON.parse(original.metadataJson), sourceRuntimeRevision: 3, credentialRef: "missing" }) });
    assert.equal(autoResolveWorkBindings(f.store, f.profiles, OWNER, requirement).models.get("m-1")?.catalogId, "model-newer-00000001");
    f.store.exec("UPDATE catalog_entries SET enabled = 0 WHERE id = 'model-newer-00000001'");
    assert.throws(() => revalidateCapturedWorkBindings(f.store, f.profiles, OWNER, requirement, resolved), { code: "TARGET_MODEL_UNAVAILABLE" });
  } finally { f.close(); }
});

test("automatic import reports unavailable models and unsupported external MCP secrets before publication", () => {
  const f = fixture();
  try {
    assert.throws(() => autoResolveWorkBindings(f.store, f.profiles, OWNER,
      { models: [{ ...requirements.models[0]!, model: "missing" }], secrets: [] }), { code: "TARGET_MODEL_UNAVAILABLE" });
    assert.throws(() => autoResolveWorkBindings(f.store, f.profiles, OWNER, requirements), { code: "EXTERNAL_MCP_SECRET_UNAVAILABLE" });
  } finally { f.close(); }
});
