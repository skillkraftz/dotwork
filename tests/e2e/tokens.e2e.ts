import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, open, reload, seedPage, shot, start, stop, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noErrors = (app: App) => expect(app.errors).toEqual([]);
const PAGE = (identity: string, text?: string) => ({
  format: 'dotwork-page', version: 2, name: 'Tokens', side: 'either', identity,
  grid: { cols: 27, rows: 44, pitch_mm: 3 }, header: { number: 'outer' },
  elements: text ? [{ type: 'text', x: 0, y: 2, text }] : [],
});
const drawn = (app: App) => app.page.locator('#canvas text').evaluateAll((els) => els.map((e) => e.textContent));

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`token units in the editor (${device})`, () => {
    it('a week page shows the sample week, and a day page the sample day', async () => {
      const app = await open(env, device);
      await seedPage(app, PAGE('WEEK {week}  {month} {day}-{day@end}', '{month} {weekday}-{weekday@end}  {day+1}'));
      expect(await drawn(app)).toContain('WEEK 44  OCT 25-31');
      expect(await drawn(app)).toContain('OCT SUN-SAT  26');
      await shot(app, `tokens-week-page-${device}`);

      await seedPage(app, PAGE('{weekday} {month} {day}'), 'Day');
      expect(await drawn(app)).toContain('MON OCT 26'); // no {week}, no @end, no big offset: a day page
      noErrors(app);
    });

    it('refuses @end with an offset, saying why', async () => {
      const app = await open(env, device);
      const { page } = app;
      await choose(app, 'page', '#settings');
      await page.waitForSelector('dialog.settings[open]');
      await page.locator('[data-key="settings-identity-page"]').fill('{day+1@end}');
      expect(await page.locator('dialog.settings .warn').innerText()).toMatch(/@end takes no offset/);
      noErrors(app);
    });

    it('lists the saved documents whose tokens changed meaning, and changes none', async () => {
      const app = await open(env, device);
      const { page } = app;
      await seedPage(app, PAGE('{month+1}', '{year-1}'), 'Old offsets');
      const notice = page.locator('#notice');
      await notice.waitFor({ state: 'visible' });
      const text = await notice.innerText();
      expect(text).toContain('whose meaning changed');
      expect(text).toContain('Old offsets (page), identity: {month+1}');
      expect(await notice.locator('[data-help="copy-details"]').count()).toBe(1);
      await shot(app, `tokens-notice-${device}`);
      const stored = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('dotwork', 1); r.onsuccess = () => res(r.result); });
        return new Promise<unknown>((res) => { const r = db.transaction('library').objectStore('library').getAll(); r.onsuccess = () => res(r.result); });
      }) as { name: string; data: { identity: string; elements: { text: string }[] } }[];
      const doc = stored.find((i) => i.name === 'Old offsets')!;
      expect(doc.data.identity).toBe('{month+1}');
      expect(doc.data.elements[0].text).toBe('{year-1}');
      await reload(app); // once per start: it is shown again, nothing was changed
      await page.locator('#notice').waitFor({ state: 'visible' });
      noErrors(app);
    });
  });
}
