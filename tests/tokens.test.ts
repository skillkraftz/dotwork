import { describe, expect, it } from 'vitest';
import { weeklyReflection } from '../src/builtin/pages';
import { bookExpand, emptyBook, setDates, setSlot } from '../src/book/book';
import { readPage } from '../src/format/read';
import { expandFor, expandTokens, findEndOffsets, findUnknownTokens, pageKind, pageSpan, sampleFor, tokenProblem } from '../src/format/tokens';
import { emptyPage, type Page, type PageElement } from '../src/format/types';
import { findChangedTokens, changedTokensProblem } from '../src/library/tokennotice';
import { Library, MemoryBackend } from '../src/library/library';
import { emptySpread } from '../src/format/spread';

const text = (t: string): PageElement => ({ type: 'text', x: 0, y: 2, text: t });
const page = (identity: string, ...els: string[]): Page => ({ ...emptyPage(), name: 'P', identity, elements: els.map(text) });
const at = (date: string, kind: 'day' | 'week', t: string) => expandTokens(t, date, kind);

describe('token units', () => {
  it('counts days, weekdays and weeks in their own unit, positive and negative', () => {
    expect(at('2026-01-31', 'day', '{day+1}')).toBe('1');
    expect(at('2028-03-01', 'day', '{day-1}')).toBe('29'); // a leap year
    expect(at('2026-12-31', 'day', '{weekday+1}')).toBe('FRI');
    expect(at('2026-01-01', 'day', '{weekday-1}')).toBe('WED');
    expect(at('2026-10-26', 'day', '{week+1} {week-1}')).toBe('45 43');
    expect(at('2026-12-21', 'day', '{week+1}')).toBe('1'); // Dec 28 is in week 1 of 2027
    expect(at('2026-12-28', 'day', '{week-1}')).toBe('52');
  });

  it('counts months across month and year ends, clamping the day', () => {
    expect(at('2026-01-31', 'day', '{month+1}')).toBe('FEB'); // Jan 31 + 1 month is Feb 28
    expect(at('2026-01-31', 'day', '{monthname+1}')).toBe('FEBRUARY');
    expect(at('2026-03-31', 'day', '{month-1}')).toBe('FEB');
    expect(at('2026-12-15', 'day', '{month+1} {year+1}')).toBe('JAN 2027');
    expect(at('2026-01-10', 'day', '{month-1} {year-1}')).toBe('DEC 2025');
    expect(at('2026-10-26', 'day', '{month+14}')).toBe('DEC');
    expect(at('2026-10-26', 'day', '{month-10}')).toBe('DEC');
  });

  it('counts years, keeping Feb 29 on a Feb 28 in a common year', () => {
    expect(at('2028-02-29', 'day', '{year+1}')).toBe('2029');
    expect(at('2028-02-29', 'day', '{month} {year+1}')).toBe('FEB 2029'); // the month token is not moved by the year’s offset
    expect(at('2028-02-29', 'day', '{year-1}')).toBe('2027');
    expect(at('2028-02-29', 'day', '{year+4}')).toBe('2032');
    expect(at('2026-12-31', 'day', '{year+1}')).toBe('2027');
  });

  it('leaves {months} counting days', () => {
    expect(at('2026-11-22', 'day', '{months+7}')).toBe('NOV / DEC');
  });
});

