import { DEFAULT_PRINT } from '../src/book/impose';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportBookFiles } from '../src/print/export';
import { emptyBook, setSlot } from '../src/book/book';
import { itemOrigin, itemValue, sequenceItems } from '../src/format/sequence';
import { GLYPH_EM, TEXT_SIZE_MM } from '../src/format/bounds';
import { emptyPage, PITCH_MM as P, type Page, type Sequence } from '../src/format/types';
import { validateElement, validatePage } from '../src/format/validate';
import { elementFromDrag } from '../src/geometry';
import { ICONS, ICON_NAMES } from '../src/icons/icons';
import { ICON_GROUPS } from '../src/icons/groups';
import { elementMarkup, pageContent } from '../src/render';
import { readPdf } from './pdf-text';

const seq = (extra: Partial<Sequence> = {}): Sequence => ({ type: 'sequence', x: 1, y: 2, count: 5, ...extra });
const rules = (el: unknown) => validateElement(el).map((i) => i.rule);

describe('sequence values', () => {
  it('numbers count from a start by a step; the default is 1, 2, 3', () => {
    expect(sequenceItems(seq())).toEqual(['1', '2', '3', '4', '5']);
    expect(sequenceItems(seq({ start: 10, step: 5, count: 3 }))).toEqual(['10', '15', '20']);
    expect(sequenceItems(seq({ start: 3, step: -1, count: 4 }))).toEqual(['3', '2', '1', '0']);
  });

  it('letters follow the alphabet from the start letter, on to AA, and keep the case', () => {
    expect(sequenceItems(seq({ values: 'letters', count: 3 }))).toEqual(['A', 'B', 'C']);
    expect(sequenceItems(seq({ values: 'letters', start: 'y', count: 4 }))).toEqual(['y', 'z', 'aa', 'ab']);
    expect(itemValue(seq({ values: 'letters', start: 'A' }), 26)).toBe('AA');
  });

  it('a list repeats, and so do icons', () => {
    expect(sequenceItems(seq({ values: 'list', list: ['S', 'M', 'T'], count: 7 }))).toEqual(['S', 'M', 'T', 'S', 'M', 'T', 'S']);
    expect(sequenceItems(seq({ values: 'icons', icons: ['sun', 'moon-full'], count: 3 }))).toEqual(['sun', 'moon-full', 'sun']);
  });

  it('lays items out down or across, spaced by `every`', () => {
    expect(itemOrigin(seq({ every: 2 }), 2)).toEqual({ x: 1, y: 6 });
    expect(itemOrigin(seq({ every: 1.5, direction: 'across' }), 2)).toEqual({ x: 4, y: 2 });
  });
});

describe('sequence rules', () => {
  it('accepts each kind of values', () => {
    expect(rules(seq())).toEqual([]);
    expect(rules(seq({ values: 'letters', start: 'c' }))).toEqual([]);
    expect(rules(seq({ values: 'list', list: ['S', 'M', '10'] }))).toEqual([]);
    expect(rules(seq({ values: 'icons', icons: ['sun'], size: 2, every: 2 }))).toEqual([]);
  });

  it('refuses text of more than two characters and an unknown icon; a list nobody has typed yet is fine', () => {
    expect(rules(seq({ values: 'list', list: ['MON'] }))).toEqual(['sequence']);
    expect(rules(seq({ values: 'list', list: [] }))).toEqual([]); // nothing typed yet: nothing drawn
    expect(rules(seq({ values: 'list' }))).toEqual([]);
    expect(rules(seq({ values: 'list', list: [''] }))).toEqual(['sequence']);
    expect(rules(seq({ values: 'icons', icons: ['unicorn'] }))).toEqual(['sequence']);
    expect(rules(seq({ values: 'letters', start: '12' }))).toEqual(['sequence']);
    expect(rules(seq({ start: 95, count: 10 }))).toEqual(['sequence']); // reaches 100
    expect(rules(seq({ start: 1.5 }))).toEqual(['sequence']);
  });

  it('keeps the whole run on the grid', () => {
    expect(rules(seq({ y: 40, count: 5 }))).toEqual(['bounds']);
    expect(rules(seq({ x: 25, count: 3, direction: 'across' }))).toEqual(['bounds']);
    expect(rules(seq({ values: 'icons', icons: ['sun'], size: 2, x: 26 }))).toEqual(['bounds']); // a 2-cell icon needs 2 columns
    expect(rules(seq({ count: 0 }))).toEqual(['count']);
    expect(rules(seq({ every: 0.3 }))).toEqual(['every']);
    expect(rules(seq({ x: 1.25 }))).toEqual(['half-cell']);
  });
});

