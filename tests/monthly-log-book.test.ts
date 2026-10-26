import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBook } from '../src/book/book';
import { planSteps } from '../src/book/build';

// The owner's Monthly Log Book (see docs/product-map.md, "The owner's monthly log book"): what its recipe makes, and why.
const book = (() => {
  const r = readBook(JSON.parse(readFileSync('tests/fixtures/monthly-log-book.json', 'utf8')));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.book;
})();

describe('the Monthly Log Book', () => {
  it('opens', () => {
    expect(book.page_count).toBe(52);
    expect(book.recipe?.month).toBe('2027-11');
  });

  it('has one fill step whose section dates its daily pages a week apart and never moves', () => {
    const steps = book.recipe!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].repeat).toEqual({ kind: 'fill' });
    expect(steps[0].start).toBeUndefined();
    const s = steps[0].section;
    expect(s.move).toBe('none');
    expect(s.days).toEqual([null, 0, null, 14, 21, 28, 35, 42, 49, null, null]);
  });

  it('so every repeat gets the same dates, the first on the 1st of the recipe month', () => {
    const plan = planSteps(book.recipe!, book.page_count);
    const cycles = [0, 12, 24, 36].map((at) => plan.entries.slice(at, at + 12).map((e) => e.date));
    expect(cycles[0]).toContain('2027-11-01');
    for (const c of cycles) expect(c).toEqual(cycles[0]);
  });

  it('is not what the recipe would build now: the last four pages were changed by hand', () => {
    const plan = planSteps(book.recipe!, book.page_count);
    expect(plan.entries.slice(48).every((e) => e.page === null)).toBe(true);
    expect(book.pages.slice(48).every((p) => p !== null)).toBe(true);
  });
});
