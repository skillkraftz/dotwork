// The print pipeline: layout (a display list in mm) -> printer (positions only) -> PDF. See docs/print-pipeline.md.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { emptyBook, setSlot } from '../src/book/book';
import { DEFAULT_PRINT, clonePrint, type SheetLayout } from '../src/book/impose';
import { emptyPage, type Page } from '../src/format/types';
import { newDocument, exportBookFiles } from '../src/print/export';
import { drawItems, mmToPt } from '../src/print/draw';
import { correct, printSide, weightFactor } from '../src/print/correct';
import { boundsOf, type Item } from '../src/print/display';
import { layoutPage } from '../src/print/layout';
import { mapPoint, sheetSize, transformOf, type SheetTransform } from '../src/print/sheets';
import { TEMPLATES } from '../src/builtin/templates';
import { LINE } from '../src/render';
import { FLAT, flatTwoUp, setPrint } from './flat';
import { readPdf, strokes, textMatrices } from './pdf-text';

const fontBytes = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const PT = 72 / 25.4;
const W = 215.9, H = 279.4; // a letter sheet

const t = (more: Partial<SheetTransform> = {}): SheetTransform => ({ sx: 1, sy: 1, rot: 0, dx: 0, dy: 0, ...more });
const line = (x1: number, y1: number, x2: number, y2: number, w = 0.35, more: Partial<Extract<Item, { k: 'line' }>> = {}): Item => ({ k: 'line', x1, y1, x2, y2, w, c: '#000000', cap: 'butt', ...more });
const lines = (items: Item[]) => items.filter((i): i is Extract<Item, { k: 'line' }> => i.k === 'line');

/** Draw items on a fresh PDF page of the sheet, under a side's printer correction, and read the page back. */
async function printed(items: Item[], print: ReturnType<typeof clonePrint>, side: 'front' | 'back' = 'front') {
  const { w, h } = sheetSize(print.sheet_layout);
  const { doc, fonts } = await newDocument(fontBytes);
  drawItems(doc.addPage([mmToPt(w), mmToPt(h)]), printSide(items, print, side, w, h), fonts, h);
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, page: (await readPdf(bytes))[0], h };
}

/** The decoded content of every form XObject on the first page. */
async function forms(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const x = doc.getPages()[0].node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  return x.entries().map(([name]) => new TextDecoder('latin1').decode(decodePDFRawStream(x.lookup(name) as PDFRawStream).decode()));
}

/** The first dot in a form: its bounding box in points, from the control points of its four curves. */
function firstDot(form: string) {
  const ops = form.split('\nf\n')[0].split('\n').slice(1); // after the colour
  const xs: number[] = [], ys: number[] = [];
  for (const op of ops) { const n = op.split(' ').slice(0, -1).map(Number); for (let i = 0; i < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); } }
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 };
}

