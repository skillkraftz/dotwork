import { describe, expect, it } from 'vitest';
import { elementMarkup, exportSvg, pageContent } from '../src/render';
import { emptyPage, type Page, type PageElement } from '../src/format/types';
import { blankTokens } from '../src/format/tokens';

const page = (elements: PageElement[], extra: Partial<Page> = {}): Page => ({ ...emptyPage(), elements, ...extra });
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('page rendering', () => {
  it('draws the grid inside the true page: 88.9 x 139.7 mm with 3.95 / 3.85 mm margins', () => {
    const svg = exportSvg(page([]), 100, 100, '');
    expect(svg).toContain('viewBox="0 0 88.9 139.7"');
    expect(svg).toContain('translate(3.95 3.85)');
    expect(pageContent(page([]), { mode: 'export' })).not.toContain('SPINE');
    expect(pageContent(page([]), { mode: 'preview' })).toContain('SPINE');
  });

  it('puts the identity by the spine: left on a right page, right on a left page', () => {
    const header = (side?: Page['side']) => pageContent(page([], { identity: 'MON', side }), { mode: 'export' });
    expect(header('right')).toMatch(/<text x="0" [^>]*font-weight="700"[^>]*>MON<\/text>/);
    expect(header(undefined)).toMatch(/<text x="0" [^>]*font-weight="700"[^>]*>MON<\/text>/);
    expect(header('left')).toMatch(/<text x="81" [^>]*font-weight="700"[^>]*text-anchor="end"[^>]*>MON<\/text>/);
    expect(header('left')).toMatch(/<text x="0" [^>]*>47<\/text>/);
    expect(header('right')).toMatch(/<text x="81" [^>]*text-anchor="end">47<\/text>/);
  });

  it('puts the SPINE label on the spine side', () => {
    expect(pageContent(page([], { side: 'left' }), { mode: 'preview' })).toContain('translate(91.5 ');
    expect(pageContent(page([], { side: 'right' }), { mode: 'preview' })).toContain('translate(-2.6 ');
  });

  it('draws elements in array order and hides hidden ones only while editing', () => {
    const els: PageElement[] = [{ type: 'shade', tones: 'D', x: 0, y: 1, w: 1, h: 1 }, { type: 'text', x: 0, y: 1, text: 'TOP' }];
    const out = pageContent(page(els), { mode: 'edit' });
    expect(out.indexOf('#bdbdbd')).toBeLessThan(out.indexOf('TOP'));
    expect(pageContent(page(els), { mode: 'edit', hidden: new Set([0]) })).not.toContain('#bdbdbd');
    expect(pageContent(page(els), { mode: 'preview', hidden: new Set([0]) })).toContain('#bdbdbd');
  });
});

