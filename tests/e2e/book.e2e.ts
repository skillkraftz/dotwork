import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { hit, libraryItems, missingHelp, nameOpen, open, openDoc, reload, seedDoc, seedLibrary, shot, start, stop, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Controls under 44 px in the book view and its windows, other than checkboxes and radios. */
const smallControls = (app: App) => app.page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('#book button, #book select, #book input, dialog[open] button, dialog[open] input')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(el).visibility === 'hidden' || (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') continue;
    if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});

/** The entries of a zip whose files are stored without compression, as Dotwork writes them. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let at = 0; bytes.readUInt32LE(at) === 0x04034b50;) {
    const size = bytes.readUInt32LE(at + 18), name = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const start = at + 30 + name + extra;
    out.set(bytes.subarray(at + 30, at + 30 + name).toString('utf8'), bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

async function openBook(app: App) {
  await hit(app, '#menu-page');
  await hit(app, '#view-book');
  await app.page.waitForSelector('.stage-page');
}

/** The outline sheet is closed on a phone until the Outline button opens it; beside the page on a desktop it is always there. */
async function showOutline(app: App) {
  if (app.touch && !(await app.page.locator('.book-contents').isVisible())) await hit(app, '.contents-toggle');
  await app.page.waitForSelector('.book-contents', { state: 'visible' });
}

/** Add a block: Add…, the tab it is on, and its card. */
async function add(app: App, tab: 'pages' | 'spreads' | 'blocks', name: string, from = '[data-key="book-add"]') {
  if (app.touch && (await app.page.locator('.book-contents').isVisible())) await hit(app, '.contents-close');
  await hit(app, from);
  await app.page.waitForSelector('dialog.picker[open] .design');
  await hit(app, `dialog.picker [data-tab="${tab}"]`);
  await hit(app, `dialog.picker .design[data-name="${name}"]`);
  await app.page.waitForSelector('dialog.picker', { state: 'hidden' });
}

const row = (app: App, key: string) => app.page.locator(`[data-block-row="${key}"]`);
/** Open a row's settings, if they are not open. */
async function settings(app: App, key: string) {
  await showOutline(app);
  if ((await row(app, key).locator('.orow-settings').count()) === 0) await hit(app, `[data-block-row="${key}"] > .orow-line [data-key="outline-more"]`);
  await app.page.waitForSelector(`[data-block-row="${key}"] .orow-settings`);
}
/** Type a number into a row's stepper, as a person does, and leave the field. */
async function setNumber(app: App, key: string, field: string, value: string) {
  await settings(app, key);
  const input = row(app, key).locator(`[data-key="${field}"]`);
  await input.fill(value);
  await input.dispatchEvent('change');
}
const used = (app: App) => app.page.locator('.book-total [data-key="book-used"]').innerText();
const outlineTypes = async (app: App) => (await openDoc(app, 'book')).outline.map((b: { type: string }) => b.type);

