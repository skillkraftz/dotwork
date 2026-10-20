// Draws a page into a PDF as vectors and real text. Mirrors src/render.ts (the SVG);
// the sizes, weights and grays come from there so the screen, the PNG and the PDF match.
import {
  appendBezierCurve, clip, closePath, concatTransformationMatrix, degrees, drawObject, endPath, fill, LineCapStyle, moveTo,
  popGraphicsState, pushGraphicsState, rectangle, rgb, setFillingColor,
  type PDFDocument, type PDFFont, type PDFPage, type PDFRef,
} from 'pdf-lib';
import {
  DEFAULTS, GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, PITCH_MM as P,
  type Box, type Checkboxes, type Page, type PageElement, type Pattern, type Rule, type Shade, type Sequence, type Text,
} from '../format/types';
import { TEXT_INSET_MM, TEXT_SIZE_MM } from '../format/bounds';
import {
  BASELINE_MM, DOT_MM, GRAY_DOT, HEADER_BASELINE_MM, HEADER_COLOR, LINE, TEXT_COLORS, headerItems, iconPlacement, itemCenter, ticks,
} from '../render';
import { shadeRects } from '../format/shade';
import { isIcons, itemSize, sequenceItems } from '../format/sequence';
import { ICONS } from '../icons/icons';
import { SCREEN_TONES, type PrintTones } from './tones';

export const MM_TO_PT = 72 / 25.4;
export const mmToPt = (mm: number) => mm * MM_TO_PT;

export interface Fonts { regular: PDFFont; bold: PDFFont }

export interface PageDrawOptions {
  /** Where the page's top-left corner lands on the PDF page, in mm from the top-left of that page. */
  x: number;
  y: number;
  /** Total height of the PDF page in mm, to turn y-down mm into PDF's y-up points. */
  sheetHeight: number;
  fonts: Fonts;
  pageNumber: string | null;
  expand: (text: string) => string;
  /** The grays of shade tones and gray text. Defaults to the fixed grays of the screen. */
  tones?: PrintTones;
}

export const color = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

/**
 * A dot grid is about 1,200 circles. Each distinct pattern is written once per PDF as a reusable form, and every page
 * that has it places the form, so the file stays small and the export fast.
 */
const dotForms = new WeakMap<PDFDocument, Map<string, PDFRef>>();
const KAPPA = 0.5522847498;

function dotForm(doc: PDFDocument, radiusPt: number, cols: number[], rows: number[], rgbColor: ReturnType<typeof rgb>): PDFRef {
  const key = `${radiusPt}|${cols.join(',')}|${rows.join(',')}|${JSON.stringify(rgbColor)}`;
  let forms = dotForms.get(doc);
  if (!forms) dotForms.set(doc, (forms = new Map()));
  const have = forms.get(key);
  if (have) return have;
  const r = radiusPt, k = r * KAPPA;
  // Local space: the pattern's top-left corner is the origin, x right and y up (so rows run to negative y).
  const ops = [setFillingColor(rgbColor)];
  for (const x of cols) {
    for (const y of rows) {
      const cy = -y;
      ops.push(
        moveTo(x + r, cy), appendBezierCurve(x + r, cy + k, x + k, cy + r, x, cy + r),
        appendBezierCurve(x - k, cy + r, x - r, cy + k, x - r, cy), appendBezierCurve(x - r, cy - k, x - k, cy - r, x, cy - r),
        appendBezierCurve(x + k, cy - r, x + r, cy - k, x + r, cy), closePath(), fill(),
      );
    }
  }
  const lastCol = cols[cols.length - 1] ?? 0, lastRow = rows[rows.length - 1] ?? 0;
  const ref = doc.context.register(doc.context.formXObject(ops, { BBox: [-r, -lastRow - r, lastCol + r, r] }));
  forms.set(key, ref);
  return ref;
}