describe('what a page covers', () => {
  it('is a week page for {week}, any @end, or a day offset of 6 or more; otherwise a day page', () => {
    expect(pageKind(page('{week}'))).toBe('week');
    expect(pageKind(page('{week+1}'))).toBe('week');
    expect(pageKind(page('{day@end}'))).toBe('week');
    expect(pageKind(page('{month@end}'))).toBe('week');
    expect(pageKind(page('', '{day+6}'))).toBe('week');
    expect(pageKind(page('', '{weekday-6}'))).toBe('week');
    expect(pageKind(page('{weekday} {day+5} {month+6} {year+1}'))).toBe('day');
    expect(pageKind(page('{months}'))).toBe('day');
    expect(pageKind(page('NOTES'))).toBe('day');
    expect(pageSpan(page('NOTES'))).toBeNull();
    expect(pageSpan(page('{week}'))).toBe('week');
  });

  it('reads the week holding its stored date, from Sunday', () => {
    const p = page('{weekday} {month} {day} {year} {week}', '{day+6} {weekday+6}');
    for (const stored of ['2026-10-25', '2026-10-28', '2026-10-31']) expect(expandFor(stored, p)('{weekday} {month} {day} {year} {week} {day+6} {weekday+6}')).toBe('SUN OCT 25 2026 44 31 SAT');
  });

  it('reads the week of Nov 29 2026 as NOV 29 – DEC 5', () => {
    const p = page('{month} {day} – {month@end} {day@end}');
    const expand = expandFor('2026-12-02', p);
    expect(expand(p.identity!)).toBe('NOV 29 – DEC 5');
    expect(expandFor('2026-11-29', p)(p.identity!)).toBe('NOV 29 – DEC 5');
    expect(expandFor('2026-12-05', p)(p.identity!)).toBe('NOV 29 – DEC 5');
  });

  it('prints the seven days of a week tracker, even the ones outside the month', () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => (i ? `{day+${i}}` : '{day}')).join(' ');
    const p = page('', days);
    expect(expandFor('2026-11-01', p)(days)).toBe('1 2 3 4 5 6 7');
    expect(expandFor('2026-12-03', p)(days)).toBe('29 30 1 2 3 4 5');
  });

  it('counts months, years and weeks from the week’s first day', () => {
    const p = page('{week}');
    expect(expandFor('2026-11-29', p)('{month+1} {year+1} {week+1}')).toBe('DEC 2027 50');
    expect(expandFor('2027-01-01', p)('{year} {year@end} {week} {week@end}')).toBe('2026 2027 1 1');
  });

  it('prints nothing without a date', () => {
    expect(expandFor(null, page('{week}'))('{month@end} {day@end}')).toBe(' ');
  });
});

describe('@end', () => {
  it('reads a day page’s own day', () => {
    expect(at('2026-10-28', 'day', '{weekday@end} {month@end} {day@end} {year@end}')).toBe('WED OCT 28 2026');
    expect(at('2026-10-28', 'day', '{week@end}')).toBe('44');
  });

  it('reads a week page’s last day', () => {
    expect(at('2026-10-28', 'week', '{weekday@end} {month@end} {monthname@end} {day@end} {year@end} {week@end}')).toBe('SAT OCT OCTOBER 31 2026 44');
    expect(at('2026-12-30', 'week', '{month@end} {day@end} {year@end}')).toBe('JAN 2 2027');
  });

  it('refuses an offset with it, with the reason', () => {
    expect(findEndOffsets('{day+1@end} {day@end+1} {day@end} {month-2@end}')).toEqual(['day+1@end', 'day@end+1', 'month-2@end']);
    expect(findUnknownTokens('{day+1@end} {day@end}')).toEqual([]);
    expect(expandTokens('{day+1@end}', '2026-10-28', 'week')).toBe('{day+1@end}');
    expect(tokenProblem('{day+1@end}')).toMatch(/@end takes no offset/);
    expect(tokenProblem('{day@end} {nope@end}')).toBe('Unknown token {nope@end}');
    for (const bad of ['{day+1@end}', '{day@end-1}']) {
      const r = readPage({ ...page(bad), identity: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues).toHaveLength(1);
        expect(r.issues[0]).toMatchObject({ rule: 'token', path: 'identity' });
        expect(r.issues[0].message).toMatch(/@end takes no offset/);
      }
    }
    const inText = readPage(page('', '{month+1@end}'));
    expect(inText.ok).toBe(false);
    expect(readPage(page('{day@end}', '{month@end} {day@end}')).ok).toBe(true);
  });
});

