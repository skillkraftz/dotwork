import { readFile } from 'node:fs/promises';
import { DEFAULT_PRINT } from '../../src/book/impose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { hit, missingHelp, open, openDoc, shot, start, stop, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const type = async (app: App, selector: string, value: string) => {
  const input = app.page.locator(selector);
  await input.fill(value);
  await input.dispatchEvent('input');
  await input.dispatchEvent('change');
};
/** The saved printer profile as the app reads it: a layout left at the defaults is not stored, so it is filled in from them. */
const profile = async (app: App) => {
  const stored = await app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.printer') ?? 'null'));
  return stored && { ...stored, layouts: { ...DEFAULT_PRINT.layouts, ...stored.layouts } };
};
const savedBook = (app: App) => openDoc(app, 'book');
const bookPrint = async (app: App) => (await savedBook(app))?.print;
const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const download = async (app: App, selector: string) => {
  const [d] = await Promise.all([app.page.waitForEvent('download'), hit(app, selector)]);
  return { name: d.suggestedFilename(), bytes: await readFile((await d.path())!) };
};
const pickLayout = async (app: App, dialog: string, layout: string) => {
  await app.page.locator(`dialog.${dialog} [data-key="book-sheet-layout"]`).selectOption(layout);
};
/** A saved printer profile with no two-up offsets, so these walks start from simple numbers (the app's own two-up defaults are the owner's calibration, which sits close to the paper's edge). */
const startZeroTwoUp = async (app: App, twoUp: Record<string, number> = {}) => {
  const none = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100, back_rotation_deg: 0 };
  await app.page.evaluate(([zero, extra]) => {
    localStorage.setItem('dotwork.printer', JSON.stringify({
      creep_per_sheet_mm: 0.3, fore_edge_shift_mm: 2, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5, sheet_layout: 'half_letter',
      layouts: { half_letter: { ...zero, front_offset_x_mm: 1.7, front_offset_y_mm: -0.05, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05 }, letter_two_up: { ...zero, ...extra } },
      shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8,
    }));
  }, [none, twoUp] as const);
  await app.page.reload();
  await app.page.waitForSelector('#canvas');
};
const openPdfTab = async (app: App) => {
  await hit(app, '#export');
  await hit(app, 'dialog.export [data-tab="pdf"]');
  await app.page.waitForSelector('dialog.export [data-key="book-sheet-layout"]');
};

