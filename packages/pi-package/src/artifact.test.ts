import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPiPackageEnvironment, validatePiPackageArtifact } from "./artifact.js";
import { validatePiPackageArtifactSync } from "./artifact-sync.js";

const environment = { os: "linux" as const, architecture: "x64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" };

test("tree digest ignores mtime but distinguishes same-version content and execute mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-artifact-"));
  try {
    await writeFile(join(root, "package.json"), '{"name":"tools","version":"1.0.0","pi":{"extensions":["tool.js"]}}');
    const file = join(root, "tool.js");
    await writeFile(file, "export default 1");
    const input = { root, sourceKind: "local" as const, resolvedSource: "tools", preparedEnvironment: environment };
    const first = await validatePiPackageArtifact(input);
    const canonicalCounts = Object.fromEntries(Object.entries(first.metadata.resourceCounts).sort(([left], [right]) => left.localeCompare(right)));
    assert.doesNotThrow(() => validatePiPackageArtifactSync(root, { ...first.metadata, resourceCounts: canonicalCounts as typeof first.metadata.resourceCounts }));
    await utimes(file, new Date("2020-01-01"), new Date("2020-01-01"));
    assert.equal((await validatePiPackageArtifact(input)).metadata.contentDigest, first.metadata.contentDigest);
    await writeFile(file, "export default 2");
    const changed = await validatePiPackageArtifact(input);
    assert.notEqual(changed.metadata.contentDigest, first.metadata.contentDigest);
    await chmod(file, 0o755);
    assert.notEqual((await validatePiPackageArtifact(input)).metadata.contentDigest, changed.metadata.contentDigest);
    await assert.rejects(validatePiPackageArtifact({ ...input, expectedDigest: first.metadata.contentDigest }), /digest mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prepared package rejects a missing runtime dependency and an incompatible environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-dependency-"));
  try {
    await writeFile(join(root, "package.json"), '{"name":"tools","dependencies":{"example-dependency":"1.0.0"}}');
    const input = { root, sourceKind: "zip" as const, resolvedSource: "tools.zip", preparedEnvironment: environment };
    await assert.rejects(validatePiPackageArtifact(input), /runtime dependency example-dependency is missing/);
    await mkdir(join(root, "node_modules", "example-dependency"), { recursive: true });
    await writeFile(join(root, "node_modules", "example-dependency", "index.js"), "module.exports = 1");
    const valid = await validatePiPackageArtifact(input);
    assert.equal(valid.metadata.name, "tools");
    assert.equal(valid.metadata.version, null);
    assertPiPackageEnvironment(environment, environment);
    assert.throws(() => assertPiPackageEnvironment(environment, { ...environment, nodeAbi: "other" }), (error) => (error as { code?: string }).code === "PI_PACKAGE_ENVIRONMENT_MISMATCH");
    assert.throws(() => assertPiPackageEnvironment(environment, { ...environment, piSdkVersion: "0.86.1" }),
      (error) => (error as { code?: string }).code === "PI_PACKAGE_ENVIRONMENT_MISMATCH");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("private TypeBox is frozen while Pi host modules and escaping dependencies remain rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-typebox-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-package-outside-"));
  const manifestPath = join(root, "package.json");
  const typeboxRoot = join(root, "node_modules", "typebox");
  const input = { root, sourceKind: "npm" as const, resolvedSource: "tools@1.0.0", preparedEnvironment: environment };
  try {
    await mkdir(typeboxRoot, { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ name: "tools", version: "1.0.0", dependencies: { typebox: "1.1.38" } }));
    await writeFile(join(typeboxRoot, "package.json"), '{"name":"typebox","version":"1.1.38"}');
    const privateFile = join(typeboxRoot, "index.js");
    await writeFile(privateFile, "export const marker = 1;");
    const first = await validatePiPackageArtifact(input);
    assert.doesNotThrow(() => validatePiPackageArtifactSync(root, first.metadata));
    assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).dependencies.typebox, "1.1.38");
    await writeFile(privateFile, "export const marker = 2;");
    assert.notEqual((await validatePiPackageArtifact(input)).metadata.contentDigest, first.metadata.contentDigest);
    assert.throws(() => validatePiPackageArtifactSync(root, first.metadata), /digest mismatch/);
    await rm(typeboxRoot, { recursive: true });
    await assert.rejects(validatePiPackageArtifact(input), /runtime dependency typebox is missing/);
    assert.throws(() => validatePiPackageArtifactSync(root, first.metadata), /runtime dependency is missing/);
    await symlink(outside, typeboxRoot);
    await assert.rejects(validatePiPackageArtifact(input), /unsafe symlink/);
    assert.throws(() => validatePiPackageArtifactSync(root, first.metadata), /unsafe symlink/);
    await rm(typeboxRoot);
    for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
      await writeFile(manifestPath, JSON.stringify({ name: "tools", version: "1.0.0", dependencies: { [name]: "0.86.1" } }));
      await assert.rejects(validatePiPackageArtifact(input), /Pi host APIs must be peer dependencies/);
      assert.throws(() => validatePiPackageArtifactSync(root, first.metadata), /Pi host APIs must be peer dependencies/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
