// The printer profile: what the Calibrate page finds out about a printer and its paper (offsets, rotation, scale, creep, fore-edge shifts, tones),
// kept in the browser and used for every book. A book file holds the design only (see docs/book-format.md).
import { PRINT_LIMITS, layoutIssues } from './book/book';
import { SHEET_LAYOUTS, clonePrint, type PrintSettings } from './book/impose';
import type { ValidationIssue } from './format/validate';
import { errorProblem, issuesProblem, type Problem } from './problems';

export const PRINTER_KEY = 'dotwork.printer';

/** The settings that every layout shares; the layouts' own offsets, scale and rotation are in `layouts`. */
export const PRINTER_KEYS = [
  'creep_per_sheet_mm', 'fore_edge_shift_mm', 'cover_fore_edge_shift_mm', 'target_fore_edge_margin_mm',
  'shade_light_pct', 'shade_medium_pct', 'shade_dark_pct', 'gray_text_pct',
] as const satisfies readonly (keyof PrintSettings)[];

/** Where it is kept: the browser's local storage, or anything shaped like it (tests use a plain object). */
export type PrinterStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Read what was stored: every setting a number within its limits. */
export function readPrinter(data: unknown): { ok: true; value: PrintSettings } | { ok: false; issues: ValidationIssue[] } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, issues: [{ rule: 'root-object', path: '(printer)', message: 'The printer settings must be a JSON object.' }] };
  const o = data as Record<string, unknown>, issues: ValidationIssue[] = [];
  for (const key of PRINTER_KEYS) {
    const { min, max } = PRINT_LIMITS[key], v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) issues.push({ rule: 'print-setting', path: key, message: `"${key}" must be a number from ${min} to ${max}, got ${JSON.stringify(v)}.` });
  }
  if (!SHEET_LAYOUTS.includes(o.sheet_layout as never)) issues.push({ rule: 'print-setting', path: 'sheet_layout', message: `"sheet_layout" must be ${SHEET_LAYOUTS.map((l) => `"${l}"`).join(' or ')}, got ${JSON.stringify(o.sheet_layout)}.` });
  const layouts = typeof o.layouts === 'object' && o.layouts !== null ? (o.layouts as Record<string, unknown>) : {};
  // A profile saved before the back rotation or the line weight existed has none: that is no rotation and no change in weight, not a broken profile.
  for (const layout of SHEET_LAYOUTS) {
    const l = layouts[layout];
    if (typeof l === 'object' && l !== null && !Array.isArray(l)) {
      const profile = l as Record<string, unknown>;
      if (!('back_rotation_deg' in profile)) profile.back_rotation_deg = 0;
      if (!('line_weight_x_pct' in profile)) profile.line_weight_x_pct = 100;
    }
    issues.push(...layoutIssues(l, `layouts.${layout}`));
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: clonePrint(o as unknown as PrintSettings) };
}

export type PrinterLoad = { status: 'none' } | { status: 'ok'; value: PrintSettings } | { status: 'bad'; problem: Problem };

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
  return { status: 'bad', problem: issuesProblem('Your saved printer settings couldn’t be read, so the defaults are used. Saving new settings replaces them.', issues) };
}

/** Keep the printer's settings. Returns what to tell the owner when the browser refuses, with its real reason; null when saved. */
export function savePrinter(storage: PrinterStorage | null, settings: PrintSettings): Problem | null {
  try {
    if (!storage) throw new Error('This browser does not allow saving settings (storage is blocked).');
    storage.setItem(PRINTER_KEY, JSON.stringify(settings));
    return null;
  } catch (err) {
    return errorProblem('This browser couldn’t keep your printer settings. They stay in use for this visit only.', err);
  }
}
