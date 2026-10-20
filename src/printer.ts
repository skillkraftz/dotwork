// The printer's settings: what the Calibrate page finds out about a printer and its paper (offsets, paper thickness, tones),
// kept in the browser so every new book starts from them. The book still carries its own copy in book.json.
import { PRINT_LIMITS } from './book/book';
import { DEFAULT_PRINT, type PrintSettings } from './book/impose';
import type { ValidationIssue } from './format/validate';
import { errorProblem, issuesProblem, type Problem } from './problems';

export const PRINTER_KEY = 'dotwork.printer';

/** The print settings that belong to the printer; the number of signatures belongs to the book. */
export const PRINTER_KEYS = [
  'paper_thickness_mm', 'front_offset_x_mm', 'front_offset_y_mm', 'back_offset_x_mm', 'back_offset_y_mm',
  'shade_light_pct', 'shade_medium_pct', 'shade_dark_pct', 'gray_text_pct',
] as const satisfies readonly (keyof PrintSettings)[];
export type PrinterSettings = Pick<PrintSettings, (typeof PRINTER_KEYS)[number]>;

/** The printer's part of a book's print settings. */
export const printerOf = (p: PrintSettings): PrinterSettings => Object.fromEntries(PRINTER_KEYS.map((k) => [k, p[k]])) as PrinterSettings;

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
export const startingPrint = (saved: PrinterSettings | null): PrintSettings => ({ ...DEFAULT_PRINT, ...saved });

/** The settings where the book's print settings differ from the printer's saved ones. */
export const differing = (book: PrintSettings, saved: PrinterSettings): (typeof PRINTER_KEYS)[number][] => PRINTER_KEYS.filter((k) => book[k] !== saved[k]);
