import { INSET_EDGES, insetScaleZone } from '../src/book/alignment';
// A printer lands the image off by a little on every pass, and the back may also come out turned. These tests simulate printers
// with real geometry (the same transforms the PDFs are drawn under), read the calibration sheet the way a person does, and check
// that the settings sheetResult() finds put everything where it belongs: with the signs and the formula derived in alignment.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyBook } from '../src/book/book';
import { NO_READINGS, crosshairs, foldScales, sheetHeight, sheetResult, type SheetReadings } from '../src/book/alignment';
import { SHEET_W_MM, profileOf, type LayoutProfile, type SheetLayout } from '../src/book/impose';
import { mapPoint, transformOf, type SheetTransform } from '../src/print/sheets';
import { sheetFile } from '../src/print/calibrate';
import { readPdf, segments } from './pdf-text';
import { FLAT, flatTwoUp } from './flat';
import { clonePrint, everywhere } from '../src/book/impose';

const fontBytes = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const W = SHEET_W_MM;

/** What a printer does to one pass: turns the image about the sheet's centre (degrees, + counter-clockwise as seen on that side) and moves it (+x right, +y up). */
interface PassError { x: number; y: number; deg: number }
interface Printer { front: PassError; back: PassError }

const asTransform = (e: PassError): SheetTransform => ({ sx: 1, sy: 1, rot: (e.deg * Math.PI) / 180, dx: e.x, dy: -e.y });
const r1 = (v: number) => Math.round(v * 10) / 10; // a person reads a scale to 0.1 mm

/**
 * Where things land on the paper for a layout printed with `profile`, by a printer with these errors: the front's crosshairs as seen through the
 * back (mirrored left to right), and the back's own marks (the zero of each scale and ruler).
 */
function paper(layout: SheetLayout, profile: LayoutProfile, pr: Printer) {
  const H = sheetHeight(layout), print = { ...clonePrint(FLAT), sheet_layout: layout, layouts: { ...clonePrint(FLAT).layouts, [layout]: everywhere(profile) } };
  const tf = transformOf(print, 'front'), tb = transformOf(print, 'back');
  const onFront = (p: { x: number; y: number }) => mapPoint(asTransform(pr.front), W, H, mapPoint(tf, W, H, p));
  const onBack = (p: { x: number; y: number }) => mapPoint(asTransform(pr.back), W, H, mapPoint(tb, W, H, p));
  // The crosshair of the front that shows through at back-view position p was printed at the mirror image of p.
  const seen = (p: { x: number; y: number }) => { const f = onFront({ x: W - p.x, y: p.y }); return { x: W - f.x, y: f.y }; };
  return { H, seen, onBack, onFront };
}

/**
 * What a person would read off the sheet, to 0.1 mm: see-through (+right, +up as seen on the back) and, after folding the sheet in two ways, where
 * the crease (always on the paper's own middle) crosses the fold scales, from each scale's zero (+up on the two across the horizontal centre line, +right on the other two).
 */
function read(layout: SheetLayout, profile: LayoutProfile, pr: Printer): SheetReadings {
  const { H, seen, onBack } = paper(layout, profile, pr), at = crosshairs(layout), fold = foldScales(layout);
  const x = (p: { x: number; y: number }) => r1(seen(p).x - onBack(p).x), y = (p: { x: number; y: number }) => r1(-(seen(p).y - onBack(p).y));
  return {
    ...NO_READINGS,
    topX: x(at.top), bottomX: x(at.bottom), leftY: y(at.left), rightY: y(at.right),
    hFoldLeft: r1(onBack(fold.left).y - H / 2), hFoldRight: r1(onBack(fold.right).y - H / 2),
    vFoldTop: r1(W / 2 - onBack(fold.top).x), vFoldBottom: r1(W / 2 - onBack(fold.bottom).x),
  };
}