/** Draw one page, clipped to its own box so nothing can land outside it. */
export function drawPage(pdf: PDFPage, page: Page, o: PageDrawOptions): void {
  // Grid-relative mm (y down) to PDF points.
  const ox = o.x + GRID_X_MM, oy = o.y + GRID_Y_MM;
  const X = (mm: number) => mmToPt(ox + mm);
  const Y = (mm: number) => mmToPt(o.sheetHeight - (oy + mm));
  const len = (mm: number) => mmToPt(mm);
  const tones = o.tones ?? SCREEN_TONES;
  const textColor = (tone: keyof typeof TEXT_COLORS) => (tone === 'gray' ? tones.grayText : TEXT_COLORS[tone]);

  const line = (x1: number, y1: number, x2: number, y2: number, w: number, c: string, cap: LineCapStyle = LineCapStyle.Butt) =>
    pdf.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: len(w), color: color(c), lineCap: cap });
  const fillRect = (x: number, y: number, w: number, h: number, c: string) =>
    pdf.drawRectangle({ x: X(x), y: Y(y + h), width: len(w), height: len(h), color: color(c) });
  const dots = (x0: number, y0: number, cols: number[], rows: number[], radius: number) => {
    if (!cols.length || !rows.length) return;
    const form = dotForm(pdf.doc, len(radius), cols.map((x) => len(x - x0)), rows.map((y) => len(y - y0)), color(GRAY_DOT));
    pdf.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, X(x0), Y(y0)), drawObject(pdf.node.newXObject('Dots', form)), popGraphicsState());
  };

  const text = (str: string, size: number, font: PDFFont, c: string, at: { x: number; y: number }, align: 'start' | 'middle' | 'end', rotate: 0 | 90 | 270) => {
    const safe = printable(str, font);
    if (!safe) return;
    const width = font.widthOfTextAtSize(safe, len(size));
    const back = align === 'start' ? 0 : align === 'middle' ? width / 2 : width;
    const angle = rotate === 90 ? Math.PI / 2 : rotate === 270 ? -Math.PI / 2 : 0;
    // Step back along the text's own direction to its start.
    pdf.drawText(safe, {
      x: X(at.x) - back * Math.cos(angle), y: Y(at.y) - back * Math.sin(angle),
      size: len(size), font, color: color(c), rotate: degrees((angle * 180) / Math.PI),
    });
  };

  const shade = (e: Shade) => {
    for (const r of shadeRects(e)) fillRect(r.x * P, r.y * P, r.w * P, r.h * P, tones.shade[r.tone]);
  };

  const pattern = (e: Pattern) => {
    const step = e.every ?? DEFAULTS.every;
    const x0 = e.x * P, x1 = (e.x + e.w) * P, y0 = e.y * P, y1 = (e.y + e.h) * P;
    const first = e.first === true;
    const rows = (start: boolean) => ticks(e.y, e.h, step, start).map((y) => y * P);
    const cols = (start: boolean) => ticks(e.x, e.w, step, start).map((x) => x * P);
    const l = LINE[e.weight ?? DEFAULTS.patternWeight];
    const hs = (start: boolean) => rows(start).forEach((y) => line(x0, y, x1, y, l.w, l.c));
    const vs = (start: boolean) => cols(start).forEach((x) => line(x, y0, x, y1, l.w, l.c));
    switch (e.pattern) {
      case 'lines': hs(first); break;
      case 'vlines': vs(first); break;
      case 'grid': hs(true); vs(true); break;
      case 'dots': dots(x0, y0, cols(true), rows(true), DOT_MM[e.dots ?? DEFAULTS.dots] / 2); break;
    }
  };

  const box = (e: Box) => {
    const w = LINE[e.weight ?? DEFAULTS.boxWeight].w;
    const x0 = e.x * P, x1 = (e.x + e.w) * P, y0 = e.y * P, y1 = (e.y + e.h) * P;
    const seg = { top: [x0, y0, x1, y0], bottom: [x0, y1, x1, y1], left: [x0, y0, x0, y1], right: [x1, y0, x1, y1] } as const;
    for (const s of e.sides ?? ['top', 'bottom', 'left', 'right']) line(...seg[s], w, '#000000', LineCapStyle.Projecting);
  };

  const rule = (e: Rule) => {
    const l = LINE[e.weight ?? DEFAULTS.ruleWeight];
    line(e.x1 * P, e.y1 * P, e.x2 * P, e.y2 * P, l.w, l.c, e.weight === 'hair' ? LineCapStyle.Butt : LineCapStyle.Projecting);
  };

  const checkboxes = (e: Checkboxes) => {
    const size = (e.size ?? DEFAULTS.checkSize) * P;
    const every = e.every ?? DEFAULTS.every;
    const across = (e.direction ?? DEFAULTS.direction) === 'across';
    const w = LINE[e.weight ?? DEFAULTS.boxWeight].w;
    for (let i = 0; i < e.count; i++) {
      const cx = (e.x + (across ? i * every : 0)) * P, cy = (e.y + (across ? 0 : i * every)) * P;
      pdf.drawRectangle({
        x: X(cx + (P - size) / 2), y: Y(cy + (P - size) / 2 + size), width: len(size), height: len(size),
        borderWidth: len(w), borderColor: color('#000000'),
      });
    }
  };

  const label = (e: Text) => {
    const size = TEXT_SIZE_MM[e.size ?? DEFAULTS.textSize];
    const align = e.align ?? DEFAULTS.align;
    const dx = align === 'left' ? TEXT_INSET_MM : align === 'right' ? -TEXT_INSET_MM : 0;
    const rotate = e.rotate ?? DEFAULTS.rotate;
    // The text's own frame has its origin at the anchor, x along the text and y down the one-cell band (see render.ts).
    const base = P - BASELINE_MM;
    const at = rotate === 90 ? { x: e.x * P + base, y: e.y * P - dx } : rotate === 270 ? { x: e.x * P - base, y: e.y * P + dx } : { x: e.x * P + dx, y: e.y * P + base };
    const font = (e.style ?? DEFAULTS.style) === 'bold' ? o.fonts.bold : o.fonts.regular;
    text(o.expand(e.text), size, font, textColor(e.tone ?? DEFAULTS.textTone), at, align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end', rotate);
  };

  const sequence = (e: Sequence) => {
    const c = textColor(e.tone ?? DEFAULTS.sequenceTone);
    const rotate = e.rotate ?? DEFAULTS.rotate;
    sequenceItems(e).forEach((item, i) => {
      const center = itemCenter(e, i);
      if (isIcons(e)) {
        const shape = ICONS[item];
        if (!shape) return;
        const { x, y, scale, stroke } = iconPlacement(e, i);
        // An icon turns about its own center, but PDF turns a path about its origin, so the origin moves to where
        // the icon's top-left corner lands: the bottom-left for 90 and the top-right for 270.
        const half = (itemSize(e) * P) / 2;
        const origin = rotate === 90 ? { x: center.x - half, y: center.y + half } : rotate === 270 ? { x: center.x + half, y: center.y - half } : { x, y };
        const at = { x: X(origin.x), y: Y(origin.y), scale: len(scale), rotate: degrees(rotate === 90 ? 90 : rotate === 270 ? -90 : 0) };
        if (shape.fill) pdf.drawSvgPath(shape.fill, { ...at, color: color(c) });
        pdf.drawSvgPath(shape.stroke, { ...at, borderColor: color(c), borderWidth: len(stroke), borderLineCap: LineCapStyle.Round });
        return;
      }
      // The baseline's midpoint, turned about the cell's center for a rotated run (see render.ts).
      const down = P - BASELINE_MM - P / 2;
      const at = rotate === 90 ? { x: center.x + down, y: center.y } : rotate === 270 ? { x: center.x - down, y: center.y } : { x: center.x, y: center.y + down };
      text(item, TEXT_SIZE_MM.label, o.fonts.regular, c, at, 'middle', rotate);
    });
  };

  const element = (e: PageElement) => {
    switch (e.type) {
      case 'sequence': return sequence(e);
      case 'pattern': return pattern(e);
      case 'shade': return shade(e);
      case 'box': return box(e);
      case 'rule': return rule(e);
      case 'checkboxes': return checkboxes(e);
      case 'text': return label(e);
    }
  };

  pdf.pushOperators(pushGraphicsState(), rectangle(mmToPt(o.x), mmToPt(o.sheetHeight - o.y - PAGE_H_MM), mmToPt(PAGE_W_MM), mmToPt(PAGE_H_MM)), clip(), endPath());
  for (const e of page.elements) element(e);
  for (const item of headerItems(page, o.pageNumber, o.expand)) {
    text(item.text, TEXT_SIZE_MM.label, item.bold ? o.fonts.bold : o.fonts.regular, HEADER_COLOR, { x: item.x, y: HEADER_BASELINE_MM }, item.anchor === 'end' ? 'end' : 'start', 0);
  }
  pdf.pushOperators(popGraphicsState());
}

/** The text with any character the font has no glyph for replaced by "?", so a stray symbol can't stop an export. */
function printable(str: string, font: PDFFont): string {
  const have = new Set(font.getCharacterSet());
  return [...str].map((ch) => (have.has(ch.codePointAt(0)!) ? ch : '?')).join('').replace(/[\r\n]+/g, ' ');
}
