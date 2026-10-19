import { describe, expect, it } from 'vitest';
import { parseNumber, shortProblem } from '../src/panel';
import { validateElement } from '../src/format/validate';
import { HELP } from '../src/help';

describe('parseNumber', () => {
  it('reads what a phone keypad types', () => {
    expect(parseNumber('1.5')).toBe(1.5);
    expect(parseNumber(' 12 ')).toBe(12);
    expect(parseNumber('1,5')).toBe(1.5); // a decimal comma
    expect(parseNumber('1.')).toBe(1); // typed so far
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('-2')).toBe(-2);
  });
  it('leaves anything else alone', () => {
    for (const bad of ['', '-', '.', 'abc', '1.2.3', '1e3', '0x10', '1 2', 'Infinity']) expect(parseNumber(bad), bad).toBeNull();
  });
});

describe('shortProblem', () => {
  const box = { type: 'box', x: 4, y: 5, w: 6, h: 4 };
  it('keeps the reasons short', () => {
    for (const patch of [{ x: 99 }, { x: 4.3 }, { w: 0 }, { y: 0 }]) {
      const issue = validateElement({ ...box, ...patch })[0];
      expect(issue, JSON.stringify(patch)).toBeDefined();
      expect(shortProblem(issue).length).toBeLessThan(70);
    }
  });
  it('names the field that is off the half-cell grid', () => {
    expect(shortProblem(validateElement({ ...box, x: 4.3 })[0])).toBe('x must be a multiple of 0.5.');
  });
});

describe('the help registry', () => {
  it('has the text for every entry', () => {
    for (const [key, e] of Object.entries(HELP)) {
      for (const f of ['name', 'what', 'touch', 'desktop'] as const) expect(e[f].trim().length, `${key}.${f}`).toBeGreaterThan(f === 'name' ? 0 : 2);
    }
  });
  it('words touch and desktop text for their own input', () => {
    for (const [key, e] of Object.entries(HELP)) {
      expect(e.touch, `${key} touch`).not.toMatch(/\bclick(s|ed)?\b|\bhover|\bright-click|\bShift\b|\bAlt\b|\bCtrl\b|\bdouble-click/i);
    }
  });
});