describe('the printer stage moves positions and nothing else', () => {
  it('leaves a line as wide in the one direction as in the other, whatever the stretch', async () => {
    // Scale x 100 %, scale y 101.01 %: a horizontal and a vertical line of one width.
    const print = clonePrint(flatTwoUp());
    setPrint(print, { scale_y_pct: 101.01 });
    const { page, h } = await printed([line(30, 40, 90, 40, 0.35), line(120, 60, 120, 120, 0.35)], print);
    const [horizontal, vertical] = strokes(page.content, h);
    expect(horizontal.w).toBeCloseTo(0.35, 4);
    expect(vertical.w).toBeCloseTo(0.35, 4);
    expect(horizontal.w).toBeCloseTo(vertical.w, 6);
    // Their endpoints did move: the vertical line is 1.01 times as long.
    expect(Math.abs(vertical.y2 - vertical.y1)).toBeCloseTo(60 * 1.0101, 3);
    expect(Math.abs(horizontal.x2 - horizontal.x1)).toBeCloseTo(60, 3);
  });

  it('keeps dots round and the same size: only their centres move', async () => {
    const print = clonePrint(flatTwoUp());
    setPrint(print, { scale_x_pct: 100, scale_y_pct: 101.01 });
    const dots: Item = { k: 'dots', x: 20, y: 30, cols: [0, 3, 6], rows: [0, 3, 6, 9], d: 0.6, c: '#808080' };
    const { bytes } = await printed([dots], print);
    const [form] = await forms(bytes);
    const dot = firstDot(form);
    expect(dot.w / PT).toBeCloseTo(0.6, 2); // (written to 0.01 pt)
    expect(dot.h / PT).toBeCloseTo(0.6, 2);
    // 12 dots, one form.
    expect(form.match(/\nf\n/g)).toHaveLength(12);
    // The row pitch is stretched with the paper (3 -> 3.0303 mm), the column pitch is not.
    const centres = [...form.matchAll(/(\S+) (\S+) m\n/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    expect(centres).toHaveLength(12);
    const pitchY = (centres[1].y - centres[0].y) / PT; // the next row down (rows run to negative y)
    const pitchX = (centres[4].x - centres[0].x) / PT;
    expect(Math.abs(pitchY)).toBeCloseTo(3 * 1.0101, 2);
    expect(pitchX).toBeCloseTo(3, 2);
  });

  it('shares one form among identical dot patterns on a side, so a dot grid stays small', async () => {
    const print = clonePrint(flatTwoUp());
    setPrint(print, { scale_y_pct: 101.01 });
    const { w, h } = sheetSize('letter_two_up');
    const { doc, fonts } = await newDocument(fontBytes);
    const page = doc.addPage([mmToPt(w), mmToPt(h)]);
    const cols = Array.from({ length: 27 }, (_, i) => i * 3), rows = Array.from({ length: 44 }, (_, i) => i * 3);
    const items: Item[] = [20, 40, 60].map((x): Item => ({ k: 'dots', x, y: x, cols, rows, d: 0.6, c: '#808080' }));
    drawItems(page, printSide(items, print, 'front', w, h), fonts, h);
    const x = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    expect(x.entries()).toHaveLength(3); // three placements...
    expect(new Set(x.entries().map(([, ref]) => String(ref))).size).toBe(1); // ...of one form
  });

  it('draws glyphs at the size they were given, and turns text without stretching it', async () => {
    const text: Item = { k: 'text', str: 'Hello', x: 40, y: 50, size: 2.4, font: 'regular', c: '#000000', align: 'start', rot: 0 };
    const was = await printed([text], clonePrint(flatTwoUp()));
    const print = clonePrint(flatTwoUp());
    setPrint(print, { scale_x_pct: 103, scale_y_pct: 97 });
    const stretched = await printed([text], print);
    const size = (c: string) => +c.match(/ ([\d.]+) Tf/)![1];
    expect(size(stretched.page.content)).toBeCloseTo(size(was.page.content), 9);
    expect(size(stretched.page.content) / PT).toBeCloseTo(2.4, 4);
    const [m] = textMatrices(stretched.page.content);
    expect(m.slice(0, 4)).toEqual([1, 0, 0, 1]); // not stretched
    // The anchor moved as mapPoint says.
    expect(m[4] / PT).toBeCloseTo(mapPoint(transformOf(print, 'front'), W, H, { x: 40, y: 50 }).x, 4);
    expect(stretched.h - m[5] / PT).toBeCloseTo(mapPoint(transformOf(print, 'front'), W, H, { x: 40, y: 50 }).y, 4);
    // On the back, which is turned: text turns with it, still unstretched.
    setPrint(print, { back_rotation_deg: 0.5 });
    const back = await printed([text], print, 'back');
    const [r] = textMatrices(back.page.content), a = (0.5 * Math.PI) / 180;
    expect(r.slice(0, 4).map((v) => +v.toFixed(9))).toEqual([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)].map((v) => +v.toFixed(9)));
  });

  it('puts every position where mapPoint says: line ends, rectangle corners, dot centres, text anchors and path points; scaled, moved and rotated', () => {
    for (const tf of [t({ sx: 1.01, sy: 0.99, dx: 0.5, dy: -0.25 }), t({ sx: 1, sy: 1.0101, rot: (0.4 * Math.PI) / 180, dx: -1, dy: 0.7 }), t({ rot: (-0.183 * Math.PI) / 180, sy: 1.0101 })]) {
      const at = (x: number, y: number) => mapPoint(tf, W, H, { x, y });
      const items: Item[] = [
        line(10, 20, 150, 220),
        { k: 'rect', x: 30, y: 40, w: 50, h: 60, c: '#efefef' },
        { k: 'dots', x: 20, y: 30, cols: [0, 3, 9], rows: [0, 6], d: 0.6, c: '#808080' },
        { k: 'text', str: 'x', x: 100, y: 110, size: 2, font: 'bold', c: '#000000', align: 'end', rot: 90 },
        { k: 'path', segs: [['M', 5, 6], ['C', 7, 8, 9, 10, 11, 12], ['L', 13, 14], ['Z']], fill: '#000000', stroke: { w: 0.3, c: '#000000', cap: 'round' } },
        { k: 'clip', pts: [{ x: 1, y: 2 }, { x: 80, y: 2 }, { x: 80, y: 90 }, { x: 1, y: 90 }] },
      ];
      const out = correct(items, tf, W, H);
      const near = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); };
      const [l, r, d, tx, p, c] = out as [Extract<Item, { k: 'line' }>, Extract<Item, { k: 'rect' | 'poly' }>, Extract<Item, { k: 'dotset' }>, Extract<Item, { k: 'text' }>, Extract<Item, { k: 'path' }>, Extract<Item, { k: 'clip' }>];
      near({ x: l.x1, y: l.y1 }, at(10, 20));
      near({ x: l.x2, y: l.y2 }, at(150, 220));
      if (tf.rot === 0) {
        expect(r.k).toBe('rect');
        const q = r as Extract<Item, { k: 'rect' }>, [a, b] = [at(30, 40), at(80, 100)];
        near({ x: q.x, y: q.y }, a);
        near({ x: q.x + q.w, y: q.y + q.h }, b);
      } else {
        expect(r.k).toBe('poly'); // a rotated rectangle is a polygon
        const q = r as Extract<Item, { k: 'poly' }>;
        [[30, 40], [80, 40], [80, 100], [30, 100]].forEach(([x, y], i) => near(q.pts[i], at(x, y)));
      }
      // Dot centres: the set's origin, plus each offset carried by the same turn and scale.
      const centres = d.pts.map(([x, y]) => ({ x: d.x + x, y: d.y + y }));
      [[0, 0], [0, 6], [3, 0], [3, 6], [9, 0], [9, 6]].forEach(([x, y], i) => {
        const want = at(20 + x, 30 + y), got = centres.find((_, k) => k === i)!;
        near(got, want);
      });
      expect(d.d).toBe(0.6); // diameter untouched
      near({ x: tx.x, y: tx.y }, at(100, 110));
      expect([tx.size, tx.font, tx.align]).toEqual([2, 'bold', 'end']);
      expect(tx.rot).toBeCloseTo(90 + (tf.rot * 180) / Math.PI, 9);
      [[5, 6], [11, 12], [13, 14]].forEach(([x, y], i) => {
        const seg = p.segs[i];
        near({ x: seg[seg.length - 2] as number, y: seg[seg.length - 1] as number }, at(x, y));
      });
      const curve = p.segs[1] as ['C', ...number[]];
      near({ x: curve[1], y: curve[2] }, at(7, 8)); // control points move like any other point
      near({ x: curve[3], y: curve[4] }, at(9, 10));
      expect(p.stroke).toEqual({ w: 0.3, c: '#000000', cap: 'round' }); // the width stays
      near(c.pts[2], at(80, 90));
    }
  });

  it('at 100 % and no rotation changes nothing but the offset', () => {
    const items: Item[] = [line(10, 20, 150, 220), { k: 'rect', x: 30, y: 40, w: 50, h: 60, c: '#efefef' }, { k: 'dots', x: 20, y: 30, cols: [0, 3], rows: [0, 3], d: 0.6, c: '#808080' }];
    const moved = correct(items, t({ dx: 0.5, dy: -1 }), W, H);
    const [l, r] = moved as [Extract<Item, { k: 'line' }>, Extract<Item, { k: 'rect' }>];
    expect([l.x1, l.y1, l.x2, l.y2, l.w]).toEqual([10.5, 19, 150.5, 219, 0.35]);
    expect([r.x, r.y, r.w, r.h]).toEqual([30.5, 39, 50, 60]);
    // Without an offset the list is the list.
    const same = correct(items, t(), W, H);
    expect(same[0]).toEqual(items[0]);
    expect(same[1]).toEqual(items[1]);
    expect((same[2] as Extract<Item, { k: 'dotset' }>).pts).toEqual([[0, 0], [0, 3], [3, 0], [3, 3]]);
  });

  it('bounds the clip of a page by its mapped corners', () => {
    const out = correct([{ k: 'clip', pts: [{ x: 0, y: 0 }, { x: 88.9, y: 0 }, { x: 88.9, y: 139.7 }, { x: 0, y: 139.7 }] }, { k: 'unclip' }], t({ rot: 0.01, sy: 1.01 }), W, H);
    expect(out.map((i) => i.k)).toEqual(['clip', 'unclip']);
  });
});

