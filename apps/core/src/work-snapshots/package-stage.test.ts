import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeWorkPackage } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../../packages/work-package/dist/fixture.js";
import { stageVerifiedPackage } from "./package-stage.js";

test("import staging revalidates the same package bytes and streams every blob to a private spool", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-package-stage-"));
  try {
    const fixture = goldenWorkFixture(); const path = join(root, "uploaded.work");
    const chunks: Buffer[] = [];
    for await (const chunk of encodeWorkPackage(fixture.spec, async function* (blob) { yield fixture.data.get(blob.digest)!; })) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks); writeFileSync(path, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const staged = await stageVerifiedPackage({ packagePath: path, spoolDirectory: join(root, "spool"), expectedDigest: digest, expectedSize: bytes.length });
    assert.equal(staged.verified.digest, digest);
    for (const [blobDigest, content] of fixture.data) assert.deepEqual(readFileSync(join(root, "spool", blobDigest)), content);
    await assert.rejects(stageVerifiedPackage({ packagePath: path, spoolDirectory: join(root, "other"), expectedDigest: "0".repeat(64), expectedSize: bytes.length }), { code: "PACKAGE_INVALID" });
    assert.deepEqual(readFileSync(path), bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
