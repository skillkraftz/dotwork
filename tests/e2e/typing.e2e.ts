import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bar, box, cellToClient, draft, drag, open, shot, start, stop, tap, touch, viewBoxOf, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const elements = async (app: App) => (await draft(app)).elements;
const field = (app: App, key: string) => app.page.locator(`#panel [data-key="${key}"]`);

/** Draw with a tool on the phone and open the properties window for what was drawn. */
async function drawAndOpen(app: App, tool: string, from: [number, number], to: [number, number]) {
  await app.page.tap(`[data-tool="${tool}"]`);
  await drag(app, await cellToClient(app, ...from), await cellToClient(app, ...to));
  await bar(app, 'properties');
  await app.page.waitForSelector('#sheet[data-state="open"]');
}

/** Type into a field the way a person does: tap it, replace what is there, one key at a time. */
async function typeInto(app: App, key: string, text: string, delay = 60) {
  const f = field(app, key);
  await f.tap();
  await f.selectText();
  await app.page.keyboard.type(text, { delay });
}

describe('typing in the properties window (phone, touch)', () => {
  it('lets a half-cell value like 1.5 be typed, point and all', async () => {
    const app = await open(env, 'phone');
    await drawAndOpen(app, 'checkboxes', [3, 4], [3, 8]);
    const every = field(app, 'prop-every');
    await every.tap();
    await every.selectText();
    await app.page.keyboard.type('1.', { delay: 60 });
    // The pause applies the 1; the point being typed must survive it.
    await app.page.waitForTimeout(1300);
    expect(await every.inputValue()).toBe('1.');
    await app.page.keyboard.type('5', { delay: 60 });
    expect(await every.inputValue()).toBe('1.5');
    await app.page.keyboard.press('Enter');
    expect(await every.inputValue()).toBe('1.5');
    expect(await elements(app)).toMatchObject([{ type: 'checkboxes', every: 1.5 }]);
    expect(app.errors).toEqual([]);
  });

  it('keeps focus on a label the whole time it is typed, and undoes it in one step', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('[data-tool="text"]');
    await tap(app, await cellToClient(app, 4, 6));
    await bar(app, 'properties');
    await page.waitForSelector('#sheet[data-state="open"]');
    const before = (await elements(app))[0].text;
    const f = field(app, 'prop-text');
    await f.tap();
    await f.selectText();
    await f.evaluate((el) => { (el as unknown as { __same: boolean }).__same = true; });
    const word = 'Groceries';
    for (const ch of word) {
      await page.keyboard.type(ch, { delay: 30 });
      await page.waitForTimeout(40);
      const same = await page.evaluate(() => {
        const a = document.activeElement as (HTMLInputElement & { __same?: boolean }) | null;
        return a?.dataset.key === 'prop-text' && a.__same === true;
      });
      expect(same, `focus after "${ch}"`).toBe(true);
    }
    expect(await f.inputValue()).toBe(word);
    expect(await elements(app)).toMatchObject([{ text: word }]);
    await page.tap('#sheet .sheet-close');
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ type: 'text', text: before }]);
    expect(app.errors).toEqual([]);
  });

  it('reverts a value the page cannot take, with a message', async () => {
    const app = await open(env, 'phone');
    await drawAndOpen(app, 'box', [4, 5], [10, 9]);
    const x = field(app, 'prop-x');
    await typeInto(app, 'prop-x', '99');
    await app.page.keyboard.press('Enter');
    expect(await x.inputValue()).toBe('4');
    const msg = app.page.locator('#panel .field.num:has([data-key="prop-x"]) .fmsg');
    expect(await msg.isVisible()).toBe(true);
    expect((await msg.innerText()).length).toBeGreaterThan(5);
    expect((await msg.innerText()).length).toBeLessThan(80);
    // not on the half-cell grid
    await typeInto(app, 'prop-y', '5.3');
    await app.page.keyboard.press('Enter');
    expect(await field(app, 'prop-y').inputValue()).toBe('5');
    // and not a number at all
    await typeInto(app, 'prop-w', 'abc');
    await app.page.keyboard.press('Enter');
    expect(await field(app, 'prop-w').inputValue()).toBe('6');
    expect(await elements(app)).toMatchObject([{ x: 4, y: 5, w: 6, h: 4 }]);
    // a good value afterwards clears the message
    await typeInto(app, 'prop-x', '6.5');
    await app.page.keyboard.press('Enter');
    expect(await elements(app)).toMatchObject([{ x: 6.5 }]);
    expect(await msg.isVisible()).toBe(false);
  });

  it('steps every number with − and +, by a cell or half a cell, one undo step per tap', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await drawAndOpen(app, 'checkboxes', [3, 4], [3, 8]);
    const start = (await elements(app))[0] as { x: number; y: number; count: number };
    const inc = (key: string) => page.tap(`[data-key="step-inc-${key}"]`);
    const dec = (key: string) => page.tap(`[data-key="step-dec-${key}"]`);

    await inc('x');
    expect(await elements(app)).toMatchObject([{ x: start.x + 1 }]);
    await dec('y');
    expect(await elements(app)).toMatchObject([{ y: start.y - 1 }]);
    await inc('count');
    expect(await elements(app)).toMatchObject([{ count: start.count + 1 }]);
    await inc('every');
    expect(await elements(app)).toMatchObject([{ every: 2 }]);
    await dec('size');
    expect(await elements(app)).toMatchObject([{ size: 0.65 }]);
    await inc('size');
    await inc('size');
    expect(await elements(app)).toMatchObject([{ size: 0.75 }]);

    // with Half on, positions and spacings step by half a cell; counts and sizes keep their step
    await page.tap('[data-key="nudge-half"]');
    await inc('x');
    expect(await elements(app)).toMatchObject([{ x: start.x + 1.5 }]);
    await inc('every');
    expect(await elements(app)).toMatchObject([{ every: 2.5 }]);
    await inc('count');
    expect(await elements(app)).toMatchObject([{ count: start.count + 2 }]);
    await page.tap('[data-key="nudge-half"]');

    // every tap was its own undo step
    await page.tap('#sheet .sheet-close');
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ count: start.count + 1 }]);
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ every: 2 }]);
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ x: start.x + 1 }]);
    expect(app.errors).toEqual([]);
  });

  it('repeats while a stepper is held, as one undo step', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await drawAndOpen(app, 'box', [4, 6], [8, 9]);
    const b = (await box(app, '[data-key="step-inc-x"]'))!;
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await touch(app, 'touchStart', [at]);
    await page.waitForTimeout(1400);
    await touch(app, 'touchEnd', []);
    await page.waitForTimeout(100);
    const held = (await elements(app))[0] as { x: number };
    expect(held.x).toBeGreaterThan(6); // more than a tap's worth
    await page.tap('#sheet .sheet-close');
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ x: 4 }]);
    expect(app.errors).toEqual([]);
  });

  it('makes every stepper at least 44 px', async () => {
    const app = await open(env, 'phone');
    await drawAndOpen(app, 'box', [4, 6], [8, 9]);
    const sizes = await app.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#panel .stepper button')].map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
    expect(sizes.length).toBe(8);
    for (const [w, h] of sizes) { expect(w).toBeGreaterThanOrEqual(43.5); expect(h).toBeGreaterThanOrEqual(43.5); }
    await shot(app, 'phone-properties-steppers');
  });
});

