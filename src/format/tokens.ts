import { addDays, dateValues } from './dates';

export const TOKENS = ['weekday', 'month', 'monthname', 'day', 'year', 'week', 'months'] as const;
export type Token = (typeof TOKENS)[number];

/** The date the editor shows tokens for: a Monday in week 44 of 2026. */
export const SAMPLE_DATE = '2026-10-26';

// {name} or {name+3} / {name-1}: a token, optionally moved by whole days.
const TOKEN_RE = /\{([^{}]*)\}/g;
const NAMED_RE = /^([a-z]+)([+-]\d{1,4})?$/;

export function isToken(name: string): name is Token {
  return (TOKENS as readonly string[]).includes(name);
}

/** Splits the inside of the braces into a known token and its day offset, or null if it isn't one. */
export function parseToken(inner: string): { token: Token; offset: number } | null {
  const m = NAMED_RE.exec(inner);
  return m && isToken(m[1]) ? { token: m[1], offset: m[2] ? Number(m[2]) : 0 } : null;
}

/** What is inside the braces, for each {token} that is not known. */
export function findUnknownTokens(text: string): string[] {
  const unknown: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) if (!parseToken(m[1])) unknown.push(m[1]);
  return unknown;
}

/** Replace known tokens with their values on `date` (plus any offset). Unknown tokens are left as typed. */
export function expandTokens(text: string, date: string = SAMPLE_DATE): string {
  return text.replace(TOKEN_RE, (whole, inner: string) => {
    const t = parseToken(inner);
    return t ? dateValues(t.offset ? addDays(date, t.offset) : date)[t.token] : whole;
  });
}

/** For print when there is no date: a known token is left empty, so the date can be written in by hand. Unknown tokens are left as typed. */
export const blankTokens = (text: string) => text.replace(TOKEN_RE, (whole, inner: string) => (parseToken(inner) ? '' : whole));

/** How a page with this date (or none) turns tokens into text. */
export const expandFor = (date: string | null): ((text: string) => string) => (date ? (text) => expandTokens(text, date) : blankTokens);