describe('sequence drawing', () => {
  /** x and text of each drawn item. */
  const items = (markup: string) => [...markup.matchAll(/<text x="([\d.]+)" y="[\d.]+">([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), text: m[2] }));

  it('keeps two-digit numbers inside their cells, centered by their actual width, with no inset', () => {
    const el = seq({ y: 8, count: 30, tone: 'black' });
    const drawn = items(elementMarkup(el));
    expect(drawn).toHaveLength(30);
    drawn.forEach(({ x, text }, i) => {
      const width = text.length * GLYPH_EM * TEXT_SIZE_MM.label;
      const cell = itemOrigin(el, i);
      expect(x).toBeCloseTo(cell.x * P + P / 2, 3); // centered on the cell
      expect(x - width / 2).toBeGreaterThanOrEqual(cell.x * P - 1e-6);
      expect(x + width / 2).toBeLessThanOrEqual((cell.x + 1) * P + 1e-6);
    });
    expect(elementMarkup(el)).toContain('text-anchor="middle"');
    expect(elementMarkup(el)).toContain('fill="#000"');
  });

  it('draws a lettered, a listed and a numbered sequence as their own text', () => {
    expect(items(elementMarkup(seq({ values: 'letters', start: 'D', count: 3 }))).map((i) => i.text)).toEqual(['D', 'E', 'F']);
    expect(items(elementMarkup(seq({ values: 'list', list: ['S', 'M'], count: 3, direction: 'across' }))).map((i) => i.text)).toEqual(['S', 'M', 'S']);
    expect(items(elementMarkup(seq({ start: 8, step: 2, count: 3 }))).map((i) => i.text)).toEqual(['8', '10', '12']);
    expect(elementMarkup(seq({ values: 'list', list: ['a'], tone: 'gray' }))).toContain('fill="#808080"');
    // across: x moves by the spacing, y stays
    const across = items(elementMarkup(seq({ direction: 'across', every: 2, count: 2 })));
    expect(across[1].x - across[0].x).toBeCloseTo(2 * P, 3);
  });

  it('draws an icon sequence as the icons’ own line art, one per item, at 1 or 2 cells', () => {
    const one = elementMarkup(seq({ values: 'icons', icons: ['sun', 'heart'], count: 3 }));
    expect((one.match(/<g transform=/g) ?? []).length).toBe(3);
    expect(one).toContain(`d="${ICONS.sun.stroke}"`);
    expect(one).toContain(`d="${ICONS.heart.stroke}"`);
    expect(one).toContain('scale(0.125)'); // 3 mm for the 24-unit icon grid
    const two = elementMarkup(seq({ values: 'icons', icons: ['sun'], count: 1, size: 2, tone: 'gray' }));
    expect(two).toContain('scale(0.25)');
    expect(two).toContain('stroke="#808080"');
  });

  it('draws filled shapes for the full moon', () => {
    expect(elementMarkup(seq({ values: 'icons', icons: ['moon-full'], count: 1 }))).toContain('fill="#000" stroke="none"');
  });
});