describe('the on-screen keyboard (phone, touch)', () => {
  it('is not mistaken for a resize: nothing is rebuilt or refitted, and the tool bar steps aside', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await drawAndOpen(app, 'box', [4, 6], [10, 10]);
    await field(app, 'prop-w').tap();
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__fieldset = document.querySelector('#panel fieldset');
      w.__input = document.activeElement;
      w.__mutations = 0;
      new MutationObserver(() => { w.__mutations = (w.__mutations as number) + 1; }).observe(document.querySelector('#panel')!, { childList: true, subtree: true });
    });
    const viewBox = await viewBoxOf(app);
    expect(await page.locator('#tools').isVisible()).toBe(true);

    await page.setViewportSize({ width: 390, height: 500 }); // a keyboard's worth smaller
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.body.classList.contains('keyboard-open'))).toBe(true);
    expect(await page.locator('#tools').isVisible()).toBe(false);
    const state = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        sameFieldset: document.querySelector('#panel fieldset') === w.__fieldset,
        sameInput: document.activeElement === w.__input,
        mutations: w.__mutations,
      };
    });
    expect(state).toEqual({ sameFieldset: true, sameInput: true, mutations: 0 });
    expect(await viewBoxOf(app)).toEqual(viewBox);
    // the field being typed in is on screen, inside the modal
    const r = (await box(app, '[data-key="prop-w"]'))!;
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.height).toBeLessThanOrEqual(500);
    await shot(app, 'phone-properties-keyboard');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.body.classList.contains('keyboard-open'))).toBe(false);
    expect(await page.locator('#tools').isVisible()).toBe(true);
    expect(app.errors).toEqual([]);
  });

  it('still handles a real resize: rotating refits the page', async () => {
    const app = await open(env, 'phone');
    const before = await viewBoxOf(app);
    await app.page.setViewportSize({ width: 844, height: 390 });
    await app.page.waitForTimeout(500);
    expect(await viewBoxOf(app)).not.toEqual(before);
  });
});
