import { TextDecoder } from "node:util";
import { FILE_ERROR_STATUS, FILE_LIMITS, type FileErrorCode } from "@piwork/contracts";
import { SaxesParser } from "saxes";

const LOCAL = /^\/works\/([A-Za-z0-9-]{16,128})\/files(\/.*)?$/s;
const CORE = /^\/api\/v1\/works\/([A-Za-z0-9-]{16,128})\/files(\/.*)?$/s;
const BAD_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u;

export class FileProxyError extends Error {
  constructor(readonly code: FileErrorCode) { super(code); }
  get status(): number { return FILE_ERROR_STATUS[this.code]; }
}

function validated(raw: string, pattern: RegExp): { workId: string; suffix: string } {
  if (raw.includes("?") || raw.includes("#")) throw new FileProxyError("FILE_PATH_INVALID");
  const match = pattern.exec(raw);
  if (!match) throw new FileProxyError("FILE_PATH_INVALID");
  const suffix = match[2] ?? "";
  if (suffix && suffix !== "/") {
    const parts = suffix.slice(1).split("/");
    if (suffix.endsWith("/")) parts.pop();
    if (parts.length > FILE_LIMITS.maxPathDepth) throw new FileProxyError("FILE_PATH_TOO_LONG");
    let bytes = 0;
    for (const part of parts) {
      if (!part || /%(?![0-9A-Fa-f]{2})/.test(part)) throw new FileProxyError("FILE_PATH_INVALID");
      let decoded: string;
      try { decoded = decodeURIComponent(part); } catch { throw new FileProxyError("FILE_PATH_INVALID"); }
      if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")
        || BAD_XML.test(decoded)) throw new FileProxyError("FILE_PATH_INVALID");
      const size = Buffer.byteLength(decoded);
      if (size > FILE_LIMITS.maxSegmentBytes) throw new FileProxyError("FILE_PATH_TOO_LONG");
      bytes += size + 1;
      if (bytes > FILE_LIMITS.maxPathBytes) throw new FileProxyError("FILE_PATH_TOO_LONG");
    }
  }
  return { workId: match[1]!, suffix };
}

export function toCorePath(raw: string): { workId: string; path: string } {
  const target = validated(raw, LOCAL);
  return { workId: target.workId, path: `/api/v1/works/${target.workId}/files${target.suffix}` };
}

export function toLocalPath(raw: string, workId: string): string {
  const target = validated(raw, CORE);
  if (target.workId !== workId) throw new FileProxyError("FILE_BACKEND_PROTOCOL_ERROR");
  return `/works/${workId}/files${target.suffix}`;
}

export function mapDestination(raw: string, workId: string, localOrigin: string): string {
  let path = raw;
  if (!raw.startsWith("/")) {
    const absolute = /^http:\/\/([^/?#]+)(\/[^?#]*)$/.exec(raw);
    if (!absolute || absolute[1]?.toLowerCase() !== localOrigin.slice("http://".length).toLowerCase())
      throw new FileProxyError("FILE_DESTINATION_DENIED");
    path = absolute[2]!;
  }
  try {
    const target = toCorePath(path);
    if (target.workId !== workId || target.path.endsWith("/files") || target.path.endsWith("/files/"))
      throw new FileProxyError("FILE_DESTINATION_DENIED");
    return target.path;
  } catch { throw new FileProxyError("FILE_DESTINATION_DENIED"); }
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function localFileError(code: FileErrorCode, head = false): { status: number; headers: Record<string, string | number>; body: string } {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:p="urn:piwork:files"><p:code>${code}</p:code></d:error>`;
  return { status: FILE_ERROR_STATUS[code], headers: { "content-type": "application/xml; charset=utf-8",
    "cache-control": "no-store", "x-piwork-file-error": code,
    ...(code === "LOCAL_AUTH_REQUIRED" ? { "www-authenticate": 'Basic realm="piwork Work files", charset="UTF-8"' } : {}),
    "content-length": Buffer.byteLength(body) }, body: head ? "" : body };
}

/** Parse the bounded Core response and rewrite only DAV:href text nodes. */
export function mapDavXml(bytes: Buffer, workId: string): Buffer {
  if (bytes.length > FILE_LIMITS.maxMetadataBytes) throw new FileProxyError("FILE_LIMIT_EXCEEDED");
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new FileProxyError("FILE_BACKEND_PROTOCOL_ERROR"); }
  const parser = new SaxesParser({ xmlns: true });
  const stack: { name: string; href: boolean; text: string }[] = [];
  const output: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
  const malformed = (): never => { throw new FileProxyError("FILE_BACKEND_PROTOCOL_ERROR"); };
  parser.on("doctype", malformed);
  parser.on("processinginstruction", malformed);
  parser.on("opentag", (tag) => {
    if (stack.length >= FILE_LIMITS.maxXmlDepth || stack.at(-1)?.href) malformed();
    const attributes = Object.values(tag.attributes).map((attr) => ` ${attr.name}="${escapeXml(attr.value)}"`).join("");
    output.push(`<${tag.name}${attributes}>`);
    stack.push({ name: tag.name, href: tag.uri === "DAV:" && tag.local === "href", text: "" });
  });
  const appendText = (value: string) => {
    const current = stack.at(-1);
    if (!current) { if (value.trim()) malformed(); return; }
    if (current!.href) current!.text += value;
    else output.push(escapeXml(value));
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => {
    const current = stack.pop();
    if (!current) malformed();
    if (current!.href) output.push(escapeXml(toLocalPath(current!.text, workId)));
    output.push(`</${current!.name}>`);
  });
  parser.on("error", malformed);
  try { parser.write(xml).close(); } catch { malformed(); }
  if (stack.length) malformed();
  const result = Buffer.from(output.join(""));
  if (result.length > FILE_LIMITS.maxMetadataBytes) throw new FileProxyError("FILE_LIMIT_EXCEEDED");
  return result;
}
