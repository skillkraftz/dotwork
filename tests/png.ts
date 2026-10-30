// Tiny PNG and JPG files for tests, made by hand so no image library is needed.
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A real w x h PNG (8-bit RGB); `pixel` gives each pixel's colour (default: a black and white checker). */
export function makePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number] = (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

/** The headers of a w x h JPG (start of image, a frame of three components, end): enough to be read and embedded, not to be decoded. */
export function makeJpgHeader(w: number, h: number, orientation?: number): Buffer {
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const exif = orientation === undefined ? Buffer.alloc(0) : Buffer.from([
    0xff, 0xe1, 0x00, 0x1e, 0x45, 0x78, 0x69, 0x66, 0, 0, // APP1 "Exif"
    0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, // big-endian TIFF header, first directory at 8
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, orientation, 0, 0, // one entry: orientation, a short
    0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), exif, frame, Buffer.from([0xff, 0xd9])]);
}

export const dataUrl = (bytes: Uint8Array, type: 'png' | 'jpeg' = 'png') => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
