import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { bookMore, hit, missingHelp, open, shot, start, stop, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const type = async (app: App, selector: string, value: string) => {
  const input = app.page.locator(selector);
  await input.fill(value);
  await input.dispatchEvent('input');
  await input.dispatchEvent('change');
};
const profile = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.printer') ?? 'null'));
const bookPrint = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.book') ?? 'null')?.print);
const savedBook = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.book') ?? 'null'));
const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const download = async (app: App, selector: string) => {
  const [d] = await Promise.all([app.page.waitForEvent('download'), hit(app, selector)]);
  return { name: d.suggestedFilename(), bytes: await readFile((await d.path())!) };
};
const pickLayout = async (app: App, dialog: string, layout: string) => {
  await app.page.locator(`dialog.${dialog} [data-key="book-sheet-layout"]`).selectOption(layout);
};
const openPdfTab = async (app: App) => {
  await hit(app, '#export');
  await hit(app, 'dialog.export [data-tab="pdf"]');
  await app.page.waitForSelector('dialog.export [data-key="book-sheet-layout"]');
};

for (const device of ['phone', 'tablet', 'desktop'] as const) {
  describe(`letter two-up (${device})`, () => {
    it('picks the layout on the PDF tab: the fields show that layout’s values, two-up asks for the bottom book, and the zip has print-duplex.pdf', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openPdfTab(app);
      const value = (key: string) => page.locator(`dialog.export [data-key="${key}"]`).inputValue();
      expect(await value('book-sheet-layout')).toBe('half_letter');
      expect(await value('book-front-offset-x')).toBe('1.7'); // the owner's half-letter calibration
      expect(await value('book-scale-x')).toBe('100');
      expect(await page.locator('dialog.export [data-key="pdf-bottom-book"]').count()).toBe(0);
      await shot(app, `${device}-layout-half-letter`);

      await pickLayout(app, 'export', 'letter_two_up');
      expect(await value('book-sheet-layout')).toBe('letter_two_up');
      expect(await value('book-front-offset-x')).toBe('0'); // two-up starts at zero offsets and 100 %
      expect(await value('book-back-rotation')).toBe('0');
      expect(await page.locator('dialog.export input[aria-label="Scale along the 11 in edge (%)"]').count()).toBe(1); // named by the paper's edges
      expect(await value('book-scale-x')).toBe('100');
      expect(await value('book-creep')).toBe('0.3'); // shared
      expect(await page.locator('dialog.export [data-key="pdf-bottom-book"]').count()).toBe(1);
      expect(await page.locator('dialog.export').innerText()).toContain('print-duplex.pdf');
      expect(await missingHelp(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      await page.locator('dialog.export [data-key="book-sheet-layout"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-layout-two-up`);

      // each layout keeps its own values
      await type(app, 'dialog.export [data-key="book-scale-x"]', '101.5');
      await pickLayout(app, 'export', 'half_letter');
      expect(await value('book-scale-x')).toBe('100');
      expect(await value('book-front-offset-x')).toBe('1.7');
      await pickLayout(app, 'export', 'letter_two_up');
      expect(await value('book-scale-x')).toBe('101.5');
      expect((await profile(app)).layouts.letter_two_up.scale_x_pct).toBe(101.5); // the printer's, not the book's
      expect((await profile(app)).layouts.half_letter.scale_x_pct).toBe(100);
      expect((await bookPrint(app)) ?? { signatures: 1 }).toEqual({ signatures: 1 }); // never the printer's settings
      await type(app, 'dialog.export [data-key="book-scale-x"]', '100');

      // out-of-limit scale is brought back in
      await type(app, 'dialog.export [data-key="book-scale-y"]', '120');
      expect(await value('book-scale-y')).toBe('105');
      await type(app, 'dialog.export [data-key="book-scale-y"]', '100');

      const zipped = await download(app, 'dialog.export [data-key="export-pdf"]');
      expect(zipped.name).toBe('untitled-book-print.zip');
      const text = zipped.bytes.toString('latin1');
      for (const f of ['print-duplex.pdf', 'print-first.pdf', 'print-second.pdf', 'cover-outside.pdf', 'cover-inside.pdf', 'summary.txt']) expect(text, f).toContain(f);
      expect(app.errors).toEqual([]);
    });

    it('refuses a two-up offset that would print closer than 3 mm to the edge, with the reason', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openPdfTab(app);
      await pickLayout(app, 'export', 'letter_two_up');
      await type(app, 'dialog.export [data-key="book-front-offset-y"]', '2');
      const zipped = await download(app, 'dialog.export [data-key="export-pdf"]');
      const files = zipped.bytes.toString('latin1');
      expect(files).toContain('error.txt');
      expect(files).toMatch(/would be 1\.85 mm from the top edge; printers need at least 3 mm/);
      expect(await page.locator('dialog.export .lib-msg').innerText()).toMatch(/Can’t export/);
    });

    it('calibrates a layout from the one sheet: the long lines become its scale, and the other layout is left alone', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openPdfTab(app);
      await pickLayout(app, 'export', 'letter_two_up');
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.calibrate .cal-progress').innerText()).toBe('Step 1 of 3: Sheet');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('Letter (not borderless)');
      expect(await page.locator('dialog.calibrate').innerText()).not.toContain('Statement (Borderless)');
      expect(await page.locator('dialog.calibrate [data-key="book-sheet-layout"]').count()).toBe(0);
      expect(await missingHelp(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      const sheet = await download(app, 'dialog.calibrate [data-key="calibrate-download-sheet"]');
      expect(sheet.name).toBe('calibration-sheet.pdf');
      const pdf = await PDFDocument.load(sheet.bytes);
      expect(pdf.getPageCount()).toBe(2); // the front and the back
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(11 * 72, 1); // a letter sheet, two halves
      await type(app, 'dialog.calibrate [data-key="calibrate-read-line-x"]', '188');
      await type(app, 'dialog.calibrate [data-key="calibrate-read-line-y"]', '262');
      const result = await page.locator('[data-key="calibrate-sheet-result"]').innerText();
      expect(result).toContain('Scale along the 8.5 in edge: 100 → 101.06 %');
      expect(result).toContain('Scale along the 11 in edge: 100 → 99.24 %');
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-sheet"]');
      const saved = await profile(app);
      expect(saved.layouts.letter_two_up).toMatchObject({ scale_x_pct: 101.06, scale_y_pct: 99.24 });
      expect(saved.layouts.half_letter).toMatchObject({ scale_x_pct: 100, scale_y_pct: 100 });
      expect(saved.sheet_layout).toBe('letter_two_up');
      expect((await bookPrint(app)) ?? { signatures: 1 }).toEqual({ signatures: 1 }); // never the printer's settings
      expect(app.errors).toEqual([]);
    });

    it('designs the outside covers in Book view, beside the inside covers, with no page number', async () => {
      const app = await open(env, device);
      const { page } = app;
      await hit(app, '#menu-page');
      await hit(app, '#view-book');
      await page.waitForSelector('.stage-page');
      const where = () => page.locator('.where strong').innerText();
      await hit(app, '[data-help="nav-prev"]');
      expect(await where()).toBe('Inside front cover');
      await hit(app, '[data-help="nav-prev"]');
      expect(await where()).toBe('Outside front cover');
      expect(await page.locator('.where .hint').innerText()).toBe('Right-hand page');
      expect(await page.locator('[data-help="nav-prev"]').isDisabled()).toBe(true);
      await hit(app, '[data-help="book-choose"]');
      await page.waitForSelector('dialog.picker[open] .design');
      expect(await page.locator('dialog.picker .lib-tabs').isVisible()).toBe(false); // a right page: pages only
      await hit(app, 'dialog.picker .design:has(.design-title:text-is("Lined page"))');
      expect((await savedBook(app)).cover.outside_front.name).toBe('Lined page');
      expect((await savedBook(app)).cover.outside_front.side).toBe('right');
      expect(await page.locator('.design-name strong').innerText()).toBe('Lined page');
      expect(await noOverflow(app)).toBe(true);
      await shot(app, `${device}-book-outside-front`);

      // the other end: the outside back cover is a left page that stands alone (no spreads there)
      if (app.touch) await hit(app, '[data-help="book-contents"]');
      const rows = page.locator('.book-contents .crow');
      expect(await rows.first().innerText()).toContain('Outside front cover');
      expect(await rows.first().innerText()).toContain('Lined page');
      expect(await rows.last().innerText()).toContain('Outside back cover');
      await shot(app, `${device}-book-contents-covers`);
      await hit(app, '.book-contents .crow >> nth=-1');
      expect(await where()).toBe('Outside back cover');
      expect(await page.locator('[data-help="nav-next"]').isDisabled()).toBe(true);
      expect(await page.locator('.where .hint').innerText()).toBe('Left-hand page');
      await hit(app, '[data-help="book-choose"]');
      await page.waitForSelector('dialog.picker[open] .design');
      expect(await page.locator('dialog.picker .lib-tabs').isVisible()).toBe(false);
      await hit(app, 'dialog.picker .design:has(.design-title:text-is("Dot grid page"))');
      const book = await savedBook(app);
      expect(book.cover.outside_back.name).toBe('Dot grid page');
      expect(book.cover.outside_back.side).toBe('left');
      expect(book.pages).toHaveLength(52);
      // Undo takes it back
      await hit(app, '.book-bar button:has-text("Undo")');
      expect((await savedBook(app)).cover.outside_back ?? null).toBeNull();

      // Flip through starts at the outside front cover, alone on the right, and the next opening is the inside front cover facing page 1.
      await bookMore(app, 'Flip through');
      await page.waitForSelector('dialog.flip[open]');
      expect(await page.locator('dialog.flip .flip-bar .where').innerText()).toBe('Outside front cover');
      expect(await page.locator('dialog.flip .stage-page').count()).toBe(2);
      expect(await page.locator('dialog.flip .stage-page >> nth=0').locator('svg').count()).toBe(0); // nothing on the left
      expect(await page.locator('dialog.flip .stage-page >> nth=1').locator('svg').count()).toBe(1);
      await hit(app, 'dialog.flip [data-help="flip-next"]');
      expect(await page.locator('dialog.flip .flip-bar .where').innerText()).toBe('Inside front cover and page 1');
      await hit(app, 'dialog.flip [data-help="flip-prev"]');
      await hit(app, 'dialog.flip [data-help="flip-stop"]');
      await page.waitForSelector('dialog.flip', { state: 'detached' });
      expect(await where()).toBe('Outside front cover'); // it stops at the opening it was on
      expect(await missingHelp(app)).toEqual([]);
      expect(app.errors).toEqual([]);
    });
  });
}
