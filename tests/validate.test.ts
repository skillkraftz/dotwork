import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatIssue, validateElement, validatePage } from '../src/format/validate';
import { readPage } from '../src/format/read';

const base = () => ({
  format: 'dotwork-page',
  version: 2,
  name: 'Test',
  grid: { cols: 27, rows: 44, pitch_mm: 3 },
  elements: [] as Record<string, unknown>[],
});
const withEl = (el: unknown) => ({ ...base(), elements: [el] });
const rules = (page: unknown) => validatePage(page).map((i) => i.rule);
const elRules = (el: unknown) => rules(withEl(el));

const box = { type: 'box', x: 0, y: 1, w: 3, h: 2 };

describe('examples', () => {
  const dir = join(__dirname, '..', 'examples');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('includes the recreated journal-system pages', () => {
    for (const f of ['monthly-tracker', 'daily-good-time', 'idea-page', 'year-weekly-page']) expect(files).toContain(`${f}.json`);
  });

  for (const f of files) {
    it(`${f} is valid version 2`, () => {
      expect(validatePage(JSON.parse(readFileSync(join(dir, f), 'utf8'))).map(formatIssue)).toEqual([]);
    });
  }
});

describe('top-level rules', () => {
  it('accepts a minimal page', () => {
    expect(validatePage(base())).toEqual([]);
    expect(validatePage({ ...base(), identity: '', side: 'either' })).toEqual([]);
  });

  it('root-object: rejects non-objects', () => {
    expect(rules(null)).toEqual(['root-object']);
    expect(rules([])).toEqual(['root-object']);
  });

  it('format: rejects the wrong format', () => {
    expect(rules({ ...base(), format: 'dotwork-spread' })).toContain('format');
  });

  it('version: rejects anything but 2', () => {
    expect(rules({ ...base(), version: 3 })).toContain('version');
    expect(rules({ ...base(), version: 1 })).toContain('version');
    expect(rules({ ...base(), version: undefined })).toContain('version');
  });

  it('name: must be a string', () => {
    expect(rules({ ...base(), name: undefined })).toContain('name');
    expect(rules({ ...base(), name: 3 })).toContain('name');
  });

  it('identity: a string with known tokens only', () => {
    expect(rules({ ...base(), identity: 5 })).toContain('identity');
    expect(validatePage({ ...base(), identity: '{weekday} {month} {monthname} {day} {year} {week}' })).toEqual([]);
    const bad = validatePage({ ...base(), identity: '{weekdy}' });
    expect(bad.map((i) => i.rule)).toEqual(['token']);
    expect(bad[0].message).toContain('{weekdy}');
  });

  it('side: left, right or either', () => {
    for (const side of ['left', 'right', 'either']) expect(validatePage({ ...base(), side })).toEqual([]);
    expect(rules({ ...base(), side: 'center' })).toEqual(['side']);
  });

  it('grid: exactly 27 x 44 at 3 mm', () => {
    expect(rules({ ...base(), grid: undefined })).toContain('grid');
    expect(rules({ ...base(), grid: { cols: 27, rows: 44, pitch_mm: 4 } })).toContain('grid');
    expect(rules({ ...base(), grid: { cols: 26, rows: 44, pitch_mm: 3 } })).toContain('grid');
  });

  it('elements-array: required, may be empty', () => {
    expect(rules({ ...base(), elements: undefined })).toEqual(['elements-array']);
    expect(rules({ ...base(), elements: {} })).toEqual(['elements-array']);
  });
});

