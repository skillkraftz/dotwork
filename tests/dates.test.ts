import { DEFAULT_PRINT } from '../src/book/impose';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bookExpand, dateOf, emptyBook, readBook, resizeBook, setDates, setSlot, type Book } from '../src/book/book';
import { datesSummary, endOfRun, planDates } from '../src/book/plan';
import { addDays, formatDate, isDate, sundayOf, weekNumber, weekStart } from '../src/format/dates';
import { blankTokens, expandFor, expandTokens, findUnknownTokens } from '../src/format/tokens';
import { emptyPage, type Page, type Sequence } from '../src/format/types';
import { validatePage } from '../src/format/validate';
import { Library, MemoryBackend, readLibraryFile } from '../src/library/library';
import { contactSheet } from '../src/print/contact';
import { exportBookFiles } from '../src/print/export';
import { pageContent } from '../src/render';
import { readPdf } from './pdf-text';
import { weeklyPage } from '../src/builtin/pages';
const weekly = weeklyPage('right', true);

const fonts = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };

describe('weeks and dates', () => {
  it('weeks run Sunday to Saturday and week 1 holds January 1', () => {
    expect(weekNumber('2026-10-18')).toBe(43);
    expect(weekNumber('2026-10-24')).toBe(43);
    expect(weekNumber('2026-10-25')).toBe(44);
    expect(weekStart(2026, 43)).toBe('2026-10-18');
    expect(weekStart(2027, 1)).toBe('2026-12-27'); // January 1 2027 is a Friday
    expect(weekNumber('2026-12-27')).toBe(1);
    expect(weekNumber('2027-01-02')).toBe(1);
    expect(weekNumber('2026-12-26')).toBe(52);
    expect(weekNumber('2026-01-01')).toBe(1);
    expect(weekStart(2026, 1)).toBe('2025-12-28');
    expect(sundayOf('2026-10-21')).toBe('2026-10-18');
  });

  it('recognises only real calendar days written YYYY-MM-DD', () => {
    for (const ok of ['2026-10-18', '2028-02-29']) expect(isDate(ok), ok).toBe(true);
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-1', '26-10-18', '2026-10-18T00:00', '', null, 20261018]) expect(isDate(bad), String(bad)).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatDate('2026-10-18')).toBe('Sun Oct 18, 2026');
  });
});

describe('tokens with offsets', () => {
  it('expands as before from the sample date, Monday 2026-10-26', () => {
    expect(expandTokens('{weekday} {month} {monthname} {day} {year} {week}')).toBe('MON OCT OCTOBER 26 2026 44');
  });

  it('moves a token by whole days', () => {
    expect(expandTokens('{day+1} {weekday+6} {day-1} {weekday-1}')).toBe('27 SUN 25 SUN');
    expect(expandTokens('{day+6}', '2026-10-18')).toBe('24');
    expect(expandTokens('{weekday}', '2026-10-18')).toBe('SUN');
  });

  it('says NOV / DEC when the 7 days from the date reach the next month', () => {
    expect(expandTokens('{months}', '2026-10-18')).toBe('OCT');
    expect(expandTokens('{months}', '2026-11-29')).toBe('NOV / DEC');
    expect(expandTokens('{months}', '2026-11-24')).toBe('NOV'); // 24..30
    expect(expandTokens('{months}', '2026-11-25')).toBe('NOV / DEC'); // 25..Dec 1
    expect(expandTokens('{months}', '2026-12-27')).toBe('DEC / JAN');
    expect(expandTokens('{months+7}', '2026-11-22')).toBe('NOV / DEC');
  });

  it('knows which names are tokens; offsets must be whole numbers', () => {
    expect(findUnknownTokens('{day+1} {months} {weekday-3}')).toEqual([]);
    expect(findUnknownTokens('{day+x} {day+} {nope+1} {day +1} {day+1.5}')).toEqual(['day+x', 'day+', 'nope+1', 'day +1', 'day+1.5']);
    expect(expandTokens('{day+x}')).toBe('{day+x}');
  });

  it('prints blank without a date', () => {
    expect(blankTokens('{day} of {months} {day+1}')).toBe(' of  ');
    expect(expandFor(null)('{day}')).toBe('');
    expect(expandFor('2026-10-18')('{day}')).toBe('18');
  });
});

const dated = (): Page => ({ ...weekly, side: 'right' });
const digits = (strings: string[]) => strings.filter((s) => /\d/.test(s));

