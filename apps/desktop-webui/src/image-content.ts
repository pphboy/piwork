/** Pure content-based image identification shared by chat input and Files preview. */
import { t } from './locale.js';
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Bounded defaults chosen for read-only Files preview (not chat input limits). */
export const FILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 8192;
export const IMAGE_MAX_PIXELS = 40_000_000;

/** Identify only by real file signature; an extension is never evidence. */
export function detectImageMime(bytes: Uint8Array): ImageMime | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return undefined;
}

/** Parse dimensions from the same signature families. Throws on malformed input. */
export function imageDimensions(mime: string, bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === 'image/png' && bytes.length >= 33 && view.getUint32(0) === 0x89504e47) { width = view.getUint32(16); height = view.getUint32(20); }
  else if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++]!;
      const n = view.getUint16(p);
      if (n < 2 || p + n > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) { height = view.getUint16(p + 3); width = view.getUint16(p + 5); break; }
      p += n;
    }
  } else if (mime === 'image/webp' && bytes.length >= 20 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    let p = 12;
    while (p + 8 <= bytes.length) {
      const tag = view.getUint32(p), n = view.getUint32(p + 4, true), d = p + 8;
      if (d + n > bytes.length) break;
      if (tag === 0x56503820 && n >= 10) { width = view.getUint16(d + 6, true) & 16383; height = view.getUint16(d + 8, true) & 16383; break; }
      if (tag === 0x5650384c && n >= 5) { const x = view.getUint32(d + 1, true); width = (x & 16383) + 1; height = ((x >>> 14) & 16383) + 1; break; }
      if (tag === 0x56503858 && n === 10) { width = 1 + bytes[d + 4]! + (bytes[d + 5]! << 8) + (bytes[d + 6]! << 16); height = 1 + bytes[d + 7]! + (bytes[d + 8]! << 8) + (bytes[d + 9]! << 16); break; }
      p = d + n + (n & 1);
    }
  }
  if (!width || !height) throw new Error(t('d.images.invalidDimensions'));
  return { width, height };
}

export function imageWithinLimits(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= IMAGE_MAX_SIDE && height <= IMAGE_MAX_SIDE && width * height <= IMAGE_MAX_PIXELS;
}
