import {
  ALIGNS, ALONGS, COLS, DIRECTIONS, DOT_SIZES, ELEMENT_TYPES, ICON_SIZES, PAGE_SIDES, PATTERNS, PITCH_MM, ROTATIONS, ROWS, RULE_WEIGHTS,
  SEQUENCE_VALUES, SIDES, TEXT_SIZES, TEXT_STYLES, TEXT_TONES, WEIGHTS, type Sequence,
} from './types';
import { tonesProblem } from './shade';
import { CLOSED_HEADER, checkboxSpan, headerOf, hitsCorner, insideGrid, limitsArea, type Header } from './bounds';
import { ART_SCALINGS, artProblems } from './art';
import { sequenceProblem, sequenceSpan } from './sequence';
import { findEndOffsets, findUnknownTokens, TOKEN_LIST } from './tokens';
import type { PageElement } from './types';

export interface ValidationIssue {
  /** Short name of the rule that failed, e.g. "bounds". */
  rule: string;
  /** Where in the file, e.g. "elements[2].x". */
  path: string;
  message: string;
}

export function formatIssue(i: ValidationIssue): string {
  return `${i.path}: ${i.message} (rule: ${i.rule})`;
}

type Fail = (rule: string, path: string, message: string) => void;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isHalf = (v: unknown): v is number => isNum(v) && Number.isInteger(v * 2);
const oneOf = (list: readonly unknown[], v: unknown) => list.includes(v);
const list = (values: readonly unknown[]) => values.map((v) => JSON.stringify(v)).join(', ');

/** Check a parsed JSON value against every rule of format version 2. An empty result means valid. */
export function validatePage(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail: Fail = (rule, path, message) => issues.push({ rule, path, message });

  if (!isObject(input)) {
    fail('root-object', '(file)', 'A page file must be a JSON object.');
    return issues;
  }

  if (input.format !== 'dotwork-page') {
    fail('format', 'format', `"format" must be "dotwork-page", got ${JSON.stringify(input.format)}.`);
  }
  if (input.version !== 2) {
    fail('version', 'version', `Unknown version ${JSON.stringify(input.version)}; this reader understands version 2.`);
  }
  if (typeof input.name !== 'string') {
    fail('name', 'name', '"name" is required and must be a string.');
  }
  if (input.identity !== undefined) {
    if (typeof input.identity !== 'string') fail('identity', 'identity', '"identity" must be a string when present.');
    else checkTokens(input.identity, 'identity', fail);
  }
  if (input.page_number !== undefined && typeof input.page_number !== 'boolean') {
    fail('page-number', 'page_number', '"page_number" must be true or false when present.');
  }
  if (input.side !== undefined && !oneOf(PAGE_SIDES, input.side)) {
    fail('side', 'side', `"side" must be one of ${list(PAGE_SIDES)}, got ${JSON.stringify(input.side)}.`);
  }

  const g = input.grid;
  if (!isObject(g) || g.cols !== COLS || g.rows !== ROWS || g.pitch_mm !== PITCH_MM) {
    fail('grid', 'grid', `"grid" must be exactly { "cols": ${COLS}, "rows": ${ROWS}, "pitch_mm": ${PITCH_MM} }.`);
  }

  if (!Array.isArray(input.elements)) {
    fail('elements-array', 'elements', '"elements" is required and must be an array (it may be empty).');
    return issues;
  }
  // Row 0 depends on the page: it is the printed header unless the page has no identity.
  const header = headerOf({
    identity: typeof input.identity === 'string' ? input.identity : undefined,
    side: oneOf(PAGE_SIDES, input.side) ? (input.side as 'left' | 'right' | 'either') : undefined,
    page_number: input.page_number === false ? false : undefined,
  });
  input.elements.forEach((el: unknown, i: number) => validateElementInto(el, `elements[${i}]`, fail, header));
  return issues;
}

