import { addDays, addMonths, dateValues, monthEnd, parts, sundayOf, weekNumberIn } from './dates';
import type { Page, PageElement } from './types';

export const TOKENS = ['weekday', 'month', 'monthname', 'day', 'year', 'week', 'months'] as const;
export type Token = (typeof TOKENS)[number];

/** The date the editor shows tokens for: a Monday in week 44 of 2026. */
export const SAMPLE_DATE = '2026-10-26';

// {name}, {name+3} / {name-1} (moved by whole units of the token's own kind) {name@start} (the first day of what the page covers inside the calendar) or {name@end} (the last day).
const TOKEN_RE = /\{([^{}]*)\}/g;
const NAMED_RE = /^([a-z]+)([+-]\d{1,4})?(@start|@end)?([+-]\d{1,4})?$/;

export type TokenRef = { token: Token; offset: number; /** Reads the last day of what the page covers inside the calendar. */ end: boolean; /** Reads the first day inside the calendar. */ start: boolean };

/** What a page covers: one 'day', or the 'week' holding its date (week start Sunday). This is the editor's guess from the tokens; in a book the block's repeat decides (`Reading`). */
export type PageKind = 'day' | 'week';

/** What a book page covers: a day, a week or a month of the calendar. */
export type Unit = 'day' | 'week' | 'month';

/**
 * What a page in a book reads (docs/book-format.md, Tokens): a day, a week or a month, as the days of it inside the calendar
 * (`first` to `last`, so a partial week or month is shorter): `@start` reads `first` and `@end` reads `last`. A week page's plain tokens
 * count from the whole week's start (`from`, which may be before the calendar), so `{day+N}` is always the week's Nth day; a day that is
 * outside the calendar (`cal`) prints blank for the date tokens (not for `{weekday}` names, which label columns). `year` is the book's year, which
 * numbers the weeks; null (the editor's sample) numbers them by the week's Saturday.
 */
export interface Reading { kind: Unit; first: string; last: string; /** A week page's first day, even outside the calendar. */ from?: string; /** The calendar's first and last day; null for the editor's sample, where every day counts. */ cal?: { start: string; end: string } | null; weekStarts: number; year: number | null }

export function isToken(name: string): name is Token {
  return (TOKENS as readonly string[]).includes(name);
}

/** Splits the inside of the braces into a known token, its offset and whether it ends in @end; null if it isn't one (or is @end with an offset). */
export function parseToken(inner: string): TokenRef | null {
  const m = NAMED_RE.exec(inner);
  if (!m || !isToken(m[1])) return null;
  const offset = m[2] ?? m[4];
  if (m[3] && offset) return null; // @start and @end take no offset
  return { token: m[1], offset: offset ? Number(offset) : 0, end: m[3] === '@end', start: m[3] === '@start' };
}

/** True for `{day+1@end}` and the like: a known token, @end and an offset together. */
const isEndWithOffset = (inner: string) => {
  const m = NAMED_RE.exec(inner);
  return !!m && isToken(m[1]) && !!m[3] && !!(m[2] ?? m[4]);
};

/** What is inside the braces, for each {token} that is not known (an @end with an offset is not "unknown": see `findEndOffsets`). */
export function findUnknownTokens(text: string): string[] {
  const unknown: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) if (!parseToken(m[1]) && !isEndWithOffset(m[1])) unknown.push(m[1]);
  return unknown;
}

/** What is inside the braces, for each {token@end} that also has an offset. */
export const findEndOffsets = (text: string): string[] => [...text.matchAll(TOKEN_RE)].map((m) => m[1]).filter(isEndWithOffset);

/** The reason a text can't be used, in words, or null when its tokens are fine. */
export function tokenProblem(text: string): string | null {
  const reasons = [
    ...findUnknownTokens(text).map((b) => `Unknown token {${b}}`),
    ...findEndOffsets(text).map((b) => `{${b}}: @start and @end take no offset (they read the first or last day of what the page covers inside the calendar); write {${b.replace(/[+-]\d+/, '')}} or an offset without @start / @end`),
  ];
  return reasons.length ? reasons.join('; ') : null;
}

