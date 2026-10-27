import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dateOf, emptyBook, readBook, setDates, setSlot, type Book } from '../src/book/book';
import { applyBuild, buildSummary, guessMove, planSteps, sectionFrom, stepLine, usageLine, type BuildPlan } from '../src/book/build';
import { readSection, type Move, type Recipe, type Repeat, type Section, type Step } from '../src/book/sections';
import { BUILTIN_SECTIONS, PRESETS, isBuiltinSection } from '../src/builtin/sections';
import { findBuiltinPage } from '../src/builtin/library';
import { notesPage } from '../src/builtin/pages';
import { addMonths } from '../src/format/dates';
import { Library, MemoryBackend, readLibraryFile } from '../src/library/library';

const load = (): Book => {
  const r = readBook(JSON.parse(readFileSync('tests/fixtures/november-2026-journal.json', 'utf8')));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.book;
};

/** The steps of the owner's November book: pages 1-10 repeat for each week, 46-47 follow, 48-49 fill, 52 ends. */
function novemberSteps(book: Book): Step[] {
  const part = (from: number, to: number, name: string, move: Move) => sectionFrom(book, from, to, name, move);
  return [
    { section: part(1, 10, 'Week', 'week'), repeat: { kind: 'weeks', only_in_month: true } },
    { section: part(46, 47, 'Month end', 'none'), repeat: { kind: 'times', count: 1 } },
    { section: part(48, 49, 'Ideas', 'none'), repeat: { kind: 'fill' } },
    { section: part(52, 52, 'Notes at the end', 'none'), repeat: { kind: 'times', count: 1 } },
  ];
}
const recipeFor = (steps: Step[], month: string, extra: Partial<Recipe> = {}): Recipe => ({ month, steps, ...extra });
const names = (plan: BuildPlan) => plan.entries.map((e) => e.page?.name ?? '-');

/** A small book to make sections from: page `n` holds the page named, dated as given. */
function small(pages: [string, string | null][], count = 8): Book {
  const b = emptyBook(count);
  pages.forEach(([name, date], i) => {
    const page = name === 'Notes' ? notesPage() : findBuiltinPage(name)!;
    setSlot(b, i + 1, page);
    if (date) setDates(b, i + 1, [date]);
  });
  return b;
}

describe('sections', () => {
  it('keeps dates relative to the first dated page, and the side it began on', () => {
    const book = load();
    const week = sectionFrom(book, 1, 10, 'Week', 'week');
    expect(week.days).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 0, null]);
    expect(week).toMatchObject({ weekday: 0, move: 'week', left: false, name: 'Week' });
    expect(sectionFrom(book, 46, 47, 'x', 'none').left).toBe(true);
    // A section with no dated page can't move its dates.
    expect(sectionFrom(book, 10, 10, 'Notes', 'week')).toMatchObject({ move: 'none', days: [null] });
  });

  it('guesses how its dates move', () => {
    const book = load();
    expect(guessMove(book, 1, 10)).toBe('week');
    expect(guessMove(book, 10, 10)).toBe('none');
    expect(guessMove(book, 2, 2)).toBe('day');
  });

  it('is checked against the section format, in the Library file and in a book', () => {
    const week = sectionFrom(load(), 1, 10, 'Week', 'week');
    expect(readSection(structuredClone(week)).ok).toBe(true);
    for (const broken of [{ move: 'year' }, { weekday: 7 }, { days: [0] }, { left: 'yes' }, { pages: [] }, { format: 'dotwork-page' }]) {
      expect(readSection({ ...week, ...broken }).ok, JSON.stringify(broken)).toBe(false);
    }
    const file = { format: 'dotwork-library', version: 1, exported: '2026-10-21T00:00:00.000Z', items: [{ id: 'a', kind: 'section', name: 'Week', updated: '2026-10-21T00:00:00.000Z', data: week }] };
    const r = readLibraryFile(file);
    expect(r.ok && r.items[0].kind).toBe('section');
    const bad = readLibraryFile({ ...file, items: [{ ...file.items[0], data: { ...week, move: 'hour' } }] });
    expect(bad.ok && bad.refused).toHaveLength(1);
  });

  it('saves to the Library, and a built-in name is reserved', async () => {
    const lib = new Library(new MemoryBackend(), undefined, undefined, (kind, name) => kind === 'section' && isBuiltinSection(name));
    const week = sectionFrom(load(), 1, 10, 'My week', 'week');
    expect((await lib.save('section', 'My week', week)).kind).toBe('section');
    expect((await lib.list()).map((i) => i.kind)).toEqual(['section']);
    await expect(lib.save('section', BUILTIN_SECTIONS[0].name, week)).rejects.toThrow(/built-in/);
  });
});