/** The rule failures of one element, for the editor to check an edit before it is committed. */
export function validateElement(el: unknown, path = 'element', header: Header = CLOSED_HEADER): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateElementInto(el, path, (rule, p, message) => issues.push({ rule, path: p, message }), header);
  return issues;
}

function validateElementInto(el: unknown, at: string, fail: Fail, header: Header) {
  if (!isObject(el)) {
    fail('element-object', at, 'An element must be an object.');
    return;
  }
  if (!oneOf(ELEMENT_TYPES, el.type)) {
    fail('element-type', `${at}.type`, `Unknown element type ${JSON.stringify(el.type)}; expected one of ${list(ELEMENT_TYPES)}.`);
    return;
  }

  // Every number field: present, a multiple of 0.5. Fields that are not usable skip the bounds check.
  let usable = true;
  const half = (key: string, required = true) => {
    const v = el[key];
    if (v === undefined && !required) return;
    if (!isHalf(v)) {
      fail('half-cell', `${at}.${key}`, `"${key}" is required and must be a multiple of 0.5 (got ${JSON.stringify(v)}).`);
      usable = false;
    }
  };
  const choice = (key: string, allowed: readonly unknown[]) => {
    if (el[key] !== undefined && !oneOf(allowed, el[key])) {
      fail('value', `${at}.${key}`, `"${key}" must be one of ${list(allowed)}, got ${JSON.stringify(el[key])}.`);
    }
  };
  const every = () => {
    if (el.every === undefined) return;
    if (!isHalf(el.every) || (el.every as number) <= 0) {
      fail('every', `${at}.every`, `"every" must be a positive multiple of 0.5 (got ${JSON.stringify(el.every)}).`);
      usable = false;
    }
  };

  if (el.group !== undefined && (typeof el.group !== 'string' || el.group === '')) {
    fail('group', `${at}.group`, `"group" must be a non-empty string when present, got ${JSON.stringify(el.group)}.`);
  }

  switch (el.type) {
    case 'pattern':
    case 'shade':
    case 'box':
    case 'art': {
      for (const k of ['x', 'y', 'w', 'h']) half(k);
      if (usable && ((el.w as number) <= 0 || (el.h as number) <= 0)) {
        fail('size', at, `"w" and "h" must be greater than 0 (got w=${el.w}, h=${el.h}).`);
        usable = false;
      }
      if (el.type === 'pattern') {
        if (!oneOf(PATTERNS, el.pattern)) {
          fail('value', `${at}.pattern`, `"pattern" is required and must be one of ${list(PATTERNS)}, got ${JSON.stringify(el.pattern)}.`);
        }
        choice('weight', RULE_WEIGHTS); choice('dots', DOT_SIZES);
        if (el.first !== undefined && typeof el.first !== 'boolean') fail('value', `${at}.first`, `"first" must be true or false, got ${JSON.stringify(el.first)}.`);
        every();
      }
      if (el.type === 'shade') {
        const problem = tonesProblem(el.tones);
        if (problem) fail('tones', `${at}.tones`, problem);
        choice('along', ALONGS);
        every();
      }
      if (el.type === 'art') {
        choice('scaling', ART_SCALINGS);
        for (const [path, message] of artProblems(el)) fail('art', `${at}.${path}`, message);
      }
      if (el.type === 'box') {
        choice('weight', WEIGHTS);
        if (el.sides !== undefined) {
          if (!Array.isArray(el.sides) || el.sides.some((s) => !oneOf(SIDES, s))) {
            fail('value', `${at}.sides`, `"sides" must be a list of ${list(SIDES)}.`);
          }
        }
      }
      break;
    }
    case 'rule': {
      for (const k of ['x1', 'y1', 'x2', 'y2']) half(k);
      choice('weight', RULE_WEIGHTS);
      if (usable && el.x1 !== el.x2 && el.y1 !== el.y2) {
        fail('diagonal', at, `A rule must be horizontal or vertical (got (${el.x1}, ${el.y1}) to (${el.x2}, ${el.y2})).`);
        usable = false;
      } else if (usable && el.x1 === el.x2 && el.y1 === el.y2) {
        fail('size', at, 'A rule must have a length greater than 0.');
        usable = false;
      }
      break;
    }
    case 'checkboxes': {
      half('x'); half('y');
      if (!Number.isInteger(el.count) || (el.count as number) < 1) {
        fail('count', `${at}.count`, `"count" is required and must be a whole number of at least 1 (got ${JSON.stringify(el.count)}).`);
        usable = false;
      }
      every();
      choice('direction', DIRECTIONS);
      choice('weight', WEIGHTS);
      if (el.size !== undefined && !(isNum(el.size) && el.size >= 0.5 && el.size <= 1)) {
        fail('size', `${at}.size`, `"size" must be a number from 0.5 to 1 (got ${JSON.stringify(el.size)}).`);
      }
      break;
    }
    case 'sequence': {
      half('x'); half('y');
      if (!Number.isInteger(el.count) || (el.count as number) < 1) {
        fail('count', `${at}.count`, `"count" is required and must be a whole number of at least 1 (got ${JSON.stringify(el.count)}).`);
        usable = false;
      }
      every();
      choice('direction', DIRECTIONS); choice('values', SEQUENCE_VALUES); choice('tone', TEXT_TONES); choice('size', ICON_SIZES); choice('rotate', ROTATIONS);
      const problem = sequenceProblem(el as unknown as Sequence);
      if (problem) { fail('sequence', at, problem); usable = false; }
      break;
    }
    case 'text': {
      half('x'); half('y');
      if (typeof el.text !== 'string') fail('text', `${at}.text`, '"text" is required and must be a string.');
      else checkTokens(el.text, `${at}.text`, fail);
      choice('size', TEXT_SIZES); choice('style', TEXT_STYLES); choice('tone', TEXT_TONES); choice('align', ALIGNS);
      choice('rotate', ROTATIONS);
      break;
    }
  }

  if (usable) {
    const area = limitsArea(el as unknown as PageElement);
    if (!insideGrid(area, header.top)) {
      const extra = el.type === 'checkboxes'
        ? ` The ${el.count} boxes (every ${el.every ?? 1}, ${el.direction ?? 'down'}) cover ${checkboxSpan(el.count as number, (el.every as number) ?? 1)} cells.`
        : el.type === 'sequence'
          ? ` The ${el.count} items (every ${el.every ?? 1}, ${el.direction ?? 'down'}) cover ${sequenceSpan(el as unknown as Sequence)} cells.`
          : '';
      const onlyHeader = header.top === 1 && area.y >= 0 && area.y < 1 && area.x >= 0 && area.x + area.w <= COLS && area.y + area.h <= ROWS;
      fail(onlyHeader ? 'header-row' : 'bounds', at,
        `Does not fit ${header.top === 1 ? 'below the header ' : ''}in the ${COLS} x ${ROWS} grid: need x >= 0, y >= ${header.top}, x + w <= ${COLS}, y + h <= ${ROWS}; this one spans x ${area.x} to ${area.x + area.w}, y ${area.y} to ${area.y + area.h}.${extra}`);
    } else if (hitsCorner(el as unknown as PageElement, header)) {
      const c = header.corner!;
      fail('header-corner', at, `Covers the page number in row 0 (x ${c.x} to ${c.x + c.w}). Turn the page number off, or keep clear of that corner.`);
    }
  }
}

function checkTokens(text: string, path: string, fail: Fail) {
  for (const name of findUnknownTokens(text)) {
    fail('token', path, `Unknown token {${name}}; known tokens are ${TOKEN_LIST}, each with an optional offset such as {day+1}, or @start / @end such as {day@end}.`);
  }
  for (const name of findEndOffsets(text)) {
    fail('token', path, `{${name}}: @start and @end take no offset. They read the first or last day of what the page covers inside the calendar; write {${name.replace(/[+-]\d+/, '')}} or an offset without @start / @end.`);
  }
}
