import type { IncomingMessage } from "node:http";
import { TextDecoder } from "node:util";
import { FILE_LIMITS } from "@piwork/contracts";
import { SaxesParser } from "saxes";
import { WorkFileExecutionError } from "./coordinator.js";

export interface QName { readonly uri: string; readonly local: string; }
export interface PropertyRequest { readonly mode: "allprop" | "propname" | "prop"; readonly properties: readonly QName[]; }
interface XmlNode extends QName { readonly children: XmlNode[]; text: string; }
export interface FileMetadata { readonly pathSegments: readonly string[];
  readonly kind: "file" | "directory" | "symlink" | "unsupported";
  readonly size: number | null; readonly modifiedMs: number | null; }

const DAV = "DAV:";
const PIWORK = "urn:piwork:files";
const LIVE: readonly QName[] = [
  { uri: DAV, local: "displayname" }, { uri: DAV, local: "resourcetype" },
  { uri: DAV, local: "getcontentlength" }, { uri: DAV, local: "getlastmodified" },
  { uri: DAV, local: "getcontenttype" }, { uri: DAV, local: "supportedlock" },
  { uri: DAV, local: "lockdiscovery" }, { uri: PIWORK, local: "kind" },
];

function invalid(): never { throw new WorkFileExecutionError("FILE_XML_INVALID"); }
function same(node: QName, uri: string, local: string): boolean { return node.uri === uri && node.local === local; }
function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export async function readXml(request: IncomingMessage): Promise<string> {
  const declared = request.headers["content-length"];
  if (typeof declared === "string" && Number(declared) > FILE_LIMITS.maxXmlBytes)
    throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > FILE_LIMITS.maxXmlBytes) throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
    chunks.push(chunk);
  }
  if (size === 0) return "";
  const type = request.headers["content-type"];
  if (typeof type === "string") {
    const match = /^(?:application|text)\/xml(?:\s*;\s*charset=([^;\s]+))?\s*$/i.exec(type);
    if (!match || match[1] && !/^"?utf-8"?$/i.test(match[1]))
      throw new WorkFileExecutionError("FILE_MEDIA_UNSUPPORTED");
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { return invalid(); }
}

