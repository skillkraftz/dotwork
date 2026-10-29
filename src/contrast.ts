/**
 * "Darker grays on screen": on some laptop displays the lightest grays (the Light shade, writing lines, dots) look white.
 * One gray-to-gray curve darkens them: white and black stay, gray text stays lighter than black text. The screen applies
 * it as an SVG filter (the page's own markup and colors don't change); a PNG can apply it to its pixels. Never the PDFs.
 */
const POINTS: [number, number][] = [
  [0, 0], [128, 100], [176, 148], [189, 160], [196, 170], [207, 183], [220, 196], [239, 214], [255, 255],
];

/** Each gray 0..255 and what it becomes. */
export const CONTRAST_TABLE: number[] = Array.from({ length: 256 }, (_, v) => {
  let i = 1;
  while (POINTS[i][0] < v) i++;
  const [x0, y0] = POINTS[i - 1], [x1, y1] = POINTS[i];
  return Math.round(y0 + ((y1 - y0) * (v - x0)) / (x1 - x0));
});

/** Darken RGBA pixels in place (the alpha is left alone). */
export function darkenPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = CONTRAST_TABLE[data[i]];
    data[i + 1] = CONTRAST_TABLE[data[i + 1]];
    data[i + 2] = CONTRAST_TABLE[data[i + 2]];
  }
}

export const VIEW_CONTRAST_KEY = 'dotwork.view.contrast';
const FILTER_ID = 'dw-contrast';

/** On unless it was switched off. */
export function contrastOn(): boolean {
  try { return localStorage.getItem(VIEW_CONTRAST_KEY) !== '0'; } catch { return true; }
}

/** Put the filter in the document and the on/off class on the body; returns the setter. */
export function setupContrast(): (on: boolean) => void {
  const values = CONTRAST_TABLE.map((v) => (v / 255).toFixed(4)).join(' ');
  const holder = document.createElement('div');
  holder.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${FILTER_ID}" color-interpolation-filters="sRGB">` +
    `<feComponentTransfer><feFuncR type="table" tableValues="${values}"/><feFuncG type="table" tableValues="${values}"/><feFuncB type="table" tableValues="${values}"/></feComponentTransfer></filter></svg>`;
  document.body.append(holder.firstElementChild!);
  return (on) => {
    document.body.classList.toggle('contrast', on);
    try { localStorage.setItem(VIEW_CONTRAST_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  };
}