const printers: [string, Printer][] = [
  ['a pure shift', { front: { x: 0.6, y: -0.3, deg: 0 }, back: { x: -0.9, y: 0.4, deg: 0 } }],
  ['the back turned counter-clockwise', { front: { x: 0, y: 0, deg: 0 }, back: { x: 0, y: 0, deg: 0.4 } }],
  ['the back turned clockwise, and shifted', { front: { x: 0.3, y: 0.2, deg: 0 }, back: { x: 1.1, y: -0.6, deg: -0.3 } }],
  ['a bit of everything', { front: { x: -1.2, y: -0.6, deg: 0 }, back: { x: 2.1, y: 0.9, deg: 0.25 } }],
  ['a printer that prints everything 1.1 mm low', { front: { x: 0, y: -1.1, deg: 0 }, back: { x: 0, y: -1.1, deg: 0 } }],
];
const layouts = ['half_letter', 'letter_two_up'] as const;
const start = (layout: SheetLayout): LayoutProfile => ({ ...profileOf(layout === 'letter_two_up' ? flatTwoUp() : FLAT) });

describe('reading the sheet: signs, from the geometry', () => {
  const none: PassError = { x: 0, y: 0, deg: 0 };
  it('a back printed to the right of where it should be reads negative on x (the front shows through to the left of the scale), and the crease is left of the vertical-fold scales’ zero', () => {
    const r = read('half_letter', start('half_letter'), { front: none, back: { x: 1, y: 0, deg: 0 } });
    expect([r.topX, r.bottomX, r.vFoldTop, r.vFoldBottom]).toEqual([-1, -1, -1, -1]);
  });
  it('a back printed above where it should be reads negative on y; a front printed above reads positive', () => {
    expect(read('half_letter', start('half_letter'), { front: none, back: { x: 0, y: 1, deg: 0 } }).leftY).toBe(-1);
    expect(read('half_letter', start('half_letter'), { front: { x: 0, y: 1, deg: 0 }, back: none }).leftY).toBe(1);
  });
  it('a front printed to the right shows through to the left on the back (the sheet is turned over)', () => {
    expect(read('half_letter', start('half_letter'), { front: { x: 1, y: 0, deg: 0 }, back: none }).topX).toBe(-1);
  });
  it('a back turned counter-clockwise reads the top x positive and the bottom x negative, the left y positive and the right y negative', () => {
    const r = read('half_letter', start('half_letter'), { front: none, back: { x: 0, y: 0, deg: 0.5 } });
    expect(r.topX!).toBeGreaterThan(0.4);
    expect(r.bottomX!).toBeLessThan(-0.4);
    expect(r.leftY!).toBeGreaterThan(0.4);
    expect(r.rightY!).toBeLessThan(-0.4);
  });
  it('a back printed 1.1 mm too low has the crease 1.1 above the horizontal-fold scales’ zero, and the vertical ones read 0', () => {
    const r = read('half_letter', start('half_letter'), { front: none, back: { x: 0, y: -1.1, deg: 0 } });
    expect([r.hFoldLeft, r.hFoldRight, r.vFoldTop, r.vFoldBottom]).toEqual([1.1, 1.1, 0, 0]);
  });
  it('a back turned counter-clockwise reads the right horizontal-fold scale more negative than the left (it is raised more), and the vertical ones the other way', () => {
    const r = read('letter_two_up', start('letter_two_up'), { front: none, back: { x: 0, y: 0, deg: 0.5 } });
    expect(r.hFoldRight!).toBeLessThan(r.hFoldLeft!);
    expect(r.hFoldLeft! + r.hFoldRight!).toBeCloseTo(0, 1); // the turn cancels in the mean
    expect(r.vFoldTop!).toBeGreaterThan(r.vFoldBottom!);
    expect(r.vFoldTop! + r.vFoldBottom!).toBeCloseTo(0, 1);
  });
});