describe('book dates', () => {
  it('sets and clears dates on pages; a book with none has no list', () => {
    const b = emptyBook(8);
    expect(b.dates).toBeUndefined();
    setDates(b, 2, ['2026-10-18', '2026-10-25']);
    expect(b.dates).toEqual([null, '2026-10-18', '2026-10-25', null, null, null, null, null]);
    expect([0, 1, 2, 3, 9].map((n) => dateOf(b, n))).toEqual([null, null, '2026-10-18', '2026-10-25', null]);
    setDates(b, 2, [null, null]);
    expect(b.dates).toBeUndefined();
    setDates(b, 7, ['2026-01-01', '2026-01-08', '2026-01-15']); // past the end is ignored
    expect(b.dates?.slice(6)).toEqual(['2026-01-01', '2026-01-08']);
  });

  it('keeps dates through resize', () => {
    const b = emptyBook(8);
    setDates(b, 1, planDates({ mode: 'day', start: '2026-10-18' }, 8)!);
    resizeBook(b, 12);
    expect(b.dates).toHaveLength(12);
    expect(b.dates?.[7]).toBe('2026-10-25');
    expect(b.dates?.[8]).toBeNull();
    resizeBook(b, 4);
    expect(b.dates).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
  });

  it('keeps dates through save and load, and a book without them still loads', async () => {
    const b = emptyBook(8);
    setDates(b, 3, ['2026-10-18']);
    const r = readBook(JSON.parse(JSON.stringify(b)));
    expect(r.ok && r.book.dates).toEqual(b.dates);
    const plain = JSON.parse(JSON.stringify(emptyBook(8)));
    expect('dates' in plain).toBe(false);
    const p = readBook(plain);
    expect(p.ok && p.book.dates).toBeUndefined();

    const lib = new Library(new MemoryBackend());
    const item = await lib.save('book', 'Dated', b);
    expect((item.data as Book).dates).toEqual(b.dates);
    const back = readLibraryFile(JSON.parse(JSON.stringify(await lib.exportAll())));
    expect(back.ok).toBe(true);
  });

  it('rejects bad dates, saying where', () => {
    const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(emptyBook(8)));
    const issues = (dates: unknown) => { const r = readBook({ ...base(), dates }); return r.ok ? [] : r.issues.map((i) => `${i.rule}:${i.path}`); };
    expect(issues(['2026-02-30', ...Array(7).fill(null)])).toEqual(['dates:dates[0]']);
    expect(issues([...Array(7).fill(null), 'tomorrow'])).toEqual(['dates:dates[7]']);
    expect(issues([...Array(7).fill(null), 20261018])).toEqual(['dates:dates[7]']);
    expect(issues(Array(7).fill(null))).toEqual(['dates:dates']); // wrong length
    expect(issues('2026-10-18')).toEqual(['dates:dates']);
    expect(issues(Array(8).fill(null))).toEqual([]);
  });

  it('plans a week or a day for each page, and says so', () => {
    expect(planDates({ mode: 'week', year: 2026, week: 43 }, 3)).toEqual(['2026-10-18', '2026-10-25', '2026-11-01']);
    expect(planDates({ mode: 'day', start: '2026-12-30' }, 4)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(planDates({ mode: 'day', start: '2026-02-30' }, 2)).toBeNull();
    expect(planDates({ mode: 'week', year: 2026, week: 0 }, 2)).toBeNull();
    expect(datesSummary({ mode: 'week', year: 2026, week: 43 }, 1, 10)).toBe('Pages 1–10 become weeks 43–52: Oct 18 – Dec 26');
    expect(datesSummary({ mode: 'week', year: 2026, week: 43 }, 5, 5)).toBe('Page 5 becomes week 43: Oct 18 – Oct 24');
    expect(datesSummary({ mode: 'day', start: '2026-10-18' }, 1, 7)).toBe('Pages 1–7 become days: Oct 18 – Oct 24');
    expect(datesSummary({ mode: 'day', start: '2026-12-30' }, 1, 4)).toBe('Pages 1–4 become days: Dec 30, 2026 – Jan 2, 2027');
  });

  it('finds the end of the run of pages sharing a design', () => {
    const b = emptyBook(12);
    const week = dated();
    for (let n = 1; n <= 10; n++) setSlot(b, n, week);
    expect(endOfRun(b, 1)).toBe(10);
    expect(endOfRun(b, 4)).toBe(10);
    expect(endOfRun(b, 11)).toBe(12); // two blank pages
  });

  it('gives each slot its own date for tokens, and covers none', () => {
    const b = emptyBook(8);
    setDates(b, 1, ['2026-10-18']);
    expect(bookExpand(b, 1)('{day}')).toBe('18');
    expect(bookExpand(b, 2)('{day}')).toBe('');
    expect(bookExpand(b, 0)('{day}')).toBe('');
  });
});

