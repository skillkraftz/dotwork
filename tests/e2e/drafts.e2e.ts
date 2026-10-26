import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, hit, open, openDoc, start, stop, type App, type Env } from './harness';

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
  // refused them, and the next refresh found a draft it couldn't read, started an empty book and overwrote the draft.
  // Printer settings now live in the printer profile, so a book can never be refused over them.
  it('keeps the book a refresh brings back, whatever the printer settings: only the signatures are in it', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await openBook(app);
    await choose(app, 'page', '#settings');
    await page.waitForSelector('dialog.settings[open]');
    await page.locator('[data-key="settings-book-name"]').fill('Field notes');
    expect(await page.locator('dialog.settings [data-key="book-creep"]').count()).toBe(0); // not a book setting
    await page.locator('dialog.settings [data-key="book-signatures"]').fill('99');
    await page.locator('dialog.settings [data-key="book-signatures"]').dispatchEvent('change');
    expect(await stored(app, 'dotwork.book')).toContain('"signatures": 20'.replace(': ', ':'));
    expect(JSON.parse((await stored(app, 'dotwork.book'))!).print).toEqual({ signatures: 20 });

    await page.reload();
    await openBook(app);
    expect(await page.locator('#notice').isVisible()).toBe(false);
    expect(JSON.parse((await stored(app, 'dotwork.book'))!).name).toBe('Field notes');
    expect(await backups(app, 'dotwork.book')).toEqual([]);
    expect(app.errors).toEqual([]);
  });

  it('opens a book draft saved with any printer settings in it, such as the broken ones that used to be refused', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    const old = JSON.stringify({ format: 'dotwork-book', version: 1, name: 'Precious', page_count: 52, page_numbers: true, print: { creep_per_sheet_mm: 2, back_offset_x_mm: 0, signatures: 1 }, pages: Array(52).fill(null), cover: { front: null, back: null } });
    await page.evaluate((raw) => localStorage.setItem('dotwork.book', raw), old);
    await page.reload();
    await openBook(app);
    expect(await page.locator('#notice').isVisible()).toBe(false);
    expect(JSON.parse((await stored(app, 'dotwork.book'))!).name).toBe('Precious');
    expect(await backups(app, 'dotwork.book')).toEqual([]);
  });
});

describe('a draft that can’t be read is never lost', () => {
  const broken = JSON.stringify({ format: 'dotwork-book', version: 1, name: 'Precious', page_count: 52, page_numbers: 'yes', print: { signatures: 1 }, pages: Array(52).fill(null), cover: { front: null, back: null } });

  it('keeps a bad book draft under a backup key, says why, and offers the download and Start fresh', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.evaluate((raw) => localStorage.setItem('dotwork.book', raw), broken);
    await page.reload();
    await openBook(app);
    const notice = page.locator('#notice');
    await notice.waitFor({ state: 'visible' });
    const text = await notice.innerText();
    expect(text).toContain('page_numbers');
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

  it('no longer reads the old page and spread drafts, and leaves them where they are', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    const old = '{"format":"dotwork-page","version":2,"name":"Old draft","elements":[{"type":"box","x":1,"y":2,"w":3,"h":3}]}';
    await page.evaluate((raw) => { localStorage.setItem('dotwork.page', raw); localStorage.setItem('dotwork.spread.left', raw); localStorage.setItem('dotwork.spread.name', 'Old spread'); }, old);
    await page.reload();
    await page.waitForSelector('body[data-ready]');
    await page.waitForFunction(() => document.querySelector('#doc-status')?.textContent === 'Saved');
    expect((await openDoc(app, 'page')).elements).toEqual([]); // the page on screen is not the draft
    expect(await page.innerText('#doc-name')).not.toContain('Old draft');
    expect(await stored(app, 'dotwork.page')).toBe(old);
    expect(await stored(app, 'dotwork.spread.name')).toBe('Old spread');
    expect(await backups(app, 'dotwork.page')).toHaveLength(0);
    expect(await page.locator('#notice').isVisible()).toBe(false);
  });
});
