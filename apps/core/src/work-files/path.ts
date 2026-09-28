import { FILE_LIMITS } from "@piwork/contracts";
import { WorkFileExecutionError } from "./coordinator.js";

const PREFIX = /^\/api\/v1\/works\/([A-Za-z0-9-]{16,128})\/files(\/.*)?$/s;
const INVALID_XML_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u;

export interface FileTarget {
  readonly workId: string;
  readonly segments: readonly string[];
  readonly isRootWithoutSlash: boolean;
  readonly hasTrailingSlash: boolean;
  readonly encodedPath: string;
}

/** Match only the literal prefix before any WHATWG URL normalization. */
export function isRawFileTarget(raw: string): boolean {
  return /^\/api\/v1\/works\/[^/?#]+\/files(?:[/?#]|$)/.test(raw);
}

export function parseRawFileTarget(raw: string): FileTarget {
  if (raw.includes("?") || raw.includes("#")) throw new WorkFileExecutionError("FILE_PATH_INVALID");
  const match = PREFIX.exec(raw);
  if (!match) throw new WorkFileExecutionError("FILE_PATH_INVALID");
  const workId = match[1]!;
  const suffix = match[2];
  if (suffix === undefined) return { workId, segments: [], isRootWithoutSlash: true,
    hasTrailingSlash: false, encodedPath: `/api/v1/works/${workId}/files/` };
  if (suffix === "/") return { workId, segments: [], isRootWithoutSlash: false,
    hasTrailingSlash: true, encodedPath: `/api/v1/works/${workId}/files/` };
  const trailing = suffix.endsWith("/");
  const pieces = suffix.slice(1).split("/");
  if (trailing) pieces.pop();
  if (pieces.length > FILE_LIMITS.maxPathDepth) throw new WorkFileExecutionError("FILE_PATH_TOO_LONG");
  let length = 0;
  const segments = pieces.map((rawSegment) => {
    if (rawSegment === "" || /%(?![0-9A-Fa-f]{2})/.test(rawSegment)) throw new WorkFileExecutionError("FILE_PATH_INVALID");
    let decoded: string;
    try { decoded = decodeURIComponent(rawSegment); }
    catch { throw new WorkFileExecutionError("FILE_PATH_INVALID"); }
    if (decoded === "" || decoded === "." || decoded === ".." || decoded.includes("/")
      || decoded.includes("\\") || INVALID_XML_CHAR.test(decoded)) throw new WorkFileExecutionError("FILE_PATH_INVALID");
    const bytes = Buffer.byteLength(decoded, "utf8");
    if (bytes > FILE_LIMITS.maxSegmentBytes) throw new WorkFileExecutionError("FILE_PATH_TOO_LONG");
    length += bytes + (length === 0 ? 0 : 1);
    if (length > FILE_LIMITS.maxPathBytes) throw new WorkFileExecutionError("FILE_PATH_TOO_LONG");
    return decoded;
  });
  return { workId, segments, isRootWithoutSlash: false, hasTrailingSlash: trailing,
    encodedPath: `/api/v1/works/${workId}/files/${segments.map(encodeURIComponent).join("/")}${trailing ? "/" : ""}` };
}
