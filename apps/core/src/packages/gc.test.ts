import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { collectPiPackageArtifactGarbage, collectPiPackageUploadGarbage } from "./gc.js";

test("upload garbage collection preserves a live lease and removes bytes after terminal release", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-gc-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    const uploads = join(root, "pi-packages", "uploads");
    await mkdir(uploads, { recursive: true });
    await writeFile(join(uploads, "upload-1.zip"), "private source bytes");
    store.packages.insertUpload({ id: "upload-1", actorId: "admin", scopeKind: "core", workId: null,
      sourceKind: "zip", displayName: "tools.zip", digest: `sha256:${"a".repeat(64)}`, size: 20,
      state: "ready", expiresAt: "2026-09-25T00:10:00.000Z", leaseCount: 1, createdAt: "2026-09-25T00:00:00.000Z" });
    await collectPiPackageUploadGarbage(store, root, new Date("2026-09-25T01:00:00.000Z"));
    assert.equal(await readFile(join(uploads, "upload-1.zip"), "utf8"), "private source bytes");
    store.packages.releaseUploadLease("upload-1");
    await collectPiPackageUploadGarbage(store, root, new Date("2026-09-25T01:00:00.000Z"));
    assert.equal(store.packages.getUpload("upload-1")?.state, "expired");
    await assert.rejects(readFile(join(uploads, "upload-1.zip")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    await collectPiPackageUploadGarbage(store, root, new Date("2026-09-25T01:00:00.000Z"));
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("retired Core artifact GC waits for Work capture leases and preserves shared head bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-artifact-gc-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    const directory = join(root, "pi-packages", "artifacts", "a".repeat(64));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), "private artifact bytes");
    const created = "2026-09-25T00:00:00.000Z";
    for (const id of ["old-head", "new-head"]) store.exec(`INSERT INTO pi_package_artifacts
      (id,scope_kind,work_id,name,content_digest,metadata_json,storage_path,created_at)
      VALUES ('${id}','core',NULL,'tools','sha256:${"a".repeat(64)}','{}','${directory}','${created}')`);
    store.exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at)
      VALUES ('tools',1,'new-head',2,'${created}','${created}')`);
    const lease = store.packages.leaseCatalogHeads(["tools"]);
    await collectPiPackageArtifactGarbage(store, root, new Date("2026-09-27T00:00:00.000Z"));
    assert.equal(store.packages.getArtifact("old-head"), undefined);
    assert.ok(store.packages.getArtifact("new-head"));
    assert.equal(await readFile(join(directory, "package.json"), "utf8"), "private artifact bytes");
    store.packages.removeCatalog("tools");
    await collectPiPackageArtifactGarbage(store, root, new Date("2026-09-27T00:00:00.000Z"));
    assert.ok(store.packages.getArtifact("new-head"), "captured Work context still holds the head");
    store.packages.releaseArtifactLeases(lease.map(({ id }) => id));
    await collectPiPackageArtifactGarbage(store, root, new Date("2026-09-27T00:00:00.000Z"));
    assert.equal(store.packages.getArtifact("new-head"), undefined);
    await assert.rejects(readFile(join(directory, "package.json")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
