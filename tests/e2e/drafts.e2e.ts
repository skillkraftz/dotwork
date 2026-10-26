import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, open, openDoc, start, stop, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const stored = (app: App, key: string) => app.page.evaluate((k) => localStorage.getItem(k), key);
const backups = (app: App, key: string) => app.page.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(`${k}.bad.`)), key);

async function openBook(app: App) {
  await choose(app, 'page', '#view-book');
  await app.page.waitForSelector('.stage-page');
}

describe('the book is a Library document, not a draft', () => {
  // Printer settings live in the printer profile, so a book can never be refused over them; only the signatures are in it.
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
    const saved = await openDoc(app, 'book');
    expect(saved.name).toBe('Field notes');
    expect(saved.print).toEqual({ signatures: 20 });

    await page.reload();
    await openBook(app);
    expect(await page.locator('#notice').isVisible()).toBe(false);
    expect((await openDoc(app, 'book')).name).toBe('Field notes');
    expect(app.errors).toEqual([]);
  });

  it('leaves an old dotwork.book key where it is: not read, not written, not removed', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    const old = JSON.stringify({ format: 'dotwork-book', version: 1, name: 'Precious', page_count: 52, page_numbers: true, print: { signatures: 1 }, pages: Array(52).fill(null), cover: { front: null, back: null } });
    await page.evaluate((raw) => localStorage.setItem('dotwork.book', raw), old);
    await page.reload();
    await openBook(app);
    expect(await page.innerText('#doc-name')).not.toContain('Precious');
    await choose(app, 'page', '#settings');
    await page.locator('[data-key="settings-book-name"]').fill('Second try');
    await openDoc(app, 'book');
    expect(await stored(app, 'dotwork.book')).toBe(old);
    expect(await backups(app, 'dotwork.book')).toEqual([]);
    expect(await page.locator('#notice').isVisible()).toBe(false);
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
