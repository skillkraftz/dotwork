import type { Page, PageElement, PageSide, Pattern, Rule, Sequence, Text } from '../format/types';
import { dayOfWeek } from '../format/dates';
import { MONTH_ABBR, MONTH_NAMES, daysInMonth, monthStarts } from './calendar';

// Built-in pages, drawn in code so the ones that depend on a date (a month's tracker, a year's index) can be
// made for any year. Positions are in cells; see docs/page-format.md. Gray text, hair lines and thin rules are
// the defaults, so only what differs is written out.

export const makePage = (name: string, side: PageSide, identity: string, elements: PageElement[], cover = false): Page => ({
  format: 'dotwork-page', version: 2, name, side, identity,
  ...(cover ? { page_number: false } : {}),
  grid: { cols: 27, rows: 44, pitch_mm: 3 }, elements,
});

const hrule = (y: number, x1 = 0, x2 = 27, weight: Rule['weight'] = 'thin'): Rule => ({ type: 'rule', x1, y1: y, x2, y2: y, weight });
const vrule = (x: number, y1: number, y2: number, weight: Rule['weight'] = 'thin'): Rule => ({ type: 'rule', x1: x, y1, x2: x, y2, weight });
const lines = (x: number, y: number, w: number, h: number): Pattern => ({ type: 'pattern', pattern: 'lines', x, y, w, h });
const label = (x: number, y: number, text: string, more: Partial<Text> = {}): Text => ({ type: 'text', x, y, text, ...more });

/** A labelled block of writing lines from row y0 to y1, set off by a black rule above it. */
const section = (y0: number, y1: number, text: string, x = 0, w = 27): PageElement[] => [lines(x, y0, w, y1 - y0), hrule(y0, x, x + w), label(x, y0, text)];

// ---- plain pages ------------------------------------------------------------------

export const blankPage = (): Page => makePage('Blank', 'either', '', []);

export const notesPage = (): Page => makePage('Notes', 'either', 'NOTES', [lines(0, 1, 27, 43), hrule(1)]);

// ---- reflections and reviews -----------------------------------------------------------

/** The Good Time Journal's weekly page: what engaged, drained and surprised me, a top and low entry, and what to change. */
export function weeklyReflection(identity = 'WEEK {week}  {month} {day}-{month+6} {day+6}'): Page {
  const aeiou = (y: number): PageElement[] => [
    { type: 'sequence', x: 0, y: y + 1, count: 5, values: 'list', list: ['A', 'E', 'I', 'O', 'U'], tone: 'black' } as Sequence,
    ...['ctivities', 'nvironments', 'nteractions', 'bjects', 'sers'].map((t, i) => label(1, y + 1 + i, t)),
  ];
  return makePage('Weekly reflection', 'either', identity, [
    ...section(1, 11, 'what engaged and energized me'),
    ...section(11, 19, 'what drained me'),
    ...section(19, 26, 'what surprised me'),
    ...section(26, 32, 'top entry'), ...aeiou(26),
    ...section(32, 38, 'low entry'), ...aeiou(32),
    ...section(38, 41, 'one thing to do more of'),
    ...section(41, 44, 'one thing to do less of'),
    hrule(44),
  ]);
}

/** The month review: patterns, then takeaways. */
export const patternsPage = (identity = '{monthname} REVIEW'): Page =>
  makePage('Patterns & takeaways', 'either', identity, [...section(1, 22, 'patterns'), ...section(22, 44, 'takeaways')]);

/** A list of questions with a box beside every other line, to tick the ones moved to a book-notes journal. */
export const questionsPage = (identity = '{monthname} QUESTIONS'): Page => makePage('Questions', 'either', identity, [
  lines(1, 2, 26, 42),
  hrule(1),
  { type: 'checkboxes', x: 0, y: 1, count: 1 },
  label(1, 1, '= moved to a book-notes journal'),
  { type: 'checkboxes', x: 0, y: 2, count: 21, every: 2 },
]);

// ---- book notes --------------------------------------------------------------------------

/** Set up a book-notes journal: what the book is, why read it and what to look for. */
export const bookNotesSetup = (): Page => makePage('Book notes setup', 'either', 'BOOK NOTES', [
  ...section(1, 3, 'Title:'), ...section(3, 5, 'Author:'), ...section(5, 7, 'Started:'), label(14, 5, 'Finished:'),
  ...section(7, 13, 'Why this book / question it answers'),
  ...section(13, 21, 'What I already think'),
  ...section(21, 29, 'What I hope to learn'),
  ...section(29, 44, 'Where to start'),
  hrule(44),
]);

