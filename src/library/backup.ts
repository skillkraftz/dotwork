// Back up and restore: one file with every document, the favorites and the printer profile (docs/library-format.md).
// Restoring only ever adds. Nothing is replaced or deleted.
import type { PrintSettings } from '../book/impose';
import type { Favorites } from './favorites';
import { readLibraryFile, type Library, type LibraryItem, type RefusedItem } from './library';
import { SHEET_LAYOUTS } from '../book/impose';
import { PRINTER_KEYS } from '../printer';
import type { Problem } from '../problems';
import { issuesProblem } from '../problems';
import type { ValidationIssue } from '../format/validate';

export interface RestoreSummary {
  added: number;
  /** Already here, with the same content. */
  skipped: number;
  /** Here under the same id with different content: the backup's copy was added as "<name> (from backup)". */
  keptBoth: number;
  refused: RefusedItem[];
  favoritesAdded: number;
  /** The backup's printer profile when it differs from the one in use; the person is asked before it replaces anything. */
  printer: PrintSettings | null;
  /** Why the backup's printer profile was not read, if it was not. */
  printerRefused: string | null;
}

/** JSON with sorted keys and no `name` (it is kept once, in the entry), so that two copies of a document compare equal. */
function canonical(v: unknown, top = true): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x, false)).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined && !(top && k === 'name')).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k], false)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
export const sameDocument = (a: LibraryItem, b: LibraryItem) => a.kind === b.kind && canonical(a.data) === canonical(b.data);
export const samePrinter = (a: PrintSettings, b: PrintSettings) => canonical(a) === canonical(b);

/**
 * Add what a backup file holds. A document whose id is here with the same content is skipped; with different content, the
 * backup's is added as "<name> (from backup)"; a new id is added (with " 2" on a name that is taken). Favorites are merged.
 * The printer profile is returned for the person to decide on, never applied here.
 */
export async function restoreBackup(library: Library, favorites: Favorites, input: unknown, currentPrinter: PrintSettings): Promise<{ ok: true; summary: RestoreSummary } | { ok: false; issues: ValidationIssue[] }> {
  const read = readLibraryFile(input);
  if (!read.ok) return read;
  const have = new Map((await library.list()).map((i) => [i.id, i]));
  const summary: RestoreSummary = { added: 0, skipped: 0, keptBoth: 0, refused: [...read.refused], favoritesAdded: 0, printer: null, printerRefused: read.printerRefused };
  for (const item of read.items) {
    try {
      const here = have.get(item.id);
      if (!here) {
        const added = await library.add(item);
        have.set(added.id, added);
        summary.added++;
      } else if (sameDocument(here, item)) {
        summary.skipped++;
      } else {
        // Same id, different content: both are kept, the backup's under a new id so that nothing here is touched.
        await library.add({ ...item, id: crypto.randomUUID() }, `${item.name} (from backup)`);
        summary.keptBoth++;
      }
    } catch (err) {
      summary.refused.push({ index: -1, id: item.id, name: item.name, kind: item.kind, reason: `The browser would not keep it: ${(err as Error).message || String(err)}` });
    }
  }
  summary.favoritesAdded = favorites.merge(read.favorites);
  if (read.printer && !samePrinter(read.printer, currentPrinter)) summary.printer = read.printer;
  return { ok: true, summary };
}

/** The summary as the message the Library shows, with the reasons for anything refused in Copy details. */
export function summaryProblem(file: string, s: RestoreSummary): Problem {
  const lines = [
    `Added ${s.added}.`,
    `Skipped ${s.skipped} (already here, the same).`,
    `Kept both ${s.keptBoth} (here, but different; the backup’s is added as “… (from backup)”).`,
    ...(s.favoritesAdded ? [`Added ${s.favoritesAdded} favorite${s.favoritesAdded === 1 ? '' : 's'}.`] : []),
    ...(s.refused.length ? [`Refused ${s.refused.length}: ${s.refused.slice(0, 3).map((r) => `“${r.name}” (${r.kind})`).join(', ')}${s.refused.length > 3 ? '…' : ''}. Copy details has the reasons.`] : []),
    ...(s.printerRefused ? ['The printer settings in the file were not read. Copy details has the reason.'] : []),
  ];
  const issues: ValidationIssue[] = [
    ...s.refused.map((r) => ({ rule: 'refused', path: `${r.kind} “${r.name}”`, message: r.reason })),
    ...(s.printerRefused ? [{ rule: 'refused', path: 'printer', message: s.printerRefused }] : []),
  ];
  const p = issuesProblem(`Restored ${file}`, issues);
  return { ...p, lines, details: [`Restored ${file}`, ...lines.slice(0, 3 + (s.favoritesAdded ? 1 : 0)), ...p.details.split('\n').slice(1)].join('\n') };
}

/** The printer settings as rows for the question: what each is now and what the backup has. */
export function printerRows(mine: PrintSettings, theirs: PrintSettings): { label: string; mine: string; theirs: string }[] {
  const val = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));
  const rows = [
    ...(['sheet_layout', ...PRINTER_KEYS] as const).map((k) => ({ label: k.replace(/_/g, ' '), mine: val(mine[k]), theirs: val(theirs[k]) })),
    ...SHEET_LAYOUTS.flatMap((layout) => Object.keys(mine.layouts[layout]).map((k) => ({
      label: `${layout} ${k.replace(/_/g, ' ')}`, mine: val((mine.layouts[layout] as unknown as Record<string, unknown>)[k]), theirs: val((theirs.layouts[layout] as unknown as Record<string, unknown>)[k]),
    }))),
  ];
  return rows;
}
