/**
 * Strict Work-relative file references (`piwork-file:/...`) and their Files
 * deep links. A reference is model-authored text, so parsing happens before
 * URL normalization: no authority, query, fragment, dot segment, encoded
 * separator, control byte or illegal percent/UTF-8 may survive.
 */

const REFERENCE_PREFIX = 'piwork-file:';
/** WF-005: 255 UTF-8 bytes per segment, 4096 bytes per relative path, 128 levels. */
export const MAX_FILE_SEGMENT_BYTES = 255;
export const MAX_FILE_PATH_BYTES = 4096;
export const MAX_FILE_PATH_DEPTH = 128;

const FORBIDDEN = /[\/\\\u0000-\u001f\u007f-\u009f]/;
const NON_CHARACTER = /[￾￿]/;

/** Validate an already-decoded workspace path. Returns the normalized path. */
export function workspacePath(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/') return undefined;
  const segments = value.slice(1).split('/');
  if (segments.length > MAX_FILE_PATH_DEPTH) return undefined;
  let bytes = 0;
  const decoded: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || FORBIDDEN.test(segment) || NON_CHARACTER.test(segment)) return undefined;
    const size = new TextEncoder().encode(segment).length;
    if (size > MAX_FILE_SEGMENT_BYTES) return undefined;
    bytes += size;
    decoded.push(segment);
  }
  if (1 + bytes + decoded.length - 1 > MAX_FILE_PATH_BYTES) return undefined;
  return `/${decoded.join('/')}`;
}

/** Encode a decoded workspace path segment-by-segment, exactly once. */
export function encodeFileReferencePath(value: string): string | undefined {
  const path = workspacePath(value);
  if (!path) return undefined;
  return '/' + path.slice(1).split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Parse a model-provided `piwork-file:/<encoded path>` destination. The raw
 * form is validated before decoding; each segment is decoded exactly once and
 * the decoded value is never interpreted again.
 */
export function parseFileReference(href: string | undefined): string | undefined {
  if (typeof href !== 'string' || !href.startsWith(`${REFERENCE_PREFIX}/`)) return undefined;
  const raw = href.slice(REFERENCE_PREFIX.length);
  // `piwork-file://host/...` is an authority, not a Work-relative path.
  if (raw.startsWith('//')) return undefined;
  if (raw.includes('?') || raw.includes('#') || raw.includes('\\')) return undefined;
  const rawSegments = raw.slice(1).split('/');
  if (!rawSegments.length || rawSegments.length > MAX_FILE_PATH_DEPTH) return undefined;
  let bytes = 0;
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    if (!rawSegment || FORBIDDEN.test(rawSegment)) return undefined;
    let segment: string;
    try {
      // decodeURIComponent rejects malformed percent escapes and invalid UTF-8.
      segment = decodeURIComponent(rawSegment);
    } catch {
      return undefined;
    }
    if (!segment || segment === '.' || segment === '..' || FORBIDDEN.test(segment) || NON_CHARACTER.test(segment)) return undefined;
    const size = new TextEncoder().encode(segment).length;
    if (size > MAX_FILE_SEGMENT_BYTES) return undefined;
    bytes += size;
    segments.push(segment);
  }
  if (1 + bytes + segments.length - 1 > MAX_FILE_PATH_BYTES) return undefined;
  return `/${segments.join('/')}`;
}

/** An in-app hash that selects one path inside the reply's real Work. */
export function filesDeepLink(workId: string | undefined, path: string | undefined): string | undefined {
  const normalized = workspacePath(path);
  if (!workId || !normalized) return undefined;
  return `#/work/${encodeURIComponent(workId)}/files/${encodeURIComponent(normalized)}`;
}

/** Resolve a valid reference into its Files destination. */
export function fileReferenceLink(href: string | undefined, workId: string | undefined): { path: string; href: string } | undefined {
  const path = parseFileReference(href);
  const link = path && filesDeepLink(workId, path);
  return path && link ? { path, href: link } : undefined;
}

/** True when the route is shaped like a Files deep link (valid or not). */
export function isFilesRoute(segments: readonly string[]): boolean {
  return segments[0] === 'work' && segments.length >= 3 && segments[2] === 'files';
}

/** A validated explicit file target from already-decoded route segments. */
export function filesRouteTarget(segments: readonly string[]): { workId: string; path: string } | undefined {
  if (!isFilesRoute(segments) || segments.length !== 4) return undefined;
  const workId = segments[1], path = workspacePath(segments[3]);
  return workId && path ? { workId, path } : undefined;
}
