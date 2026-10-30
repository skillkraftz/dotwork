// Reads a PNG or JPG file into what the `image` element stores: a data: URL and the size in pixels. A longer side over 2400 px is scaled down to 2400
// (a PNG stays a lossless PNG, a JPG stays a JPG); a file over 10 MB is refused. A file that is already small enough is stored byte for byte.
import { IMAGE_LIMITS, imageInfo, jpegOrientation, storedSize, toDataUrl, type ImageType } from '../format/image';

export type ImageRead =
  | { ok: true; src: string; width_px: number; height_px: number }
  | { ok: false; reason: string };

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** The picture drawn at `w` x `h` and written as a PNG (lossless) or a JPG, using the browser's own decoder and encoder. */
async function redraw(file: Blob, type: ImageType, w: number, h: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('the browser has no canvas to scale it with');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type === 'png' ? 'image/png' : 'image/jpeg', 0.92));
    if (!blob) throw new Error('the browser could not write it');
    return new Uint8Array(await blob.arrayBuffer());
  } finally { bitmap.close(); }
}

export async function readImageFile(file: File): Promise<ImageRead> {
  if (file.size > IMAGE_LIMITS.file_bytes) return { ok: false, reason: `${file.name} is ${mb(file.size)} MB. Images over ${mb(IMAGE_LIMITS.file_bytes)} MB aren’t imported: make it smaller and try again.` };
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch (err) { return { ok: false, reason: `${file.name} couldn’t be read: ${(err as Error).message}` }; }
  const info = imageInfo(bytes);
  if (!info) return { ok: false, reason: `${file.name} isn’t a PNG or JPG picture.` };
  // A phone photo is often stored sideways with a note to turn it (orientation 5 to 8 swaps width and height). Such a photo is turned for good,
  // so that the screen, the PNG and the PDF all show it the same way up.
  const orientation = info.type === 'jpeg' ? jpegOrientation(bytes) : 1;
  const shown = orientation >= 5 ? { w: info.h, h: info.w } : { w: info.w, h: info.h };
  const target = storedSize(shown.w, shown.h);
  if (orientation !== 1 || target.w !== shown.w || target.h !== shown.h) {
    try { bytes = await redraw(file, info.type, target.w, target.h); } catch (err) {
      return { ok: false, reason: `${file.name} is ${info.w} × ${info.h} px and couldn’t be scaled down: ${(err as Error).message}.` };
    }
  }
  const { w, h } = target;
  if (bytes.length > IMAGE_LIMITS.file_bytes) return { ok: false, reason: `${file.name} is still ${mb(bytes.length)} MB at ${w} × ${h} px. Images over ${mb(IMAGE_LIMITS.file_bytes)} MB aren’t imported.` };
  return { ok: true, src: toDataUrl(bytes, info.type), width_px: w, height_px: h };
}