/** The known tokens as they are typed, for messages. */
export const TOKEN_LIST = TOKENS.map((t) => `{${t}}`).join(' ');

/** The sample reading of a date as a page of this kind: the day, its Sunday-to-Saturday week or its month. */
export function sampleReading(kind: Unit, date: string = SAMPLE_DATE): Reading {
  if (kind === 'week') return { kind, first: sundayOf(date), last: addDays(sundayOf(date), 6), weekStarts: 0, year: null };
  if (kind === 'month') return { kind, first: date.slice(0, 8) + '01', last: monthEnd(date), weekStarts: 0, year: null };
  return { kind, first: date, last: date, weekStarts: 0, year: null };
}

/**
 * The day a token reads: the reading's first day, moved by `offset` in the token's own unit (months for month, years for
 * year, weeks for week, days for the rest), or, with @end, its last day.
 */
function readDay(ref: TokenRef, r: Reading): string {
  if (ref.end) return r.last;
  if (ref.start) return r.first;
  const base = r.from ?? r.first;
  switch (ref.token) {
    case 'month': case 'monthname': return addMonths(base, ref.offset);
    case 'year': return addMonths(base, ref.offset * 12);
    case 'week': return addDays(base, ref.offset * 7);
    default: return addDays(base, ref.offset);
  }
}

/** What one token says for a reading (or, for a sample, a date read as a page of `kind`). */
export function tokenValue(ref: TokenRef, from: Reading | string, kind: PageKind = 'day'): string {
  const r = typeof from === 'string' ? sampleReading(kind, from) : from;
  const day = readDay(ref, r), v = dateValues(day);
  // A date that falls outside the calendar prints blank (a week page's days before or after it); names and numbers of weeks always print.
  const dated = ref.token === 'day' || (!ref.start && !ref.end && ref.offset === 0 && (ref.token === 'month' || ref.token === 'monthname' || ref.token === 'year'));
  if (dated && r.cal && (day < r.cal.start || day > r.cal.end)) return '';
  if (ref.token === 'week' && r.year !== null) return String(weekNumberIn(day, r.weekStarts, r.year));
  // A week or month that spans two months says both ("DEC / JAN"), the way a seven-day look ahead does.
  if (ref.token === 'months' && !ref.start && !ref.end && ref.offset === 0 && r.kind !== 'day') {
    const [a, b] = [parts(r.first).month, parts(r.last).month];
    return a === b ? dateValues(r.first).month : `${dateValues(r.first).month} / ${dateValues(r.last).month}`;
  }
  return v[ref.token];
}

/** Replace known tokens with their values for a reading (or a date, read as a page of `kind`). Unknown tokens are left as typed. */
export function expandTokens(text: string, from: Reading | string = SAMPLE_DATE, kind: PageKind = 'day'): string {
  return text.replace(TOKEN_RE, (whole, inner: string) => {
    const t = parseToken(inner);
    return t ? tokenValue(t, from, kind) : whole;
  });
}

/**
 * How text turns its tokens into what is printed. When the page is in a book it also says what the page reads (`read`: a reading, or null
 * for a page that reads nothing and prints blank), which a week block needs to draw the right days. A plain function (the editor's sample)
 * has no `read`.
 */
export type Expander = ((text: string) => string) & { read?: Reading | null };

/** For print when there is no date: a known token is left empty, so the date can be written in by hand. Unknown tokens are left as typed. */
export const blankTokens: Expander = Object.assign(
  (text: string) => text.replace(TOKEN_RE, (whole, inner: string) => (parseToken(inner) ? '' : whole)),
  { read: null },
);

/** How a book page turns tokens into text: by what its block reads, or, with no reading (no calendar), blank. */
export const expandRead = (read: Reading | null): Expander => (read ? Object.assign((text: string) => expandTokens(text, read), { read }) : blankTokens);

/** How a page with this date (or none) turns tokens into text. Without the page it reads as a day page. */
export const expandFor = (date: string | null, page?: Page | null): Expander => {
  const kind = page ? pageKind(page) : 'day';
  return date ? (text) => expandTokens(text, date, kind) : blankTokens;
};

/** The editor's samples: the sample date, read the way the page's kind reads it. */
export const sampleFor = (page: Page): Expander => expandFor(SAMPLE_DATE, page);