describe('icons', () => {
  it('is a curated set of plain-named line icons, each in one group of the picker', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(40);
    for (const name of ICON_NAMES) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    const grouped = ICON_GROUPS.flatMap(([, names]) => names);
    expect([...grouped].sort()).toEqual([...ICON_NAMES].sort());
    for (const name of ICON_NAMES) expect(ICONS[name].stroke.length, name).toBeGreaterThan(5);
    for (const name of ['task', 'done', 'migrated', 'scheduled', 'note', 'event', 'priority', 'inspiration', 'explore', 'sun', 'water', 'home', 'gift', 'arrow-up']) {
      expect(ICON_NAMES, name).toContain(name);
    }
  });

  it('places with a tap as a one-item sequence, sized 1 or 2 cells, black or gray', () => {
    const at = { x: 4, y: 6 };
    expect(elementFromDrag('icon', at, at, { name: 'sun', size: 1, tone: 'black' })).toEqual({ type: 'sequence', x: 4, y: 6, count: 1, values: 'icons', icons: ['sun'] });
    const big = elementFromDrag('icon', at, at, { name: 'star', size: 2, tone: 'gray' })!;
    expect(big).toMatchObject({ values: 'icons', icons: ['star'], size: 2, every: 2, tone: 'gray', count: 1 });
    expect(validateElement(big)).toEqual([]);
    // a drag along a row repeats it
    expect(elementFromDrag('icon', at, { x: 7, y: 6 }, { name: 'sun', size: 1, tone: 'black' })).toMatchObject({ count: 4, direction: 'across' });
    // near the edge a 2-cell icon is moved back onto the page
    expect(elementFromDrag('icon', { x: 26, y: 43 }, { x: 26, y: 43 }, { name: 'sun', size: 2, tone: 'black' })).toMatchObject({ x: 25, y: 42 });
  });

  it('renders on a page and stays a valid page', () => {
    const el = elementFromDrag('icon', { x: 4, y: 6 }, { x: 4, y: 6 }, { name: 'coffee', size: 1, tone: 'black' })!;
    const page: Page = { ...emptyPage(), elements: [el] };
    expect(validatePage(page)).toEqual([]);
    expect(pageContent(page, { mode: 'export' })).toContain(`d="${ICONS.coffee.stroke}"`);
  });

  it('makes a sequence by dragging along a run of cells, numbers from 1; a tap puts seven down the page', () => {
    expect(elementFromDrag('sequence', { x: 2, y: 8 }, { x: 2, y: 12 })).toEqual({ type: 'sequence', x: 2, y: 8, count: 5 });
    expect(elementFromDrag('sequence', { x: 2, y: 8 }, { x: 5, y: 8 })).toEqual({ type: 'sequence', x: 2, y: 8, count: 4, direction: 'across' });
    expect(elementFromDrag('sequence', { x: 5, y: 8 }, { x: 2, y: 8 })).toMatchObject({ x: 2, count: 4 }); // either way round
    expect(elementFromDrag('sequence', { x: 2, y: 8 }, { x: 2, y: 8 })).toMatchObject({ count: 7 });
    expect(elementFromDrag('sequence', { x: 2, y: 40 }, { x: 2, y: 40 })).toMatchObject({ count: 4 }); // only room for four
  });
});

describe('printing', () => {
  it('puts sequences and icons in the PDF: text as real text, icons as drawn paths', async () => {
    const page: Page = {
      ...emptyPage(), identity: '',
      elements: [seq({ y: 3, count: 12, tone: 'black' }), seq({ x: 3, y: 3, values: 'icons', icons: ['sun', 'moon-full', 'heart'], count: 3 })],
    };
    const book = emptyBook(8);
    book.page_numbers = false;
    setSlot(book, 1, page);
    const files = await exportBookFiles(book, DEFAULT_PRINT, {
      regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf'),
    });
    const pdf = await readPdf(files.find((f) => f.name === 'pages.pdf')!.bytes);
    expect(pdf[0].strings).toEqual(expect.arrayContaining(['1', '9', '12']));
    expect(pdf[0].strings.filter((s) => /^\d+$/.test(s))).toHaveLength(12);
    expect(pdf[0].content).toMatch(/ c\b/); // curves from the icon paths
  });
});

