export type ToolResultPreview =
  | { kind: "text"; text: string; truncated: boolean; isError: boolean }
  | { kind: "non-text" | "unavailable"; truncated: boolean; isError: boolean };

/** Bound public previews by UTF-8 bytes without changing private SDK history. */
export function toolResultPreview(result: unknown, isError = false): ToolResultPreview {
  if (!result || typeof result !== "object" || !Array.isArray((result as { content?: unknown }).content)) return { kind: "unavailable", truncated: false, isError };
  const parts = (result as { content: unknown[] }).content.flatMap(part => {
    if (!part || typeof part !== "object") return [];
    const value = part as { type?: string; text?: unknown };
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  });
  if (!parts.length) return { kind: "non-text", truncated: false, isError };
  const bytes = Buffer.from(parts.join("\n"), "utf8"), limit = 64 * 1024;
  let end = Math.min(bytes.length, limit);
  if (end < bytes.length) while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return { kind: "text", text: bytes.subarray(0, end).toString("utf8"), truncated: end < bytes.length, isError };
}
