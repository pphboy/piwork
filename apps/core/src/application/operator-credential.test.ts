import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { ensureOperatorCredential, readProtectedCredential, verifyOperatorCredential } from "./operator-credential.js";

test("operator credential is durable, protected, and independently verified", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-operator-"));
  try {
    const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
    const path = join(root, "operator.credential");
    try {
      const first = ensureOperatorCredential(store, path);
      assert.equal(readProtectedCredential(path), first);
      assert.equal(verifyOperatorCredential(store, first), true);
      assert.equal(verifyOperatorCredential(store, "wrong"), false);
      assert.equal(ensureOperatorCredential(store, path), first);
      if (process.platform !== "win32") {
        chmodSync(path, 0o644);
        assert.throws(() => readProtectedCredential(path), /0600/);
      }
    } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("operator credential reader rejects symbolic links", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-operator-link-"));
  try {
    const target = join(root, "target");
    const link = join(root, "link");
    writeFileSync(target, "x".repeat(40), { mode: 0o600 });
    symlinkSync(target, link);
    assert.throws(() => readProtectedCredential(link), /symbolic link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
