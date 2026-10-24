// The PDF stage: draws a display list (see display.ts) into a PDF as vectors and real text. It does exactly what the list says,
// at the sizes and positions it gives; correcting for a printer is done before this (correct.ts).
import {
  appendBezierCurve, clip, closePath, concatTransformationMatrix, degrees, drawObject, endPath, fill, fillAndStroke, LineCapStyle, lineTo, moveTo,
  popGraphicsState, pushGraphicsState, rgb, setFillingColor, setLineCap, setLineWidth, setStrokingColor, stroke,
  type PDFDocument, type PDFFont, type PDFPage, type PDFRef,
} from 'pdf-lib';
import type { Page } from '../format/types';
import { dotsAsSet, type Cap, type Item, type Pt } from './display';
import { layoutPage, type PageLayoutOptions } from './layout';

export const MM_TO_PT = 72 / 25.4;
export const mmToPt = (mm: number) => mm * MM_TO_PT;

export interface Fonts { regular: PDFFont; bold: PDFFont }

export const color = (hex: string) => {
  // "#fff" is "#ffffff" (art's black and white are written short).
  const v = parseInt(hex.length === 4 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

const CAPS: Record<Cap, LineCapStyle> = { butt: LineCapStyle.Butt, round: LineCapStyle.Round, square: LineCapStyle.Projecting };

/**
 * A dot grid is about 1,200 circles. Each distinct set of dots is written once per PDF as a reusable form (round dots of the size given,
 * at the positions given), and every page that has it places the form, so the file stays small and the export fast.
 */
const dotForms = new WeakMap<PDFDocument, Map<string, PDFRef>>();
const KAPPA = 0.5522847498;

function dotForm(doc: PDFDocument, key: string, diameterMm: number, pts: [number, number][], rgbColor: ReturnType<typeof rgb>): PDFRef {
  let forms = dotForms.get(doc);
  if (!forms) dotForms.set(doc, (forms = new Map()));
  const have = forms.get(key);
  if (have) return have;
  const r = mmToPt(diameterMm) / 2, k = r * KAPPA;
  // Coordinates are written to 0.01 pt (0.0035 mm, a sixth of a 1200 dpi printer's dot): a corrected (turned) lattice has no tidy numbers,
  // and written in full they would make the form three times as big.
  const q = (v: number) => Math.round(v * 100) / 100;
  // Local space: the set's origin is the pattern's top-left corner, x right and y up (so the mm y of a dot is negated).
  const ops = [setFillingColor(rgbColor)];
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (const [px, py] of pts) {
    const x = mmToPt(px), cy = -mmToPt(py);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
    ops.push(
      moveTo(q(x + r), q(cy)), appendBezierCurve(q(x + r), q(cy + k), q(x + k), q(cy + r), q(x), q(cy + r)),
      appendBezierCurve(q(x - k), q(cy + r), q(x - r), q(cy + k), q(x - r), q(cy)), appendBezierCurve(q(x - r), q(cy - k), q(x - k), q(cy - r), q(x), q(cy - r)),
      appendBezierCurve(q(x + k), q(cy - r), q(x + r), q(cy - k), q(x + r), q(cy)), closePath(), fill(),
    );
  }
  const ref = doc.context.register(doc.context.formXObject(ops, { BBox: [x0 - r, y0 - r, x1 + r, y1 + r] }));
  forms.set(key, ref);
  return ref;
}

/** The text with any character the font has no glyph for replaced by "?", so a stray symbol can't stop an export. */
function printable(str: string, font: PDFFont): string {
  const have = new Set(font.getCharacterSet());
  return [...str].map((ch) => (have.has(ch.codePointAt(0)!) ? ch : '?')).join('').replace(/[\r\n]+/g, ' ');
}

/** Draw a display list on a PDF page `sheetHeight` mm tall (to turn y-down mm into PDF's y-up points). */
export function drawItems(pdf: PDFPage, items: readonly Item[], fonts: Fonts, sheetHeight: number): void {
  const X = (mm: number) => mmToPt(mm), Y = (mm: number) => mmToPt(sheetHeight - mm);
  const trace = (pts: readonly Pt[]) => [moveTo(X(pts[0].x), Y(pts[0].y)), ...pts.slice(1).map((p) => lineTo(X(p.x), Y(p.y))), closePath()];

  for (const i of items) {
    switch (i.k) {
      case 'line':
        pdf.drawLine({ start: { x: X(i.x1), y: Y(i.y1) }, end: { x: X(i.x2), y: Y(i.y2) }, thickness: mmToPt(i.w), color: color(i.c), lineCap: CAPS[i.cap] });
        break;
      case 'rect':
        pdf.drawRectangle({ x: X(i.x), y: Y(i.y + i.h), width: mmToPt(i.w), height: mmToPt(i.h), color: color(i.c) });
        break;
      case 'poly':
        pdf.pushOperators(pushGraphicsState(), setFillingColor(color(i.c)), ...trace(i.pts), fill(), popGraphicsState());
        break;
      case 'dots':
      case 'dotset': {
        const set = i.k === 'dots' ? dotsAsSet(i) : i;
        if (!set.pts.length) break;
        const form = dotForm(pdf.doc, set.key, set.d, set.pts, color(set.c));
        pdf.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, X(set.x), Y(set.y)), drawObject(pdf.node.newXObject('Dots', form)), popGraphicsState());
        break;
      }
      case 'text': {
        const font = i.font === 'bold' ? fonts.bold : fonts.regular, safe = printable(i.str, font);
        if (!safe) break;
        const size = mmToPt(i.size), width = font.widthOfTextAtSize(safe, size);
        const back = i.align === 'start' ? 0 : i.align === 'middle' ? width / 2 : width, angle = (i.rot * Math.PI) / 180;
        // Step back along the text's own direction to its start.
        pdf.drawText(safe, { x: X(i.x) - back * Math.cos(angle), y: Y(i.y) - back * Math.sin(angle), size, font, color: color(i.c), rotate: degrees(i.rot) });
        break;
      }
      case 'path': {
        const [first, ...rest] = i.segs;
        if (!first) break;
        const ops = [pushGraphicsState()];
        if (i.fill !== undefined) ops.push(setFillingColor(color(i.fill)));
        if (i.stroke) ops.push(setLineWidth(mmToPt(i.stroke.w)), setLineCap(CAPS[i.stroke.cap]), setStrokingColor(color(i.stroke.c)));
        for (const s of [first, ...rest]) {
          if (s[0] === 'M') ops.push(moveTo(X(s[1]), Y(s[2])));
          else if (s[0] === 'L') ops.push(lineTo(X(s[1]), Y(s[2])));
          else if (s[0] === 'C') ops.push(appendBezierCurve(X(s[1]), Y(s[2]), X(s[3]), Y(s[4]), X(s[5]), Y(s[6])));
          else ops.push(closePath());
        }
        ops.push(i.fill !== undefined && i.stroke ? fillAndStroke() : i.fill !== undefined ? fill() : stroke(), popGraphicsState());
        pdf.pushOperators(...ops);
        break;
      }
      case 'clip':
        pdf.pushOperators(pushGraphicsState(), ...trace(i.pts), clip(), endPath());
        break;
      case 'unclip':
        pdf.pushOperators(popGraphicsState());
        break;
    }
  }
}

export interface PageDrawOptions extends PageLayoutOptions {
  /** Total height of the PDF page in mm, to turn y-down mm into PDF's y-up points. */
  sheetHeight: number;
  fonts: Fonts;
}

/** Lay out one page and draw it as it is, with no printer correction (pages.pdf and the tests). */
export function drawPage(pdf: PDFPage, page: Page, o: PageDrawOptions): void {
  const items: Item[] = [];
  layoutPage(page, o, items);
  drawItems(pdf, items, o.fonts, o.sheetHeight);
}
