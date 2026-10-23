// The printer's settings: what the Calibrate page finds out about a printer and its paper (offsets, creep, fore-edge shifts, tones),
// kept in the browser so every new book starts from them. The book still carries its own copy in book.json.
import { PRINT_LIMITS, layoutIssues } from './book/book';
import { DEFAULT_PRINT, LAYOUT_NAMES, SHEET_LAYOUTS, clonePrint, type LayoutProfile, type PrintSettings } from './book/impose';
import type { ValidationIssue } from './format/validate';
import { errorProblem, issuesProblem, type Problem } from './problems';
import { LAYOUT_LABELS, PRINT_LABELS } from './print/settingstext';

export const PRINTER_KEY = 'dotwork.printer';

/** The print settings that belong to the printer; the number of signatures belongs to the book. */
export const PRINTER_KEYS = [
  'creep_per_sheet_mm', 'fore_edge_shift_mm', 'cover_fore_edge_shift_mm', 'target_fore_edge_margin_mm',
  'shade_light_pct', 'shade_medium_pct', 'shade_dark_pct', 'gray_text_pct',
] as const satisfies readonly (keyof PrintSettings)[];
/** The printer's settings: those above, which every layout shares, and the offsets and scale of each layout, with the layout in use. */
export type PrinterSettings = Pick<PrintSettings, (typeof PRINTER_KEYS)[number] | 'sheet_layout' | 'layouts'>;

/** The printer's part of a book's print settings (a copy). */
export const printerOf = (p: PrintSettings): PrinterSettings => {
  const c = clonePrint(p);
  return { ...(Object.fromEntries(PRINTER_KEYS.map((k) => [k, c[k]])) as Pick<PrintSettings, (typeof PRINTER_KEYS)[number]>), sheet_layout: c.sheet_layout, layouts: c.layouts };
};

/** Where it is kept: the browser's local storage, or anything shaped like it (tests use a plain object). */
export type PrinterStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Read what was stored: every setting a number within the book format's limits. */
export function readPrinter(data: unknown): { ok: true; value: PrinterSettings } | { ok: false; issues: ValidationIssue[] } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, issues: [{ rule: 'root-object', path: '(printer)', message: 'The printer settings must be a JSON object.' }] };
  const o = data as Record<string, unknown>, issues: ValidationIssue[] = [];
  for (const key of PRINTER_KEYS) {
    const { min, max } = PRINT_LIMITS[key], v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) issues.push({ rule: 'print-setting', path: key, message: `"${key}" must be a number from ${min} to ${max}, got ${JSON.stringify(v)}.` });
  }
  if (!SHEET_LAYOUTS.includes(o.sheet_layout as never)) issues.push({ rule: 'print-setting', path: 'sheet_layout', message: `"sheet_layout" must be ${SHEET_LAYOUTS.map((l) => `"${l}"`).join(' or ')}, got ${JSON.stringify(o.sheet_layout)}.` });
  const layouts = typeof o.layouts === 'object' && o.layouts !== null ? (o.layouts as Record<string, unknown>) : {};
  for (const layout of SHEET_LAYOUTS) issues.push(...layoutIssues(layouts[layout], `layouts.${layout}`));
  return issues.length ? { ok: false, issues } : { ok: true, value: printerOf(o as unknown as PrintSettings) };
}

export type PrinterLoad = { status: 'none' } | { status: 'ok'; value: PrinterSettings } | { status: 'bad'; problem: Problem };

/** The saved settings. Stored settings that can't be read are reported with the reason, and ignored. */
export function loadPrinter(storage: PrinterStorage | null): PrinterLoad {
  let raw: string | null;
  try { raw = storage?.getItem(PRINTER_KEY) ?? null; } catch (err) { return { status: 'bad', problem: errorProblem('This browser would not give back your printer settings.', err) }; }
  if (raw === null) return { status: 'none' };
  let issues: ValidationIssue[];
  try {
    const r = readPrinter(JSON.parse(raw));
    if (r.ok) return { status: 'ok', value: r.value };
    issues = r.issues;
  } catch (err) {
    issues = [{ rule: 'json', path: '(printer)', message: `The saved printer settings are not valid JSON: ${(err as Error).message}` }];
  }
  return { status: 'bad', problem: issuesProblem('Your saved printer settings couldn’t be read, so new books start from the defaults. Saving new settings replaces them.', issues) };
}

/** Keep the printer's settings. Returns what to tell the owner when the browser refuses, with its real reason; null when saved. */
export function savePrinter(storage: PrinterStorage | null, settings: PrintSettings): Problem | null {
  try {
    if (!storage) throw new Error('This browser does not allow saving settings (storage is blocked).');
    storage.setItem(PRINTER_KEY, JSON.stringify(printerOf(settings)));
    return null;
  } catch (err) {
    return errorProblem('This browser couldn’t keep your printer settings. They stay in this book, and book.json carries them.', err);
  }
}

/** The print settings a new book starts from: the defaults, with the printer's saved settings over them. */
export const startingPrint = (saved: PrinterSettings | null): PrintSettings => clonePrint({ ...DEFAULT_PRINT, ...saved });

/** Every setting of the printer, flat: its name in words and its value. Layout settings are named by their layout. */
export function printerEntries(p: PrinterSettings): [string, number | string][] {
  return [
    ...PRINTER_KEYS.map((k): [string, number | string] => [PRINT_LABELS[k], p[k]]),
    ['sheet layout', LAYOUT_NAMES[p.sheet_layout]],
    ...SHEET_LAYOUTS.flatMap((l) => (Object.keys(LAYOUT_LABELS) as (keyof LayoutProfile)[]).map((k): [string, number | string] => [`${LAYOUT_NAMES[l].toLowerCase()} ${LAYOUT_LABELS[k]}`, p.layouts[l][k]])),
  ];
}

/** The settings where the book's print settings differ from the printer's saved ones: the name, the book's value and the saved one. */
export function differing(book: PrintSettings, saved: PrinterSettings): { name: string; here: number | string; saved: number | string }[] {
  const mine = printerEntries(book), theirs = printerEntries(saved);
  return mine.flatMap(([name, here], i) => (here !== theirs[i][1] ? [{ name, here, saved: theirs[i][1] }] : []));
}
