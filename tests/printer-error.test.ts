// A printer lands the image off by a little on every pass, and the back may also come out turned. These tests simulate printers
// with real geometry (the same transforms the PDFs are drawn under), read the calibration sheet the way a person does, and check
// that the settings sheetResult() finds put everything where it belongs: with the signs and the formula derived in alignment.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyBook } from '../src/book/book';
import { NO_READINGS, crosshairs, foldScaleAt, sheetHeight, sheetResult, type SheetReadings } from '../src/book/alignment';
import { SHEET_W_MM, profileOf, type LayoutProfile, type SheetLayout } from '../src/book/impose';
import { GRID_Y_MM } from '../src/format/types';
import { mapPoint, transformOf, type SheetTransform } from '../src/print/sheets';
import { sheetFile } from '../src/print/calibrate';
import { readPdf } from './pdf-text';
import { FLAT, flatTwoUp } from './flat';
import { clonePrint } from '../src/book/impose';

const fontBytes = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const W = SHEET_W_MM;
const PT = 72 / 25.4;

/** What a printer does to one pass: turns the image about the sheet's centre (degrees, + counter-clockwise as seen on that side) and moves it (+x right, +y up). */
interface PassError { x: number; y: number; deg: number }
interface Printer { front: PassError; back: PassError }

const asTransform = (e: PassError): SheetTransform => ({ sx: 1, sy: 1, rot: (e.deg * Math.PI) / 180, dx: e.x, dy: -e.y });
const r1 = (v: number) => Math.round(v * 10) / 10; // a person reads a scale to 0.1 mm

/**
 * Where things land on the paper for a layout printed with `profile`, by a printer with these errors: the front's crosshairs as seen through the
 * back (mirrored left to right), and the back's own scales' zeros, the fold scale and the box lines at the top and bottom edge.
 */
function paper(layout: SheetLayout, profile: LayoutProfile, pr: Printer) {
  const H = sheetHeight(layout), print = { ...clonePrint(FLAT), sheet_layout: layout, layouts: { ...clonePrint(FLAT).layouts, [layout]: profile } };
  const tf = transformOf(print, 'front'), tb = transformOf(print, 'back');
  const onFront = (p: { x: number; y: number }) => mapPoint(asTransform(pr.front), W, H, mapPoint(tf, W, H, p));
  const onBack = (p: { x: number; y: number }) => mapPoint(asTransform(pr.back), W, H, mapPoint(tb, W, H, p));
  // The crosshair of the front that shows through at back-view position p was printed at the mirror image of p.
  const seen = (p: { x: number; y: number }) => { const f = onFront({ x: W - p.x, y: p.y }); return { x: W - f.x, y: f.y }; };
  return { H, seen, onBack, onFront };
}

/** What a person would read off the sheet, to 0.1 mm: see-through (+right, +up as seen on the back), the crease and the margins. */
function read(layout: SheetLayout, profile: LayoutProfile, pr: Printer): SheetReadings {
  const { H, seen, onBack } = paper(layout, profile, pr), at = crosshairs(layout), f = foldScaleAt(layout);
  const x = (p: { x: number; y: number }) => r1(seen(p).x - onBack(p).x), y = (p: { x: number; y: number }) => r1(-(seen(p).y - onBack(p).y));
  return {
    ...NO_READINGS,
    topX: x(at.top), bottomX: x(at.bottom), leftY: y(at.left), rightY: y(at.right),
    crease: r1(W / 2 - onBack(f).x),
    // The ruler counts from the box line (at the top and bottom of the nominal page, on the fold) to the paper's edge.
    topMargin: r1(onBack({ x: W / 2, y: GRID_Y_MM }).y), bottomMargin: r1(H - onBack({ x: W / 2, y: H - GRID_Y_MM }).y),
  };
}

const printers: [string, Printer][] = [
  ['a pure shift', { front: { x: 0.6, y: -0.3, deg: 0 }, back: { x: -0.9, y: 0.4, deg: 0 } }],
  ['the back turned counter-clockwise', { front: { x: 0, y: 0, deg: 0 }, back: { x: 0, y: 0, deg: 0.4 } }],
  ['the back turned clockwise, and shifted', { front: { x: 0.3, y: 0.2, deg: 0 }, back: { x: 1.1, y: -0.6, deg: -0.3 } }],
  ['a bit of everything', { front: { x: -1.2, y: -0.6, deg: 0 }, back: { x: 2.1, y: 0.9, deg: 0.25 } }],
];
const layouts = ['half_letter', 'letter_two_up'] as const;
const start = (layout: SheetLayout): LayoutProfile => ({ ...profileOf(layout === 'letter_two_up' ? flatTwoUp() : FLAT) });

