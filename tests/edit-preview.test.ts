import { describe, expect, it } from 'vitest';
import { shownPage } from '../src/format/mirror';
import { withSide } from '../src/format/spread';
import { emptyPage, type Page, type PageElement } from '../src/format/types';
import { expandRead, sampleReading } from '../src/format/tokens';
import { findBuiltinPage } from '../src/builtin/library';
import { pageContent } from '../src/render';
import { Store } from '../src/store';
import { dataUrl, makePng } from './png';

// The rule (CLAUDE.md): the editor shows exactly what will print. Edit and Preview draw every element the same; the only things the editor adds
// are its aids (the grid dots, the gray background and header shading, the selection, layers hidden with the eye, and a faint draw of what
// Preview leaves out for the day shown). Each aid is marked class="aid" in the markup, so removing them must leave the two drawings equal.

/** The markup with the editing aids taken out: marked rects and paths, and marked groups with all they hold. */
function withoutAids(svg: string): string {
  let out = svg.replace(/<(rect|path) class="aid"[^>]*\/>/g, '');
  for (let at = out.indexOf('<g class="aid"'); at >= 0; at = out.indexOf('<g class="aid"')) {
    let depth = 0, end = at;
    for (const m of out.slice(at).matchAll(/<g[\s>]|<\/g>/g)) {
      depth += m[0] === '</g>' ? -1 : 1;
      if (depth === 0) { end = at + m.index + m[0].length; break; }
    }
    out = out.slice(0, at) + out.slice(end);
  }
  return out;
}

const png = makePng(4, 4);
const art: PageElement = { type: 'art', x: 2, y: 20, w: 6, h: 4, view_box: [0, 0, 10, 10], paths: [{ d: 'M1 1L9 1L9 9Z', fill: 'dark', stroke: 'black', stroke_mm: 0.3 }] };
const elements: PageElement[] = [
  { type: 'pattern', pattern: 'lines', x: 0, y: 30, w: 14, h: 6 },
  { type: 'shade', x: 0, y: 37, w: 10, h: 3, tones: 'LMD', along: 'columns' },
  { type: 'box', x: 2, y: 4, w: 7, h: 5, sides: ['left', 'top'], weight: 'thick' },
  { type: 'rule', x1: 1, y1: 11, x2: 12, y2: 11 },
  { type: 'checkboxes', x: 1, y: 13, count: 4 },
  { type: 'sequence', x: 24, y: 2, count: 7 },
  { type: 'text', x: 3, y: 15, text: 'LEFT {weekday} {day} {month}' },
  { type: 'text', x: 20, y: 16, text: 'right', align: 'right', style: 'bold' },
  { type: 'text', x: 14, y: 17, text: 'middle {year}', align: 'center' },
  { type: 'text', x: 1, y: 25, text: 'TURNED', rotate: 90 },
  art,
  { type: 'image', x: 12, y: 20, w: 8, h: 5, src: dataUrl(png), width_px: 4, height_px: 4 },
  { type: 'text', x: 3, y: 27, text: 'SATURDAY ONLY', days: 'weekends' },
  { type: 'rule', x1: 3, y1: 29, x2: 20, y2: 29, days: 'weekdays' },
];
const page = (more: Partial<Page> = {}): Page => ({ ...emptyPage(), identity: '{weekday} {day}', elements, ...more });

const SATURDAY = sampleReading('day', '2026-10-31');
const MONDAY = sampleReading('day', '2026-10-26');
const WEEK = sampleReading('week');

/** What the editor draws for a page as it is saved, and what Preview draws for it. `side` is where the editor's page sits. */
function both(saved: Page, read?: ReturnType<typeof sampleReading>, side?: 'left' | 'right') {
  const store = new Store(saved, side);
  const expand = read ? expandRead(read) : undefined;
  const edit = pageContent(store.page, { mode: 'edit', placed: true, expand });
  const preview = pageContent(side ? withSide(saved, side) : saved, { mode: 'preview', expand });
  return { edit, preview, plain: withoutAids(edit) };
}

