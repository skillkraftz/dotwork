import { describe, expect, it } from 'vitest';
import { monthDays, monthOf } from '../src/format/month';
import { sequenceItems } from '../src/format/sequence';
import { shadeRects, weekLines } from '../src/format/shade';
import { expandRead, sampleReading } from '../src/format/tokens';
import type { Sequence, Shade } from '../src/format/types';
import { validateElement } from '../src/format/validate';
import { monthlyTracker } from '../src/builtin/pages';
import { layoutPage } from '../src/print/layout';
import { elementMarkup } from '../src/render';
import type { Item } from '../src/print/display';

const NOV = monthDays('2026-11-15'), FEB = monthDays('2027-02-01');
const seq = (values: Sequence['values'], count = 31): Sequence => ({ type: 'sequence', x: 1, y: 8, count, values });
const weekends = (extra: Partial<Shade> = {}): Shade => ({ type: 'shade', tones: 'L', x: 1, y: 8, w: 26, h: 31, weekends: true, ...extra });
const spans = (rs: { y: number; h: number }[]) => rs.map((r) => [r.y, r.h]);

describe('the month a page reads', () => {
  it('is the first day’s month, October 2026 in the editor, and none without a calendar', () => {
    expect(monthOf(sampleReading('week', '2026-11-29'))).toEqual(NOV); // the week's first day inside it is Nov 29
    expect(monthOf(undefined)).toEqual({ first: 4, days: 31 }); // the sample date: October 2026 starts on a Thursday
    expect(monthOf(null)).toBeNull();
  });
});

describe('days and weekdays of the month', () => {
  it('November 2026 starts on a Sunday and has 30 days', () => {
    expect(NOV).toEqual({ first: 0, days: 30 });
    const days = sequenceItems(seq('month_days'), NOV), letters = sequenceItems(seq('month_weekdays'), NOV);
    expect(days.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(days.filter(Boolean)).toHaveLength(30);
    expect(days[29]).toBe('30');
    expect(days[30]).toBe('');
    expect(letters.slice(0, 8)).toEqual([...'SMTWTFSS']);
    expect(letters[30]).toBe('');
  });

  it('February 2027 starts on a Monday and has 28 days', () => {
    expect(FEB).toEqual({ first: 1, days: 28 });
    const days = sequenceItems(seq('month_days'), FEB), letters = sequenceItems(seq('month_weekdays'), FEB);
    expect(days.filter(Boolean)).toHaveLength(28);
    expect(days[27]).toBe('28');
    expect(letters.slice(0, 7)).toEqual([...'MTWTFSS']);
    expect(letters.slice(28)).toEqual(['', '', '']);
  });

  it('count is the most drawn, and a page with no month prints nothing', () => {
    expect(sequenceItems(seq('month_days', 5), NOV)).toEqual(['1', '2', '3', '4', '5']);
    expect(sequenceItems(seq('month_days', 3), null)).toEqual(['', '', '']);
  });
});

describe('Only weekends of the month', () => {
  it('shades the Saturdays and Sundays of November 2026, joining a Saturday to the Sunday after it', () => {
    expect(spans(shadeRects(weekends(), NOV))).toEqual([[8, 1], [14, 2], [21, 2], [28, 2], [35, 2]]);
    expect(shadeRects(weekends(), NOV).every((r) => r.x === 1 && r.w === 26 && r.tone === 'L')).toBe(true);
  });

  it('draws a rule across the box between each Saturday and the next Sunday', () => {
    const lines = weekLines(weekends({ week_lines: 'thin' }), NOV);
    expect(lines.map((l) => l.y1)).toEqual([15, 22, 29, 36]);
    expect(lines.every((l) => l.x1 === 1 && l.x2 === 27 && l.y2 === l.y1 && l.weight === 'thin')).toBe(true);
    expect(weekLines(weekends(), NOV)).toEqual([]);
  });

  it('shades no days past the month’s end or the box’s end', () => {
    expect(shadeRects(weekends(), FEB).at(-1)).toMatchObject({ y: 34, h: 2 }); // Sat 27 and Sun 28 are the last
    expect(spans(shadeRects(weekends({ h: 10 }), NOV))).toEqual([[8, 1], [14, 2]]);
    expect(shadeRects(weekends(), null)).toEqual([]);
  });

  it('runs across with a step: one column per day, every cells wide', () => {
    const r = shadeRects(weekends({ direction: 'across', every: 2, w: 20, h: 3 }), NOV);
    expect(r.map((x) => [x.x, x.w])).toEqual([[1, 2], [13, 4]]); // Sun at 0, Sat+Sun at 6 and 7; the box ends at 10 days
    expect(weekLines(weekends({ direction: 'across', every: 2, w: 20, h: 3, week_lines: 'hair' }), NOV)).toEqual([{ x1: 15, y1: 8, x2: 15, y2: 11, weight: 'hair' }]);
  });

  it('is checked by the format', () => {
    expect(validateElement(weekends({ week_lines: 'thin', direction: 'across' }))).toEqual([]);
    expect(validateElement({ ...weekends(), week_lines: 'thick' }).map((i) => i.rule)).toEqual(['value']);
    expect(validateElement(seq('month_weekdays'))).toEqual([]);
  });
});

describe('the monthly tracker', () => {
  const page = monthlyTracker();
  const read = (m: string) => expandRead(sampleReading('month', m));

  it('is one design of 31 rows that reads any month', () => {
    expect(page.identity).toBe('{monthname} {year}');
    expect(page.elements.find((e) => e.type === 'shade')).toMatchObject({ y: 8, h: 31, weekends: true });
    expect(page.elements.filter((e) => e.type === 'sequence').map((e) => (e as Sequence).values)).toEqual(['month_days', 'month_weekdays']);
  });

  const texts = (month: string) => {
    const out: Item[] = [];
    layoutPage(page, { x: 0, y: 0, pageNumber: null, expand: read(month) }, out);
    return out.flatMap((i) => (i.k === 'text' ? [i.str] : []));
  };

  it('prints November 2026 as the old one did, apart from the empty 31st row', () => {
    const t = texts('2026-11-01');
    expect(t.filter((s) => /^\d+$/.test(s))).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
    expect(t.filter((s) => /^[SMTWF]$/.test(s)).slice(0, 8)).toEqual([...'SMTWTFSS']);
    const fills: Item[] = [];
    layoutPage(page, { x: 0, y: 0, pageNumber: null, expand: read('2026-11-01') }, fills);
    const shaded = fills.filter((i) => i.k === 'rect');
    expect(shaded).toHaveLength(5); // Nov 1, then four weekends
    // the screen draws the same: the same rectangles, and the same letters
    expect(elementMarkup(page.elements.find((e) => e.type === 'shade')!, read('2026-11-01')).match(/<rect /g)).toHaveLength(5);
    expect(elementMarkup(page.elements.find((e) => e.type === 'sequence' && e.values === 'month_days')!, read('2026-11-01')).match(/<text/g)).toHaveLength(30);
  });

  it('prints December 2026 starting on a Tuesday, with 31 days', () => {
    const t = texts('2026-12-01');
    expect(t.filter((s) => /^\d+$/.test(s))).toHaveLength(31);
    expect(t.filter((s) => /^[SMTWF]$/.test(s)).slice(0, 3)).toEqual(['T', 'W', 'T']);
  });
});
