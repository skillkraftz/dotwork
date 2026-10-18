import type { Page } from './format/types';
import { PAGE_H_MM, PAGE_W_MM } from './format/types';
import { exportSvg } from './render';
import { setPngDpi } from './pngdpi';
import regular from './fonts/CourierPrime-Regular.woff2?inline';
import bold from './fonts/CourierPrime-Bold.woff2?inline';

export const PNG_DPI = 600;
const mmToPx = (mm: number) => Math.round((mm / 25.4) * PNG_DPI);

const FONT_CSS =
  `@font-face{font-family:'Courier Prime';font-weight:400;src:url(${regular}) format('woff2')}` +
  `@font-face{font-family:'Courier Prime';font-weight:700;src:url(${bold}) format('woff2')}`;

/** Render the page as printed to a PNG at its final size (88.9 x 139.7 mm at 600 DPI). */
export async function pageToPng(page: Page): Promise<Blob> {
  const w = mmToPx(PAGE_W_MM), h = mmToPx(PAGE_H_MM);
  const svg = exportSvg(page, w, h, FONT_CSS);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('The browser could not create the PNG.');
    const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), PNG_DPI);
    return new Blob([bytes as BlobPart], { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