describe('the built-in Weekly reflection', () => {
  it('reads the week it is in, ending with @end', () => {
    const p = weeklyReflection();
    expect(p.identity).toBe('WEEK {week}  {month} {day}-{month@end} {day@end}');
    expect(pageSpan(p)).toBe('week');
    expect(sampleFor(p)(p.identity!)).toBe('WEEK 44  OCT 25-OCT 31');
    expect(expandFor('2026-12-01', p)(p.identity!)).toBe('WEEK 49  NOV 29-DEC 5');
    expect(readPage(p).ok).toBe(true);
  });

  it('prints in a book from the page’s stored date', () => {
    const book = emptyBook();
    setSlot(book, 1, weeklyReflection());
    setDates(book, 1, ['2026-12-03']);
    expect(bookExpand(book, 1)(book.pages[0]!.identity!)).toBe('WEEK 49  NOV 29-DEC 5');
  });
});

describe('the notice about changed tokens', () => {
  async function library() {
    let n = 0;
    const lib = new Library(new MemoryBackend(), undefined, () => `id${++n}`);
    await lib.create('page', 'Plan', page('{month+1} {day+1}', '{year+1}'));
    await lib.create('page', 'Fine', page('{month} {month+0} {day+3} {months+7} {month@end}'));
    const spread = emptySpread();
    spread.right = page('', 'a', '{week-1}');
    await lib.create('spread', 'Ideas', spread);
    const book = emptyBook();
    setSlot(book, 3, page('{monthname+2}'));
    book.cover.back = page('{year-1}');
    await lib.create('book', 'Journal', book);
    await lib.create('widget', 'Footer', { name: 'Footer', elements: [text('{week+2}')] });
    return lib;
  }

  it('lists each place, by document, page and element', async () => {
    const found = findChangedTokens(await (await library()).list());
    const lines = found.map((c) => [c.document, c.kind, c.page, c.element.split(' (')[0], c.text]);
    expect(lines).toContainEqual(['Plan', 'page', null, 'identity', '{month+1}']);
    expect(lines).toContainEqual(['Plan', 'page', null, 'element 1', '{year+1}']);
    expect(lines).toContainEqual(['Ideas', 'spread', 'right page', 'element 2', '{week-1}']);
    expect(lines).toContainEqual(['Journal', 'book', 'page 3', 'identity', '{monthname+2}']);
    expect(lines).toContainEqual(['Journal', 'book', 'inside back cover', 'identity', '{year-1}']);
    expect(lines).toContainEqual(['Footer', 'widget', null, 'element 1', '{week+2}']);
    expect(found.some((c) => c.document === 'Fine')).toBe(false); // {month+0}, {day+3}, {months+7}, {month@end} are not changed
    expect(found).toHaveLength(6);
  });

  it('says what changed, with every place in Copy details, and changes nothing', async () => {
    const lib = await library();
    const before = JSON.stringify(await lib.list());
    const problem = changedTokensProblem(findChangedTokens(await lib.list()))!;
    expect(problem.title).toBe('4 saved documents use {month±N}, {year±N} or {week±N}, whose meaning changed.');
    expect(problem.lines.join('\n')).toMatch(/count months, years and weeks/);
    expect(problem.lines).toHaveLength(7); // the note, five places, and "…and 1 more"
    expect(problem.details).toContain('Journal (book), inside back cover, identity: {year-1}');
    expect(problem.details).toContain('Footer (widget), element 1 (text “{week+2}”): {week+2}');
    expect(JSON.stringify(await lib.list())).toBe(before);
  });

  it('is silent when nothing uses them', async () => {
    const lib = new Library(new MemoryBackend());
    await lib.create('page', 'Fine', page('{month} {day+3}'));
    expect(changedTokensProblem(findChangedTokens(await lib.list()))).toBeNull();
  });
});
