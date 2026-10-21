import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { open, shot, start, stop, settle, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const fixture = readFileSync('tests/fixtures/november-2026-journal.json', 'utf8');
const click = async (app: App, target: ReturnType<App['page']['locator']>) => { if (app.touch) { await target.tap(); await settle(app); } else await target.click(); };
const saved = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.book')!));

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

async function run(device: Device) {
  const app = await open(env, device);
  const { page } = app;
  await page.evaluate((json) => localStorage.setItem('dotwork.book', json), fixture);
  await page.reload();
  await page.waitForSelector('#canvas');
  await click(app, page.locator('#menu-page'));
  await click(app, page.locator('#view-book'));
  await page.waitForSelector('.stage-page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // The contents show each page's date.
  expect(await page.locator('.book-contents .crow-date').first().innerText()).toBe('Nov 1');

  // ---- Build by week
  await click(app, page.getByRole('button', { name: 'Build by week…' }));
  await page.waitForSelector('dialog.weeks[open]');
  // The section guessed from the dates is pages 1-10, for November 2026.
  expect(await page.locator('dialog.weeks [data-key="weeks-from-page"]').first().inputValue()).toBe('1');
  expect(await page.locator('dialog.weeks [data-key="weeks-to-page"]').first().inputValue()).toBe('10');
  expect(await page.locator('dialog.weeks [data-key="weeks-month"]').inputValue()).toBe('11');
  const fields = page.locator('dialog.weeks .weeks-part');
  const fill = async (part: number, from: string, to: string) => {
    await fields.nth(part).locator('input').nth(0).fill(from);
    await fields.nth(part).locator('input').nth(1).fill(to);
  };
  await fill(1, '46', '47');
  await fill(2, '48', '49');
  await fill(3, '52', '52');
  expect(await page.locator('dialog.weeks .apply-summary').innerText()).toContain('Fills the book’s 52 pages exactly.');
  await page.locator('dialog.weeks [data-key="weeks-month"]').selectOption('12');
  const summary = await page.locator('dialog.weeks .apply-summary').innerText();
  expect(summary).toContain('5 weeks of DEC'.replace('DEC', 'Dec'));
  expect(summary).toContain('Nov 29–30, Jan 1–2');
  expect(summary).toContain('Inserted a Notes page on page 47');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  await shot(app, `${device}-weeks-december`);
  await click(app, page.locator('dialog.weeks [data-key="weeks-go"]'));
  let book = await saved(app);
  expect(book.recipe.month).toBe('2026-12');
  expect(book.dates[0]).toBe('2026-11-29');
  expect(book.dates.slice(1, 3)).toEqual(['2026-12-01', '2026-12-02']);
  expect(await page.locator('.book-msg').innerText()).toContain('Built 5 weeks of December');
  await click(app, page.getByRole('button', { name: 'Undo' }));
  expect((await saved(app)).recipe).toBeUndefined(); // one Undo step

  // ---- rebuilding: only the month
  await click(app, page.getByRole('button', { name: 'Build by week…' }));
  await page.locator('dialog.weeks [data-key="weeks-month"]').selectOption('2');
  await page.locator('dialog.weeks [data-key="weeks-year"]').fill('2027');
  await click(app, page.locator('dialog.weeks [data-key="weeks-go"]'));
  await click(app, page.getByRole('button', { name: 'Build by week…' }));
  expect(await page.locator('dialog.weeks .weeks-part').count()).toBe(0); // the rebuild view: month only
  await page.locator('dialog.weeks [data-key="weeks-month"]').selectOption('3');
  expect(await page.locator('dialog.weeks .apply-summary').innerText()).toContain('Mar');
  await shot(app, `${device}-weeks-rebuild`);
  await click(app, page.locator('dialog.weeks [data-key="weeks-go"]'));
  book = await saved(app);
  expect(book.recipe.month).toBe('2027-03');
  expect(book.pages).toHaveLength(52);

  // ---- flip through
  await click(app, page.getByRole('button', { name: 'Flip through' }));
  await page.waitForSelector('dialog.flip[open]');
  await page.waitForTimeout(700);
  expect(await page.locator('dialog.flip .flip-bar .where').innerText()).not.toBe('Inside front cover and page 1'); // it plays
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await click(app, page.locator('dialog.flip .flip-stage'));                     // a tap pauses
  const paused = await page.locator('dialog.flip .flip-bar .where').innerText();
  await page.waitForTimeout(500);
  expect(await page.locator('dialog.flip .flip-bar .where').innerText()).toBe(paused);
  await page.locator('dialog.flip [data-help="flip-speed"]').fill('600');
  expect(await page.locator('dialog.flip .flip-speed .hint').innerText()).toBe('600 ms per opening');
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

describe('build by week and flip through', () => {
  it('works on a phone', () => run('phone'));
  it('works on a tablet', () => run('tablet'));
  it('works on a desktop', () => run('desktop'));

  it('desktop keys: Space pauses, arrows step, Escape stops', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.evaluate((json) => localStorage.setItem('dotwork.book', json), fixture);
    await page.reload();
    await page.waitForSelector('#canvas');
    await page.locator('#menu-page').click();
    await page.locator('#view-book').click();
    await page.getByRole('button', { name: 'Flip through' }).click();
    await page.waitForSelector('dialog.flip[open]');
    await page.keyboard.press(' ');
    const paused = await page.locator('dialog.flip .flip-bar .where').innerText();
    await page.waitForTimeout(500);
    expect(await page.locator('dialog.flip .flip-bar .where').innerText()).toBe(paused);
    await page.keyboard.press('ArrowRight');
    expect(await page.locator('dialog.flip .flip-bar .where').innerText()).not.toBe(paused);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.flip', { state: 'detached' });
    expect(app.errors).toEqual([]);
    await app.ctx.close();
  });
});
