import { describe, expect, it } from 'vitest';
import { mirrorElement, mirrorsOn, placedElements, resolveGenerated } from '../src/format/mirror';
import { resolveWeek } from '../src/format/week';
import { elementArea } from '../src/format/bounds';
import { readPage } from '../src/format/read';
import { calendarFor, readingOf, spansOf } from '../src/format/calendar';
import { emptyPage, type Generated, type Page, type PageElement, type Shade, type Text } from '../src/format/types';
import { findBuiltinPage } from '../src/builtin/library';
import { layoutPage } from '../src/print/layout';
import type { Item } from '../src/print/display';
import { expandRead } from '../src/format/tokens';
import { pageContent } from '../src/render';

const m = (e: PageElement) => mirrorElement(e);
const r = (v: number) => +v.toFixed(3);
const text = (more: Partial<Text> = {}): Text => ({ type: 'text', x: 3, y: 5, text: 'HELLO', ...more });

describe('mirroring one element', () => {
  it('moves areas to 27 - x - w, and rules and runs the same way as blocks', () => {
    expect(m({ type: 'box', x: 2, y: 4, w: 5, h: 3 })).toMatchObject({ x: 20, y: 4, w: 5, h: 3 });
    expect(m({ type: 'pattern', pattern: 'lines', x: 0, y: 1, w: 25, h: 8 })).toMatchObject({ x: 2, w: 25 });
    expect(m({ type: 'rule', x1: 0, y1: 5, x2: 25, y2: 5 })).toMatchObject({ x1: 27, x2: 2, y1: 5 });
    expect(m({ type: 'rule', x1: 25, y1: 5, x2: 25, y2: 9 })).toMatchObject({ x1: 2, x2: 2 });
    expect(m({ type: 'checkboxes', x: 0, y: 9, count: 3 })).toMatchObject({ x: 26 });
    expect(m({ type: 'checkboxes', x: 1, y: 9, count: 3, every: 2, direction: 'across' })).toMatchObject({ x: 21 }); // 5 cells wide: 22 to 27 - 1 - 5
    expect(m({ type: 'sequence', x: 0, y: 2, count: 7 })).toMatchObject({ x: 26 });
    expect(m({ type: 'sequence', x: 4, y: 2, count: 3, direction: 'across', values: 'icons', icons: ['star'], size: 2, every: 2 })).toMatchObject({ x: 27 - 4 - 6 });
  });

  it('puts every element where its drawn area is the mirror of the original', () => {
    const els: PageElement[] = [
      { type: 'box', x: 2, y: 4, w: 5, h: 3 }, { type: 'shade', x: 25, y: 9, w: 2, h: 4, tones: 'L' },
      { type: 'rule', x1: 3, y1: 5, x2: 12, y2: 5 }, { type: 'checkboxes', x: 3, y: 9, count: 4, direction: 'across', every: 2 },
      { type: 'sequence', x: 20, y: 9, count: 5, direction: 'across' }, { type: 'sequence', x: 20, y: 9, count: 5 },
      text(), text({ align: 'right' }), text({ align: 'center' }), text({ rotate: 90 }), text({ rotate: 270, align: 'center' }), text({ rotate: 90, align: 'right' }),
    ];
    for (const e of els) {
      const a = elementArea(e), b = elementArea(m(e));
      expect([e.type, r(b.x + b.w), r(b.y), r(b.w), r(b.h)]).toEqual([e.type, r(27 - a.x), r(a.y), r(a.w), r(a.h)]);
    }
  });

  it('is its own inverse', () => {
    const els: PageElement[] = [
      { type: 'box', x: 2, y: 4, w: 5, h: 3, sides: ['top', 'left'] }, text({ rotate: 90, align: 'right' }), text({ align: 'center' }),
      { type: 'sequence', x: 20, y: 9, count: 5, rotate: 270 },
    ];
    for (const e of els) expect(m(m(e)), e.type).toEqual(e);
  });

  it('swaps the box sides that face left and right', () => {
    expect(m({ type: 'box', x: 0, y: 1, w: 4, h: 4, sides: ['left', 'top'] })).toMatchObject({ sides: ['right', 'top'] });
    expect(m({ type: 'box', x: 0, y: 1, w: 4, h: 4 }).type === 'box' && (m({ type: 'box', x: 0, y: 1, w: 4, h: 4 }) as { sides?: unknown }).sides).toBeUndefined();
  });

  it('runs a shade\'s tones from the other end', () => {
    const shade = (more: Partial<Shade>): Shade => ({ type: 'shade', x: 0, y: 1, w: 4, h: 2, tones: 'LMD', ...more });
    expect(m(shade({ along: 'columns' }))).toMatchObject({ x: 23, tones: 'LDM' }); // four columns L M D L, read from the right: L D M L, which repeats with the same period
    expect(m(shade({ along: 'columns', every: 2 }))).toMatchObject({ tones: 'MLD' }); // two steps of 2: the tones 0 and 1, reversed (the unused third follows)
    expect(m(shade({}))).toMatchObject({ x: 23, tones: 'LMD' }); // rows are the same across
    expect(m(shade({ along: 'checker', tones: 'LM' }))).toMatchObject({ tones: 'ML' }); // four columns: the squares swap
    expect(m(shade({ along: 'checker', tones: 'LM', w: 3 }))).toMatchObject({ tones: 'LM' });
  });
});

