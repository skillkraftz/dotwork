import { describe, expect, it, vi } from 'vitest';

// With a page taken out of examples/pages, what depends on it is left out or built with a notes page, and says so.
vi.mock('../src/builtin/examples', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/builtin/examples')>();
  const pageFiles = Object.fromEntries(Object.entries(real.pageFiles).filter(([path]) => !/(lined-page|idea-page)\.json$/.test(path)));
  return { ...real, pageFiles };
});

describe('built-ins that depend on a page that was removed', () => {
  it('leaves out the spreads that need it, builds the books with a notes page, and says what and why', async () => {
    const lib = await import('../src/builtin/library');
    const { TEMPLATES } = await import('../src/builtin/templates');
    const names = lib.BUILTIN_SPREADS.map((s) => s.name);
    expect(names).not.toContain('Lined spread');
    expect(names).not.toContain('Ideas spread');
    expect(names).toContain('Dot grid spread');
    const lines = lib.BUILTIN_NOTICES.map((n) => `${n.tab}: ${n.text}`);
    expect(lines).toContain('spreads: “Lined spread” is left out: “Lined page” isn\'t in examples/pages.');
    expect(lines).toContain('spreads: “Ideas spread” is left out: “Idea page” isn\'t in examples/pages.');
    expect(lines).toContain('books: “Lined journal” uses a notes page where “Lined page” would go: it isn\'t in examples/pages.');
    expect(lines).toContain('books: “Idea book” uses a notes page where “Idea page” would go: it isn\'t in examples/pages.');
    expect(lines.some((l) => l.includes('Dot grid spread') || l.includes('Blank journal'))).toBe(false);
    expect(lines.every((l) => !l.includes('\n'))).toBe(true);
    // the books still build
    for (const t of TEMPLATES) expect(t.build().pages.length).toBeGreaterThan(0);
  });
});
