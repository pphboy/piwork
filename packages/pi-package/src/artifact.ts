import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { Check } from "typebox/value";
import { PiPackagePreparedEnvironmentSchema, type PiPackageArtifactMetadata, type PiPackagePreparedEnvironment, type PiPackageSourceKind } from "@piwork/contracts";
import { inspectPiPackageResources, type PiPackageInventory, type PiPackageTreePath } from "./inventory.js";
import { PiPackageInputError, parsePiPackageManifest, PI_HOST_MODULES } from "./manifest.js";
import { PI_PACKAGE_LIMITS } from "./limits.js";
import { readPiPackageDigestTree, hashPiPackageDigestTree } from "./tree-digest.js";


export interface ValidatedPiPackageArtifact {
  readonly metadata: PiPackageArtifactMetadata;
  readonly inventory: PiPackageInventory;
  readonly entryCount: number;
  readonly restoredBytes: number;
}

function invalid(code: PiPackageInputError["code"], message: string): never { throw new PiPackageInputError(code, message); }
/** Hash every normalized tree entry, including dependency bytes and symlink targets. */
export async function validatePiPackageArtifact(input: {
  readonly root: string;
  readonly sourceKind: PiPackageSourceKind;
  readonly resolvedSource: string;
  readonly preparedEnvironment: PiPackagePreparedEnvironment;
  readonly expectedDigest?: string;
}): Promise<ValidatedPiPackageArtifact> {
  if (!Check(PiPackagePreparedEnvironmentSchema, input.preparedEnvironment)) invalid("PI_PACKAGE_INVALID_MANIFEST", "prepared environment is invalid");
  if (!input.resolvedSource || input.resolvedSource.length > 4096 || input.resolvedSource.includes("\0") || /:\/\/[^/]*@/.test(input.resolvedSource)) {
    invalid("PI_PACKAGE_INVALID_SOURCE", "resolved source contains invalid or private information");
  }
  const { root, tree, restoredBytes } = await readPiPackageDigestTree(input.root);
  const manifestEntry = tree.find((entry) => entry.path === "package.json");
  if (manifestEntry?.type !== "file" || manifestEntry.size > PI_PACKAGE_LIMITS.manifestBytes) invalid("PI_PACKAGE_INVALID_MANIFEST", "prepared package has no regular package.json");
  const manifest = parsePiPackageManifest(await readFile(join(root, "package.json")));
  for (const name of Object.keys(manifest.dependencies)) {
    if (PI_HOST_MODULES.has(name)) invalid("PI_PACKAGE_INVALID_MANIFEST", "Pi host APIs must be peer dependencies");
    const dependency = join(root, "node_modules", ...name.split("/"));
    let resolved: string;
    try { resolved = await realpath(dependency); }
    catch { invalid("PI_PACKAGE_INVALID_MANIFEST", `runtime dependency ${name} is missing`); }
    if (!resolved.startsWith(`${root}${sep}`) || !(await stat(resolved)).isDirectory()) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", `runtime dependency ${name} is not inside the artifact`);
  }
  const inventory = inspectPiPackageResources(manifest, tree);
  const contentDigest = await hashPiPackageDigestTree(tree);
  if (input.expectedDigest !== undefined && input.expectedDigest !== contentDigest) invalid("PI_PACKAGE_INVALID_MANIFEST", "package content digest mismatch");
  return {
    metadata: {
      name: manifest.name, version: manifest.version, sourceKind: input.sourceKind, resolvedSource: input.resolvedSource,
      preparedEnvironment: input.preparedEnvironment,
      resourceCounts: { extensions: inventory.extensions.length, skills: inventory.skills.length, prompts: inventory.prompts.length, themes: inventory.themes.length },
      contentDigest,
    },
    inventory, entryCount: tree.length, restoredBytes,
  };
}

export function assertPiPackageEnvironment(expected: PiPackagePreparedEnvironment, actual: PiPackagePreparedEnvironment): void {
  if (!Check(PiPackagePreparedEnvironmentSchema, expected) || !Check(PiPackagePreparedEnvironmentSchema, actual) ||
      expected.os !== actual.os || expected.architecture !== actual.architecture || expected.variant !== actual.variant ||
      expected.nodeAbi !== actual.nodeAbi || expected.piSdkVersion !== actual.piSdkVersion) {
    throw Object.assign(new Error("PI_PACKAGE_ENVIRONMENT_MISMATCH"), { code: "PI_PACKAGE_ENVIRONMENT_MISMATCH" });
  }
}