function parseXml(xml: string): XmlNode {
  let root: XmlNode | undefined;
  const stack: XmlNode[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("xmldecl", (decl) => { if (decl.encoding && decl.encoding.toLowerCase() !== "utf-8") invalid(); });
  parser.on("doctype", invalid);
  parser.on("processinginstruction", invalid);
  parser.on("cdata", invalid);
  parser.on("opentag", (tag) => {
    if (stack.length >= FILE_LIMITS.maxXmlDepth) invalid();
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri !== "http://www.w3.org/2000/xmlns/") invalid();
    }
    const node: XmlNode = { uri: tag.uri, local: tag.local, children: [], text: "" };
    if (stack.length === 0) { if (root) invalid(); root = node; }
    else stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("text", (value) => { if (stack.length > 0) stack.at(-1)!.text += value; else if (value.trim()) invalid(); });
  parser.on("closetag", () => { stack.pop(); });
  parser.on("error", invalid);
  try { parser.write(xml).close(); }
  catch { invalid(); }
  if (!root || stack.length !== 0) invalid();
  return root;
}

function propertyChildren(node: XmlNode): QName[] {
  if (node.text.trim()) invalid();
  if (node.children.length > FILE_LIMITS.maxProperties) throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
  return node.children.map((child) => {
    if (child.children.length > 0 || child.text.trim()) invalid();
    return { uri: child.uri, local: child.local };
  });
}

export function parsePropfind(xml: string): PropertyRequest {
  if (xml.trim() === "") return { mode: "allprop", properties: [] };
  const root = parseXml(xml);
  if (!same(root, DAV, "propfind") || root.text.trim()) invalid();
  const allprop = root.children.find((child) => same(child, DAV, "allprop"));
  const propname = root.children.find((child) => same(child, DAV, "propname"));
  const prop = root.children.find((child) => same(child, DAV, "prop"));
  const include = root.children.find((child) => same(child, DAV, "include"));
  if (Number(Boolean(allprop)) + Number(Boolean(propname)) + Number(Boolean(prop)) !== 1
    || root.children.length !== Number(Boolean(allprop)) + Number(Boolean(propname)) + Number(Boolean(prop)) + Number(Boolean(include))
    || include && !allprop) invalid();
  if (allprop) {
    if (allprop.children.length || allprop.text.trim()) invalid();
    return { mode: "allprop", properties: include ? propertyChildren(include) : [] };
  }
  if (propname) {
    if (propname.children.length || propname.text.trim()) invalid();
    return { mode: "propname", properties: [] };
  }
  return { mode: "prop", properties: propertyChildren(prop!) };
}

export function parseProppatch(xml: string): readonly QName[] {
  if (xml.trim() === "") invalid();
  const root = parseXml(xml);
  if (!same(root, DAV, "propertyupdate") || root.text.trim() || root.children.length === 0) invalid();
  const properties: QName[] = [];
  for (const operation of root.children) {
    if ((!same(operation, DAV, "set") && !same(operation, DAV, "remove"))
      || operation.text.trim() || operation.children.length !== 1 || !same(operation.children[0]!, DAV, "prop")) invalid();
    const prop = operation.children[0]!;
    if (prop.text.trim()) invalid();
    for (const child of prop.children) {
      properties.push({ uri: child.uri, local: child.local });
      if (properties.length > FILE_LIMITS.maxProperties) throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
    }
  }
  if (properties.length === 0) invalid();
  return properties;
}

function qname(property: QName): string {
  if (property.uri === DAV) return `d:${property.local}`;
  if (property.uri === PIWORK) return `p:${property.local}`;
  return `x:${property.local} xmlns:x="${escapeXml(property.uri)}"`;
}

function value(property: QName, entry: FileMetadata): string | undefined {
  if (property.uri === PIWORK && property.local === "kind") return escapeXml(entry.kind);
  if (property.uri !== DAV) return undefined;
  switch (property.local) {
    case "displayname": return escapeXml(entry.pathSegments.at(-1) ?? "/");
    case "resourcetype": return entry.kind === "directory" ? "<d:collection/>" : "";
    case "getcontentlength": return entry.kind === "file" ? String(entry.size ?? 0) : undefined;
    case "getlastmodified": return entry.modifiedMs !== null
      ? new Date(entry.modifiedMs).toUTCString() : undefined;
    case "getcontenttype": return entry.kind === "file" ? "application/octet-stream"
      : entry.kind === "directory" ? "httpd/unix-directory" : undefined;
    case "supportedlock": case "lockdiscovery": return "";
    default: return undefined;
  }
}

export function fileHref(workId: string, entry: FileMetadata): string {
  return `/api/v1/works/${workId}/files/${entry.pathSegments.map(encodeURIComponent).join("/")}`
    + (entry.kind === "directory" && entry.pathSegments.length > 0 ? "/" : "");
}

export function renderPropfind(workId: string, entries: readonly FileMetadata[], request: PropertyRequest): string {
  const responses = entries.map((entry) => {
    const properties = request.mode === "propname" ? LIVE.filter((item) => value(item, entry) !== undefined)
      : request.mode === "allprop" ? [...LIVE.filter((item) => value(item, entry) !== undefined), ...request.properties]
      : request.properties;
    const success: string[] = [], missing: string[] = [];
    for (const property of properties) {
      const encoded = qname(property);
      const content = value(property, entry);
      if (content === undefined) missing.push(`<${encoded}/>`);
      else success.push(request.mode === "propname" || content === "" ? `<${encoded}/>` : `<${encoded}>${content}</${encoded.split(" ")[0]}>`);
    }
    const stat = (status: 200 | 404, props: readonly string[]) => props.length === 0 ? ""
      : `<d:propstat><d:prop>${props.join("")}</d:prop><d:status>HTTP/1.1 ${status} ${status === 200 ? "OK" : "Not Found"}</d:status></d:propstat>`;
    return `<d:response><d:href>${escapeXml(fileHref(workId, entry))}</d:href>${stat(200, success)}${stat(404, missing)}</d:response>`;
  });
  const xml = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files">${responses.join("")}</d:multistatus>`;
  if (Buffer.byteLength(xml) > FILE_LIMITS.maxMetadataBytes) throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
  return xml;
}

export function renderProppatch(workId: string, entry: FileMetadata, properties: readonly QName[]): string {
  const props = properties.map((property) => `<${qname(property)}/>`).join("");
  const xml = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files"><d:response><d:href>${escapeXml(fileHref(workId, entry))}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response></d:multistatus>`;
  if (Buffer.byteLength(xml) > FILE_LIMITS.maxMetadataBytes) throw new WorkFileExecutionError("FILE_LIMIT_EXCEEDED");
  return xml;
}
