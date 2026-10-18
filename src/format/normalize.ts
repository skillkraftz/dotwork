import type { Page } from './types';

/**
 * Tidy a page the editor has just modified: drop empty border/labels, and keep
 * label rows inside their region (so shrinking a region never makes the file invalid).
 * Mutates and returns the page; callers pass a fresh clone.
 */
export function normalizePage(page: Page): Page {
  for (const r of page.regions) {
    if (r.border && Object.keys(r.border).length === 0) delete r.border;
    if (r.labels && r.labels.length === 0) delete r.labels;
    for (const l of r.labels ?? []) {
      if (l.row !== undefined) l.row = Math.max(0, Math.min(r.h - 1, l.row));
    }
  }
  return page;
}