describe('reading the sheet: signs, from the geometry', () => {
  const none: PassError = { x: 0, y: 0, deg: 0 };
  it('a back printed to the right of where it should be reads negative on x (the front shows through to the left of the scale)', () => {
    const r = read('half_letter', start('half_letter'), { front: none, back: { x: 1, y: 0, deg: 0 } });
    expect([r.topX, r.bottomX, r.crease]).toEqual([-1, -1, -1]); // the crease is the paper's own centre, which is left of the scale's zero
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
  it('the margins: a back printed too low has a top margin bigger than 3.85 and a bottom margin smaller', () => {
    const r = read('half_letter', start('half_letter'), { front: none, back: { x: 0, y: -0.5, deg: 0 } });
    expect(r.topMargin!).toBeGreaterThan(4.2);
    expect(r.bottomMargin!).toBeLessThan(3.5);
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
        // After it: every see-through reading is 0 (to what a person can read), the crease and the margins are right.
        const after = read(layout, next, pr);
        for (const k of ['topX', 'bottomX', 'leftY', 'rightY'] as const) expect(Math.abs(after[k]!), `${k}`).toBeLessThan(0.2);
        expect(Math.abs(after.crease!), 'crease').toBeLessThan(0.2);
        expect(Math.abs(after.topMargin! - GRID_Y_MM), 'top margin').toBeLessThan(0.2);
        expect(Math.abs(after.bottomMargin! - GRID_Y_MM), 'bottom margin').toBeLessThan(0.2);
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

    it('with only the crease and the margins read, the back goes to the paper’s centre and the front and rotation stay', () => {
      const pr: Printer = { front: { x: 0.8, y: 0.5, deg: 0 }, back: { x: -0.4, y: 0.3, deg: 0 } };
      const printed = start(layout);
      const r = read(layout, printed, pr);
      const next = sheetResult(layout, printed, { ...NO_READINGS, crease: r.crease, topMargin: r.topMargin, bottomMargin: r.bottomMargin });
      expect(next.front_offset_x_mm).toBe(printed.front_offset_x_mm);
      expect(next.back_rotation_deg).toBe(printed.back_rotation_deg);
      const after = read(layout, next, pr);
      expect(Math.abs(after.crease!)).toBeLessThan(0.1);
      expect(Math.abs(after.topMargin! - GRID_Y_MM)).toBeLessThan(0.1);
      expect(Math.abs(after.bottomMargin! - GRID_Y_MM)).toBeLessThan(0.1);
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
      for (const k of ['topX', 'bottomX', 'leftY', 'rightY', 'crease'] as const) expect(Math.abs(after[k]!), k).toBeLessThan(0.2);
      expect(next.back_rotation_deg).toBeCloseTo(-pr.back.deg, 1);
    });
  });
}

describe('the PDF is drawn under the same transform the model uses', () => {
  it('maps points exactly as mapPoint does, for the back of each layout, rotated, scaled and moved', async () => {
    for (const layout of layouts) {
      const print = clonePrint(layout === 'letter_two_up' ? flatTwoUp() : FLAT);
      Object.assign(print.layouts[layout], { back_rotation_deg: 0.35, scale_x_pct: 100.4, scale_y_pct: 99.7, back_offset_x_mm: 0.6, back_offset_y_mm: -0.4 });
      const [, back] = await readPdf((await sheetFile(emptyBook(52), print, fontBytes)).bytes);
      const m = back.content.match(/q\n(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm\n/)!.slice(1).map(Number);
      const H = sheetHeight(layout), t = transformOf(print, 'back');
      for (const p of [{ x: 10, y: 10 }, { x: W / 2, y: H / 2 }, { x: 150, y: H - 20 }]) {
        const X = p.x * PT, Y = (H - p.y) * PT;
        const landed = { x: (m[0] * X + m[2] * Y + m[4]) / PT, y: H - (m[1] * X + m[3] * Y + m[5]) / PT };
        const model = mapPoint(t, W, H, p);
        expect(landed.x).toBeCloseTo(model.x, 6);
        expect(landed.y).toBeCloseTo(model.y, 6);
      }
    }
  });
});