for (const device of ['phone', 'desktop'] as const) {
  describe(`letter two-up (${device})`, () => {
    it('picks the layout on the PDF tab: the fields show that layout’s values, two-up asks for the bottom book, and the zip has print-duplex.pdf', async () => {
      const app = await open(env, device);
      const { page } = app;
      await startZeroTwoUp(app);
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
      expect((await profile(app)).layouts.letter_two_up.auto.inside.scale_x_pct).toBe(101.5); // the printer's, not the book's
      expect((await profile(app)).layouts.half_letter.hand.inside.scale_x_pct).toBe(100);
      expect((await bookPrint(app)) ?? { signatures: 1 }).toEqual({ signatures: 1 }); // never the printer's settings
      await type(app, 'dialog.export [data-key="book-scale-x"]', '100');

      // out-of-limit scale is brought back in
      await type(app, 'dialog.export [data-key="book-scale-y"]', '120');
      expect(await value('book-scale-y')).toBe('105');
      await type(app, 'dialog.export [data-key="book-scale-y"]', '100');

      const zipped = await download(app, 'dialog.export [data-key="export-pdf"]');
      expect(zipped.name).toBe('untitled-book-print.zip');
      const text = zipped.bytes.toString('latin1');
      for (const f of ['print-duplex.pdf', 'cover-duplex.pdf', 'summary.txt']) expect(text, f).toContain(f);

      // Reset this layout to defaults: it shows the values first, Cancel changes nothing, Yes brings back the calibrated defaults
      await page.locator('dialog.export [data-key="reset-layout"]').scrollIntoViewIfNeeded();
      await hit(app, 'dialog.export [data-key="reset-layout"]');
      const question = page.locator('dialog.export [data-key="reset-layout-question"]');
      await question.waitFor();
      expect(await question.innerText()).toContain('-0.25'); // the default's front offset x, beside the 0 it has now
      await shot(app, `${device}-reset-layout`);
      await hit(app, 'dialog.export [data-key="reset-layout-cancel"]');
      expect(await question.count()).toBe(0);
      expect(await value('book-front-offset-x')).toBe('0');
      await hit(app, 'dialog.export [data-key="reset-layout"]');
      await hit(app, 'dialog.export [data-key="reset-layout-yes"]');
      expect(await value('book-front-offset-x')).toBe('-0.25');
      expect(await value('book-scale-y')).toBe('101.01');
      expect(await value('book-back-rotation')).toBe('-0.183');
      await pickLayout(app, 'export', 'half_letter');
      expect(await value('book-front-offset-x')).toBe('1.7'); // the other layout is left alone
      expect(app.errors).toEqual([]);
    });

    it('warns about content that would print closer to the edge than the printable inset, naming the page and row, and still makes the files', async () => {
      const app = await open(env, device);
      const { page } = app;
      await startZeroTwoUp(app, { inset_front_top_mm: 6 }); // the printer leaves the front's top 6 mm unprinted
      await openPdfTab(app);
      await pickLayout(app, 'export', 'letter_two_up');
      const zipped = await download(app, 'dialog.export [data-key="export-pdf"]');
      const files = zipped.bytes.toString('latin1');
      for (const f of ['print-duplex.pdf', 'summary.txt']) expect(files, f).toContain(f);
      expect(files).not.toContain('error.txt');
      expect(files).toMatch(/Warnings:\n  - Book 1, page \d+, row 0 \(the header\): on the front of the letter sheet it prints [\d.]+ mm from the top edge/);
      const message = await page.locator('dialog.export .lib-msg').innerText();
      await shot(app, `${device}-edge-warning`);
      expect(message).toMatch(/The files were made/);
      expect(message).toMatch(/Book 1, page \d+, row 0 \(the header\): on the front of the letter sheet it prints/);
      expect(message).toMatch(/The print driver may cut it off; check by printing that page/);
      expect(message).not.toMatch(/Can’t export/);
      expect(app.errors).toEqual([]);
    });

    it('calibrates a layout from the one sheet: the long lines become its scale, and the other layout is left alone', async () => {
      const app = await open(env, device);
      const { page } = app;
      await startZeroTwoUp(app);
      await openPdfTab(app);
      await pickLayout(app, 'export', 'letter_two_up');
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.calibrate .cal-progress').innerText()).toBe('Step 1 of 4: Sheet');
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
      await type(app, 'dialog.calibrate [data-key="calibrate-read-line-x"]', '98');
      await type(app, 'dialog.calibrate [data-key="calibrate-read-line-y"]', '101');
      const result = await page.locator('[data-key="calibrate-sheet-result"]').innerText();
      expect(result).toContain('Scale along the 8.5 in edge: 100 → 102.04 %');
      expect(result).toContain('Scale along the 11 in edge: 100 → 99.01 %');
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-sheet"]');
      const saved = await profile(app);
      expect(saved.layouts.letter_two_up.auto.inside).toMatchObject({ scale_x_pct: 102.04, scale_y_pct: 99.01 });
      expect(saved.layouts.half_letter.hand.inside).toMatchObject({ scale_x_pct: 100, scale_y_pct: 100 });
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
      if (app.touch) await hit(app, '[data-help="book-outline"]');
      const rows = page.locator('.book-contents .orow');
      expect(await rows.first().innerText()).toContain('Outside front cover');
      expect(await rows.first().innerText()).toContain('Lined page');
      expect(await rows.last().innerText()).toContain('Outside back cover');
      await shot(app, `${device}-book-contents-covers`);
      await hit(app, '.book-contents .orow .orow-main >> nth=-1');
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
      expect(book.outline).toEqual([]); // the outline makes the pages; the covers are designed on their own
      // Undo takes it back
      await hit(app, '.book-bar button:has-text("Undo")');
      expect((await savedBook(app)).cover.outside_back ?? null).toBeNull();

      // Flip through starts at the outside front cover, alone on the right, and the next opening is the inside front cover facing page 1.
      await hit(app, '[data-key="book-flip"]');
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