describe('mirrored text', () => {
  it('reads left to right as before: the anchor moves to 27 - x and left and right alignment swap', () => {
    expect(m(text())).toMatchObject({ x: 24, align: 'right' }); // text starting 3 in, now ending 3 from the right
    expect(m(text({ align: 'right' }))).toMatchObject({ x: 24 });
    expect((m(text({ align: 'right' })) as Text).align).toBeUndefined(); // left is the default and is not written
    expect(m(text({ align: 'center' }))).toMatchObject({ x: 24, align: 'center' });
    expect(m(text({ text: 'HELLO' })).type === 'text' && (m(text({ text: 'HELLO' })) as Text).text).toBe('HELLO'); // never reversed
  });

  it('turns rotated text the other way, so 90 and 270 swap, and keeps its place along the page', () => {
    const up = text({ rotate: 90, x: 1, y: 20 }), down = text({ rotate: 270, x: 26.5, y: 20, align: 'center' });
    expect(m(up)).toMatchObject({ rotate: 270, x: 26, align: 'right' });
    expect(m(down)).toMatchObject({ rotate: 90, x: 0.5, align: 'center' });
    // a column of cells, one of the strip's, lands in the mirrored column
    expect(elementArea(m(down))).toMatchObject({ x: 0.5, w: 1 });
    expect(elementArea(down)).toMatchObject({ x: 25.5, w: 1 });
    // the stretch of page the text covers up and down does not move
    for (const t of [up, text({ rotate: 270, y: 8 }), text({ rotate: 90, y: 30, align: 'center' }), text({ rotate: 270, y: 8, align: 'right' })]) {
      const a = elementArea(t), b = elementArea(m(t));
      expect([r(b.y), r(b.h)]).toEqual([r(a.y), r(a.h)]);
    }
  });

  it('turns the items of a rotated run the other way too', () => {
    expect(m({ type: 'sequence', x: 0, y: 2, count: 3, rotate: 90 })).toMatchObject({ rotate: 270 });
    expect(m({ type: 'sequence', x: 0, y: 2, count: 3, rotate: 270 })).toMatchObject({ rotate: 90 });
    expect((m({ type: 'sequence', x: 0, y: 2, count: 3 }) as { rotate?: number }).rotate).toBeUndefined();
  });
});

describe('mirrored art', () => {
  it('flips the whole drawing: its box moves across and its paths turn about the middle of the view box', () => {
    const art: PageElement = {
      type: 'art', x: 2, y: 3, w: 6, h: 4, view_box: [0, 0, 10, 10],
      paths: [{ d: 'M 1 1 L 4 1 L 4 9 Z', fill: 'black', stroke: 'none', stroke_mm: 0 }],
    };
    const out = m(art);
    expect(out).toMatchObject({ x: 19, w: 6, y: 3, h: 4 });
    expect((out as { paths: { d: string }[] }).paths[0].d).toBe('M9 1L6 1L6 9Z');
    expect(m(m(m(art)))).toEqual(out); // flipping again and again lands on the same two drawings
  });
});

describe('which pages are mirrored', () => {
  const page = (more: Partial<Page>): Page => ({ ...emptyPage(), ...more });

  it('only a page that asks for it, and only on a left page', () => {
    expect(mirrorsOn(page({ mirror_left: true, side: 'left' }))).toBe(true);
    expect(mirrorsOn(page({ mirror_left: true, side: 'right' }))).toBe(false);
    expect(mirrorsOn(page({ mirror_left: true }))).toBe(false); // either
    expect(mirrorsOn(page({ side: 'left' }))).toBe(false);
    expect(mirrorsOn(page({ mirror_left: false, side: 'left' }))).toBe(false);
  });

  it('leaves the elements of every other page exactly as they are', () => {
    const els: PageElement[] = [{ type: 'box', x: 0, y: 1, w: 3, h: 3 }];
    expect(placedElements(page({ elements: els, side: 'right', mirror_left: true }))).toBe(els);
    expect(placedElements(page({ elements: els, side: 'left' }))).toBe(els);
  });

  it('is read from a file as a true or false, and refused as anything else', () => {
    expect(readPage({ ...emptyPage(), mirror_left: true }).ok).toBe(true);
    expect(readPage({ ...emptyPage(), mirror_left: false }).ok).toBe(true);
    const bad = readPage({ ...emptyPage(), mirror_left: 'yes' });
    expect(bad.ok ? '' : bad.issues.map((i) => i.rule)).toEqual(['mirror-left']);
  });
});