describe('element rules', () => {
  it('element-object and element-type', () => {
    expect(elRules(3)).toEqual(['element-object']);
    expect(elRules({ type: 'circle' })).toEqual(['element-type']);
    expect(elRules({})).toEqual(['element-type']);
  });

  it('half-cell: coordinates and sizes are multiples of 0.5', () => {
    expect(elRules({ ...box, x: 0.5, w: 2.5 })).toEqual([]);
    expect(elRules({ ...box, x: 0.3 })).toEqual(['half-cell']);
    expect(elRules({ ...box, h: 1.25 })).toEqual(['half-cell']);
    expect(elRules({ type: 'box', y: 1, w: 1, h: 1 })).toEqual(['half-cell']); // x missing
    expect(elRules({ ...box, x: '1' })).toEqual(['half-cell']);
    expect(elRules({ type: 'rule', x1: 0, y1: 1, x2: 5.2, y2: 1 })).toEqual(['half-cell']);
    expect(elRules({ type: 'checkboxes', x: 0.25, y: 1, count: 2 })).toEqual(['half-cell']);
    expect(elRules({ type: 'text', x: 1, y: 1.75, text: 'a' })).toEqual(['half-cell']);
  });

  it('size: area elements must have w and h above 0', () => {
    expect(elRules({ ...box, w: 0 })).toEqual(['size']);
    expect(elRules({ ...box, h: -1 })).toEqual(['size']);
    expect(elRules({ type: 'pattern', pattern: 'none', x: 0, y: 1, w: 0.5, h: 0.5 })).toEqual([]);
  });

  it('bounds: inside the grid', () => {
    expect(elRules({ ...box, x: 26, w: 2 })).toEqual(['bounds']);
    expect(elRules({ ...box, x: 25.5, w: 2 })).toEqual(['bounds']);
    expect(elRules({ ...box, y: 43, h: 2 })).toEqual(['bounds']);
    expect(elRules({ ...box, x: -0.5 })).toEqual(['bounds']);
    expect(elRules({ ...box, x: 24, w: 3, y: 42, h: 2 })).toEqual([]); // flush with the corner
    expect(validatePage(withEl({ ...box, x: 26, w: 2 }))[0].path).toBe('elements[0]');
  });

  it('header-row: nothing above y = 1', () => {
    expect(elRules({ ...box, y: 0 })).toEqual(['header-row']);
    expect(elRules({ ...box, y: 0.5 })).toEqual(['header-row']);
    expect(elRules({ ...box, y: 1 })).toEqual([]);
    expect(elRules({ ...box, y: -1 })).toEqual(['bounds']);
    expect(elRules({ type: 'text', x: 0, y: 0.5, text: 'a' })).toEqual(['header-row']);
  });

  it('overlap is allowed', () => {
    const page = { ...base(), elements: [box, box, { ...box, x: 1 }] };
    expect(validatePage(page)).toEqual([]);
  });

  it('pattern: background and stripes, and "none" for plain shading', () => {
    const shade = { type: 'pattern', pattern: 'none', x: 0, y: 1, w: 3, h: 2 };
    for (const background of ['none', 'light', 'medium', 'dark']) expect(elRules({ ...shade, background })).toEqual([]);
    for (const stripes of ['none', 'rows', 'columns']) expect(elRules({ ...shade, stripes })).toEqual([]);
    expect(elRules({ ...shade, background: 'black' })).toEqual(['value']);
    expect(elRules({ ...shade, stripes: 'diagonal' })).toEqual(['value']);
    expect(elRules({ ...shade, pattern: 'lines', background: 'light', stripes: 'rows' })).toEqual([]);
  });

  it('the shade element is gone', () => {
    expect(elRules({ type: 'shade', x: 0, y: 1, w: 3, h: 2 })).toEqual(['element-type']);
  });

  it('pattern: kind is required; every is a positive multiple of 0.5', () => {
    const pattern = { type: 'pattern', x: 0, y: 1, w: 3, h: 2, pattern: 'lines' };
    for (const p of ['lines', 'vlines', 'grid', 'dots']) expect(elRules({ ...pattern, pattern: p, every: 2 })).toEqual([]);
    expect(elRules({ ...pattern, pattern: 'hatch' })).toEqual(['value']);
    expect(elRules({ ...pattern, pattern: undefined })).toEqual(['value']);
    expect(elRules({ ...pattern, every: 0 })).toEqual(['every']);
    expect(elRules({ ...pattern, every: -1 })).toEqual(['every']);
    expect(elRules({ ...pattern, every: 1.3 })).toEqual(['every']);
  });

  it('box: sides and weight', () => {
    expect(elRules({ ...box, sides: ['top', 'bottom', 'left', 'right'], weight: 'thick' })).toEqual([]);
    expect(elRules({ ...box, sides: ['top'] })).toEqual([]);
    expect(elRules({ ...box, sides: ['middle'] })).toEqual(['value']);
    expect(elRules({ ...box, sides: 'top' })).toEqual(['value']);
    expect(elRules({ ...box, weight: 'hair' })).toEqual(['value']);
  });

  it('rule: horizontal or vertical, with a length', () => {
    const rule = { type: 'rule', x1: 0, y1: 1, x2: 27, y2: 1 };
    for (const weight of ['hair', 'thin', 'thick']) expect(elRules({ ...rule, weight })).toEqual([]);
    expect(elRules({ ...rule, x2: 0, y2: 44 })).toEqual([]); // vertical
    expect(elRules({ ...rule, x1: 27, x2: 0 })).toEqual([]); // either direction
    expect(elRules({ ...rule, weight: 'bold' })).toEqual(['value']);
    expect(elRules({ ...rule, y2: 2 })).toEqual(['diagonal']);
    expect(elRules({ ...rule, y2: 1.5 })).toEqual(['diagonal']);
    expect(elRules({ ...rule, x2: 0 })).toEqual(['size']);
    expect(elRules({ ...rule, y1: 0.5, y2: 0.5 })).toEqual(['header-row']);
    expect(elRules({ ...rule, x2: 28 })).toEqual(['bounds']);
  });

  it('checkboxes: count, spacing, size, direction, weight', () => {
    const cb = { type: 'checkboxes', x: 0, y: 1, count: 5 };
    expect(elRules({ ...cb, every: 2, direction: 'across', size: 0.5, weight: 'thick' })).toEqual([]);
    expect(elRules({ ...cb, size: 1 })).toEqual([]);
    expect(elRules({ ...cb, count: 0 })).toEqual(['count']);
    expect(elRules({ ...cb, count: 2.5 })).toEqual(['count']);
    expect(elRules({ ...cb, count: undefined })).toEqual(['count']);
    expect(elRules({ ...cb, every: 0 })).toEqual(['every']);
    expect(elRules({ ...cb, size: 0.4 })).toEqual(['size']);
    expect(elRules({ ...cb, size: 1.1 })).toEqual(['size']);
    expect(elRules({ ...cb, direction: 'up' })).toEqual(['value']);
    expect(elRules({ ...cb, weight: 'hair' })).toEqual(['value']);
  });

  it('checkboxes must stay in the grid, counting their spacing', () => {
    expect(elRules({ type: 'checkboxes', x: 0, y: 1, count: 43 })).toEqual([]);
    expect(elRules({ type: 'checkboxes', x: 0, y: 1, count: 44 })).toEqual(['bounds']);
    expect(elRules({ type: 'checkboxes', x: 0, y: 1, count: 22, every: 2 })).toEqual([]); // last box in row 43
    expect(elRules({ type: 'checkboxes', x: 0, y: 1, count: 23, every: 2 })).toEqual(['bounds']);
    expect(elRules({ type: 'checkboxes', x: 20, y: 1, count: 8, direction: 'across' })).toEqual(['bounds']);
    expect(elRules({ type: 'checkboxes', x: 20, y: 1, count: 7, direction: 'across' })).toEqual([]);
    expect(validatePage(withEl({ type: 'checkboxes', x: 0, y: 1, count: 44 }))[0].message).toContain('44 boxes');
  });

  it('text: string, tokens and style fields', () => {
    const text = { type: 'text', x: 0, y: 1, text: 'Hello' };
    expect(elRules({ ...text, size: 'heading', style: 'bold', tone: 'black', align: 'right', rotate: 90 })).toEqual([]);
    expect(elRules({ ...text, text: '{weekday} {month} {monthname} {day} {year} {week}' })).toEqual([]);
    expect(elRules({ ...text, text: undefined })).toEqual(['text']);
    expect(elRules({ ...text, text: 5 })).toEqual(['text']);
    expect(elRules({ ...text, text: 'Due {tomorrow}' })).toEqual(['token']);
    expect(validatePage(withEl({ ...text, text: '{x}' }))[0].path).toBe('elements[0].text');
    expect(elRules({ ...text, size: 'huge' })).toEqual(['value']);
    expect(elRules({ ...text, style: 'italic' })).toEqual(['value']);
    expect(elRules({ ...text, tone: 'red' })).toEqual(['value']);
    expect(elRules({ ...text, align: 'justify' })).toEqual(['value']);
    expect(elRules({ ...text, rotate: 45 })).toEqual(['value']);
    expect(elRules({ ...text, rotate: '90' })).toEqual(['value']);
  });

  it('text anchors stay inside the grid, including their band', () => {
    expect(elRules({ type: 'text', x: 27, y: 43, text: 'a', align: 'right' })).toEqual([]);
    expect(elRules({ type: 'text', x: 28, y: 1, text: 'a' })).toEqual(['bounds']);
    expect(elRules({ type: 'text', x: 0, y: 44, text: 'a' })).toEqual(['bounds']); // the band would be below the grid
    expect(elRules({ type: 'text', x: 0, y: 44, text: 'a', rotate: 90 })).toEqual([]); // reads upward from the bottom
    expect(elRules({ type: 'text', x: 27, y: 1, text: 'a', rotate: 90 })).toEqual(['bounds']); // band lies right of x
    expect(elRules({ type: 'text', x: 27, y: 1, text: 'a', rotate: 270 })).toEqual([]); // band lies left of x
    expect(elRules({ type: 'text', x: 0, y: 1, text: 'a', rotate: 270 })).toEqual(['bounds']);
  });

  it('reports every problem with a path and the rule name', () => {
    const page = { ...base(), version: 3, elements: [{ ...box, y: 0 }, { type: 'blob' }] };
    const issues = validatePage(page);
    expect(issues.map((i) => i.rule).sort()).toEqual(['element-type', 'header-row', 'version']);
    expect(issues.find((i) => i.rule === 'element-type')!.path).toBe('elements[1].type');
    expect(formatIssue(issues[0])).toMatch(/\(rule: [a-z-]+\)$/);
  });

  it('validateElement checks a single element', () => {
    expect(validateElement(box)).toEqual([]);
    expect(validateElement({ ...box, w: 0 })[0].rule).toBe('size');
  });
});

describe('readPage', () => {
  it('passes version 2 through and rejects bad files with the rule', () => {
    const ok = readPage(base());
    expect(ok.ok && ok.converted).toBe(false);
    const bad = readPage({ ...base(), elements: [{ ...box, y: 0 }] });
    expect(!bad.ok && bad.issues[0].rule).toBe('header-row');
  });

  it('rejects unknown versions without trying to convert', () => {
    const r = readPage({ ...base(), version: 9 });
    expect(!r.ok && r.issues[0].rule).toBe('version');
    expect(readPage('nope').ok).toBe(false);
  });
});