describe('the book builder', () => {
  it('rebuilds November from its steps to the same pages and dates', () => {
    const book = load();
    const plan = planSteps(recipeFor(novemberSteps(book), '2026-11'), book.page_count);
    expect(plan.problem).toBeNull();
    expect(plan.steps.map((s) => s.repeats)).toEqual([5, 1, 2, 1]);
    expect(plan.leftOut).toEqual(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    expect(plan.gaps).toEqual([]);
    expect(usageLine(plan, 52)).toBe('52 of 52 used, 0 left');
    const again = load();
    applyBuild(again, plan);
    expect(again.pages).toEqual(book.pages);
    expect(again.dates).toEqual(book.dates);
    expect(again.recipe?.month).toBe('2026-11');
  });

  it('builds December (Dec 1 is a Tuesday) without Nov 29-30 and Jan 1-2, keeping the week pages', () => {
    const book = load();
    const plan = planSteps(recipeFor(novemberSteps(book), '2026-12'), 52);
    expect(plan.steps[0].repeats).toBe(5);
    expect(plan.leftOut).toEqual(['2026-11-29', '2026-11-30', '2027-01-01', '2027-01-02']);
    const weekly = plan.entries.filter((e) => e.page?.name.startsWith('Year journal weekly'));
    expect(weekly.map((e) => e.date)).toEqual(['2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']);
    const dailies = plan.entries.filter((e) => e.page?.name === 'Daily Good Time Journal').map((e) => e.date!);
    expect(dailies).toHaveLength(31);
    expect([dailies[0], dailies.at(-1)]).toEqual(['2026-12-01', '2026-12-31']);
    // 8 + 10 + 10 + 10 + 8 pages for the weeks, a gap so the review pages begin on the left, 2 after, 2 of filler, the end.
    expect(plan.steps.map((s) => s.pages)).toEqual([46, 2, 2, 1]);
    expect(plan.gaps).toEqual([47]);
    expect(names(plan).slice(46, 52)).toEqual(['Notes', 'Weekly reflection', 'Patterns & takeaways', 'Idea page', 'Dot grid page', 'Book notes']);
    expect(plan.entries).toHaveLength(52);
    expect(plan.left).toBe(0);
    expect(plan.entries[47].date).toBe('2026-12-01'); // the month-end pages are dated the start of the month, so {monthname} reads DECEMBER
    expect(buildSummary(plan, 52).join(' ')).toMatch(/52 of 52 used, 0 left.*Left out.*4 daily pages \(Nov 29–30, Jan 1–2\).*Added a gap page \(Notes\) on page 47/);
  });

  it('builds February 2027, which starts on a Monday, and keeps the weeks on the right sides', () => {
    const book = load();
    const plan = planSteps(recipeFor(novemberSteps(book), '2027-02'), 52);
    expect(plan.steps[0].repeats).toBe(5); // Jan 31, Feb 7, 14, 21, 28
    expect(plan.leftOut).toEqual(['2027-01-31', '2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06']);
    // The first week has 9 pages, so a Notes page keeps the second week's weekly page on a right (odd) page.
    expect(plan.gaps).toEqual([10, 45]);
    plan.entries.forEach((e, i) => { if (e.page?.name.startsWith('Year journal weekly')) expect((i + 1) % 2, `page ${i + 1}`).toBe(1); });
    expect(plan.entries[9].page?.name).toBe('Notes');
    expect(plan.entries).toHaveLength(52);
    expect(plan.left).toBe(0);
    expect(plan.problem).toBeNull();
  });

  it('keeps every day of the weeks unless only days in the month are asked for', () => {
    const book = load();
    const steps = novemberSteps(book);
    steps[0].repeat = { kind: 'weeks', only_in_month: false };
    const plan = planSteps(recipeFor(steps.slice(0, 1), '2026-12'), 52);
    expect(plan.leftOut).toEqual([]);
    expect(plan.used).toBe(50); // five whole weeks of ten pages
  });

  it('takes a step’s own month over the recipe’s', () => {
    const book = load();
    const steps = novemberSteps(book);
    steps[0].repeat = { kind: 'weeks', month: '2027-02', only_in_month: true };
    expect(planSteps(recipeFor(steps.slice(0, 1), '2026-11'), 52).entries[0].date).toBe('2027-01-31');
  });

  it('repeats a day section: a left page and its facing page, a day later each time', () => {
    const b = small([['Notes', null], ['Daily Good Time Journal', '2026-12-01'], ['Notes', null]], 8);
    const day = sectionFrom(b, 2, 3, 'Day and notes', 'day');
    expect(day).toMatchObject({ left: true, days: [0, null], move: 'day' });
    const plan = planSteps(recipeFor([{ section: day, repeat: { kind: 'times', count: 3 } }], '2026-12'), 8);
    expect(plan.problem).toBeNull();
    expect(plan.entries.slice(0, 7).map((e) => e.date)).toEqual([null, '2026-12-01', null, '2026-12-02', null, '2026-12-03', null]);
    expect(plan.gaps).toEqual([1]); // it begins on a left page, so page 1 (a right page) is a gap
    expect(usageLine(plan, 8)).toBe('7 of 8 used, 1 left');
    expect(plan.steps[0]).toEqual({ pages: 6, repeats: 3 });
    // A start date moves the first repeat.
    const later = planSteps(recipeFor([{ section: day, repeat: { kind: 'times', count: 2 }, start: '2027-01-30' }], '2026-12'), 8);
    expect(later.entries.filter((e) => e.date).map((e) => e.date)).toEqual(['2027-01-30', '2027-01-31']);
  });

  it('repeats a month section: a month later each time, shorter months keeping their last day', () => {
    const b = small([['Daily Good Time Journal', '2026-10-31']]);
    const month = sectionFrom(b, 1, 1, 'Month page', 'month');
    const plan = planSteps(recipeFor([{ section: month, repeat: { kind: 'times', count: 5 }, start: '2026-10-31' }], '2026-10'), 8);
    expect(plan.entries.filter((e) => e.date).map((e) => e.date)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-31', -2)).toBe('2025-11-30');
    // With no start date, the first of the recipe's month.
    expect(planSteps(recipeFor([{ section: month, repeat: { kind: 'times', count: 1 } }], '2027-03'), 8).entries[0].date).toBe('2027-03-01');
  });

  it('fills what is left with whole repeats, and counts the pages left over', () => {
    const b = small([['Idea page', null], ['Dot grid page', '2026-11-01'], ['Book notes', null]]);
    const ideas = sectionFrom(b, 1, 2, 'Ideas', 'none');
    const end = sectionFrom(b, 3, 3, 'End', 'none');
    const plan = planSteps(recipeFor([{ section: ideas, repeat: { kind: 'fill' } }, { section: end, repeat: { kind: 'times', count: 1 } }], '2026-11'), 12);
    // The end began on page 3, a right page: the latest right page that fits is 11, and page 12 is a gap.
    expect(plan.problem).toBeNull();
    expect(plan.steps[0].repeats).toBe(5);
    expect(names(plan).slice(0, 10).every((n, i) => n === (i % 2 ? 'Dot grid page' : 'Idea page'))).toBe(true);
    expect(plan.entries[10].page?.name).toBe('Book notes');
    expect(plan.gaps).toEqual([12]);
    expect(usageLine(plan, 12)).toBe('12 of 12 used, 0 left');
    // Only whole repeats are placed: four pages of ideas twice fill 8 of 10 pages and leave 2 blank.
    const four = { ...ideas, pages: [...ideas.pages, ...ideas.pages], days: [...ideas.days, ...ideas.days] };
    const some = planSteps(recipeFor([{ section: four, repeat: { kind: 'fill' } }], '2026-11'), 10);
    expect(some.steps[0]).toEqual({ pages: 8, repeats: 2 });
    expect(some.left).toBe(2);
    expect(usageLine(some, 10)).toBe('8 of 10 used, 2 left');
    expect(some.entries[8].page).toBeNull();
  });

  it('keeps each repeat on its own side with gap pages, and says where it added them', () => {
    const b = small([['Idea page', null], ['Dot grid page', null], ['Book notes', null]]);
    const right = sectionFrom(b, 1, 1, 'Right page', 'none'); // page 1 is a right page
    const left = sectionFrom(b, 2, 2, 'Left page', 'none');
    expect([right.left, left.left]).toEqual([false, true]);
    const plan = planSteps(recipeFor([
      { section: right, repeat: { kind: 'times', count: 3 } },
      { section: left, repeat: { kind: 'times', count: 1 } },
    ], '2026-11'), 12);
    expect(plan.gaps).toEqual([2, 4]); // three right pages need a gap between them; the left page then lands on 6
    expect(names(plan).slice(0, 7)).toEqual(['Idea page', 'Notes', 'Idea page', 'Notes', 'Idea page', 'Dot grid page', '-']);
    expect(buildSummary(plan, 12).join(' ')).toContain('Added a gap page (Notes) on pages 2 and 4, so spreads stay on the right sides.');
    // A different gap page can be chosen.
    const choose = planSteps(recipeFor([{ section: right, repeat: { kind: 'times', count: 2 } }], '2026-11', { gap: findBuiltinPage('Dot grid page')! }), 12);
    expect(choose.entries[1].page?.name).toBe('Dot grid page');
    expect(buildSummary(choose, 12).join(' ')).toContain('Added a gap page (Dot grid page) on page 2');
  });

  it('puts the steps after a fill on the last pages, a gap last when they would begin on the wrong side', () => {
    const book = load();
    const steps = novemberSteps(book);
    steps[3] = { section: sectionFrom(book, 50, 51, 'Two at the end', 'none'), repeat: { kind: 'times', count: 1 } }; // began on a left page
    const plan = planSteps(recipeFor(steps, '2026-11'), 52);
    expect(plan.entries.at(-1)!.page?.name).toBe('Notes');
    expect(plan.gaps).toContain(52);
  });

  it('counts the pages left live, and what each step adds', () => {
    const book = load();
    const steps = novemberSteps(book).slice(0, 2);
    const plan = planSteps(recipeFor(steps, '2026-11'), 52);
    expect(usageLine(plan, 52)).toBe('47 of 52 used, 5 left');
    expect(stepLine(steps[0], plan.steps[0], '2026-11')).toBe('Week, 5 weeks of Nov: 45 pages');
    expect(stepLine(steps[1], plan.steps[1], '2026-11')).toBe('Month end, × 1: 2 pages');
    expect(plan.entries).toHaveLength(52);
    expect(plan.entries.slice(47).every((e) => e.page === null)).toBe(true);
    expect(plan.problem).toBeNull();
  });

  it('refuses a step list longer than the book, with the reason, and leaves the book alone', () => {
    const book = load();
    const plan = planSteps(recipeFor(novemberSteps(book), '2026-12'), 40);
    expect(plan.problem).toMatch(/need \d+ pages but the book has 40: \d+ too many/);
    expect(usageLine(plan, 40)).toMatch(/of 40 used: \d+ too many/);
    expect(buildSummary(plan, 40)[1]).toBe(plan.problem);
    const before = JSON.stringify(book);
    expect(() => applyBuild(book, plan)).toThrow(/too many/);
    expect(JSON.stringify(book)).toBe(before);
    // Steps with no fill that are too long, too.
    const week = novemberSteps(book)[0];
    expect(planSteps(recipeFor([{ section: week.section, repeat: { kind: 'times', count: 6 } }], '2026-11'), 52).problem).toMatch(/60 pages but the book has 52: 8 too many/);
  });

  it('applies as one change: pages, dates and recipe together, and the recipe reads back', () => {
    const book = load();
    const plan = planSteps(recipeFor(novemberSteps(book), '2026-12'), 52);
    applyBuild(book, plan);
    expect(book.recipe?.month).toBe('2026-12');
    expect(book.pages[46]?.name).toBe('Notes');
    expect(dateOf(book, 1)).toBe('2026-11-29');
    const back = readBook(JSON.parse(JSON.stringify(book)));
    expect(back.ok).toBe(true);
    // Rebuilding keeps the steps: only the month changes, and the result is the same as building it from the steps directly.
    const recipe = back.ok ? back.book.recipe! : null!;
    const feb = planSteps({ ...recipe, month: '2027-02' }, 52);
    expect(feb.entries).toEqual(planSteps(recipeFor(novemberSteps(load()), '2027-02'), 52).entries);
    const bad = (change: (r: Record<string, any>) => void) => { const copy = JSON.parse(JSON.stringify(book)); change(copy.recipe); return readBook(copy).ok; };
    expect(bad((r) => { r.month = '2026-13'; })).toBe(false);
    expect(bad((r) => { r.steps[0].repeat = { kind: 'weekly' }; })).toBe(false);
    expect(bad((r) => { r.steps[1].repeat = { kind: 'times', count: 0 }; })).toBe(false);
    expect(bad((r) => { r.steps[0].section.move = 'hour'; })).toBe(false);
    expect(bad((r) => { r.steps[1].repeat = { kind: 'fill' }; })).toBe(false); // two fills
    expect(bad((r) => { r.steps[0].start = '2026-02-30'; })).toBe(false);
    expect(bad((r) => { r.steps = 'none'; })).toBe(false);
  });

  it('has Build by week as a preset of steps, not separate code', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Weekly journal']);
    const steps = PRESETS[0].steps;
    expect(steps.map((s) => s.repeat.kind)).toEqual(['weeks', 'times', 'fill', 'times']);
    const plan = planSteps(recipeFor(structuredClone(steps), '2026-11'), 52);
    expect(plan.problem).toBeNull();
    const fixture = load();
    expect(names(plan)).toEqual(fixture.pages.map((p) => p?.name ?? '-'));
    expect(plan.entries.map((e) => e.date)).toEqual(fixture.dates);
    const dec = planSteps(recipeFor(structuredClone(steps), '2026-12'), 52);
    expect(dec.problem).toBeNull();
    expect(dec.gaps).toEqual([47]);
    expect(dec.left).toBe(0);
  });

  it('refuses nothing it can build: every repeat kind of a step list builds', () => {
    const kinds: Repeat[] = [{ kind: 'times', count: 2 }, { kind: 'weeks', only_in_month: true }, { kind: 'fill' }];
    const section: Section = BUILTIN_SECTIONS[0];
    for (const repeat of kinds) expect(planSteps(recipeFor([{ section, repeat }], '2026-11'), 52).entries).toHaveLength(52);
  });
});