describe('the Week planner on a left page and a right page', () => {
  const planner = findBuiltinPage('Week planner')!;
  const NOV = calendarFor(2026, 11);
  const week = readingOf(NOV, spansOf(NOV, 'week')[1]);
  const left: Page = { ...structuredClone(planner), side: 'left' }, right: Page = { ...structuredClone(planner), side: 'right' };
  const kinds = (els: PageElement[], type: string) => els.filter((e) => e.type === type);
  /** What the left page draws: its elements flipped, the week block turned into the pieces it draws. */
  const drawnLeft = () => placedElements(left).flatMap((e) => (e.type === 'generated' ? resolveGenerated(e, week) : [e]));

  it('is built to mirror, and the week block mirrors its widgets: the strip goes from the right edge to the left', () => {
    expect(planner.mirror_left).toBe(true);
    const asMade = resolveWeek(planner.elements[0] as Generated, week), mirrored = drawnLeft();
    expect(asMade.length).toBe(mirrored.length);
    const strips = (els: PageElement[]) => kinds(els, 'shade').map((s) => [(s as Shade).x, (s as Shade).w]);
    expect(strips(asMade)).toEqual([[25, 2], [25, 2]]); // Sunday and Saturday
    expect(strips(mirrored)).toEqual([[0, 2], [0, 2]]);
    // every element of the week block is the mirror of the one drawn on a right page
    asMade.forEach((e, i) => expect(mirrored[i]).toEqual(mirrorElement(e)));
  });

  it('reads the labels right: GOAL and OUTCOME turn the other way and every word is the same word', () => {
    const asMade = kinds(resolveWeek(planner.elements[0] as Generated, week), 'text') as Text[], mirrored = kinds(drawnLeft(), 'text') as Text[];
    expect(mirrored.map((t) => t.text)).toEqual(asMade.map((t) => t.text));
    const strip = (t: Text) => (t.rotate ?? 0) !== 0;
    const turned = asMade.filter(strip), turnedMirror = mirrored.filter(strip);
    expect(turned.length).toBeGreaterThan(0);
    expect(new Set(turned.map((t) => t.rotate))).toEqual(new Set([270]));
    expect(turnedMirror).toHaveLength(turned.length);
    expect(new Set(turnedMirror.map((t) => t.rotate))).toEqual(new Set([90]));
    // the strip's labels land in the strip: x 0 to 2
    for (const t of mirrored.filter((t) => ['GOAL', 'OUTCOME'].includes(t.text))) expect(elementArea(t).x).toBeLessThan(2);
    // a day's weekday and date sit in the strip, centered
    for (const t of mirrored.filter((t) => ['SUN', 'MON', '8'].includes(t.text))) expect(t).toMatchObject({ x: 1, align: 'center' });
  });

  it('is laid out for print flipped on the left page and unchanged on the right', () => {
    const items = (page: Page) => { const out: Item[] = []; layoutPage(page, { x: 0, y: 0, pageNumber: null, expand: expandRead(week) }, out); return out; };
    const rects = (page: Page) => items(page).filter((i) => i.k === 'rect').map((i) => (i as { x: number; w: number }));
    const gx = 3.95; // where the grid starts
    expect(rects(right).every((r) => Math.abs(r.x - (gx + 25 * 3)) < 1e-6)).toBe(true);
    expect(rects(left).every((r) => Math.abs(r.x - gx) < 1e-6)).toBe(true);
    // the same page with the mirroring switched off prints exactly like the right-hand one
    expect(items({ ...left, mirror_left: undefined })).toEqual(items(right));
  });

  it('is drawn flipped on the screen too: in the editor, the preview and the export', () => {
    const drawn = (page: Page, mode: 'edit' | 'preview' | 'export') => pageContent(page, { mode, expand: expandRead(week) });
    for (const mode of ['edit', 'preview', 'export'] as const) {
      expect(drawn(left, mode)).not.toBe(drawn({ ...left, mirror_left: undefined }, mode));
    }
    expect(drawn(right, 'preview')).toBe(drawn({ ...right, mirror_left: undefined }, 'preview'));
  });
});
