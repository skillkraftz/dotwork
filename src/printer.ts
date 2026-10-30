// The printer profile: what the Calibrate page finds out about a printer and its paper (offsets, rotation, scale, creep, fore-edge shifts, tones, and
// for each sheet layout how the paper is flipped and the offsets of each method and paper),
// kept in the browser and used for every book. A book file holds the design only (see docs/book-format.md).
import { PRINT_LIMITS, layoutIssues } from './book/book';
import { DEFAULT_METHOD, DEFAULT_PRINT, PRINT_METHODS, SHEET_LAYOUTS, clonePrint, everywhere, type LayoutSets, type PrintMethod, type PrintSettings, type SheetLayout } from './book/impose';
import type { ValidationIssue } from './format/validate';
import { errorProblem, issuesProblem, type Problem } from './problems';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const PRINTER_KEY = 'dotwork.printer';

/** The settings that every layout shares; the layouts' own print method, offsets, scale and rotation are in `print_method` and `layouts`. */
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
  const stored = isObject(o.layouts) ? o.layouts : {}, storedMethods = isObject(o.print_method) ? o.print_method : {};
  const layouts = {} as Record<SheetLayout, LayoutSets>, methods = {} as Record<SheetLayout, PrintMethod>;
  for (const layout of SHEET_LAYOUTS) {
    const m = storedMethods[layout];
    if (m !== undefined && !PRINT_METHODS.includes(m as never)) issues.push({ rule: 'print-setting', path: `print_method.${layout}`, message: `"print_method.${layout}" must be ${PRINT_METHODS.map((x) => `"${x}"`).join(' or ')}, got ${JSON.stringify(m)}.` });
    methods[layout] = (m as PrintMethod | undefined) ?? DEFAULT_METHOD[layout];
    const l = stored[layout], base = DEFAULT_PRINT.layouts[layout].hand.inside;
    if (l === undefined) { layouts[layout] = everywhere(base); continue; }
    if (!isObject(l)) { issues.push(...layoutIssues(l, `layouts.${layout}`)); continue; }
    // A profile saved before there were methods and papers holds one set of numbers for the layout: those become the inside paper's, for every method,
    // and the cover paper starts as a copy of them. Nothing is reset.
    if (!PRINT_METHODS.some((x) => x in l)) {
      const own = { ...base, ...l };
      issues.push(...layoutIssues(own, `layouts.${layout}`));
      layouts[layout] = everywhere(own);
      continue;
    }
    const sets = {} as LayoutSets;
    for (const method of PRINT_METHODS) {
      const m2 = isObject(l[method]) ? (l[method] as Record<string, unknown>) : {};
      const inside = { ...base, ...(isObject(m2.inside) ? m2.inside : {}) }, cover = { ...inside, ...(isObject(m2.cover) ? m2.cover : {}) };
      issues.push(...layoutIssues(inside, `layouts.${layout}.${method}.inside`), ...layoutIssues(cover, `layouts.${layout}.${method}.cover`));
      sets[method] = { inside, cover } as LayoutSets[PrintMethod];
    }
    layouts[layout] = sets;
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: clonePrint({ ...(o as unknown as PrintSettings), print_method: methods, layouts }) };
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

/**
 * The profile as it is kept: a layout still at the defaults is left out, so it keeps following them (a profile saved before a layout was
 * calibrated would otherwise hold that layout's old values for ever, and override the calibrated defaults). `readPrinter` puts them back.
 */
const atDefaults = (layout: SheetLayout, p: PrintSettings) => JSON.stringify(p.layouts[layout]) === JSON.stringify(DEFAULT_PRINT.layouts[layout]);
const stored = (settings: PrintSettings) => ({
  ...settings,
  layouts: Object.fromEntries(SHEET_LAYOUTS.filter((l) => !atDefaults(l, settings)).map((l) => [l, settings.layouts[l]])),
});

/** Keep the printer's settings. Returns what to tell the owner when the browser refuses, with its real reason; null when saved. */
export function savePrinter(storage: PrinterStorage | null, settings: PrintSettings): Problem | null {
  try {
    if (!storage) throw new Error('This browser does not allow saving settings (storage is blocked).');
    storage.setItem(PRINTER_KEY, JSON.stringify(stored(settings)));
    return null;
  } catch (err) {
    return errorProblem('This browser couldn’t keep your printer settings. They stay in use for this visit only.', err);
  }
}
