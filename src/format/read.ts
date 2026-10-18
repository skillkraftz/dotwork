import { convertV1 } from './convert';
import type { Page } from './types';
import { validatePage, type ValidationIssue } from './validate';
import { validatePageV1 } from './validate-v1';
import type { PageV1 } from './v1';

export type ReadResult =
  | { ok: true; page: Page; converted: boolean }
  | { ok: false; issues: ValidationIssue[] };

/** Check a parsed file against the format, converting version 1 to version 2. Used for everything the app loads. */
export function readPage(input: unknown): ReadResult {
  const version = typeof input === 'object' && input !== null ? (input as { version?: unknown }).version : undefined;
  if (version === 1) {
    const issues = validatePageV1(input);
    if (issues.length) return { ok: false, issues };
    const page = convertV1(input as PageV1);
    // The conversion is trusted to produce a valid page; check anyway so a bug can't reach a file.
    const after = validatePage(page);
    return after.length ? { ok: false, issues: after } : { ok: true, page, converted: true };
  }
  const issues = validatePage(input);
  return issues.length ? { ok: false, issues } : { ok: true, page: input as Page, converted: false };
}
