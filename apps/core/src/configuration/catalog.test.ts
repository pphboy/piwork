import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import {
  CatalogAdministrationError,
  CatalogConflictError,
  CatalogSelectionError,
  CatalogService,
} from "./catalog.js";

const admin = { userId: "admin", role: "admin" as const };
const user = { userId: "user", role: "user" as const };

test("only administrators create image, Skill, model, and secret entries", async () => {
  await withCatalog(async ({ catalog }) => {
    for (const kind of ["agent_image", "skill", "model"] as const) {
      assert.throws(() => catalog.createCatalogEntry(user, { kind, name: `${kind}-entry` }), CatalogAdministrationError);
      assert.equal(catalog.createCatalogEntry(admin, { kind, name: `${kind}-entry` }).kind, kind);
    }
    assert.throws(() => catalog.createSecret(user, { name: "model-key", value: "secret-value" }), CatalogAdministrationError);
  });
});

test("duplicate identifiers and names conflict", async () => {
  await withCatalog(async ({ catalog }) => {
    catalog.createCatalogEntry(admin, { id: "model-fixed", kind: "model", name: "primary" });
    assert.throws(
      () => catalog.createCatalogEntry(admin, { id: "model-fixed", kind: "model", name: "secondary" }),
      CatalogConflictError,
    );
    assert.throws(
      () => catalog.createCatalogEntry(admin, { kind: "model", name: "primary" }),
      CatalogConflictError,
    );
  });
});

test("ordinary users list and select only enabled approved catalog entries", async () => {
  await withCatalog(async ({ catalog }) => {
    const enabled = catalog.createCatalogEntry(admin, { kind: "model", name: "enabled" });
    const disabled = catalog.createCatalogEntry(admin, { kind: "model", name: "disabled", enabled: false });
    assert.deepEqual(catalog.listCatalog(user).map((entry) => entry.id), [enabled.id]);
    assert.deepEqual(catalog.listCatalog(admin).map((entry) => entry.id).sort(), [disabled.id, enabled.id].sort());
    assert.equal(catalog.selectCatalogEntry(user, enabled.id, "model").id, enabled.id);
    assert.throws(() => catalog.selectCatalogEntry(user, disabled.id, "model"), CatalogSelectionError);
    assert.throws(() => catalog.selectCatalogEntry(user, enabled.id, "skill"), CatalogSelectionError);
    assert.equal(catalog.selectCatalogEntry(admin, disabled.id, "model").id, disabled.id);
  });
});

test("secret values are written to restricted files and never returned by queries", async () => {
  await withCatalog(async ({ catalog, store }) => {
    const value = "model-secret-plain-text";
    const created = catalog.createSecret(admin, { name: "model-key", value });
    const internal = store.getSecretReference(created.id);
    assert.equal(await readFile(internal?.storagePath ?? "", "utf8"), value);
    assert.equal((await stat(internal?.storagePath ?? "")).mode & 0o777, 0o600);
    const listed = catalog.listSecrets(admin);
    assert.deepEqual(listed, [{ id: created.id, name: "model-key", available: true }]);
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(value));
    assert.equal("storagePath" in listed[0]!, false);
  });
});

async function withCatalog(
  run: (fixture: { catalog: CatalogService; store: CoreStore }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-catalog-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const catalog = new CatalogService(store, join(root, "secrets"), () => new Date("2026-09-20T00:00:00Z"));
  try {
    await run({ catalog, store });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
