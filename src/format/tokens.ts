export const TOKENS = ['weekday', 'month', 'monthname', 'day', 'year', 'week'] as const;
export type Token = (typeof TOKENS)[number];

export const SAMPLE_VALUES: Record<Token, string> = {
  weekday: 'MON',
  month: 'OCT',
  monthname: 'OCTOBER',
  day: '26',
  year: '2026',
  week: '44',
};

const TOKEN_RE = /\{([^{}]*)\}/g;

export function isToken(name: string): name is Token {
  return (TOKENS as readonly string[]).includes(name);
}

/** Names inside {braces} that are not known tokens. */
export function findUnknownTokens(text: string): string[] {
  const unknown: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) if (!isToken(m[1])) unknown.push(m[1]);
  return unknown;
}

/** Replace known tokens with sample values. Unknown tokens are left as typed. */
export function expandTokens(text: string, values: Record<Token, string> = SAMPLE_VALUES): string {
  return text.replace(TOKEN_RE, (whole, name: string) => (isToken(name) ? values[name] : whole));
}

/** For print: a known token is left empty, so the date can be written in by hand. Unknown tokens are left as typed. */
export const blankTokens = (text: string) => text.replace(TOKEN_RE, (whole, name: string) => (isToken(name) ? '' : whole));
