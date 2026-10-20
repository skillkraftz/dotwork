// Drafts kept in the browser. A draft that can't be read is never thrown away or overwritten: it is copied to a backup
// key first, and the owner is told, shown why, and offered the draft as a file.
import type { ValidationIssue } from './format/validate';
import { errorProblem, issuesProblem, type Problem } from './problems';

/** The part of localStorage drafts use. */
export interface DraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type Reader<T> = (data: unknown) => { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export type DraftLoad<T> =
  | { status: 'none' }
  | { status: 'ok'; value: T }
  | { status: 'bad'; raw: string; issues: ValidationIssue[]; /** Where the copy is kept, or null if even that failed. */ backupKey: string | null; backupError?: unknown };

const BAD = '.bad.';

/** Every backup of a draft key, oldest first. */
export function backupsOf(storage: DraftStorage, key: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(key + BAD)) keys.push(k);
  }
  return keys.sort();
}

/** Copy a draft that can't be read to a key of its own, unless an identical copy is already kept. Never overwrites a backup. */
function backUp(storage: DraftStorage, key: string, raw: string, now: Date): { key: string | null; error?: unknown } {
  const have = backupsOf(storage, key);
  const same = have.find((k) => storage.getItem(k) === raw);
  if (same) return { key: same };
  let name = `${key}${BAD}${now.toISOString()}`;
  while (have.includes(name)) name += '+';
  try {
    storage.setItem(name, raw);
    return { key: name };
  } catch (error) {
    return { key: null, error };
  }
}

/** Read a draft. Anything stored but unreadable (not JSON, or breaking the format) is backed up and reported, never dropped. */
export function loadDraft<T>(storage: DraftStorage | null, key: string, read: Reader<T>, now = new Date()): DraftLoad<T> {
  let raw: string | null;
  try { raw = storage?.getItem(key) ?? null; } catch { return { status: 'none' }; }
  if (!raw || !storage) return { status: 'none' };
  let issues: ValidationIssue[];
  try {
    const r = read(JSON.parse(raw));
    if (r.ok) return { status: 'ok', value: r.value };
    issues = r.issues;
  } catch (err) {
    issues = [{ rule: 'json', path: '(draft)', message: `The saved draft is not valid JSON: ${(err as Error).message}` }];
  }
  const b = backUp(storage, key, raw, now);
  return { status: 'bad', raw, issues, backupKey: b.key, backupError: b.error };
}

/** The notice for a draft that couldn't be read. `label` is "book", "page", "left page"…; the actions are added by the caller. */
export function badDraftProblem(label: string, d: Extract<DraftLoad<unknown>, { status: 'bad' }>, actions: Problem['actions']): Problem {
  const p = issuesProblem(`Your saved ${label} draft couldn’t be opened, so it was not loaded.`, d.issues, actions);
  p.lines.unshift(d.backupKey ? 'Nothing was deleted: the draft is kept under a backup name in this browser. You can download it.' : 'The draft is still where it was, but a backup copy could not be made in this browser. Download it now.');
  p.details += `\n\nBackup key: ${d.backupKey ?? '(none)'}\n${d.backupError ? `Backup failed: ${(d.backupError as Error).message}\n` : ''}\n--- the draft, as stored ---\n${d.raw}`;
  return p;
}

/**
 * Keep a draft. A value that breaks the format is not written (the last good draft stays), and a storage failure is
 * reported with its real reason. Returns what to tell the owner, or null when saved.
 */
export function saveDraft<T>(storage: DraftStorage | null, key: string, value: T, label: string, check: (value: T) => ValidationIssue[]): Problem | null {
  const issues = check(value);
  if (issues.length) return issuesProblem(`The ${label} breaks the format, so the latest change was not kept in the draft (the last good draft is still saved).`, issues);
  try {
    if (!storage) throw new Error('This browser does not allow saving drafts (storage is blocked).');
    storage.setItem(key, JSON.stringify(value));
    return null;
  } catch (err) {
    return errorProblem(`This browser couldn’t keep a draft of the ${label}. Save it to the Library or export it as JSON.`, err);
  }
}