describe('elements', () => {
  it('shades in three tones, and blank draws nothing', () => {
    const shade = { type: 'shade', x: 0, y: 1, w: 4, h: 5 } as const;
    expect(elementMarkup({ ...shade, tones: 'L' })).toContain('#efefef');
    expect(elementMarkup({ ...shade, tones: 'M' })).toContain('#dcdcdc');
    expect(elementMarkup({ ...shade, tones: 'D' })).toContain('#bdbdbd');
    expect(elementMarkup({ ...shade, tones: 'B' })).toBe('');
    expect(count(elementMarkup({ ...shade, tones: 'L' }), /<rect/g)).toBe(1); // solid: one rectangle, no seams
  });

  it('shades rows, columns and a checkerboard from the tone letters', () => {
    const shade = { type: 'shade', x: 0, y: 1, w: 4, h: 5 } as const;
    // LB along rows: rows 0, 2 and 4 are light (every other row, starting with the first)
    const rows = elementMarkup({ ...shade, tones: 'LB' });
    expect(count(rows, /<rect/g)).toBe(3);
    expect(rows).toContain('y="3" width="12" height="3"'); // row 0 is 3 mm tall at y = 1 cell
    // LB along columns: columns 0 and 2
    expect(count(elementMarkup({ ...shade, tones: 'LB', along: 'columns' }), /<rect/g)).toBe(2);
    // LB as a checker: cell (r, c) takes tone (r + c) mod 2, so 4 x 5 cells hold 10 light ones
    const checker = elementMarkup({ ...shade, tones: 'LB', along: 'checker' });
    expect(count(checker, /<rect/g)).toBe(10);
    // a custom repeat: L, B, B, M, B, B down five rows is a light, a medium row
    const custom = elementMarkup({ ...shade, tones: 'LBBMBB' });
    expect(custom).toContain('#efefef');
    expect(custom).toContain('#dcdcdc');
    expect(count(custom, /<rect/g)).toBe(2);
  });

  it('every sets how many cells each tone step covers, in multiples of half a cell', () => {
    const shade = { type: 'shade', x: 0, y: 1, w: 4, h: 5, tones: 'LB' } as const;
    expect(count(elementMarkup({ ...shade, every: 2 }), /<rect/g)).toBe(2); // rows 0-1 and 4-5 (the last is cut to one row)
    expect(elementMarkup({ ...shade, every: 2 })).toContain('height="6"'); // two cells
    expect(count(elementMarkup({ ...shade, every: 0.5 }), /<rect/g)).toBe(5); // ten half-rows, every other one
  });

  it('draws lines in three weights, and dots in two sizes', () => {
    const area = { x: 0, y: 1, w: 4, h: 3 } as const;
    expect(elementMarkup({ type: 'pattern', pattern: 'lines', ...area })).toContain('stroke="#c4c4c4"'); // hair by default
    expect(elementMarkup({ type: 'pattern', pattern: 'lines', weight: 'thin', ...area })).toMatch(/stroke="#000" stroke-width="0.176"/);
    expect(elementMarkup({ type: 'pattern', pattern: 'lines', weight: 'thick', ...area })).toMatch(/stroke="#000" stroke-width="0.529"/);
    for (const kind of ['vlines', 'grid'] as const) expect(elementMarkup({ type: 'pattern', pattern: kind, weight: 'thick', ...area })).toContain('stroke-width="0.529"');
    expect(elementMarkup({ type: 'pattern', pattern: 'dots', ...area })).toContain('stroke-width="0.5"');
    expect(elementMarkup({ type: 'pattern', pattern: 'dots', dots: 'large', ...area })).toContain('stroke-width="0.9"');
  });

  it('can include the first edge: the top line of lines, the left line of vlines', () => {
    const area = { x: 1, y: 2, w: 3, h: 4 } as const;
    const lines = elementMarkup({ type: 'pattern', pattern: 'lines', first: true, ...area });
    expect(count(lines, /H/g)).toBe(5);
    expect(lines).toContain('M3 6H12'); // the top edge, at y = 2 cells
    expect(elementMarkup({ type: 'pattern', pattern: 'lines', first: false, ...area })).not.toContain('M3 6H');
    const vlines = elementMarkup({ type: 'pattern', pattern: 'vlines', first: true, ...area });
    expect(count(vlines, /V/g)).toBe(4);
    expect(vlines).toContain('M3 6V18'); // the left edge, at x = 1 cell
    expect(elementMarkup({ type: 'pattern', pattern: 'vlines', ...area })).not.toContain('M3 6V');
  });

  it('draws a rule under each row band including the bottom edge, and a rule right of each column band', () => {
    const lines = elementMarkup({ type: 'pattern', pattern: 'lines', x: 1, y: 2, w: 3, h: 4 });
    expect(count(lines, /H/g)).toBe(4);
    expect(lines).toContain('M3 9H12'); // under the first row, at y = 3 cells
    expect(lines).toContain('M3 18H12'); // the bottom edge
    expect(lines).not.toContain('M3 6H'); // not above the first row
    const vlines = elementMarkup({ type: 'pattern', pattern: 'vlines', x: 1, y: 2, w: 3, h: 4 });
    expect(count(vlines, /V/g)).toBe(3);
    expect(vlines).toContain('M12 6V18'); // the right edge
  });

  it('draws a grid on every boundary and dots on every intersection, edges included', () => {
    const grid = elementMarkup({ type: 'pattern', pattern: 'grid', x: 0, y: 1, w: 3, h: 2 });
    expect(count(grid, /H/g)).toBe(3);
    expect(count(grid, /V/g)).toBe(4);
    expect(count(elementMarkup({ type: 'pattern', pattern: 'dots', x: 0, y: 1, w: 3, h: 2 }), /h0/g)).toBe(12);
  });

  it('spaces patterns every n cells and closes a partial last band at the edge', () => {
    expect(count(elementMarkup({ type: 'pattern', pattern: 'lines', x: 0, y: 1, w: 3, h: 6, every: 2 }), /H/g)).toBe(3);
    const odd = elementMarkup({ type: 'pattern', pattern: 'lines', x: 0, y: 1, w: 3, h: 5, every: 2 });
    expect(count(odd, /H/g)).toBe(3);
    expect(odd).toContain('M0 18H9'); // the bottom edge at y = 6 cells
    expect(count(elementMarkup({ type: 'pattern', pattern: 'lines', x: 0, y: 1, w: 3, h: 2, every: 0.5 }), /H/g)).toBe(4);
  });

  it('draws only the sides asked for, at the weights the format names', () => {
    const top = elementMarkup({ type: 'box', x: 0, y: 1, w: 2, h: 2, sides: ['top'], weight: 'thick' });
    expect(top).toContain('M0 3H6');
    expect(count(top, /[HV]/g)).toBe(1);
    expect(top).toContain('stroke-width="0.529"');
    expect(elementMarkup({ type: 'box', x: 0, y: 1, w: 2, h: 2 })).toContain('stroke-width="0.176"');
    expect(count(elementMarkup({ type: 'box', x: 0, y: 1, w: 2, h: 2 }), /[HV]/g)).toBe(4);
  });

  it('draws hair rules gray and thin or thick rules black', () => {
    const rule = { type: 'rule', x1: 0, y1: 3, x2: 5, y2: 3 } as const;
    expect(elementMarkup({ ...rule, weight: 'hair' })).toContain('#c4c4c4');
    expect(elementMarkup(rule)).toContain('stroke="#000"');
    expect(elementMarkup({ ...rule, weight: 'thick' })).toContain('0.529');
  });

  it('centers each checkbox in its cell at the chosen size and spacing', () => {
    const down = elementMarkup({ type: 'checkboxes', x: 1, y: 2, count: 3, every: 2, size: 0.5 });
    expect(count(down, /<rect/g)).toBe(3);
    expect(down).toContain('x="3.75" y="6.75" width="1.5" height="1.5"');
    expect(down).toContain('y="18.75"'); // the third box, 4 cells below the first
    const across = elementMarkup({ type: 'checkboxes', x: 0, y: 1, count: 2, direction: 'across' });
    expect(across).toContain('x="0.45" y="3.45" width="2.1"');
    expect(across).toContain('x="3.45"');
  });

  it('anchors text in its cell band, with alignment, style, tone and rotation', () => {
    const t = elementMarkup({ type: 'text', x: 2, y: 3, text: 'Hi & <you>' });
    expect(t).toContain('translate(6 9)');
    expect(t).toContain('y="2.4"'); // baseline 0.6 mm above the band's bottom
    expect(t).toContain('Hi &amp; &lt;you&gt;');
    expect(t).toContain('fill="#808080"');
    expect(elementMarkup({ type: 'text', x: 0, y: 1, text: 'a', tone: 'black', style: 'bold', size: 'heading' }))
      .toMatch(/font-size="3.2" font-weight="700"[^>]*fill="#000"/);
    expect(elementMarkup({ type: 'text', x: 0, y: 1, text: 'a', align: 'right' })).toContain('text-anchor="end"');
    expect(elementMarkup({ type: 'text', x: 0, y: 1, text: 'a', align: 'center' })).toContain('text-anchor="middle"');
    expect(elementMarkup({ type: 'text', x: 5, y: 5, text: 'a', rotate: 90 })).toContain('rotate(-90)');
    expect(elementMarkup({ type: 'text', x: 5, y: 5, text: 'a', rotate: 270 })).toContain('rotate(90)');
  });

  it('fills tokens in text with sample values', () => {
    expect(elementMarkup({ type: 'text', x: 0, y: 1, text: '{monthname} {year}' })).toContain('OCTOBER 2026');
  });
});

