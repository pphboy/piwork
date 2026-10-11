import { createHash } from "node:crypto";
import { Type } from "typebox";

export const CHAT_IMAGE_PROFILE = "chat-images-v1" as const;
export const CHAT_IMAGE_LIMITS = Object.freeze({ maxImages: 4, imageBytes: 5 * 1024 ** 2, totalBytes: 10 * 1024 ** 2, requestBytes: 16 * 1024 ** 2, textBytes: 65536, maxDimension: 8192, maxPixels: 40_000_000 });
const strict = { additionalProperties: false } as const;
export const ChatImageMimeSchema = Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg"), Type.Literal("image/webp")]);
export const ChatImageInputSchema = Type.Object({ mimeType: ChatImageMimeSchema, data: Type.String({ minLength: 4, maxLength: 6990508 }) }, strict);
export const ChatImageDescriptorSchema = Type.Object({ mimeType: ChatImageMimeSchema, byteSize: Type.Integer({ minimum: 1, maximum: CHAT_IMAGE_LIMITS.imageBytes }), sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }) }, strict);
export const ChatImageModelSchema = Type.Object({ modelRef: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]), availability: Type.Union([Type.Literal("supported"), Type.Literal("unsupported"), Type.Literal("unknown")]) }, strict);
export const ChatImageCapabilitiesSchema = Type.Object({ profile: Type.Literal(CHAT_IMAGE_PROFILE), mimeTypes: Type.Array(ChatImageMimeSchema, { minItems: 3, maxItems: 3 }), maxImages: Type.Literal(4), imageBytes: Type.Literal(CHAT_IMAGE_LIMITS.imageBytes), totalBytes: Type.Literal(CHAT_IMAGE_LIMITS.totalBytes), maxDimension: Type.Literal(8192), maxPixels: Type.Literal(40_000_000), defaultModel: Type.Union([ChatImageModelSchema, Type.Null()]), models: Type.Array(ChatImageModelSchema, { maxItems: 256 }) }, strict);
export type ChatImageInput = Type.Static<typeof ChatImageInputSchema>;
export type ChatImageDescriptor = Type.Static<typeof ChatImageDescriptorSchema>;
export type ChatImageCapabilities = Type.Static<typeof ChatImageCapabilitiesSchema>;
export type ImageAvailability = "supported" | "unsupported" | "unknown";
export class ChatImageError extends Error {
  constructor(readonly code: "IMAGE_INVALID" | "IMAGE_LIMIT_EXCEEDED" | "IMAGE_MODEL_UNSUPPORTED" | "IMAGE_MODEL_UNCONFIRMED" | "IMAGE_INPUT_UNSUPPORTED" | "IMAGE_HISTORY_CORRUPT", message: string) { super(message); this.name = "ChatImageError"; }
}
const invalid = (): never => { throw new ChatImageError("IMAGE_INVALID", "The image format or contents are invalid."); };
const limit = (): never => { throw new ChatImageError("IMAGE_LIMIT_EXCEEDED", "Use up to 4 images, 5 MiB each and 10 MiB total, within the supported dimensions."); };
function dimensions(w: number, h: number) { if (!w || !h) invalid(); if (w > 8192 || h > 8192 || w * h > 40_000_000) limit(); }
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Container validation only: no pixel decompression, re-encoding or network access. */
export function validateImageBytes(mimeType: string, value: Uint8Array): void {
  const b = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!b.length) invalid(); if (b.length > CHAT_IMAGE_LIMITS.imageBytes) limit();
  if (mimeType === "image/png") {
    if (b.length < 45 || b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") invalid();
    let p = 8, header = false, data = false;
    while (p + 12 <= b.length) {
      const n = b.readUInt32BE(p), end = p + 12 + n;
      if (end > b.length) invalid();
      const type = b.toString("ascii", p + 4, p + 8);
      if (crc32(b.subarray(p + 4, end - 4)) !== b.readUInt32BE(end - 4)) invalid();
      if (!header && type !== "IHDR") invalid();
      if (type === "IHDR") { if (header || n !== 13) invalid(); dimensions(b.readUInt32BE(p + 8), b.readUInt32BE(p + 12)); header = true; }
      if (type === "IDAT") data = true;
      if (type === "IEND") { if (n || !data || end !== b.length) invalid(); return; }
      p = end;
    }
    invalid();
  }
  if (mimeType === "image/jpeg") {
    if (b.length < 4 || b[0] !== 255 || b[1] !== 216) invalid();
    let p = 2, header = false, scan = false;
    while (p < b.length) {
      if (b[p++] !== 255) invalid(); while (b[p] === 255) p++;
      const marker = b[p++]!;
      if (marker === 217) { if (!header || !scan || p !== b.length) invalid(); return; }
      if (marker === undefined || marker === 0 || marker === 216) invalid();
      if (marker >= 208 && marker <= 215 || marker === 1) continue;
      if (p + 2 > b.length) invalid(); const n = b.readUInt16BE(p);
      if (n < 2 || p + n > b.length) invalid();
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (n < 8) invalid(); dimensions(b.readUInt16BE(p + 5), b.readUInt16BE(p + 3)); header = true;
      }
      p += n;
      if (marker === 218) {
        scan = true;
        while (p < b.length) {
          if (b[p] !== 255) { p++; continue; }
          if (b[p + 1] === 0 || (b[p + 1]! >= 208 && b[p + 1]! <= 215)) { p += 2; continue; }
          break;
        }
      }
    }
    invalid();
  }
  if (mimeType === "image/webp") {
    if (b.length < 20 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP" || b.readUInt32LE(4) + 8 !== b.length) invalid();
    let p = 12, image = false;
    while (p + 8 <= b.length) {
      const type = b.toString("ascii", p, p + 4), n = b.readUInt32LE(p + 4), d = p + 8, end = d + n;
      if (end + (n & 1) > b.length) invalid();
      if (type === "VP8 ") { if (n < 10 || b.subarray(d + 3, d + 6).toString("hex") !== "9d012a") invalid(); dimensions(b.readUInt16LE(d + 6) & 16383, b.readUInt16LE(d + 8) & 16383); image = true; }
      if (type === "VP8L") { if (n < 5 || b[d] !== 47) invalid(); const v = b.readUInt32LE(d + 1); dimensions((v & 16383) + 1, ((v >>> 14) & 16383) + 1); image = true; }
      if (type === "VP8X") { if (n !== 10 || (b[d]! & 2)) invalid(); dimensions(b.readUIntLE(d + 4, 3) + 1, b.readUIntLE(d + 7, 3) + 1); }
      p = end + (n & 1);
    }
    if (p !== b.length || !image) invalid(); return;
  }
  invalid();
}
export function validateChatImages(images: readonly ChatImageInput[]): ChatImageDescriptor[] {
  if (!Array.isArray(images) || images.length > CHAT_IMAGE_LIMITS.maxImages) limit();
  let total = 0;
  return images.map(image => {
    if (!image || Object.keys(image).sort().join(",")!=="data,mimeType" || typeof image.data !== "string" || image.data.length > 6990508 || image.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) invalid();
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.toString("base64") !== image.data) invalid();
    total += bytes.length; if (total > CHAT_IMAGE_LIMITS.totalBytes) limit();
    validateImageBytes(image.mimeType, bytes);
    return { mimeType: image.mimeType, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(typeof value==='string'?Buffer.from(value,'utf8').toString('utf8'):value).replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
}
export function chatInputDigest(prompt: string, images: readonly ChatImageInput[] = []): string {
  return createHash("sha256").update(images.length ? canonical({ profile: CHAT_IMAGE_PROFILE, prompt, images: validateChatImages(images) }) : prompt).digest("hex");
}
export function parseChatImageInput(value: string): { profile: typeof CHAT_IMAGE_PROFILE; prompt: string; images: ChatImageInput[] } {
  if(Buffer.byteLength(value)>CHAT_IMAGE_LIMITS.requestBytes)invalid();
  const input = JSON.parse(value);
  if (!input || Object.keys(input).sort().join(",") !== "images,profile,prompt" || input.profile !== CHAT_IMAGE_PROFILE || typeof input.prompt !== "string" || Buffer.byteLength(input.prompt) > CHAT_IMAGE_LIMITS.textBytes || !input.images?.length) invalid();
  validateChatImages(input.images); return input;
}
