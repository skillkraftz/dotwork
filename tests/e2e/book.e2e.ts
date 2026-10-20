import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { box, open, shot, start, stop, touch, settle, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noErrors = (app: App) => expect(app.errors).toEqual([]);
const click = async (app: App, target: ReturnType<App['page']['locator']>) => { if (app.touch) { await target.tap(); await settle(app); } else await target.click(); };
const saved = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.book')!));
const names = async (app: App) => (await saved(app)).pages.map((p: { name: string } | null) => p?.name ?? null);

async function smallControls(app: App) {
  return app.page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#book button, #book summary, #book input, dialog[open] button, dialog[open] input')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (getComputedStyle(el).visibility === 'hidden' || (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

async function openBook(app: App) {
  await click(app, app.page.locator('#menu-page'));
  await click(app, app.page.locator('#view-book'));
  await app.page.waitForSelector('.stage-page');
}

/** The whole flow, on one device: choose, step, apply, contents, spreads, undo. */
async function flow(app: App, device: string) {
  const { page } = app;
  await openBook(app);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.where strong').innerText()).toBe('Page 1');
  const stage = (await box(app, '.book-stage'))!, pg = (await box(app, '.stage-page svg'))!;
  expect(pg.height).toBeGreaterThan(stage.height - 30); // the page fills its space
  await shot(app, `${device}-book-empty`);

  // Choose a design from the picker
  await click(app, page.getByRole('button', { name: 'Choose design…' }));
  await page.waitForSelector('dialog.picker[open] .design');
  expect(await page.locator('dialog.picker .design').count()).toBeGreaterThan(6);
  expect((await page.locator('dialog.picker .design .thumb svg').nth(1).boundingBox())!.height).toBeGreaterThan(150);
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  await shot(app, `${device}-book-picker`);
  await click(app, page.locator('dialog.picker .design', { hasText: 'Lined page' }).first());
  expect(await page.locator('dialog.picker').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);
  expect((await names(app))[0]).toBe('Lined page');
  expect(await page.locator('.design-name strong').innerText()).toBe('Lined page');

  // Previous / next, and swipe on touch
  await click(app, page.getByRole('button', { name: 'Next page' }));
  expect(await page.locator('.where strong').innerText()).toBe('Page 2');
  await click(app, page.getByRole('button', { name: 'Previous page' }));
  await click(app, page.getByRole('button', { name: 'Previous page' }));
  expect(await page.locator('.where strong').innerText()).toBe('Inside front cover');
  expect(await page.getByRole('button', { name: 'Previous page' }).isDisabled()).toBe(true);
  if (app.touch) {
    const s = (await box(app, '.book-stage'))!, y = s.y + s.height / 2;
    await touch(app, 'touchStart', [{ x: s.x + s.width * 0.8, y }]);
    for (let i = 1; i <= 6; i++) await touch(app, 'touchMove', [{ x: s.x + s.width * (0.8 - 0.1 * i), y }]);
    await touch(app, 'touchEnd', []);
    await page.waitForTimeout(1500); // Chromium ignores a tap soon after a fast synthetic swipe
    expect(await page.locator('.where strong').innerText()).toBe('Page 1');
  } else await click(app, page.getByRole('button', { name: 'Next page' }));

  // Apply to more pages, with the pages shown first
  await click(app, page.getByRole('button', { name: 'Apply to more pages…' }));
  await page.waitForSelector('dialog.apply[open]');
  await click(app, page.getByLabel('Every right page, from … to …'));
  await page.getByLabel('From page').fill('1');
  await page.getByLabel('To page').fill('9');
  await page.getByLabel('To page').dispatchEvent('change');
  const summary = await page.locator('.apply-summary').innerText();
  expect(summary).toContain('pages 3, 5, 7 and 9'); // page 1 already has it
  await shot(app, `${device}-book-apply`);
  await click(app, page.getByRole('button', { name: 'Apply to 4 pages' }));
  expect((await names(app)).slice(0, 10)).toEqual(['Lined page', null, 'Lined page', null, 'Lined page', null, 'Lined page', null, 'Lined page', null]);

  // Undo takes it back
  await click(app, page.getByRole('button', { name: 'Undo' }));
  expect((await names(app)).filter(Boolean)).toEqual(['Lined page']);

  // Redo it as a run and look at the contents
  await click(app, page.getByRole('button', { name: 'Apply to more pages…' }));
  await click(app, page.getByLabel('Pages … to …'));
  await page.getByLabel('To page').fill('30');
  await page.getByLabel('To page').dispatchEvent('change');
  await click(app, page.getByRole('button', { name: /^Apply to \d+ pages$/ }));
  if (app.touch) { await click(app, page.getByRole('button', { name: 'Contents', exact: true })); }
  const rows = page.locator('.book-contents .crow');
  expect(await rows.first().innerText()).toContain('Inside front cover');
  const run = page.locator('.book-contents .crow', { hasText: 'Pages 1–30' });
  expect(await run.innerText()).toContain('Lined page');
  expect(await page.locator('.book-contents .crow', { hasText: 'Pages 31–52' }).innerText()).toContain('Blank');
  await shot(app, `${device}-book-contents`);
  await click(app, run); // tap expands
  expect(await page.locator('.crow-kids .crow').count()).toBe(30);
  await click(app, page.locator('.crow-kids .crow', { hasText: 'Page 12' }));
  expect(await page.locator('.where strong').innerText()).toBe('Page 12');
  if (app.touch) expect(await page.locator('.book-contents').isVisible()).toBe(false);

  // View as spreads
  await click(app, page.getByRole('button', { name: 'Spreads', exact: true }));
  expect(await page.locator('.stage-page').count()).toBe(2);
  expect(await page.locator('.where strong').innerText()).toBe('Page 12 and page 13');
  const pages = await page.locator('.stage-page svg').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  if (app.touch) expect(pages[0] + pages[1]).toBeGreaterThan(300); // phones use the full width
  await shot(app, `${device}-book-spreads`);
  await click(app, page.getByRole('button', { name: 'Next spread' }));
  expect(await page.locator('.where strong').innerText()).toBe('Page 14 and page 15');
  await click(app, page.locator('.stage-page[data-slot="15"]'));
  expect(await page.locator('.design-name').innerText()).toContain('Page 15');
  await click(app, page.getByRole('button', { name: 'Spreads', exact: true })); // back to one page
  expect(await page.locator('.stage-page').count()).toBe(1);
  expect(await page.locator('.where strong').innerText()).toBe('Page 15');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  noErrors(app);
}

describe('book builder', () => {
  it('works on a phone', async () => {
    const app = await open(env, 'phone');
    await flow(app, 'phone');
    expect(await smallControls(app)).toEqual([]);
  });
  it('works on a desktop', async () => {
    const app = await open(env, 'desktop');
    await flow(app, 'desktop');
    expect(await app.page.locator('.book-contents').isVisible()).toBe(true); // the list stays beside the page
  });
  it('works on a tablet', async () => {
    const app = await open(env, 'tablet');
    await flow(app, 'tablet');
  });
});

/** Dated weekly pages: choose the dated example for pages 1-10, date them as weeks 43-52, and see it on the page. */
async function dates(app: App, device: string) {
  const { page } = app;
  await openBook(app);
  await click(app, page.getByRole('button', { name: 'Choose design…' }));
  await page.waitForSelector('dialog.picker[open] .design');
  await click(app, page.locator('dialog.picker .design', { hasText: 'Year journal weekly page (dated)' }).first());
  await click(app, page.getByRole('button', { name: 'Apply to more pages…' }));
  await click(app, page.getByLabel('Pages … to …'));
  await page.getByLabel('To page').fill('10');
  await page.getByLabel('To page').dispatchEvent('change');
  await click(app, page.getByRole('button', { name: /^Apply to \d+ pages$/ }));
  expect(await page.locator('.page-date').count()).toBe(0); // undated

  await click(app, page.getByRole('button', { name: 'Dates…' }));
  await page.waitForSelector('dialog.dates[open]');
  // From and to default to this page and the end of the run sharing its design
  expect(await page.locator('[data-key="dates-from"]').inputValue()).toBe('1');
  expect(await page.locator('[data-key="dates-to"]').inputValue()).toBe('10');
  await page.locator('[data-key="dates-year"]').fill('2026');
  await page.locator('[data-key="dates-week"]').fill('43');
  expect(await page.locator('dialog.dates .apply-summary').innerText()).toBe('Pages 1–10 become weeks 43–52: Oct 18 – Dec 26');
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(app, `${device}-book-dates`);
  await click(app, page.locator('dialog.dates [data-key="dates-mode-day"]'));
  await page.locator('[data-key="dates-start"]').fill('2026-10-18');
  expect(await page.locator('dialog.dates .apply-summary').innerText()).toBe('Pages 1–10 become days: Oct 18 – Oct 27');
  await click(app, page.locator('dialog.dates [data-key="dates-mode-week"]'));
  await page.locator('[data-key="dates-year"]').fill('2026');
  await page.locator('[data-key="dates-week"]').fill('43');
  await click(app, page.locator('dialog.dates [data-key="dates-set"]'));
  expect((await saved(app)).dates).toEqual(['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20', ...Array(42).fill(null)]);
  expect(await page.locator('.page-date').innerText()).toContain('Sun Oct 18, 2026');
  // the page shows its own dates, and the NOV / DEC week
  expect(await page.locator('.stage-page svg').innerHTML()).toContain('>OCT<');
  await shot(app, `${device}-book-dated`);
  await click(app, page.getByRole('button', { name: 'Next page' }));
  expect(await page.locator('.page-date').innerText()).toContain('Sun Oct 25, 2026');

  // Undo takes it back; Clear dates takes them off a range
  await click(app, page.getByRole('button', { name: 'Undo' }));
  expect((await saved(app)).dates).toBeUndefined();
  await click(app, page.getByRole('button', { name: 'Dates…' }));
  await page.locator('[data-key="dates-from"]').fill('1');
  await page.locator('[data-key="dates-from"]').dispatchEvent('change');
  await page.locator('[data-key="dates-year"]').fill('2026');
  await page.locator('[data-key="dates-week"]').fill('43');
  await click(app, page.locator('dialog.dates [data-key="dates-set"]'));
  expect((await saved(app)).dates[0]).toBe('2026-10-18');
  await click(app, page.getByRole('button', { name: 'Dates…' }));
  await page.locator('[data-key="dates-from"]').fill('3');
  await page.locator('[data-key="dates-from"]').dispatchEvent('change');
  await page.locator('[data-key="dates-to"]').fill('4');
  await page.locator('[data-key="dates-to"]').dispatchEvent('change');
  await click(app, page.locator('dialog.dates [data-key="dates-clear"]'));
  expect((await saved(app)).dates.slice(0, 5)).toEqual(['2026-10-18', '2026-10-25', null, null, '2026-11-15']);
  noErrors(app);
}

describe('book dates', () => {
  for (const device of ['phone', 'tablet', 'desktop'] as const) {
    it(`sets, shows and clears dates on a ${device}`, async () => { await dates(await open(env, device), device); });
  }
});

/** The design picker's tabs, a lined spread across two pages, the mirrored weekly spread, and the last tab being remembered. */
async function spreadsPicker(app: App, device: string) {
  const { page } = app;
  await openBook(app);
  await click(app, page.getByRole('button', { name: 'Choose design…' }));
  await page.waitForSelector('dialog.picker[open] .design');
  // Page 1 is a right page: a spread can't start there, so there are no tabs
  expect(await page.locator('dialog.picker .lib-tabs').isVisible()).toBe(false);
  await click(app, page.getByRole('button', { name: 'Close' }).last());
  await click(app, page.getByRole('button', { name: 'Next page' })); // page 2, a left page
  await click(app, page.getByRole('button', { name: 'Choose design…' }));
  await page.waitForSelector('dialog.picker[open] .design');
  const tabs = page.locator('dialog.picker [role=tab]');
  expect(await tabs.allInnerTexts()).toEqual(['Pages', 'Spreads']);
  for (const t of await tabs.all()) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  expect(await page.locator('dialog.picker .design[data-kind=spread]').count()).toBe(0);
  expect((await page.locator('dialog.picker h3').allInnerTexts()).map((t) => t.toLowerCase())).toEqual(['saved pages', 'built-in pages']);
  await click(app, tabs.nth(1));
  expect((await page.locator('dialog.picker h3').allInnerTexts()).map((t) => t.toLowerCase())).toEqual(['saved spreads', 'built-in spreads']);
  for (const want of ['Lined spread', 'Dot grid spread', 'Notes spread', 'Weekly spread']) expect(await page.locator('dialog.picker .design', { hasText: want }).count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  await shot(app, `${device}-book-picker-tabs`);
  await click(app, page.locator('dialog.picker .design', { hasText: 'Lined spread' }).first());
  expect((await names(app)).slice(0, 4)).toEqual([null, 'Lined page', 'Lined page', null]);
  expect((await saved(app)).pages.slice(1, 3).map((p: { side: string }) => p.side)).toEqual(['left', 'right']);
  expect(await page.locator('.book-problem').isHidden()).toBe(true);

  // The picker opens on the tab used last
  await click(app, page.getByRole('button', { name: 'Choose design…' }));
  expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true');
  await click(app, page.locator('dialog.picker .design', { has: page.locator('.design-title', { hasText: /^Weekly spread$/ }) }));
  expect((await names(app)).slice(1, 3)).toEqual(['Year journal weekly page (dated)', 'Year journal weekly page (dated)']);
  await click(app, page.getByRole('button', { name: 'Spreads' }));
  await shot(app, `${device}-book-weekly-spread`);
  await click(app, page.getByRole('button', { name: 'Undo' }));
  await shot(app, `${device}-book-lined-spread`);
  noErrors(app);
}

describe('the design picker', () => {
  for (const device of ['phone', 'tablet', 'desktop'] as const) {
    it(`has Pages and Spreads tabs and places a spread on a ${device}`, async () => { await spreadsPicker(await open(env, device), device); });
  }
});