describe('page numbers and tokens in a book', () => {
  const header = (p: Page, opts = {}) => pageContent(p, { mode: 'export', ...opts });

  it('prints the number it is given in the outer corner, and nothing when null', () => {
    expect(header(page([], { side: 'right' }), { pageNumber: '9' })).toMatch(/text-anchor="end">9<\/text>/);
    expect(header(page([], { side: 'left' }), { pageNumber: '10' })).toMatch(/<text x="0" [^>]*>10<\/text>/);
    expect(header(page([], { side: 'right' }), { pageNumber: null })).not.toContain('47');
    expect(header(page([], { side: 'right' }), { pageNumber: null })).not.toMatch(/<text x="81"/);
  });

  it('expands tokens the way it is told to, in the header and in text', () => {
    const els: PageElement[] = [{ type: 'text', x: 0, y: 1, text: 'Week {week}' }];
    const p = page(els, { identity: '{weekday} {month}' });
    expect(header(p)).toContain('MON OCT');
    expect(header(p)).toContain('Week 44');
    const blank = header(p, { expand: blankTokens, pageNumber: null });
    expect(blank).toContain('>Week <');
    expect(blank).not.toContain('MON');
    expect(blank).not.toContain('font-weight="700"'); // a blank identity leaves no empty bold text behind
  });
});
