import { posix } from "node:path";
import { createHash } from "node:crypto";
import { WorkPackageValidationError, type PortablePiPackageArtifact, type PortableWorkSpec } from "@piwork/contracts";
import { inspectPiPackageResources, parsePiPackageManifest } from "@piwork/pi-package";
import { decodeBase64, decodeWorkPath, type WorkTree, type WorkTreeEntry } from "./tree.js";

function invalid(field: string): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }

/** Validate relative links and inventory without executing package code. */
export function validatePiPackageWorkTree(tree: WorkTree, inventory: PortablePiPackageArtifact["resourceInventory"]): void {
  const paths = new Map<string, WorkTreeEntry>();
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  for (const entry of tree.entries) {
    const parts = entry.segmentsBase64.map((encoded) => {
      const bytes = decodeBase64(encoded);
      let name: string;
      try { name = utf8.decode(bytes); } catch { invalid("piPackageArtifacts.pathUtf8"); }
      if (!Buffer.from(name).equals(bytes) || name.includes("\\")) invalid("piPackageArtifacts.path");
      return name;
    });
    paths.set(parts.join("/"), entry);
  }
  if (paths.get("package.json")?.type !== "file") invalid("piPackageArtifacts.manifest");
  const resolvePath = (path: string): WorkTreeEntry => {
    let parts = path.split("/");
    for (let hops = 0; hops < 41; hops++) {
      const current: string[] = [];
      let restarted = false;
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!;
        if (part === "" || part === ".") continue;
        if (part === "..") { if (current.length === 0) invalid("piPackageArtifacts.symlinkEscape"); current.pop(); continue; }
        current.push(part);
        const entry = paths.get(current.join("/"));
        if (!entry) invalid("piPackageArtifacts.symlinkMissing");
        if (entry.type !== "symlink") continue;
        const targetBytes = decodeBase64(entry.targetBase64);
        let target: string;
        try { target = utf8.decode(targetBytes); } catch { invalid("piPackageArtifacts.symlinkUtf8"); }
        if (!target || !Buffer.from(target).equals(targetBytes) || target.startsWith("/") || target.includes("\\") || target.includes("\0")) invalid("piPackageArtifacts.symlinkTarget");
        parts = [...current.slice(0, -1), ...target.split("/"), ...parts.slice(index + 1)];
        restarted = true;
        break;
      }
      if (!restarted) {
        const final = paths.get(current.join("/"));
        if (!final) invalid("piPackageArtifacts.symlinkMissing");
        return final;
      }
    }
    invalid("piPackageArtifacts.symlinkCycle");
  };
  for (const [path, entry] of paths) if (entry.type === "symlink") resolvePath(path);
  for (const kind of ["extensions", "skills", "prompts", "themes"] as const) {
    for (const path of inventory[kind]) {
      if (path.startsWith("/") || path.includes("\\") || posix.normalize(path) !== path || path.split("/").some((part) => part === "." || part === "..")) invalid("piPackageArtifacts.inventoryPath");
      if (resolvePath(path).type !== "file") invalid("piPackageArtifacts.inventoryFile");
    }
  }
}

/** Verify the portable tree against Piwork's prepared-artifact identity without restoring or executing it. */
export async function validatePiPackageContentDigests(spec: PortableWorkSpec, metadata: ReadonlyMap<string, unknown>,
  readBlob: (digest: string) => AsyncIterable<Uint8Array>): Promise<void> {
  const seen = new Set<string>();
  const field = (hash: ReturnType<typeof createHash>, value: string) => {
    const bytes = Buffer.from(value), length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length); hash.update(length); hash.update(bytes);
  };
  for (const artifact of spec.piPackageArtifacts) {
    if (seen.has(artifact.contentDigest)) continue;
    seen.add(artifact.contentDigest);
    const tree = metadata.get(artifact.treeDigest) as WorkTree | undefined;
    if (!tree) invalid("piPackageArtifacts.tree");
    const manifest = tree.entries.find((entry) => entry.type === "file" && decodeWorkPath(entry.segmentsBase64).toString("utf8") === "package.json");
    if (manifest?.type !== "file" || manifest.size > 1024 * 1024) invalid("piPackageArtifacts.manifest");
    const manifestBytes: Buffer[] = [];
    for await (const chunk of readBlob(manifest.blob)) manifestBytes.push(Buffer.from(chunk));
    let parsed: { name?: unknown; version?: unknown };
    try { parsed = JSON.parse(Buffer.concat(manifestBytes).toString("utf8")) as typeof parsed; }
    catch { invalid("piPackageArtifacts.manifest"); }
    if (parsed.name !== artifact.name || (parsed.version ?? null) !== artifact.version) invalid("piPackageArtifacts.manifestIdentity");
    try {
      const manifestValue = parsePiPackageManifest(Buffer.concat(manifestBytes));
      const inventory = inspectPiPackageResources(manifestValue, tree.entries.slice(1).map((entry) => ({
        path: decodeWorkPath(entry.segmentsBase64).toString("utf8"), type: entry.type === "hardlink" ? "file" as const : entry.type,
      })));
      if (Object.entries(inventory).some(([kind, paths]) => JSON.stringify(paths) !== JSON.stringify(artifact.resourceInventory[kind as keyof typeof inventory])
        || paths.length !== artifact.resourceCounts[kind as keyof typeof artifact.resourceCounts])) invalid("piPackageArtifacts.inventory");
    } catch { invalid("piPackageArtifacts.inventory"); }
    const hash = createHash("sha256"); hash.update("piwork-pi-package-tree-v1\0");
    for (const entry of tree.entries.slice(1)) {
      const path = decodeWorkPath(entry.segmentsBase64).toString("utf8");
      field(hash, path); field(hash, entry.type);
      if (entry.type === "directory") field(hash, "755");
      else if (entry.type === "file") {
        field(hash, entry.mode & 0o111 ? "755" : "644");
        field(hash, String(entry.size));
        let bytes = 0;
        for await (const chunk of readBlob(entry.blob)) { bytes += chunk.byteLength; hash.update(chunk); }
        if (bytes !== entry.size) invalid("piPackageArtifacts.fileSize");
      } else if (entry.type === "symlink") {
        field(hash, "777"); field(hash, decodeBase64(entry.targetBase64).toString("utf8"));
      } else invalid("piPackageArtifacts.hardlink");
    }
    if (`sha256:${hash.digest("hex")}` !== artifact.contentDigest || artifact.key !== artifact.contentDigest) invalid("piPackageArtifacts.contentDigest");
  }
}