for (const layout of layouts) {
  describe(`the calibration finds the settings, ${layout}`, () => {
    for (const [name, pr] of printers) {
      it(`${name}: one round puts both sides on the paper and the back on the front`, () => {
        const printed = start(layout);
        const next = sheetResult(layout, printed, read(layout, printed, pr));
        // The back's rotation cancels the printer's turn.
        expect(next.back_rotation_deg).toBeCloseTo(-pr.back.deg, 1);
        // After it: every see-through reading is 0 (to what a person can read), and every edge is at 8.0.
        const after = read(layout, next, pr);
        for (const k of ['topX', 'bottomX', 'leftY', 'rightY'] as const) expect(Math.abs(after[k]!), `${k}`).toBeLessThan(0.2);
        for (const k of ['hFoldLeft', 'hFoldRight', 'vFoldTop', 'vFoldBottom'] as const) expect(Math.abs(after[k]!), k).toBeLessThan(0.25);
        // And the front is on the paper too: its crosshairs land where they were drawn for.
        const { onFront } = paper(layout, next, pr);
        for (const p of Object.values(crosshairs(layout))) {
          const landed = onFront({ x: W - p.x, y: p.y });
          expect(Math.abs(landed.x - (W - p.x)), 'front x').toBeLessThan(0.2);
          expect(Math.abs(landed.y - p.y), 'front y').toBeLessThan(0.2);
        }
      });

      it(`${name}: a second round changes nothing`, () => {
        const printed = start(layout);
        const next = sheetResult(layout, printed, read(layout, printed, pr));
        const again = sheetResult(layout, next, read(layout, next, pr));
        for (const k of Object.keys(next) as (keyof LayoutProfile)[]) expect(Math.abs(again[k] - next[k]), k).toBeLessThan(0.15);
      });
    }

    it('with only the see-through read, the back follows the front: the back lines up with where the front landed, the front stays', () => {
      const pr: Printer = { front: { x: 0.8, y: 0.5, deg: 0 }, back: { x: -0.4, y: 0.3, deg: 0.2 } };
      const printed = start(layout);
      const r = read(layout, printed, pr);
      const next = sheetResult(layout, printed, { ...NO_READINGS, topX: r.topX, bottomX: r.bottomX, leftY: r.leftY, rightY: r.rightY });
      expect(next.front_offset_x_mm).toBe(printed.front_offset_x_mm);
      expect(next.front_offset_y_mm).toBe(printed.front_offset_y_mm);
      const after = read(layout, next, pr);
      for (const k of ['topX', 'bottomX', 'leftY', 'rightY'] as const) expect(Math.abs(after[k]!), k).toBeLessThan(0.2);
    });

    it('with only the fold read, the back goes onto the paper’s middle and the front and rotation stay', () => {
      const pr: Printer = { front: { x: 0.8, y: 0.5, deg: 0 }, back: { x: -0.4, y: 0.3, deg: 0 } };
      const printed = start(layout);
      const r = read(layout, printed, pr);
      const next = sheetResult(layout, printed, { ...NO_READINGS, hFoldLeft: r.hFoldLeft, hFoldRight: r.hFoldRight, vFoldTop: r.vFoldTop, vFoldBottom: r.vFoldBottom });
      expect(next.front_offset_x_mm).toBe(printed.front_offset_x_mm);
      expect(next.back_rotation_deg).toBe(printed.back_rotation_deg);
      const after = read(layout, next, pr);
      for (const k of ['hFoldLeft', 'hFoldRight', 'vFoldTop', 'vFoldBottom'] as const) expect(Math.abs(after[k]!), k).toBeLessThan(0.1);
    });

    it('a printer that prints 1.1 mm low, starting from no offsets: both sides move up 1.1 mm, x is left alone', () => {
      const pr: Printer = { front: { x: 0, y: -1.1, deg: 0 }, back: { x: 0, y: -1.1, deg: 0 } };
      const printed = start(layout);
      const next = sheetResult(layout, printed, read(layout, printed, pr));
      expect(next.front_offset_y_mm).toBeCloseTo(1.1, 2);
      expect(next.back_offset_y_mm).toBeCloseTo(1.1, 2);
      expect([next.front_offset_x_mm, next.back_offset_x_mm]).toEqual([0, 0]);
    });

    it('the owner’s case: content 1.1 mm too low on both sides moves both y offsets up by 1.1 (front -2.7 -> -1.6, back 0 -> 1.1)', () => {
      // Printed at front y -2.7, back y 0; the printer's own error makes the front land 1.1 low in all (error +1.6) and the back 1.1 low (error -1.1).
      const printed = { ...start(layout), front_offset_y_mm: -2.7, back_offset_y_mm: 0 };
      const pr: Printer = { front: { x: 0, y: 1.6, deg: 0 }, back: { x: 0, y: -1.1, deg: 0 } };
      const next = sheetResult(layout, printed, read(layout, printed, pr));
      expect(next.front_offset_y_mm).toBeCloseTo(-1.6, 2);
      expect(next.back_offset_y_mm).toBeCloseTo(1.1, 2);
      const after = read(layout, next, pr);
      for (const k of ['topX', 'bottomX', 'leftY', 'rightY', 'hFoldLeft', 'hFoldRight', 'vFoldTop', 'vFoldBottom'] as const) expect(Math.abs(after[k]!), k).toBeLessThan(0.1);
    });

    it('nothing read changes nothing', () => {
      const printed = start(layout);
      expect(sheetResult(layout, printed, NO_READINGS)).toEqual(printed);
    });

    it('is relative to the settings the sheet was printed with, so it works on top of any old setting', () => {
      const pr: Printer = { front: { x: -0.5, y: 0.2, deg: 0 }, back: { x: 0.7, y: -0.3, deg: -0.2 } };
      const printed = { ...start(layout), front_offset_x_mm: 1.7, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05, back_rotation_deg: 0.3 };
      const next = sheetResult(layout, printed, read(layout, printed, pr));
      const after = read(layout, next, pr);
      for (const k of ['topX', 'bottomX', 'leftY', 'rightY'] as const) expect(Math.abs(after[k]!), k).toBeLessThan(0.2);
      for (const k of ['hFoldLeft', 'hFoldRight', 'vFoldTop', 'vFoldBottom'] as const) expect(Math.abs(after[k]!), k).toBeLessThan(0.25);
      expect(next.back_rotation_deg).toBeCloseTo(-pr.back.deg, 1);
    });
  });
}

