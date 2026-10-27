import { addDays, addMonths, dateValues, sundayOf } from './dates';
import type { Page } from './types';

export const TOKENS = ['weekday', 'month', 'monthname', 'day', 'year', 'week', 'months'] as const;
export type Token = (typeof TOKENS)[number];

/** The date the editor shows tokens for: a Monday in week 44 of 2026. */
export const SAMPLE_DATE = '2026-10-26';

// {name}, {name+3} / {name-1} (moved by whole units of the token's own kind) or {name@end} (the last day of what the page covers).
const TOKEN_RE = /\{([^{}]*)\}/g;
const NAMED_RE = /^([a-z]+)([+-]\d{1,4})?(@end)?([+-]\d{1,4})?$/;

export type TokenRef = { token: Token; offset: number; end: boolean };

/** What a page covers: one 'day', or the 'week' holding its date (week start Sunday). */
export type PageKind = 'day' | 'week';

export function isToken(name: string): name is Token {
  return (TOKENS as readonly string[]).includes(name);
}

/** Splits the inside of the braces into a known token, its offset and whether it ends in @end; null if it isn't one (or is @end with an offset). */
export function parseToken(inner: string): TokenRef | null {
  const m = NAMED_RE.exec(inner);
  if (!m || !isToken(m[1])) return null;
  const offset = m[2] ?? m[4];
  if (m[3] && offset) return null; // @end takes no offset
  return { token: m[1], offset: offset ? Number(offset) : 0, end: !!m[3] };
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
    ...findEndOffsets(text).map((b) => `{${b}}: @end takes no offset (it reads the last day of what the page covers); write {${b.replace(/[+-]\d+/, '')}} or an offset without @end`),
  ];
  return reasons.length ? reasons.join('; ') : null;
}

/** The known tokens as they are typed, for messages. */
export const TOKEN_LIST = TOKENS.map((t) => `{${t}}`).join(' ');

/**
 * The day a token reads: the page's first day for a week page, moved by `offset` in the token's own unit (months for
 * month, years for year, weeks for week, days for the rest), or, with @end, the last day of what the page covers.
 */
function readDay(ref: TokenRef, date: string, kind: PageKind): string {
  const first = kind === 'week' ? sundayOf(date) : date;
  if (ref.end) return kind === 'week' ? addDays(first, 6) : date;
  switch (ref.token) {
    case 'month': case 'monthname': return addMonths(first, ref.offset);
    case 'year': return addMonths(first, ref.offset * 12);
    case 'week': return addDays(first, ref.offset * 7);
    default: return addDays(first, ref.offset);
  }
}

/** What one token says on a stored date, for a page of this kind. */
export const tokenValue = (ref: TokenRef, date: string, kind: PageKind = 'day'): string => dateValues(readDay(ref, date, kind))[ref.token];

/** Replace known tokens with their values on `date` for a page of `kind`. Unknown tokens are left as typed. */
export function expandTokens(text: string, date: string = SAMPLE_DATE, kind: PageKind = 'day'): string {
  return text.replace(TOKEN_RE, (whole, inner: string) => {
    const t = parseToken(inner);
    return t ? tokenValue(t, date, kind) : whole;
  });
}

/** For print when there is no date: a known token is left empty, so the date can be written in by hand. Unknown tokens are left as typed. */
export const blankTokens = (text: string) => text.replace(TOKEN_RE, (whole, inner: string) => (parseToken(inner) ? '' : whole));

/** How a page with this date (or none) turns tokens into text. Without the page it reads as a day page. */
export const expandFor = (date: string | null, page?: Page | null): ((text: string) => string) => {
  const kind = page ? pageKind(page) : 'day';
  return date ? (text) => expandTokens(text, date, kind) : blankTokens;
};

/** The editor's samples: the sample date, read the way the page's kind reads it. */
export const sampleFor = (page: Page): ((text: string) => string) => expandFor(SAMPLE_DATE, page);

/** The tokens in some text. */
const tokensIn = (text: string) => [...text.matchAll(TOKEN_RE)].flatMap((m) => parseToken(m[1]) ?? []);

/** Every token a page prints: in its identity and in its text. */
export function pageTokens(page: Page): TokenRef[] {
  return [page.identity ?? '', ...page.elements.flatMap((el) => (el.type === 'text' ? [el.text] : []))].flatMap(tokensIn);
}

/** Whether a page prints anything from a date. A page that doesn't has no use for one. */
export const usesDates = (page: Page | null): boolean => !!page && pageTokens(page).length > 0;

/** Tokens that count in days; an offset of 6 or more reaches past one day. */
const DAY_UNITS: readonly Token[] = ['day', 'weekday', 'months'];

/**
 * What a page covers until the calendar decides (docs/product-model.md, D15): a week page if its tokens include {week},
 * any @end, or a day offset of 6 or more; otherwise a day page.
 */
export const pageKind = (page: Page): PageKind =>
  pageTokens(page).some((t) => t.token === 'week' || t.end || (DAY_UNITS.includes(t.token) && Math.abs(t.offset) >= 6)) ? 'week' : 'day';

/** The kind of a dated page, or null for one that prints no dates. */
export const pageSpan = (page: Page): PageKind | null => (usesDates(page) ? pageKind(page) : null);