/** The tokens in some text. */
const tokensIn = (text: string) => [...text.matchAll(TOKEN_RE)].flatMap((m) => parseToken(m[1]) ?? []);

/** Whether a page has a week block: it reads a week, and prints its days whatever else it says. */
export const hasWeekBlock = (page: Page | null): boolean => !!page && page.elements.some((el) => el.type === 'generated' && el.kind === 'week');

/** Every token a page prints: in its identity and in its text, and in the pieces of a generated element. */
export function pageTokens(page: Page): TokenRef[] {
  const texts = (els: readonly PageElement[]): string[] => els.flatMap((el) => (el.type === 'text' ? [el.text] : el.type === 'generated' ? [el.goals, el.day, el.outcomes].flatMap((p) => texts(p.elements)) : []));
  return [page.identity ?? '', ...texts(page.elements)].flatMap(tokensIn);
}

/** Whether a page prints anything from a date. A page that doesn't has no use for one. */
export const usesDates = (page: Page | null): boolean => !!page && (hasWeekBlock(page) || pageTokens(page).length > 0);

/** Tokens that count in days; an offset of 6 or more reaches past one day. */
const DAY_UNITS: readonly Token[] = ['day', 'weekday', 'months'];

/**
 * What a page covers until the calendar decides (docs/product-model.md, D15): a week page if its tokens include {week},
 * any @end, or a day offset of 6 or more; otherwise a day page.
 */
export const pageKind = (page: Page): PageKind =>
  hasWeekBlock(page) || pageTokens(page).some((t) => t.token === 'week' || t.end || t.start || (DAY_UNITS.includes(t.token) && Math.abs(t.offset) >= 6)) ? 'week' : 'day';

/** The kind of a dated page, or null for one that prints no dates. */
export const pageSpan = (page: Page): PageKind | null => (usesDates(page) ? pageKind(page) : null);

/** Whether some text holds a token. */
export const hasTokens = (text: string): boolean => tokensIn(text).length > 0;

/**
 * The repeat a page (or both pages of a spread) suggests, from its tokens (docs/product-model.md, D13): `@start`, `@end` or a day offset of 6
 * or more is a week; `{weekday}` or `{day}` is a day (a `{week}` beside them is only extra); `{week}` alone is a week; any other
 * date token is a month. Null for a page that prints no dates.
 */
export function suggestUnit(...pages: (Page | null)[]): Unit | null {
  if (pages.some(hasWeekBlock)) return 'week';
  const t = pages.flatMap((p) => (p ? pageTokens(p) : []));
  if (!t.length) return null;
  if (t.some((x) => x.end || x.start || (DAY_UNITS.includes(x.token) && Math.abs(x.offset) >= 6))) return 'week';
  if (t.some((x) => x.token === 'day' || x.token === 'weekday')) return 'day';
  if (t.some((x) => x.token === 'week')) return 'week';
  return 'month';
}

const cap = (iso: string) => dateValues(iso);
/** A reading in words, in the page's own style: "SUN NOV 1", "NOV 1 – NOV 7", "NOVEMBER 2026". */
export function readingLabel(r: Reading): string {
  const day = (iso: string) => `${cap(iso).month} ${cap(iso).day}`;
  if (r.first === r.last) return `${cap(r.first).weekday} ${day(r.first)}`;
  if (r.kind === 'month') return `${cap(r.first).monthname} ${cap(r.first).year}`;
  return `${day(r.first)} – ${day(r.last)}`;
}

/**
 * What a page's first repeat prints, for the outline's "reads:" line: the header it prints when that has date tokens
 * ("SUN NOV 1"), otherwise the days it reads. Null for a page that prints no dates; words when there is nothing to read.
 */
export function readsText(page: Page | null, read: Reading | null, calendar: boolean | 'unplaced'): string | null {
  if (!page || !usesDates(page)) return null;
  if (!read) return calendar === 'unplaced' ? 'blank: not repeated by the calendar' : calendar ? 'outside the calendar' : 'blank, no calendar';
  return page.identity && hasTokens(page.identity) ? expandTokens(page.identity, read) : readingLabel(read);
}
