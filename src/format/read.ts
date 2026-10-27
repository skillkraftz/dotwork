import type { Page } from './types';
import { validatePage, type ValidationIssue } from './validate';

export type ReadResult =
  | { ok: true; page: Page }
  | { ok: false; issues: ValidationIssue[] };

/** Check a parsed file against the format. Used for everything the app loads; a file of another version is refused. */
export function readPage(input: unknown): ReadResult {
  const issues = validatePage(input);
  return issues.length ? { ok: false, issues } : { ok: true, page: input as Page };
}
