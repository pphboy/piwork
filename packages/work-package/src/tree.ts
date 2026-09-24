import { Type } from "typebox";
import { Check } from "typebox/value";
import { WorkBlobDigestSchema, WorkByteSizeSchema, WorkPackageValidationError, type WorkBlob } from "@piwork/contracts";
import { WORK_PACKAGE_LIMITS, type WorkPackageLimits } from "./limits.js";

const exact = { additionalProperties: false } as const;
const segments = Type.Array(Type.String(), { maxItems: WORK_PACKAGE_LIMITS.depth });
const common = {
  segmentsBase64: segments, uid: Type.Integer({ minimum: 0, maximum: 4294967295 }),
  gid: Type.Integer({ minimum: 0, maximum: 4294967295 }), mode: Type.Integer({ minimum: 0, maximum: 4095 }),
  mtimeNs: Type.String({ pattern: "^-?(?:0|[1-9][0-9]*)$", maxLength: 32 }),
};
export const WorkTreeSchema = Type.Object({ version: Type.Literal(1), entries: Type.Array(Type.Union([
  Type.Object({ ...common, type: Type.Literal("directory") }, exact),
  Type.Object({ ...common, type: Type.Literal("file"), blob: WorkBlobDigestSchema, size: WorkByteSizeSchema }, exact),
  Type.Object({ ...common, type: Type.Literal("symlink"), targetBase64: Type.String() }, exact),
  Type.Object({ ...common, type: Type.Literal("hardlink"), targetSegmentsBase64: segments }, exact),
]), { minItems: 1, maxItems: WORK_PACKAGE_LIMITS.entries }) }, exact);
export type WorkTree = Type.Static<typeof WorkTreeSchema>;
export type WorkTreeEntry = WorkTree["entries"][number];
function invalid(field: string): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }
function limit(field: string): never { throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", field); }

export function decodeBase64(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) invalid("tree.base64");
  return bytes;
}
export function decodeWorkPath(segments: readonly string[], limits: WorkPackageLimits = WORK_PACKAGE_LIMITS): Buffer {
  if (segments.length > limits.depth) limit("tree.depth");
  const decoded = segments.map((segment) => {
    const bytes = decodeBase64(segment);
    if (bytes.length === 0 || bytes.includes(0) || bytes.includes(47) || bytes.equals(Buffer.from(".")) || bytes.equals(Buffer.from(".."))) invalid("tree.path");
    return bytes;
  });
  const length = decoded.reduce((total, segment) => total + segment.length, Math.max(0, decoded.length - 1));
  if (length > limits.pathBytes) limit("tree.pathBytes");
  const parts: Buffer[] = [];
  for (const segment of decoded) { if (parts.length > 0) parts.push(Buffer.from("/")); parts.push(segment); }
  return Buffer.concat(parts);
}

export function validateWorkTree(value: unknown, blobs: ReadonlyMap<string, WorkBlob>, limits: WorkPackageLimits = WORK_PACKAGE_LIMITS): { tree: WorkTree; fileBytes: number; paths: ReadonlyMap<string, WorkTreeEntry> } {
  if (value !== null && typeof value === "object" && "entries" in value && Array.isArray(value.entries) && value.entries.length > limits.entries) limit("tree.entries");
  if (!Check(WorkTreeSchema, value)) invalid("tree");
  const tree = value as WorkTree;
  const paths = new Map<string, WorkTreeEntry>();
  let previous: Buffer | undefined, fileBytes = 0;
  for (const entry of tree.entries) {
    const path = decodeWorkPath(entry.segmentsBase64, limits);
    if (previous === undefined) { if (path.length !== 0 || entry.type !== "directory") invalid("tree.root"); }
    else if (Buffer.compare(previous, path) >= 0) invalid("tree.order");
    previous = path;
    const key = path.toString("base64");
    if (entry.segmentsBase64.length > 0) {
      const parent = decodeWorkPath(entry.segmentsBase64.slice(0, -1), limits).toString("base64");
      if (paths.get(parent)?.type !== "directory") invalid("tree.parent");
    }
    paths.set(key, entry);
    if (entry.type === "file") {
      const blob = blobs.get(entry.blob);
      if (blob?.size !== entry.size || !blob.kinds.includes("file")) invalid("tree.file");
      fileBytes += entry.size;
      if (!Number.isSafeInteger(fileBytes) || fileBytes > limits.restoredBytes) limit("tree.restoredBytes");
    } else if (entry.type === "symlink") {
      const target = decodeBase64(entry.targetBase64);
      if (target.length === 0 || target.includes(0)) invalid("tree.symlink");
      if (target.length > limits.pathBytes) limit("tree.symlink");
    }
  }
  for (const entry of tree.entries) if (entry.type === "hardlink") {
    const target = paths.get(decodeWorkPath(entry.targetSegmentsBase64, limits).toString("base64"));
    if (target?.type !== "file") invalid("tree.hardlink");
    if (entry.uid !== target.uid || entry.gid !== target.gid || entry.mode !== target.mode || entry.mtimeNs !== target.mtimeNs) invalid("tree.hardlinkMetadata");
  }
  return { tree, fileBytes, paths };
}
