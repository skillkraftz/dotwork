import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, hit, open, start, stop, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const stored = (app: App, key: string) => app.page.evaluate((k) => localStorage.getItem(k), key);
const backups = (app: App, key: string) => app.page.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(`${k}.bad.`)), key);

async function openBook(app: App) {
  await choose(app, 'page', '#view-book');
  await app.page.waitForSelector('.stage-page');
}

describe('the owner’s lost book', () => {
  // The error: out-of-range print settings (paper thickness 2 mm, say) were saved into the draft, the book file format
  // refuses them, and the next refresh found a draft it couldn't read, started an empty book and overwrote the draft.
  it('keeps print settings the book file can hold, so a refresh brings the same book back', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await openBook(app);
    await choose(app, 'page', '#settings');
    await page.waitForSelector('dialog.settings[open]');
    await page.locator('[data-key="settings-book-name"]').fill('Field notes');
    const thickness = page.locator('dialog.settings [data-key="book-creep"]');
    await thickness.fill('2');
    await thickness.dispatchEvent('change');
    expect(await thickness.inputValue()).toBe('1'); // brought back into range, not kept
    await page.locator('dialog.settings [data-key="book-signatures"]').fill('99');
    await page.locator('dialog.settings [data-key="book-signatures"]').dispatchEvent('change');
    expect(await stored(app, 'dotwork.book')).toContain('"signatures": 20'.replace(': ', ':'));

    await page.reload();
    await openBook(app);
    expect(await page.locator('#notice').isVisible()).toBe(false);
    expect(JSON.parse((await stored(app, 'dotwork.book'))!).name).toBe('Field notes');
    expect(await backups(app, 'dotwork.book')).toEqual([]);
    expect(app.errors).toEqual([]);
  });
});

describe('a draft that can’t be read is never lost', () => {
  const broken = JSON.stringify({ format: 'dotwork-book', version: 1, name: 'Precious', page_count: 52, page_numbers: true, print: { creep_per_sheet_mm: 2, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0, target_fore_edge_margin_mm: 3.5, back_offset_x_mm: 0, back_offset_y_mm: 0, signatures: 1 }, pages: Array(52).fill(null), cover: { front: null, back: null } });

  it('keeps a bad book draft under a backup key, says why, and offers the download and Start fresh', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.evaluate((raw) => localStorage.setItem('dotwork.book', raw), broken);
    await page.reload();
    await openBook(app);
    const notice = page.locator('#notice');
    await notice.waitFor({ state: 'visible' });
    const text = await notice.innerText();
    expect(text).toContain('print.creep_per_sheet_mm');
    expect(text).toContain('Nothing was deleted');
    expect(await notice.locator('button').allInnerTexts()).toEqual(['Download the draft', 'Start fresh', 'Copy details', 'Dismiss']);
    const kept = await backups(app, 'dotwork.book');
    expect(kept).toHaveLength(1);
    expect(await stored(app, kept[0])).toBe(broken);

    // Download the draft gives the stored text back
    const [file] = await Promise.all([page.waitForEvent('download'), notice.locator('[data-key="draft-download"]').click()]);
    expect(file.suggestedFilename()).toBe('dotwork-book-draft.json');

    // The notice outlives other messages being cleared, until Start fresh
    await choose(app, 'page', '#settings');
    await hit(app, 'dialog.settings header button');
    expect(await notice.isVisible()).toBe(true);
    await notice.locator('[data-key="draft-fresh"]').click();
    expect(await notice.isVisible()).toBe(false);

    // Changing the new book doesn't touch the backup
    await choose(app, 'page', '#settings');
    await page.locator('[data-key="settings-book-name"]').fill('Second try');
    expect(await stored(app, kept[0])).toBe(broken);
    await page.reload();
    expect(await backups(app, 'dotwork.book')).toEqual(kept);
    expect(app.errors).toEqual([]);
  });

  it('does the same for a page draft', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.evaluate(() => localStorage.setItem('dotwork.page', '{"format":"dotwork-page","version":2,"elements":"nope"}'));
    await page.reload();
    const notice = page.locator('#notice');
    await notice.waitFor({ state: 'visible' });
    expect(await notice.innerText()).toContain('Your saved page draft couldn’t be opened');
    expect(await backups(app, 'dotwork.page')).toHaveLength(1);
    await notice.locator('[data-key="copy-details"]').click();
    await page.waitForFunction(() => /Copied|Couldn’t copy/.test(document.querySelector('#notice [data-key="copy-details"]')!.textContent!));
  });
});