const onEdgeScale = (x: number, y: number) => INSET_EDGES.some((e) => { const z = insetScaleZone('letter_two_up', e); return x >= z.x0 - 1 && x <= z.x1 + 1 && y >= z.y0 - 1 && y <= z.y1 + 1; });

describe('the PDF is drawn under the same transform the model uses', () => {
  it('places every stroke at the midpoint mapPoint says, for the back of each layout, rotated, scaled and moved, without turning it', async () => {
    for (const layout of layouts) {
      const flat = clonePrint(layout === 'letter_two_up' ? flatTwoUp() : FLAT);
      const print = clonePrint(flat);
      Object.assign(print.layouts[layout].hand.inside, { back_rotation_deg: 0.35, scale_x_pct: 100.4, scale_y_pct: 99.7, back_offset_x_mm: 0.6, back_offset_y_mm: -0.4 });
      const [, before] = await readPdf((await sheetFile(emptyBook(52), flat, fontBytes)).bytes);
      const [, after] = await readPdf((await sheetFile(emptyBook(52), print, fontBytes)).bytes);
      const H = sheetHeight(layout), t = transformOf(print, 'back');
      const was = segments(before.content, H), now = segments(after.content, H);
      expect(now.length).toBe(was.length);
      expect(was.length).toBeGreaterThan(100);
      const sx = t.sx, sy = t.sy;
      was.forEach((s, i) => {
        // The edge scales are placed with the correction already undone, so they do not move.
        if (layout === 'letter_two_up' && onEdgeScale((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)) return;
        // Each stroke is placed at its rotated midpoint and keeps its direction (scaled): it is not turned.
        const mid = mapPoint(t, W, H, { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });
        expect((now[i].x1 + now[i].x2) / 2).toBeCloseTo(mid.x, 3);
        expect((now[i].y1 + now[i].y2) / 2).toBeCloseTo(mid.y, 3);
        expect(now[i].x2 - now[i].x1).toBeCloseTo(sx * (s.x2 - s.x1), 3);
        expect(now[i].y2 - now[i].y1).toBeCloseTo(sy * (s.y2 - s.y1), 3);
      });
    }
  });
});
