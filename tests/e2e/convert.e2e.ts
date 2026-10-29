import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bar, cellToClient, draft, drag, hit, missingHelp, open, shot, start, stop, tap, waitSaved, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const labels = async (app: App) => (await app.page.locator('#bar-context button .label').allInnerTexts()).map((t) => t.trim());
type El = { type: string; x?: number; y?: number; text?: string; group?: string };

/** Open a copy of the built-in Week planner (a built-in opens read-only; Duplicate makes one to edit). */
async function openWeekPlanner(app: App) {
  const { page } = app;
  await hit(app, '#menu-edit');
  await hit(app, '#library');
  await page.waitForSelector('dialog.library.browser[open] .lib-card');
  await hit(app, '[data-tab="pages"]');
  await hit(app, '.lib-card[data-name="Week planner"] .lib-more');
  await hit(app, '.lib-menu button');
  await page.waitForSelector('dialog.ask[open]');
  await hit(app, 'dialog.ask .primary');
  await hit(app, '.lib-card[data-name="Week planner copy"] .lib-open');
  await page.waitForSelector('dialog.library.browser', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Week planner copy');
  await waitSaved(app);
}

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`Convert to elements on a ${device}`, () => {
    it('turns the week block into a group of plain elements, which Ungroup frees and one of which moves', async () => {
      const app = await open(env, device);
      await openWeekPlanner(app);
      expect(((await draft(app)).elements as El[]).map((e) => e.type)).toEqual(['generated']);

      await tap(app, await cellToClient(app, 12, 20));
      expect(await labels(app)).toEqual(['Props', 'Copy', 'Delete', 'Convert', 'More']);
      expect(await app.page.locator('#bar-context [data-action="convert"]').getAttribute('aria-label')).toBe('Convert to elements');
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-convert-generated-selected`);

      await bar(app, 'convert');
      await app.page.waitForFunction(() => document.querySelector('#bar-context [data-action="group"] .label')?.textContent?.trim() === 'Ungroup');
      let els = (await draft(app)).elements as El[];
      expect(els.length).toBeGreaterThan(20);
      expect(els.every((e) => e.type !== 'generated' && e.group === 'g1')).toBe(true);
      // row k's day tokens count k days from the page's first day
      const texts = els.filter((e) => e.type === 'text').map((e) => e.text!);
      expect(texts).toEqual(expect.arrayContaining(['{day}', '{day+3}', '{day+6}']));
      await shot(app, `${device}-convert-result`);

      await bar(app, 'group'); // Ungroup
      els = (await draft(app)).elements as El[];
      expect(els.every((e) => e.group === undefined)).toBe(true);

      // move one element: the vertical rule at column 18 in the first day row
      type R = El & { x1: number; y1: number; x2: number; y2: number };
      const rules = (els as R[]).map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'rule' && e.x1 === e.x2 && e.y2 - e.y1 === 4);
      const at = rules.find(({ e }) => e.x1 === 18)!, other = rules.find(({ e }) => e.x1 === 25)!;
      const mid = (r: R, dx = 0) => cellToClient(app, r.x1 + dx, (r.y1 + r.y2) / 2);
      await tap(app, await mid(at.e));
      await drag(app, await mid(at.e), await mid(at.e, -1));
      expect(((await draft(app)).elements as R[])[at.i].x1).toBe(17);

      if (!app.touch) {
        // Ctrl+click adds a second element to the selection, and takes it off again
        await tap(app, await mid(at.e, -1));
        const p2 = await mid(other.e);
        await app.page.keyboard.down('Control');
        await app.page.mouse.click(p2.x, p2.y);
        expect(await app.page.locator('#panel .layer.selected').count()).toBe(2);
        await app.page.mouse.click(p2.x, p2.y);
        await app.page.keyboard.up('Control');
        expect(await app.page.locator('#panel .layer.selected').count()).toBe(1);
      }
      expect(app.errors).toEqual([]);
    });
  });
}
