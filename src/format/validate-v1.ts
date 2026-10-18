import { COLS, PITCH_MM, ROWS } from './types';
import { BORDER_STYLES, EDGES, FILLS } from './v1';
import type { ValidationIssue } from './validate';
import { findUnknownTokens } from './tokens';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Check a parsed JSON value against every rule of format version 1 (kept so old files can be imported). Empty result means valid. */
export function validatePageV1(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (rule: string, path: string, message: string) => issues.push({ rule, path, message });

  if (!isObject(input)) {
    fail('root-object', '(file)', 'A page file must be a JSON object.');
    return issues;
  }

  if (input.format !== 'dotwork-page') {
    fail('format', 'format', `"format" must be "dotwork-page", got ${JSON.stringify(input.format)}.`);
  }
  if (input.version !== 1) {
    fail('version', 'version', `Unknown version ${JSON.stringify(input.version)}; this reader only understands version 1.`);
  }
  if (typeof input.name !== 'string') {
    fail('name', 'name', '"name" is required and must be a string.');
  }
  if (input.identity !== undefined) {
    if (typeof input.identity !== 'string') {
      fail('identity', 'identity', '"identity" must be a string when present.');
    } else {
      checkTokens(input.identity, 'identity', fail);
    }
  }

  const g = input.grid;
  if (!isObject(g) || g.cols !== COLS || g.rows !== ROWS || g.pitch_mm !== PITCH_MM) {
    fail('grid', 'grid', `"grid" must be exactly { "cols": ${COLS}, "rows": ${ROWS}, "pitch_mm": ${PITCH_MM} } in version 1.`);
  }

  if (!Array.isArray(input.regions)) {
    fail('regions-array', 'regions', '"regions" is required and must be an array (it may be empty).');
    return issues;
  }

  // Regions whose x/y/w/h are usable integers; only these take part in the overlap check.
  const placed: { i: number; x: number; y: number; w: number; h: number }[] = [];

  input.regions.forEach((r: unknown, i: number) => {
    const at = `regions[${i}]`;
    if (!isObject(r)) {
      fail('region-object', at, 'A region must be an object.');
      return;
    }

    let ints = true;
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      if (!isInt(r[k])) {
        fail('region-integers', `${at}.${k}`, `"${k}" is required and must be an integer number of cells.`);
        ints = false;
      }
    }
    if (ints) {
      const { x, y, w, h } = r as Record<'x' | 'y' | 'w' | 'h', number>;
      let ok = true;
      if (y === 0) {
        fail('header-row', `${at}.y`, 'Row 0 is the header row; no region may include it, so y must be at least 1.');
        ok = false;
      }
      if (w < 1 || h < 1) {
        fail('size', at, `"w" and "h" must be at least 1 (got w=${w}, h=${h}).`);
        ok = false;
      }
      if (x < 0 || y < 0 || x + w > COLS || y + h > ROWS) {
        fail('bounds', at, `Region (x=${x}, y=${y}, w=${w}, h=${h}) does not fit in the ${COLS} x ${ROWS} grid: need x >= 0, y >= 1, x + w <= ${COLS}, y + h <= ${ROWS}.`);
        ok = false;
      }
      if (ok) placed.push({ i, x, y, w, h });
    }

    if (typeof r.fill !== 'string' || !(FILLS as readonly string[]).includes(r.fill)) {
      fail('fill', `${at}.fill`, `Unknown fill type ${JSON.stringify(r.fill)}; expected one of ${FILLS.join(', ')}.`);
    }

    if (r.border !== undefined) {
      if (!isObject(r.border)) {
        fail('border', `${at}.border`, '"border" must be an object with top, bottom, left and/or right.');
      } else {
        for (const [edge, style] of Object.entries(r.border)) {
          if (!(EDGES as readonly string[]).includes(edge)) {
            fail('border', `${at}.border.${edge}`, `Unknown border edge "${edge}"; expected top, bottom, left or right.`);
          } else if (!(BORDER_STYLES as readonly unknown[]).includes(style)) {
            fail('border', `${at}.border.${edge}`, `Border style must be "thin" or "thick", got ${JSON.stringify(style)}.`);
          }
        }
      }
    }

    if (r.labels !== undefined) {
      if (!Array.isArray(r.labels)) {
        fail('labels', `${at}.labels`, '"labels" must be an array.');
      } else {
        r.labels.forEach((l: unknown, j: number) => {
          const lat = `${at}.labels[${j}]`;
          if (!isObject(l)) {
            fail('label-object', lat, 'A label must be an object.');
            return;
          }
          if (typeof l.text !== 'string') {
            fail('label-text', `${lat}.text`, '"text" is required and must be a string.');
          } else {
            checkTokens(l.text, `${lat}.text`, fail);
          }
          if (l.row !== undefined) {
            const h = isInt(r.h) ? r.h : undefined;
            if (!isInt(l.row) || l.row < 0 || (h !== undefined && l.row >= h)) {
              fail('label-row', `${lat}.row`, `"row" must be an integer from 0 to the region's height minus 1${h !== undefined ? ` (${h - 1})` : ''}.`);
            }
          }
          if (l.align !== undefined && l.align !== 'left' && l.align !== 'right') {
            fail('label-align', `${lat}.align`, `"align" must be "left" or "right", got ${JSON.stringify(l.align)}.`);
          }
          if (l.vertical !== undefined && typeof l.vertical !== 'boolean') {
            fail('label-vertical', `${lat}.vertical`, '"vertical" must be true or false.');
          }
        });
      }
    }
  });

  for (let a = 0; a < placed.length; a++) {
    for (let b = a + 1; b < placed.length; b++) {
      const p = placed[a], q = placed[b];
      if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) {
        fail('no-overlap', `regions[${q.i}]`, `Overlaps regions[${p.i}]; regions may not overlap in version 1.`);
      }
    }
  }

  return issues;
}

function checkTokens(
  text: string,
  path: string,
  fail: (rule: string, path: string, message: string) => void,
) {
  for (const name of findUnknownTokens(text)) {
    fail('token', path, `Unknown token {${name}}; known tokens are {weekday} {month} {monthname} {day} {year} {week}.`);
  }
}
