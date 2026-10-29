// The `image` element: a PNG or JPG stored inside the page as a data: URL with its size in pixels. See docs/page-format.md.
import { viewProblems } from './picture';

export const IMAGE_TYPES = ['png', 'jpeg'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** A file over `file_bytes` is refused; a longer side over `max_px` is scaled down to it. */
export const IMAGE_LIMITS = { file_bytes: 10 * 1024 * 1024, max_px: 2400 } as const;

/** The data: URL of a stored image. */
export const DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A data: URL holds 4 characters for every 3 bytes, plus its prefix. */
const MAX_URL_CHARS = Math.ceil((IMAGE_LIMITS.file_bytes * 4) / 3) + 64;

/** The size an image of `w` x `h` pixels is stored at: the same, or with its longer side brought down to 2400 and the proportions kept. */
export function storedSize(w: number, h: number, max: number = IMAGE_LIMITS.max_px): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** What a PNG or JPG file says about itself: its type and size in pixels; null if the bytes are neither. */
export function imageInfo(b: Uint8Array): { type: ImageType; w: number; h: number } | null {
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    const w = u32(16), h = u32(20);
    return w > 0 && h > 0 ? { type: 'png', w, h } : null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the start-of-frame marker, which holds the height and width.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8];
        return w > 0 && h > 0 ? { type: 'jpeg', w, h } : null;
      }
      i += 2 + len;
    }
  }
  return null;
}

/** The EXIF orientation of a JPG (1 to 8; 1 is upright, and what a file with none says). Phone photos are often stored sideways with a 6 or 8 here. */
export function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  while (i + 10 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda) break;
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, little = b[t] === 0x49;
      const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + u32(t + 4), count = u16(ifd);
      for (let k = 0; k < count && ifd + 2 + 12 * (k + 1) <= b.length; k++) {
        const at = ifd + 2 + 12 * k;
        if (u16(at) === 0x0112) return u16(at + 8) || 1;
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** The bytes as a data: URL. */
export function toDataUrl(bytes: Uint8Array, type: ImageType): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/${type};base64,${btoa(text)}`;
}

/** The type and bytes inside a stored image's data: URL. */
export function fromDataUrl(src: string): { type: ImageType; bytes: Uint8Array } {
  const comma = src.indexOf(',');
  const text = atob(src.slice(comma + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return { type: src.slice(0, comma).includes('png') ? 'png' : 'jpeg', bytes };
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Why this is not a good image element (beyond its box), as [field, message] pairs; empty when it is fine. */
export function imageProblems(el: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  if (typeof el.src !== 'string' || !DATA_URL.test(el.src)) out.push(['src', '"src" is required and must be a base64 data: URL of a PNG or JPG ("data:image/png;base64,..." or "data:image/jpeg;base64,...").']);
  else if (el.src.length > MAX_URL_CHARS) out.push(['src', `The image is larger than ${IMAGE_LIMITS.file_bytes / 1024 / 1024} MB.`]);
  for (const k of ['width_px', 'height_px'] as const) {
    if (!isInt(el[k]) || el[k] < 1 || el[k] > IMAGE_LIMITS.max_px) out.push([k, `"${k}" is required and must be a whole number of pixels from 1 to ${IMAGE_LIMITS.max_px}, got ${JSON.stringify(el[k])}.`]);
  }
  return [...out, ...viewProblems(el)];
}