/** A page of notes on a book: the page it came from in a margin column, and a line at the bottom for the takeaway. */
export const bookNotesPage = (): Page => makePage('Book notes', 'either', 'BOOK NOTES', [
  ...section(1, 3, 'Chapter:'),
  { type: 'shade', x: 0, y: 3, w: 3, h: 35, tones: 'L' },
  lines(3, 3, 24, 35),
  vrule(3, 3, 38, 'hair'),
  label(0, 3, 'page'),
  ...section(38, 44, 'so what? my takeaway'),
  hrule(44),
]);

// ---- the year planner's weekly pages ----------------------------------------------------------

/**
 * The year journal's weekly page: a lined area with a day column on the outer edge (the right of a right page, the
 * left of a left one) listing the seven days, a goal block above them and an outcome block below. Dated, the day
 * column fills in from the page's date, which should be its Sunday.
 */
export function weeklyPage(side: 'left' | 'right', dated: boolean): Page {
  const left = side === 'left';
  const col = left ? 0 : 25, text = left ? 2 : 0;
  const cx = col + 1, cy = col + 1.5;
  const els: PageElement[] = [
    { type: 'shade', tones: 'L', x: col, y: 9, w: 2, h: 4 },
    { type: 'shade', tones: 'L', x: col, y: 33, w: 2, h: 4 },
    lines(text, 1, 25, 43),
    ...[1, 9, 13, 17, 21, 25, 29, 33, 37].map((y) => hrule(y)),
    vrule(left ? 2 : 25, 1, 44),
    label(cy, 5, 'GOAL', { rotate: 270, align: 'center' }),
    label(cy, 40.5, 'OUTCOME', { rotate: 270, align: 'center' }),
  ];
  const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  for (let i = 0; i < 7; i++) {
    const day = dated ? (i ? `{day+${i}}` : '{day}') : String(i + 1);
    els.push(label(cx, 9 + 4 * i, dated ? (i ? `{weekday+${i}}` : '{weekday}') : names[i], { align: 'center' }));
    els.push(label(cx, 11 + 4 * i, day, { align: 'center', size: 'heading', style: 'bold', tone: 'black' }));
  }
  return makePage(dated ? 'Year journal weekly page (dated)' : 'Year journal weekly page', side, dated ? '{months}' : '', els);
}

// ---- sideways lists: year goals, indexes ----------------------------------------------------------

const rotated = (x: number, y: number, count: number, start: number): Sequence =>
  ({ type: 'sequence', x, y, count, direction: 'across', values: 'numbers', start, tone: 'black', rotate: 90 });

/** The year goals cover (inside front cover): a heading, a few lines, and the 52 weeks in four quarters to write goals down the columns of. */
export function yearGoals(year: number): Page {
  const els: PageElement[] = [
    label(0, 0, String(year), { size: 'heading', style: 'bold', tone: 'black' }),
    label(3, 0, 'goals'),
    lines(0, 1, 27, 6),
    { type: 'pattern', pattern: 'vlines', x: 1, y: 8, w: 26, h: 36 },
    hrule(25), hrule(43),
    rotated(1, 25, 13, 27), rotated(14, 25, 13, 40), rotated(1, 43, 13, 1), rotated(14, 43, 13, 14),
    { type: 'box', x: 0, y: 8, w: 27, h: 36, weight: 'thick' },
    hrule(26, 0, 27, 'thick'),
    vrule(1, 8, 44, 'thick'), vrule(14, 8, 26, 'thick'), vrule(14, 26, 44, 'thick'),
    label(0, 26, 'Q3', { rotate: 90, style: 'bold', tone: 'black' }), label(14, 25, 'Q4', { rotate: 90, style: 'bold', tone: 'black' }),
    label(0, 44, 'Q1', { rotate: 90, style: 'bold', tone: 'black' }), label(14, 43, 'Q2', { rotate: 90, style: 'bold', tone: 'black' }),
  ];
  return makePage('Year goals cover', 'left', '', els, true);
}

/**
 * A sideways list of the book's 52 pages or weeks, one numbered column each: 1 to 26 along the bottom half, 27 to 52
 * along the top. Fill the columns by writing up them. With a year, the weeks are grouped by month; with labels, each
 * column already says something.
 */