describe('line weight by direction', () => {
  it('is 1 across the 8.5 in edge, the setting along it, and in between by angle', () => {
    expect(weightFactor(1, 0, 0.9)).toBeCloseTo(0.9, 12);
    expect(weightFactor(0, 1, 0.9)).toBeCloseTo(1, 12);
    expect(weightFactor(1, 1, 0.9)).toBeCloseTo(0.95, 12);
    expect(weightFactor(-5, 0, 1.1)).toBeCloseTo(1.1, 12);
    expect(weightFactor(0, 0, 0.9)).toBe(1);
    const mid = weightFactor(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0.8); // 30 degrees from the 8.5 in edge
    expect(mid).toBeGreaterThan(0.8);
    expect(mid).toBeLessThan(1);
  });

  it('thins horizontal strokes only, and leaves dots, text and filled areas alone', () => {
    const items: Item[] = [
      line(10, 20, 60, 20, 0.35), line(10, 20, 10, 70, 0.35), line(10, 20, 60, 70, 0.35), line(10, 20, 60, 20, 0.35, { fixed: true }),
      { k: 'dots', x: 5, y: 5, cols: [0, 3], rows: [0], d: 0.6, c: '#808080' },
      { k: 'text', str: 'a', x: 1, y: 2, size: 2, font: 'regular', c: '#000000', align: 'start', rot: 0 },
      { k: 'rect', x: 0, y: 0, w: 5, h: 5, c: '#efefef' },
      { k: 'path', segs: [['M', 0, 0], ['L', 10, 0]], stroke: { w: 0.4, c: '#000000', cap: 'butt' } },
    ];
    const out = correct(items, t(), W, H, 0.9);
    const [h, v, d, fixed] = lines(out);
    expect(h.w).toBeCloseTo(0.315, 9);
    expect(v.w).toBe(0.35);
    expect(d.w).toBeCloseTo(0.35 * 0.95, 9);
    expect(fixed.w).toBe(0.35);
    expect(out[4]).toMatchObject({ d: 0.6 });
    expect(out[5]).toMatchObject({ size: 2 });
    expect(out[6]).toEqual(items[6]);
    expect(out[7]).toEqual(items[7]);
  });

  it('follows the paper, not the drawing: a stroke turned by the back rotation is weighed by its direction on the paper', () => {
    const out = correct([line(10, 20, 60, 20, 0.35)], t({ rot: Math.PI / 2 }), W, H, 0.8);
    expect(lines(out)[0].w).toBeCloseTo(0.35, 6); // turned a quarter, it now runs across
  });

  it('is a per-layout printer setting, 100 % by default, applied to every PDF the layout prints', async () => {
    for (const layout of ['half_letter', 'letter_two_up'] as const) expect(DEFAULT_PRINT.layouts[layout].line_weight_x_pct).toBe(100);
    const print = clonePrint(FLAT);
    setPrint(print, { line_weight_x_pct: 90 });
    expect(print.layouts.half_letter.line_weight_x_pct).toBe(90);
    expect(print.layouts.letter_two_up.line_weight_x_pct).toBe(100);
    const { page, h } = await printed([line(30, 40, 90, 40, 0.35), line(120, 60, 120, 120, 0.35)], print);
    const [horizontal, vertical] = strokes(page.content, h);
    expect(horizontal.w).toBeCloseTo(0.315, 4);
    expect(vertical.w).toBeCloseTo(0.35, 4);
  });
});

