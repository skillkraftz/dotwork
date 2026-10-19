import { ICONS } from '../icons/icons';
import { DEFAULTS, type Area, type Sequence } from './types';

/** Text items are short enough to sit in one 3 mm cell: two characters of the label size. */
export const MAX_ITEM_CHARS = 2;

export const isIcons = (e: Sequence) => e.values === 'icons';

/** Cells an item is wide and tall: icons are 1 or 2, text always 1. */
export const itemSize = (e: Sequence): number => (isIcons(e) ? e.size ?? DEFAULTS.iconSize : 1);

/** Cells the run covers along its direction. */
export const sequenceSpan = (e: Sequence): number => (e.count - 1) * (e.every ?? DEFAULTS.every) + itemSize(e);

export function sequenceArea(e: Sequence): Area {
  const span = sequenceSpan(e), size = itemSize(e);
  return (e.direction ?? DEFAULTS.direction) === 'across'
    ? { x: e.x, y: e.y, w: span, h: size }
    : { x: e.x, y: e.y, w: size, h: span };
}

/** Top-left corner of item `i`, in cells. */
export function itemOrigin(e: Sequence, i: number): { x: number; y: number } {
  const at = i * (e.every ?? DEFAULTS.every);
  return (e.direction ?? DEFAULTS.direction) === 'across' ? { x: e.x + at, y: e.y } : { x: e.x, y: e.y + at };
}

/** A, B, ... Z, AA, AB, ... (the way spreadsheets count columns). `n` counts from 0. */
function letters(n: number): string {
  let s = '';
  for (let k = n; k >= 0; k = Math.floor(k / 26) - 1) s = String.fromCharCode(65 + (k % 26)) + s;
  return s;
}

/** What item `i` says (or, for icons, which icon it is). */
export function itemValue(e: Sequence, i: number): string {
  switch (e.values ?? DEFAULTS.values) {
    case 'numbers': return String((typeof e.start === 'number' ? e.start : DEFAULTS.start) + i * (e.step ?? DEFAULTS.step));
    case 'letters': {
      const first = typeof e.start === 'string' && e.start ? e.start : DEFAULTS.letter;
      const out = letters(first.toUpperCase().charCodeAt(0) - 65 + i);
      return first === first.toLowerCase() ? out.toLowerCase() : out;
    }
    case 'list': return e.list?.length ? e.list[i % e.list.length] : '';
    case 'icons': return e.icons?.length ? e.icons[i % e.icons.length] : '';
  }
}

/** Every item of the run, in order. */
export const sequenceItems = (e: Sequence): string[] => Array.from({ length: Math.max(0, e.count) }, (_, i) => itemValue(e, i));

export const isIconName = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(ICONS, name);

/** Why the values can't be drawn, or null. Fields the kind doesn't use are ignored. */
export function sequenceProblem(e: Sequence): string | null {
  switch (e.values ?? DEFAULTS.values) {
    case 'numbers':
      if (e.start !== undefined && !Number.isInteger(e.start)) return '"start" must be a whole number for numbers.';
      if (e.step !== undefined && !Number.isInteger(e.step)) return '"step" must be a whole number.';
      break;
    case 'letters':
      if (e.start !== undefined && !(typeof e.start === 'string' && /^[A-Za-z]$/.test(e.start))) return '"start" must be one letter for letters.';
      break;
    case 'list':
      if (!Array.isArray(e.list) || !e.list.length || e.list.some((s) => typeof s !== 'string' || !s || [...s].length > MAX_ITEM_CHARS)) {
        return `"list" must have at least one item, each 1 to ${MAX_ITEM_CHARS} characters.`;
      }
      break;
    case 'icons':
      if (!Array.isArray(e.icons) || !e.icons.length || e.icons.some((n) => !isIconName(n))) return '"icons" must name at least one icon from the icon set.';
      break;
  }
  if (Number.isInteger(e.count) && e.count > 0 && e.values !== 'icons') {
    const long = sequenceItems(e).find((s) => [...s].length > MAX_ITEM_CHARS);
    if (long !== undefined) return `Items are at most ${MAX_ITEM_CHARS} characters, but “${long}” is longer.`;
  }
  return null;
}
