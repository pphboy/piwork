import { WorkPackageValidationError } from "@piwork/contracts";
import { WORK_PACKAGE_LIMITS } from "./limits.js";

function invalid(): never { throw new WorkPackageValidationError("PACKAGE_INVALID", "json"); }

/** Duplicate-aware parser. All maps are prototype-free, including user env maps. */
export function parseWorkJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > WORK_PACKAGE_LIMITS.metadataBytes) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "metadata");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { invalid(); }
  let offset = 0;
  const whitespace = () => { while (offset < text.length && /[\x20\t\r\n]/.test(text[offset]!)) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '"') {
        try { return JSON.parse(text.slice(start, offset)) as string; } catch { invalid(); }
      }
      if (char === "\\") offset++;
    }
    return invalid();
  };
  const value = (depth: number): unknown => {
    if (depth > WORK_PACKAGE_LIMITS.depth) invalid();
    whitespace();
    const char = text[offset];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      offset++;
      const object = char === "{";
      const end = object ? "}" : "]";
      const result: Record<string, unknown> | unknown[] = object ? Object.create(null) as Record<string, unknown> : [];
      whitespace();
      if (text[offset] === end) { offset++; return result; }
      while (offset < text.length) {
        if (object) {
          if (text[offset] !== '"') invalid();
          const key = string(); whitespace();
          if (text[offset++] !== ":" || Object.hasOwn(result, key)) invalid();
          (result as Record<string, unknown>)[key] = value(depth + 1);
        } else (result as unknown[]).push(value(depth + 1));
        whitespace();
        if (text[offset] === end) { offset++; return result; }
        if (text[offset++] !== ",") invalid();
        whitespace();
      }
      return invalid();
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(offset));
    if (!match) return invalid();
    offset += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) invalid();
    return number;
  };
  const parsed = value(0); whitespace();
  if (offset !== text.length) invalid();
  return parsed;
}

/** Deterministic JSON without assigning keys into normal JS objects. */
export function encodeWorkJson(value: unknown): Buffer {
  const seen = new Set<object>();
  const encode = (item: unknown, depth: number): string => {
    if (depth > WORK_PACKAGE_LIMITS.depth) invalid();
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) invalid();
      return JSON.stringify(item);
    }
    if (typeof item !== "object" || seen.has(item)) return invalid();
    seen.add(item);
    let output: string;
    if (Array.isArray(item)) {
      const parts: string[] = [];
      for (let i = 0; i < item.length; i++) parts.push(encode(item[i], depth + 1));
      output = `[${parts.join(",")}]`;
    } else {
      const record = item as Record<string, unknown>;
      const keys = Object.keys(record).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      output = `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key], depth + 1)}`).join(",")}}`;
    }
    seen.delete(item);
    return output;
  };
  const bytes = Buffer.from(encode(value, 0));
  if (bytes.length > WORK_PACKAGE_LIMITS.metadataBytes) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "metadata");
  return bytes;
}