describe('the dated weekly example', () => {
  it('is a valid page whose labels run from the week’s Sunday', () => {
    expect(validatePage(weekly)).toEqual([]);
    const text = weekly.elements.flatMap((e) => (e.type === 'text' ? [e.text] : []));
    expect(text).toEqual(expect.arrayContaining(['{weekday}', '{weekday+6}', '{day}', '{day+6}']));
    expect(weekly.identity).toBe('{months}');
  });
});

describe('an exported dated book', () => {
  const book = (): Book => {
    const b = emptyBook(52);
    for (let n = 1; n <= 10; n++) setSlot(b, n, dated());
    setDates(b, 1, planDates({ mode: 'week', year: 2026, week: 43 }, 10)!);
    return b;
  };

  it('fills each page’s tokens from its own date; undated pages have no digits', async () => {
    const files = await exportBookFiles(book(), DEFAULT_PRINT, fonts);
    const pages = await readPdf(files.find((f) => f.name === 'pages.pdf')!.bytes);
    expect(pages).toHaveLength(52);
    const first = pages[0].strings;
    expect(first).toEqual(expect.arrayContaining(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'OCT']));
    expect(first.filter((s) => /^\d+$/.test(s))).toEqual(['18', '19', '20', '21', '22', '23', '24', '1']); // days, then page number 1
    // week 7 starts Nov 29 and runs into December
    expect(pages[6].strings).toContain('NOV / DEC');
    expect(pages[6].strings.filter((s) => /^\d+$/.test(s))).toEqual(['29', '30', '1', '2', '3', '4', '5', '7']);
    // pages 11 on are blank designs with no dates: nothing but their page numbers
    for (let n = 11; n <= 52; n++) expect(digits(pages[n - 1].strings), `page ${n}`).toEqual([String(n)]);
    // a dated page printed in the books’ print files says the same
    const sheets = (await Promise.all(['print-first.pdf', 'print-second.pdf'].map(async (f) => readPdf(files.find((x) => x.name === f)!.bytes)))).flat();
    const strings = sheets.flatMap((s) => s.strings);
    expect(strings.filter((s) => s === 'NOV / DEC')).toHaveLength(1);
    expect(strings.filter((s) => s === 'SUN')).toHaveLength(10);
  });

  it('prints a dated design blank when the page has no date', async () => {
    const b = book();
    setDates(b, 1, Array(10).fill(null));
    const files = await exportBookFiles(b, DEFAULT_PRINT, fonts, { pages: true, cover: false, signatures: false });
    const pages = await readPdf(files[0].bytes);
    expect(pages[0].strings).not.toContain('SUN');
    expect(pages[0].strings).toEqual(['GOAL', 'OUTCOME', '1']); // only the page's own words
  });

  it('draws thumbnails and the contact sheet from the dates', () => {
    const b = book();
    expect(pageContent(dated(), { mode: 'export', expand: bookExpand(b, 1) })).toContain('>18<');
    const sheet = contactSheet(b);
    expect(sheet.svg).toContain('>NOV / DEC<');
    expect(sheet.svg).toContain('>SAT<');
    expect(contactSheet(emptyBook(8)).svg).not.toContain('>SUN<');
  });
});

