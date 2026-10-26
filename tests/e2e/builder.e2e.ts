import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookMore, missingHelp, open, openDoc, seedDoc, shot, start, stop, settle, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const fixture = readFileSync('tests/fixtures/november-2026-journal.json', 'utf8');
const click = async (app: App, target: ReturnType<App['page']['locator']>) => { if (app.touch) { await target.tap(); await settle(app); } else await target.click(); };
const saved = (app: App) => openDoc(app, 'book');

async function smallControls(app: App) {
  return app.page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('dialog[open] button, dialog[open] input, dialog[open] select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

const noSideways = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function start_(device: Device) {
  const app = await open(env, device);
  const { page } = app;
  const book = JSON.parse(fixture);
  await seedDoc(app, 'book', book, book.name); // the fixture is the open book
  await click(app, page.locator('#menu-page'));
  await click(app, page.locator('#view-book'));
  await page.waitForSelector('.stage-page');
  return app;
}

async function run(device: Device) {
  const app = await start_(device);
  const { page } = app;
  expect(await noSideways(app)).toBe(true);
  // The bar fits: Undo, Build book, More and Print files, and nothing scrolls sideways.
  expect(await page.evaluate(() => { const b = document.querySelector('.book-bar')!; return b.scrollWidth <= b.clientWidth; })).toBe(true);
  expect(await page.locator('.book-contents .crow-date').first().innerText()).toBe('Nov 1');

  // The less-used actions are in the More menu.
  await click(app, page.locator('[data-key="book-more"]'));
  expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Dates…', 'Save pages as a section…', 'Flip through']);
  expect(await noSideways(app)).toBe(true);
  await shot(app, `${device}-book-more`);
  await click(app, page.locator('[data-key="book-more"]'));

  // ---- Save pages as a section
  await bookMore(app, 'Save pages as a section…');
  await page.waitForSelector('dialog.section-save[open]');
  await page.locator('dialog.section-save [data-key="section-from"]').fill('1');
  await page.locator('dialog.section-save [data-key="section-to"]').fill('10');
  await page.locator('dialog.section-save [data-key="section-name"]').fill('My week');
  expect(await page.locator('dialog.section-save [data-key="section-move"]').inputValue()).toBe('week'); // guessed from the dates
  expect(await page.locator('dialog.section-save .apply-summary').innerText()).toContain('Pages 1–10: 10 pages, starting on a right page');
  expect(await missingHelp(app), `${device} save section`).toEqual([]);
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  expect(await noSideways(app)).toBe(true);
  await shot(app, `${device}-section-save`);
  await click(app, page.locator('dialog.section-save [data-key="section-save"]'));
  await page.waitForSelector('dialog.section-save', { state: 'hidden' });
  expect(await page.locator('.book-msg').innerText()).toContain('Saved the section “My week” (10 pages)');

  // ---- the builder, from the Weekly journal preset
  await click(app, page.locator('[data-key="book-build"]'));
  await page.waitForSelector('dialog.build[open]');
  expect(await page.locator('dialog.build [data-key="build-empty"]').count()).toBe(1);
  expect(await page.locator('dialog.build [data-key="build-go"]').isDisabled()).toBe(true); // nothing to build yet
  expect(await page.locator('dialog.build [data-key="build-month"]').inputValue()).toBe('11'); // the month of the book's first date
  await click(app, page.locator('dialog.build [data-key="build-preset-weekly-journal"]'));
  expect(await page.locator('dialog.build .step-card').count()).toBe(4);
  expect(await page.locator('dialog.build .apply-summary .usage').innerText()).toBe('52 of 52 used, 0 left');
  expect(await page.locator('dialog.build .step-adds').first().innerText()).toBe('Adds Journal week, 5 weeks of Nov: 45 pages');
  await page.locator('dialog.build [data-key="build-month"]').selectOption('12');
  const summary = await page.locator('dialog.build .apply-summary').innerText();
  expect(summary).toContain('52 of 52 used, 0 left');
  expect(summary).toContain('Nov 29–30, Jan 1–2');
  expect(summary).toContain('Added a gap page (Notes) on page 47');
  expect(await noSideways(app)).toBe(true);
  expect(await missingHelp(app), `${device} builder`).toEqual([]);
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  await shot(app, `${device}-builder-december`);

  // reorder, remove, add: the pages used and left change live
  await click(app, page.locator('dialog.build .step-card').nth(3).locator('[data-key="build-step-up"]'));
  expect(await page.locator('dialog.build .step-card strong').allInnerTexts()).toEqual(['1. Journal week', '2. Month-end review', '3. Book notes', '4. Idea spread']);
  await click(app, page.locator('dialog.build .step-card').nth(3).locator('[data-key="build-step-remove"]'));
  expect(await page.locator('dialog.build .step-card').count()).toBe(3);
  expect(await page.locator('dialog.build .apply-summary .usage').innerText()).toMatch(/^49 of 52 used, 3 left$|^\d+ of 52 used, \d+ left$/);
  await click(app, page.locator('dialog.build [data-key="build-add"]'));
  await click(app, page.locator('dialog.build [data-key="build-pick"][data-name="My week"]'));
  expect(await page.locator('dialog.build .step-card').count()).toBe(4);
  // a step list longer than the book is refused, with the reason
  await page.locator('dialog.build .step-card').nth(3).locator('[data-key="step-count"]').fill('9');
  expect(await page.locator('dialog.build .apply-summary').innerText()).toMatch(/too many/);
  expect(await page.locator('dialog.build [data-key="build-go"]').isDisabled()).toBe(true);
  await shot(app, `${device}-builder-too-long`);
  await click(app, page.locator('dialog.build .step-card').nth(3).locator('[data-key="build-step-remove"]'));

  // the gap page is chosen from the Library's pages
  await click(app, page.locator('dialog.build [data-key="build-gap"]'));
  await click(app, page.locator('dialog.build [data-key="build-pick"][data-name="Dot grid page"]'));
  expect(await page.locator('dialog.build [data-key="build-gap"]').innerText()).toContain('Dot grid page');
  await click(app, page.locator('dialog.build [data-key="build-gap"]'));
  await click(app, page.locator('dialog.build [data-key="build-pick"][data-name="Notes"]'));
  await click(app, page.locator('dialog.build [data-key="build-preset-weekly-journal"]')); // back to the preset

  await click(app, page.locator('dialog.build [data-key="build-go"]'));
  await page.waitForSelector('dialog.build', { state: 'hidden' });
  let book = await saved(app);
  expect(book.recipe.month).toBe('2026-12');
  expect(book.recipe.steps).toHaveLength(4);
  expect(book.dates[0]).toBe('2026-11-29');
  expect(book.dates.slice(1, 3)).toEqual(['2026-12-01', '2026-12-02']);
  expect(await page.locator('.book-msg').innerText()).toContain('52 of 52 pages used');
  await click(app, page.getByRole('button', { name: 'Undo' }));
  expect((await saved(app)).recipe).toBeUndefined(); // one Undo step

  // ---- rebuilding keeps the steps: change the month and generate again
  await click(app, page.locator('[data-key="book-build"]'));
  await click(app, page.locator('dialog.build [data-key="build-preset-weekly-journal"]'));
  await page.locator('dialog.build [data-key="build-month"]').selectOption('2');
  await page.locator('dialog.build [data-key="build-year"]').fill('2027');
  await click(app, page.locator('dialog.build [data-key="build-go"]'));
  await click(app, page.locator('[data-key="book-build"]'));
  expect(await page.locator('dialog.build .step-card').count()).toBe(4); // the steps came back with the book
  expect(await page.locator('dialog.build [data-key="build-year"]').inputValue()).toBe('2027');
  await page.locator('dialog.build [data-key="build-month"]').selectOption('3');
  await shot(app, `${device}-builder-rebuild`);
  await click(app, page.locator('dialog.build [data-key="build-go"]'));
  book = await saved(app);
  expect(book.recipe.month).toBe('2027-03');
  expect(book.pages).toHaveLength(52);

  // ---- the Library lists the saved section
  await click(app, page.locator('#menu-edit'));
  await click(app, page.locator('#library'));
  await page.waitForSelector('dialog.browser[open]');
  await click(app, page.locator('dialog.browser [data-tab="sections"]'));
  await page.waitForSelector('dialog.browser .lib-card[data-name="My week"]');
  expect(await page.locator('dialog.browser .lib-card[data-name="Journal week"]').count()).toBe(1); // a built-in
  await shot(app, `${device}-library-sections`);
  expect(app.errors).toEqual([]);
  await app.ctx.close();
}

async function flip(device: Device) {
  const app = await start_(device);
  const { page } = app;
  await bookMore(app, 'Flip through');
  await page.waitForSelector('dialog.flip[open]');
  expect(await page.locator('dialog.flip .flip-speed .hint').innerText()).toBe('1 s per opening'); // the default
  await page.waitForTimeout(400);
  expect(await page.locator('dialog.flip .flip-bar .where').innerText()).toBe('Inside front cover and page 1'); // it hasn't moved yet
  const slider = page.locator('dialog.flip [data-help="flip-speed"]');
  expect([await slider.getAttribute('min'), await slider.getAttribute('max'), await slider.getAttribute('step')]).toEqual(['250', '3000', '250']);
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  expect(await noSideways(app)).toBe(true);
  await click(app, page.locator('dialog.flip .flip-stage'));                     // a tap pauses
  const paused = await page.locator('dialog.flip .flip-bar .where').innerText();
  await page.waitForTimeout(500);
  expect(await page.locator('dialog.flip .flip-bar .where').innerText()).toBe(paused);
  await slider.fill('500');
  expect(await page.locator('dialog.flip .flip-speed .hint').innerText()).toBe('0.5 s per opening');
  await click(app, page.getByRole('button', { name: 'Next opening' }));
  await shot(app, `${device}-flip`);
  const at = await page.locator('dialog.flip .flip-bar .where').innerText();
  const left = Number(/Pages (\d+) and/.exec(at)![1]);
  await click(app, page.locator('dialog.flip .flip-stage'));                     // a tap on a paused opening stops there
  await page.waitForSelector('dialog.flip', { state: 'detached' });
  expect(await page.locator('.book-nav .where strong').innerText()).toBe(`Page ${left}`);
  expect(app.errors).toEqual([]);
  await app.ctx.close();
}

describe('the book builder', () => {
  it('works on a phone', () => run('phone'));
  it('works on a tablet', () => run('tablet'));
  it('works on a desktop', () => run('desktop'));
});

describe('flip through', () => {
  it('plays at a second an opening and pauses on a phone', () => flip('phone'));
  it('plays at a second an opening and pauses on a tablet', () => flip('tablet'));
  it('plays at a second an opening and pauses on a desktop', () => flip('desktop'));

  it('desktop keys: Space pauses, arrows step, Escape stops', async () => {
    const app = await start_('desktop');
    const { page } = app;
    await bookMore(app, 'Flip through');
    await page.waitForSelector('dialog.flip[open]');
    await page.keyboard.press(' ');
    const paused = await page.locator('dialog.flip .flip-bar .where').innerText();
    await page.waitForTimeout(1300);
    expect(await page.locator('dialog.flip .flip-bar .where').innerText()).toBe(paused);
    await page.keyboard.press('ArrowRight');
    expect(await page.locator('dialog.flip .flip-bar .where').innerText()).not.toBe(paused);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.flip', { state: 'detached' });
    expect(app.errors).toEqual([]);
    await app.ctx.close();
  });
});