function indexPage(name: string, side: 'left' | 'right', o: { year?: number; labels?: (string | null)[]; cover?: boolean } = {}): Page {
  const els: PageElement[] = [];
  const starts = o.year === undefined ? [] : monthStarts(o.year);
  for (const bottom of [false, true]) {
    const y0 = bottom ? 22 : 0, y1 = y0 + 22, first = bottom ? 1 : 27;
    els.push({ type: 'pattern', pattern: 'vlines', x: 0.5, y: y0, w: 26, h: 22 });
    els.push(hrule(y1 - 1, 0.5, 26.5));
    els.push(rotated(0.5, y1 - 1, 26, first));
    starts.forEach((week, m) => {
      if (week === null || week < first || week >= first + 26) return;
      const x = 0.5 + week - first;
      if (week > first) els.push(vrule(x, y0, y1, 'thick'));
      els.push(label(x, y1 - 1, MONTH_ABBR[m], { rotate: 90 }));
    });
    for (let c = 0; c < 26; c++) {
      const text = o.labels?.[first - 1 + c];
      if (text) els.push(label(0.5 + c, y1 - 1, text, { rotate: 90 }));
    }
    els.push({ type: 'box', x: 0.5, y: y0, w: 26, h: 22, weight: 'thick' });
  }
  return makePage(name, side, '', els, o.cover ?? true);
}

/** The year index (inside back cover): every week of the year in its month. */
export const yearIndex = (year: number): Page => indexPage('Year index', 'right', { year });

/** The plain-book index (inside back cover): 52 numbered columns to list what is on each page. */
export const plainIndex = (): Page => indexPage('Plain-book index', 'right');

/** The monthly journal's page index (inside back cover): what is on each of the 52 pages, listed in its column. */
export const monthlyPageIndex = (labels: (string | null)[]): Page => indexPage('Monthly page index', 'right', { labels });

/** The plain-book purpose cover (inside front cover): what the book is for, and when it is started and done. */
export function purposeCover(): Page {
  const cells = [['started', 0], ['p13', 5.5], ['p26', 11], ['p39', 16.5], ['done', 22]] as const;
  return makePage('Plain-book purpose cover', 'left', '', [
    lines(0, 0, 27, 3),
    label(0, 0, 'for:'),
    { type: 'shade', tones: 'L', x: 11, y: 4, w: 5.5, h: 2 },
    lines(0, 6, 27, 38),
    hrule(4, 0, 27, 'thick'), hrule(6, 0, 27, 'thick'),
    ...[5.5, 11, 16.5, 22].map((x) => vrule(x, 4, 6, 'hair')),
    ...cells.map(([t, x]) => label(x, 4, t)),
  ], true);
}

// ---- the monthly tracker --------------------------------------------------------------------------------

/**
 * The monthly tracker (inside front cover) for a real month: a numbered row for each day with its weekday letter
 * and the weekends shaded, a grid of habit columns, a column of sleep hours, and appointment lines. Everything is
 * concrete, so the day count, the weekday letters and the shading are right for that month.
 */
export function monthlyTracker(year: number, month: number): Page {
  const n = daysInMonth(year, month);
  const first = dayOfWeek(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`);
  const weekend = (i: number) => [0, 6].includes((first + i) % 7);
  const shades: PageElement[] = [];
  for (let i = 0; i < n; i++) {
    if (!weekend(i)) continue;
    const prev = shades[shades.length - 1];
    if (prev && prev.type === 'shade' && prev.y + prev.h === 8 + i) prev.h += 1;
    else shades.push({ type: 'shade', tones: 'L', x: 1, y: 8 + i, w: 26, h: 1 });
  }
  const letters = [...'SMTWTFS'];
  const rest = 36 - n; // rows left under the days for the times box
  return makePage('Monthly tracker', 'left', `${MONTH_NAMES[month - 1]} ${year}`, [
    ...shades,
    lines(15, 7, 12, n + 1),
    { type: 'pattern', pattern: 'grid', x: 1, y: 8, w: 14, h: n },
    lines(0, 8.5, 1, n),
    { type: 'pattern', pattern: 'vlines', x: 3, y: 1, w: 12, h: 7 },
    vrule(3, 1, 8, 'hair'),
    { type: 'pattern', pattern: 'vlines', x: 3, y: 8 + n, w: 12, h: rest },
    { type: 'box', x: 1, y: 8, w: 14, h: n, weight: 'thin' },
    { type: 'box', x: 0, y: 8.5, w: 1, h: n },
    { type: 'box', x: 3, y: 8 + n, w: 12, h: rest },
    label(15, 7, 'appointments'),
    label(0, 8, 'hrs sleep', { rotate: 90 }),
    label(2, 8, 'habits', { rotate: 90 }),
    label(2, 43, 'times', { rotate: 90 }),
    { type: 'sequence', x: 1, y: 8, count: n, values: 'numbers', tone: 'black' },
    { type: 'sequence', x: 2, y: 8, count: n, values: 'list', list: [...letters.slice(first), ...letters.slice(0, first)], tone: 'gray' },
  ]);
}