/** The main path: a 52-page book as an outline, a row moved, and the print files. */
async function buildFiftyTwo(app: App, device: Device) {
  const { page } = app;
  await openBook(app);
  expect(await noOverflow(app)).toBe(true);
  expect(await used(app)).toBe('0 of 52 pages');
  expect(await page.locator('.where strong').innerText()).toBe('Page 1');
  const stage = (await page.locator('.book-stage').boundingBox())!, pg = (await page.locator('.stage-page svg').boundingBox())!;
  expect(pg.height).toBeGreaterThan(stage.height - 30); // the page gets the room
  await showOutline(app);
  expect(await page.locator('[data-key="outline-empty"]').count()).toBe(1);
  await shot(app, `${device}-outline-empty`);

  // blank ×10
  await add(app, 'blocks', 'Blank page');
  expect(await used(app)).toBe('1 of 52 pages');
  await setNumber(app, '0', 'outline-repeat', '10');
  expect(await used(app)).toBe('10 of 52 pages');

  // a group of an idea spread and a lined page, ×6
  await add(app, 'blocks', 'New group');
  await settings(app, '1');
  await hit(app, '[data-block-row="1"] [data-key="outline-add-to-group"]');
  await page.waitForSelector('dialog.picker[open] .design');
  await hit(app, 'dialog.picker [data-tab="spreads"]');
  await hit(app, 'dialog.picker .design[data-name="Ideas spread"]');
  await page.waitForSelector('dialog.picker', { state: 'hidden' });
  await settings(app, '1');
  await hit(app, '[data-block-row="1"] [data-key="outline-add-to-group"]');
  await page.waitForSelector('dialog.picker[open] .design');
  await hit(app, 'dialog.picker [data-tab="pages"]');
  await hit(app, 'dialog.picker .design[data-name="Lined page"]');
  await page.waitForSelector('dialog.picker', { state: 'hidden' });
  expect(await row(app, '1.0').count()).toBe(1);
  expect(await row(app, '1.1').count()).toBe(1);
  await setNumber(app, '1', 'outline-repeat', '6');
  // 6 × (a gap page, 2 for the spread, 1 for the lined page), after the 10 blank pages
  expect(await used(app)).toBe('34 of 52 pages');
  expect(await page.locator('.orow.gap').count()).toBe(1); // the first one, before the group; the others are inside it
  expect(await page.locator('.orow.gap').first().innerText()).toContain('1 gap page');
  await shot(app, `${device}-outline-group`);

  // free pages for the rest, and a closing page pinned to the last page
  await add(app, 'blocks', 'Free pages');
  expect(await used(app)).toBe('52 of 52 pages'); // they take the 18 pages left
  await add(app, 'pages', 'Notes');
  await settings(app, '3');
  await hit(app, '[data-block-row="3"] [data-key="outline-pin-last"]');
  expect(await used(app)).toBe('52 of 52 pages');
  expect(await page.locator('.book-total .over-by').count()).toBe(0);
  await showOutline(app);
  expect(await row(app, '3').locator('.crow-name').innerText()).toContain('pinned: last page');
  expect(await row(app, '3').locator('.crow-name').innerText()).toContain('p.52');
  expect(await row(app, '2').locator('.crow-name').innerText()).toContain('17 pages');
  expect(await noOverflow(app)).toBe(true);
  if (app.touch) expect(await smallControls(app)).toEqual([]);
  expect(await missingHelp(app)).toEqual([]);
  await shot(app, `${device}-outline`);

  const book = await openDoc(app, 'book');
  expect(book.page_count).toBe(52);
  expect(book.outline.map((b: { type: string }) => b.type)).toEqual(['page', 'group', 'free', 'page']);
  expect(book.outline[0]).toMatchObject({ page: null, repeat: { times: 10 } });
  expect(book.outline[1]).toMatchObject({ repeat: { times: 6 } });
  expect(book.outline[1].children.map((c: { type: string }) => c.type)).toEqual(['spread', 'page']);
  expect(book.outline[1].children[0].from.id).toMatch(/^example:spread:/); // the link to the design it came from, kept
  expect(book.outline[3]).toMatchObject({ pin: 'last' });
  expect('pages' in book || 'dates' in book || 'recipe' in book).toBe(false);

  // tapping a row goes to its first page: the idea spread's left page, after the gap page
  await showOutline(app);
  await hit(app, '[data-block-row="1"] .orow-main');
  expect(await page.locator('.where strong').innerText()).toBe('Page 12');
  expect(await page.locator('.design-name strong').innerText()).toBe('Idea page');
  expect(await page.locator('.design-name .page-origin').innerText()).toContain('From block 2');

  // move the group down: the free pages now come before it, and the book still fits
  await showOutline(app);
  await hit(app, '[data-block-row="1"] > .orow-line [data-key="outline-down"]');
  expect(await outlineTypes(app)).toEqual(['page', 'free', 'group', 'page']);
  expect(await used(app)).toBe('51 of 52 pages'); // the group no longer needs a gap page before it
  await hit(app, '[data-block-row="2"] > .orow-line [data-key="outline-up"]');
  expect(await outlineTypes(app)).toEqual(['page', 'group', 'free', 'page']);
  expect(await used(app)).toBe('52 of 52 pages');
  await hit(app, '[data-block-row="1"] > .orow-line [data-key="outline-down"]'); // and Undo takes a move back
  if (app.touch) await hit(app, '.contents-close');
  await hit(app, '.book-bar [data-key="book-undo"]');
  expect(await outlineTypes(app)).toEqual(['page', 'group', 'free', 'page']);

  // print: the PDFs follow the outline
  await nameOpen(app, 'Outline book');
  await hit(app, '.book-bar [data-key="book-export"]');
  await page.waitForSelector('dialog.export[open] [data-key="export-pdf"]');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 50_000 }), hit(app, '[data-key="export-pdf"]')]);
  expect(download.suggestedFilename()).toBe('outline-book-print.zip');
  const files = unzip(readFileSync((await download.path())!));
  expect([...files.keys()]).toEqual(expect.arrayContaining(['pages.pdf', 'print-first.pdf', 'print-second.pdf', 'cover-outside.pdf', 'cover-inside.pdf', 'book.json']));
  expect((await PDFDocument.load(files.get('pages.pdf')!)).getPageCount()).toBe(52);
  expect((await PDFDocument.load(files.get('print-first.pdf')!)).getPageCount()).toBe(13);
  expect((await PDFDocument.load(files.get('print-second.pdf')!)).getPageCount()).toBe(13);
  expect(JSON.parse(files.get('book.json')!.toString('utf8')).outline).toHaveLength(4);
  expect(app.errors).toEqual([]);
}

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`the outline on a ${device}`, () => {
    it('builds a 52-page book from blocks, moves a row, and prints it', async () => {
      await buildFiftyTwo(await open(env, device), device);
    });

    it('says when the book is over, in red, and Make the book longer fixes it', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openBook(app);
      await add(app, 'blocks', 'Blank page');
      await setNumber(app, '0', 'outline-repeat', '56');
      if (app.touch) await hit(app, '.contents-close');
      expect(await used(app)).toBe('56 of 52 pages');
      expect(await page.locator('.book-total .over-by').innerText()).toBe('over by 4 pages');
      expect(await page.locator('.book-total .over-by').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(204, 0, 0)');
      expect(await page.locator('.book-bar [data-key="book-export"]').isDisabled()).toBe(true);
      expect(await missingHelp(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      if (app.touch) expect(await smallControls(app)).toEqual([]);
      await shot(app, `${device}-outline-over`);
      await hit(app, '.book-total [data-key="book-make-longer"]');
      expect(await used(app)).toBe('56 of 56 pages');
      expect(await page.locator('.book-total .over-by').count()).toBe(0);
      expect(await page.locator('.book-bar [data-key="book-export"]').isDisabled()).toBe(false);
      expect((await openDoc(app, 'book')).page_count).toBe(56);
      expect(app.errors).toEqual([]);
    });

    it('commits a typed number or name with Enter, or by tapping elsewhere, without an error', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openBook(app);
      // Some browsers throw when the outline is redrawn inside a field's own change or blur event; this browser doesn't, so look for the cause:
      // the outline must never be redrawn while one of those events is being handled.
      await page.evaluate(() => {
        const w = window as unknown as { redrawnIn: string[] };
        w.redrawnIn = [];
        const outline = document.querySelector('.book-contents')!;
        const real = outline.replaceChildren.bind(outline);
        outline.replaceChildren = (...nodes: (Node | string)[]) => {
          const type = (window.event as Event | undefined)?.type ?? '';
          if (['change', 'blur', 'focusout', 'focus', 'focusin'].includes(type)) w.redrawnIn.push(type);
          real(...nodes);
        };
      });
      await add(app, 'blocks', 'Blank page');
      await settings(app, '0');
      const repeat = () => row(app, '0').locator('[data-key="outline-repeat"]');
      await repeat().click();
      await repeat().fill('7');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-key="book-used"]')?.textContent === '7 of 52 pages');
      await repeat().click();
      await repeat().fill('9');
      await page.locator('.book-contents header h2').click(); // leaving the field commits it
      await page.waitForFunction(() => document.querySelector('[data-key="book-used"]')?.textContent === '9 of 52 pages');
      await add(app, 'blocks', 'New group');
      await settings(app, '1');
      const name = row(app, '1').locator('[data-key="outline-group-name"]');
      await name.click();
      await name.fill('Ideas');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.body.textContent?.includes('Ideas'));
      expect((await openDoc(app, 'book')).outline[1].name).toBe('Ideas');
      expect((await openDoc(app, 'book')).outline[0].repeat.times).toBe(9);
      expect(await page.evaluate(() => (window as unknown as { redrawnIn: string[] }).redrawnIn)).toEqual([]);
      expect(app.errors).toEqual([]);
    });

    it('lists a book and a section from before the outline as Old format, with Export and Delete, and does not open them', async () => {
      const app = await open(env, device);
      const { page } = app;
      const oldBook = JSON.parse(readFileSync('tests/fixtures/november-2026-journal.json', 'utf8'));
      const oldSection = { format: 'dotwork-section', version: 1, name: 'Old week', pages: [null, null], days: [0, 1], weekday: 1, move: 'week', left: false };
      await seedLibrary(app, [{ id: 'old-section', kind: 'section', name: 'Old week', data: oldSection }]);
      await seedDoc(app, 'book', oldBook, 'November 2026 journal'); // it was the book open at the last visit
      await openBook(app); // the app starts a new book instead of opening it
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Untitled: name it');
      expect(app.errors).toEqual([]);

      await hit(app, '#menu-edit');
      await hit(app, '#library');
      await hit(app, '[data-tab="books"]');
      const card = page.locator('.lib-card[data-name="November 2026 journal"]');
      await card.waitFor();
      expect(await card.locator('.lib-meta .hint').innerText()).toContain('Old format');
      await shot(app, `${device}-old-format`);
      await hit(app, '.lib-card[data-name="November 2026 journal"] .lib-open');
      expect(await page.locator('dialog.library.browser .lib-msg').innerText()).toContain('old format');
      expect(await page.locator('dialog.library.browser').evaluate((d: HTMLDialogElement) => d.open)).toBe(true); // nothing was opened
      expect(await page.innerText('#doc-name')).toBe('Untitled: name it');
      await hit(app, '.lib-card[data-name="November 2026 journal"] .lib-more');
      await page.waitForSelector('.lib-menu');
      expect(await page.locator('.lib-menu button').allInnerTexts()).toEqual(['Export', 'Delete']);
      expect(await missingHelp(app)).toEqual([]);
      const [file] = await Promise.all([page.waitForEvent('download'), hit(app, '.lib-menu [data-key="library-export-file"]')]);
      expect(file.suggestedFilename()).toBe('november-2026-journal.json');
      expect(JSON.parse(readFileSync((await file.path())!, 'utf8')).pages).toHaveLength(52); // the file as it was kept

      await hit(app, '[data-tab="sections"]');
      const section = page.locator('.lib-card[data-name="Old week"]');
      await section.waitFor();
      expect(await section.locator('.lib-meta .hint').innerText()).toContain('Old format');
      await hit(app, '.lib-card[data-name="Old week"] .lib-more');
      await page.waitForSelector('.lib-menu');
      expect(await page.locator('.lib-menu button').allInnerTexts()).toEqual(['Export', 'Delete']);
      page.once('dialog', (d) => void d.accept());
      await hit(app, '.lib-menu [data-key="library-delete"]');
      await page.waitForSelector('.lib-card[data-name="Old week"]', { state: 'detached' });
      await hit(app, '[data-tab="books"]');
      await hit(app, '.lib-card[data-name="November 2026 journal"] .lib-more');
      page.once('dialog', (d) => void d.accept());
      await hit(app, '.lib-menu [data-key="library-delete"]');
      await page.waitForSelector('.lib-card[data-name="November 2026 journal"]', { state: 'detached' });
      expect((await libraryItems(app)).filter((i) => i.name === 'November 2026 journal' || i.name === 'Old week')).toEqual([]);
      await reload(app);
      expect(app.errors).toEqual([]);
    });
  });
}