describe('rotated sequences', () => {
  const row = (rotate?: 0 | 90 | 270): Page => ({
    ...emptyPage(), identity: '',
    elements: [
      { type: 'sequence', x: 2, y: 3, count: 4, direction: 'across', every: 2, ...(rotate === undefined ? {} : { rotate }) } as Sequence,
      { type: 'sequence', x: 2, y: 6, count: 4, direction: 'across', every: 2, values: 'letters', ...(rotate === undefined ? {} : { rotate }) } as Sequence,
      { type: 'sequence', x: 2, y: 9, count: 3, direction: 'across', every: 2, values: 'icons', icons: ['sun', 'heart'], ...(rotate === undefined ? {} : { rotate }) } as Sequence,
      { type: 'sequence', x: 2, y: 12, count: 2, direction: 'across', every: 3, values: 'icons', icons: ['star'], size: 2, ...(rotate === undefined ? {} : { rotate }) } as Sequence,
    ],
  });

  it('validates 0, 90 and 270 only, without changing the bounds', () => {
    for (const r of [undefined, 0, 90, 270] as const) expect(validatePage(row(r)), String(r)).toEqual([]);
    const bad = row(); (bad.elements[0] as unknown as { rotate: number }).rotate = 45;
    expect(validatePage(bad).map((i) => i.rule)).toEqual(['value']);
  });

  it('turns every item about the center of its own cell in the SVG', () => {
    const svg = (r: 0 | 90 | 270) => pageContent(row(r), { mode: 'export' });
    expect(svg(0)).not.toContain('rotate(');
    // the first number sits in the cell at x 2..3, y 3..4: center (7.5, 10.5) mm
    expect(svg(90)).toContain('transform="rotate(-90 7.5 10.5)"');
    expect(svg(270)).toContain('transform="rotate(90 7.5 10.5)"');
    // the second number is two cells on
    expect(svg(90)).toContain('rotate(-90 13.5 10.5)');
    // an icon turns about its own cell (1 cell: 7.5, 28.5) and a 2 cell icon about the middle of its square (9, 39)
    expect(svg(90)).toContain('rotate(-90 7.5 28.5) translate(');
    expect(svg(270)).toContain('rotate(90 9 39) translate(');
  });

  it('prints rotated text rotated, and keeps the same text', async () => {
    const out = async (r: 0 | 90 | 270) => {
      const b = emptyBook(8); b.page_numbers = false; setSlot(b, 1, row(r));
      const files = await exportBookFiles(b, DEFAULT_PRINT, fonts, { pages: true, cover: false, signatures: false });
      return (await readPdf(files[0].bytes))[0];
    };
    const [plain, up, down] = [await out(0), await out(90), await out(270)];
    expect(up.strings).toEqual(plain.strings);
    expect(down.strings).toEqual(plain.strings);
    // a text matrix with a 90° turn is  0 1 -1 0 ; down is  0 -1 1 0
    const turns = (content: string, a: number, b: number) => [...content.matchAll(/(-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) Tm/g)]
      .filter((m) => Math.abs(+m[1]) < 1e-6 && Math.round(+m[2]) === a && Math.round(+m[3]) === -a && Math.abs(+m[4]) < 1e-6 && b === b).length;
    expect(turns(plain.content, 1, 0)).toBe(0);
    expect(turns(up.content, 1, 0)).toBe(8);
    expect(turns(down.content, -1, 0)).toBe(8);
  });

  it('puts rotated PDF text on the baseline of its own cell, centered on the cell', async () => {
    const b = emptyBook(8); b.page_numbers = false;
    for (const r of [90, 270] as const) setSlot(b, r === 90 ? 1 : 3, row(r));
    const [file] = await exportBookFiles(b, DEFAULT_PRINT, fonts, { pages: true, cover: false, signatures: false });
    const pages = await readPdf(file.bytes);
    const mm = (v: number) => v * 72 / 25.4;
    // The first number "1" sits in cell x 2, y 3 (center 7.5, 10.5 mm from the grid corner, which is 3.95, 3.85 from the page's).
    const start = (content: string) => { const m = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/.exec(content)!; return { x: +m[5], y: +m[6] }; };
    const cx = 3.95 + 7.5, cy = 139.7 - (3.85 + 10.5), down = 3 - 0.6 - 1.5; // baseline is 0.9 mm below the cell's middle
    const up = start(pages[0].content), dn = start(pages[2].content);
    expect(up.x).toBeCloseTo(mm(cx + down), 1);   // reads bottom to top: the baseline is right of the middle
    expect(dn.x).toBeCloseTo(mm(cx - down), 1);   // reads top to bottom: the baseline is left of it
    expect(up.y).toBeLessThan(mm(cy));            // starts below the middle and runs up to it
    expect(dn.y).toBeGreaterThan(mm(cy));         // starts above the middle and runs down
    expect(mm(cy) - up.y).toBeLessThan(mm(2));
    expect(dn.y - mm(cy)).toBeLessThan(mm(2));
  });
});
