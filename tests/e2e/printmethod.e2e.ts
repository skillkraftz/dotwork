import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PRINT, clonePrint } from '../../src/book/impose';
import { hit, missingHelp, open, seedDoc, shot, start, stop, type App, type Env } from './harness';
import { readPdf } from '../pdf-text';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const BOOK = JSON.stringify({ format: 'dotwork-book', version: 1, name: 'Untitled book', page_count: 52, page_numbers: true, print: { signatures: 1 }, outline: [], cover: { front: null, back: null } });

/** The entries of a zip whose files are stored without compression, as Dotwork writes them. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let at = 0; bytes.readUInt32LE(at) === 0x04034b50;) {
    const size = bytes.readUInt32LE(at + 18), name = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const begin = at + 30 + name + extra;
    out.set(bytes.subarray(at + 30, at + 30 + name).toString('utf8'), bytes.subarray(begin, begin + size));
    at = begin + size;
  }
  return out;
}

const download = async (app: App, selector: string) => {
  const [d] = await Promise.all([app.page.waitForEvent('download'), hit(app, selector)]);
  return readFile((await d.path())!);
};

/** A saved profile whose cover paper differs from its inside paper (half letter, by hand: inside 1.7, cover 2.5). */
const seed = async (app: App) => {
  const p = clonePrint(DEFAULT_PRINT);
  p.layouts.half_letter.hand.cover.front_offset_x_mm = 2.5;
  await app.page.evaluate((profile) => localStorage.setItem('dotwork.printer', JSON.stringify(profile)), p as unknown as object);
  await seedDoc(app, 'book', JSON.parse(BOOK), JSON.parse(BOOK).name);
};

const select = (app: App, scope: string, key: string, value: string) => app.page.locator(`${scope} [data-key="${key}"]`).selectOption(value);

for (const device of ['phone', 'desktop'] as const) {
  describe(`the print method and the paper set (${device})`, () => {
    it('follows the method in the creep test’s page order, and keeps the cover paper’s numbers apart from the inside paper’s', async () => {
      const app = await open(env, device);
      const { page } = app;
      await seed(app);
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      await page.waitForSelector('dialog.export [data-key="calibrate-open"]');

      // The print settings show the method and, per paper, separate numbers.
      expect(await page.locator('dialog.export [data-key="print-method"]').inputValue()).toBe('hand'); // half letter's default
      expect(await page.locator('dialog.export [data-key="print-set"]').innerText()).toContain('inside paper');
      expect(await page.locator('dialog.export [data-key="book-front-offset-x"]').inputValue()).toBe('1.7');
      await select(app, 'dialog.export', 'paper-set', 'cover');
      expect(await page.locator('dialog.export [data-key="print-set"]').innerText()).toContain('cover paper');
      expect(await page.locator('dialog.export [data-key="book-front-offset-x"]').inputValue()).toBe('2.5');
      await select(app, 'dialog.export', 'paper-set', 'inside');
      expect(await page.locator('dialog.export [data-key="book-front-offset-x"]').inputValue()).toBe('1.7');
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-print-settings-method`);

      // Calibrate: the same choices at the top, and the set being read and written.
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-set"]').innerText()).toContain('I flip the paper by hand, inside paper');
      await select(app, 'dialog.calibrate', 'paper-set', 'cover');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-set"]').innerText()).toContain('cover paper');
      await shot(app, `${device}-calibrate-paper-set`);
      await select(app, 'dialog.calibrate', 'paper-set', 'inside');
      await select(app, 'dialog.calibrate', 'print-method', 'auto');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-set"]').innerText()).toContain('auto duplex), inside paper');
      expect(await page.locator('dialog.calibrate .cal-how').innerText()).toContain('auto duplex');
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-calibrate-method`);

      // Step 2: the creep test follows the method. Auto duplex: the outermost sheet's front and back, then the innermost's.
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');
      expect(await page.locator('dialog.calibrate .cal-how').innerText()).toContain('each sheet’s front then its back');
      const auto = unzip(await download(app, 'dialog.calibrate [data-key="calibrate-download-creep"]'));
      const label = (strings: string[]) => `${strings.find((s) => /^SHEET \d+ OF 13/.test(s))!.match(/\d+/)![0]} ${strings.find((s) => /^(FRONT|BACK), left/.test(s))!.split(',')[0]}`;
      expect((await readPdf(auto.get('creep-test.pdf')!)).map((p) => label(p.strings))).toEqual(['1 FRONT', '1 BACK', '13 FRONT', '13 BACK']);
      const footers = (await readPdf(auto.get('creep-test.pdf')!)).flatMap((p) => p.strings.filter((s) => s.startsWith('made for')));
      expect(new Set(footers)).toEqual(new Set(['made for Half letter | auto duplex | inside paper']));
      expect(new TextDecoder().decode(auto.get('calibration.txt')!)).toContain('Print method: the printer flips the paper (auto duplex)');

      // By hand: the current order, the innermost front first.
      await select(app, 'dialog.calibrate', 'print-method', 'hand');
      expect(await page.locator('dialog.calibrate .cal-how').innerText()).toContain('put the stack back');
      const hand = unzip(await download(app, 'dialog.calibrate [data-key="calibrate-download-creep"]'));
      expect((await readPdf(hand.get('creep-test.pdf')!)).map((p) => label(p.strings))).toEqual(['13 FRONT', '1 FRONT', '1 BACK', '13 BACK']);
      expect(new Set((await readPdf(hand.get('calibration-cover.pdf')!)).flatMap((p) => p.strings.filter((s) => s.startsWith('made for'))))).toEqual(new Set(['made for Half letter | by hand | cover paper']));
      await shot(app, `${device}-calibrate-creep-method`);
    });
  });
}