describe('the layout stage', () => {
  const page = (elements: Page['elements']): Page => ({ ...emptyPage(), identity: '', elements });

  it('makes a display list in sheet mm with no printer in it', () => {
    const items: Item[] = [];
    layoutPage(page([{ type: 'rule', x1: 0, y1: 1, x2: 27, y2: 1, weight: 'thick' }, { type: 'pattern', pattern: 'dots', x: 0, y: 2, w: 3, h: 2 }, { type: 'text', x: 1, y: 5, text: 'Hi' }]), { x: 19.05, y: 0, pageNumber: null, expand: (s) => s }, items);
    expect(items[0].k).toBe('clip');
    expect(items.at(-1)!.k).toBe('unclip');
    const rule = lines(items)[0];
    expect(rule).toMatchObject({ x1: 19.05 + 3.95, y1: 3.85 + 3, w: LINE.thick.w, cap: 'square' });
    const dots = items.find((i) => i.k === 'dots') as Extract<Item, { k: 'dots' }>;
    expect([dots.x, dots.y, dots.cols, dots.rows]).toEqual([19.05 + 3.95, 3.85 + 6, [0, 3, 6, 9], [0, 3, 6]]);
    const text = items.find((i) => i.k === 'text') as Extract<Item, { k: 'text' }>;
    expect(text).toMatchObject({ str: 'Hi', size: 2.3, font: 'regular', align: 'start', rot: 0 });
    const b = boundsOf(items)!;
    expect(b.x0).toBeLessThan(b.x1);
  });

  it('draws the same thing as before at 100 % and no rotation: the book’s PDF is the display list drawn as it is', async () => {
    const book = emptyBook(8);
    setSlot(book, 1, page([{ type: 'rule', x1: 0, y1: 1, x2: 27, y2: 1 }, { type: 'text', x: 1, y: 5, text: 'Hi' }]));
    const files = await exportBookFiles(book, { ...clonePrint(FLAT), fore_edge_shift_mm: 0, creep_per_sheet_mm: 0 }, fontBytes);
    const sheets = await readPdf(files.find((f) => f.name === 'print-first.pdf')!.bytes);
    const pages = await readPdf(files.find((f) => f.name === 'pages.pdf')!.bytes);
    // Page 1 is on the front of the innermost... of the outermost sheet: the same strokes as pages.pdf's, moved to the page's place on the sheet.
    const own = strokes(pages[0].content, 139.7)[0];
    const placed = sheets.flatMap((s) => strokes(s.content, 139.7)).find((s) => Math.abs(s.w - own.w) < 1e-6 && Math.abs(s.x2 - s.x1 - (own.x2 - own.x1)) < 1e-3 && s.y1 === s.y2)!;
    expect(placed).toBeDefined();
    expect(placed.y1).toBeCloseTo(own.y1, 3);
    expect(placed.x1 - own.x1).toBeCloseTo(107.95, 3); // a right page starts at the fold
  });
});

describe('through the pipeline', () => {
  it('the dot grid book is fast and small on the owner’s two-up printer too (a stretched, turned back)', async () => {
    const book = TEMPLATES.find((tpl) => tpl.id === 'dot-grid-journal')!.build({});
    const print = { ...clonePrint(DEFAULT_PRINT), sheet_layout: 'letter_two_up' as SheetLayout };
    const start = performance.now();
    const files = await exportBookFiles(book, print, fontBytes);
    // Two-up makes three files' worth of sheets with two books on each (and print-duplex.pdf besides), so it has more room than the half-letter book's 1 s.
    expect(performance.now() - start).toBeLessThan(2500);
    expect(files.filter((f) => f.name.endsWith('.pdf')).reduce((n, f) => n + f.bytes.length, 0)).toBeLessThan(500_000);
    // The files still have their dots.
    const [first] = await readPdf(files.find((f) => f.name === 'print-first.pdf')!.bytes);
    expect(first.content).toContain(' Do');
  });
});