describe('Edit and Preview draw every element the same', () => {
  const cases: [string, Page, 'left' | 'right' | undefined][] = [
    ['a page on neither side', page(), undefined],
    ['a right page', page({ side: 'right', mirror_left: true }), undefined],
    ['a page mirrored on a left page', page({ side: 'left', mirror_left: true }), undefined],
    ['the left half of a spread, whatever its side says', page({ side: 'right', mirror_left: true }), 'left'],
    ['the left half of a spread with no side', page({ mirror_left: true }), 'left'],
    ['the right half of a spread', page({ mirror_left: true }), 'right'],
    ['a left page that is not mirrored', page({ side: 'left' }), undefined],
  ];
  for (const [name, saved, side] of cases) {
    for (const [day, read] of [['the sample date', undefined], ['a Saturday', SATURDAY], ['a Monday', MONDAY], ['a week', WEEK]] as const) {
      it(`${name}, reading ${day}`, () => {
        const { plain, preview, edit } = both(saved, read, side);
        // the editor adds its aids, so it is not byte for byte the same; without them it is
        expect(edit).not.toBe(preview);
        // an element Preview hides for the day shown is the editor's one extra: drawn faintly, so it can still be selected
        expect(plain).toBe(preview);
      });
    }
  }

  it('draws a mirrored left page flipped in the editor, as Preview does', () => {
    const { plain } = both(page({ side: 'left', mirror_left: true }));
    const unflipped = both(page({ side: 'left' })).plain;
    expect(plain).not.toBe(unflipped);
  });

  it('draws an element that Preview hides for the day faintly, and the same element in full when Preview shows it', () => {
    const saturday = both(page(), SATURDAY).edit, monday = both(page(), MONDAY).edit;
    expect(saturday.match(/class="aid" opacity="0.25"/g)).toHaveLength(1); // the weekday rule
    expect(monday.match(/class="aid" opacity="0.25"/g)).toHaveLength(1); // the weekend text
    expect(both(page(), WEEK).edit).not.toContain('opacity="0.25"'); // where no single day is read, everything shows
  });

  it('reads the same dates in both: the slot’s own date, wherever the page is shown', () => {
    const { edit, preview } = both(page(), SATURDAY);
    for (const out of [edit, preview]) expect(out).toContain('>SAT 31<'); // the identity
    expect(withoutAids(edit)).toContain('LEFT SAT 31 OCT');
  });

  it('fails when the editor draws a mirrored page as stored, so the check can tell', () => {
    const saved = page({ side: 'left', mirror_left: true });
    const asStored = withoutAids(pageContent(saved, { mode: 'edit', placed: true }));
    expect(asStored).not.toBe(pageContent(saved, { mode: 'preview' }));
  });

  it('draws the layers hidden with the eye in Preview but not in the editor (an aid)', () => {
    const saved = page();
    const edit = pageContent(saved, { mode: 'edit', hidden: new Set([2]) });
    expect(edit).not.toBe(pageContent(saved, { mode: 'edit' }));
    expect(pageContent(saved, { mode: 'preview' })).toBe(withoutAids(pageContent(saved, { mode: 'edit' })));
  });

  it('shows a saved page the way shownPage says: flipped only when it is mirrored where it sits', () => {
    const saved = page({ side: 'left', mirror_left: true });
    expect(new Store(saved).page).toEqual(shownPage(saved));
    expect(new Store(saved).document).toEqual(saved);
  });

  it('holds true for the built-in pages too', () => {
    for (const name of ['Week planner', 'Good Time']) {
      const built = findBuiltinPage(name);
      if (!built) continue;
      for (const side of ['left', 'right'] as const) {
        const saved = { ...structuredClone(built), side };
        for (const read of [undefined, WEEK, SATURDAY]) {
          const { plain, preview } = both(saved, read);
          expect(plain).toBe(preview);
        }
      }
    }
  });
});
