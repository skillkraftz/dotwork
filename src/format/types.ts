// Dotwork page format, version 2. See docs/page-format.md.

export const COLS = 27;
export const ROWS = 44;
export const PITCH_MM = 3;

/** The physical page and where the grid sits on it (the grid is centered). */
export const PAGE_W_MM = 88.9;
export const PAGE_H_MM = 139.7;
const centered = (page: number, cells: number) => +((page - cells * PITCH_MM) / 2).toFixed(3);
export const GRID_X_MM = centered(PAGE_W_MM, COLS); // 3.95
export const GRID_Y_MM = centered(PAGE_H_MM, ROWS); // 3.85

export const BACKGROUNDS = ['none', 'light', 'medium', 'dark'] as const;
export type Background = (typeof BACKGROUNDS)[number];
export const STRIPES = ['none', 'rows', 'columns'] as const;
export type Stripes = (typeof STRIPES)[number];

export const PATTERNS = ['none', 'lines', 'vlines', 'grid', 'dots'] as const;
export type PatternKind = (typeof PATTERNS)[number];

export const SEQUENCE_VALUES = ['numbers', 'letters', 'list', 'icons'] as const;
export type SequenceValues = (typeof SEQUENCE_VALUES)[number];
export const ICON_SIZES = [1, 2] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export const SIDES = ['top', 'bottom', 'left', 'right'] as const;
export type BoxSide = (typeof SIDES)[number];

export const WEIGHTS = ['thin', 'thick'] as const;
export type Weight = (typeof WEIGHTS)[number];
export const RULE_WEIGHTS = ['hair', 'thin', 'thick'] as const;
export type RuleWeight = (typeof RULE_WEIGHTS)[number];

export const DIRECTIONS = ['down', 'across'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const TEXT_SIZES = ['label', 'heading'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_STYLES = ['regular', 'bold'] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];
export const TEXT_TONES = ['gray', 'black'] as const;
export type TextTone = (typeof TEXT_TONES)[number];
export const ALIGNS = ['left', 'center', 'right'] as const;
export type Align = (typeof ALIGNS)[number];
export const ROTATIONS = [0, 90, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

export const PAGE_SIDES = ['left', 'right', 'either'] as const;
export type PageSide = (typeof PAGE_SIDES)[number];

export interface Area { x: number; y: number; w: number; h: number }

export interface Pattern extends Area {
  type: 'pattern';
  pattern: PatternKind;
  background?: Background;
  stripes?: Stripes;
  every?: number;
}

export interface Box extends Area {
  type: 'box';
  sides?: BoxSide[];
  weight?: Weight;
}

export interface Rule {
  type: 'rule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight?: RuleWeight;
}

export interface Checkboxes {
  type: 'checkboxes';
  x: number;
  y: number;
  count: number;
  every?: number;
  direction?: Direction;
  size?: number;
  weight?: Weight;
}

export interface Text {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size?: TextSize;
  style?: TextStyle;
  tone?: TextTone;
  align?: Align;
  rotate?: Rotation;
}

/** A run of cells with one item in each: numbers, letters, a repeating list of short texts, or icons. */
export interface Sequence {
  type: 'sequence';
  x: number;
  y: number;
  count: number;
  direction?: Direction;
  /** Cells from one item to the next. */
  every?: number;
  values?: SequenceValues;
  /** numbers: the first number. letters: the first letter. */
  start?: number | string;
  /** numbers: what to add each time. */
  step?: number;
  /** list: items of one or two characters, repeating. */
  list?: string[];
  /** icons: icon names, repeating. */
  icons?: string[];
  tone?: TextTone;
  /** icons: how many cells wide and tall each icon is. */
  size?: IconSize;
}

export type PageElement = Pattern | Box | Rule | Checkboxes | Text | Sequence;
export type ElementType = PageElement['type'];
export const ELEMENT_TYPES: readonly ElementType[] = ['pattern', 'box', 'rule', 'checkboxes', 'text', 'sequence'];

export interface Page {
  format: 'dotwork-page';
  version: 2;
  name: string;
  identity?: string;
  side?: PageSide;
  grid: { cols: 27; rows: 44; pitch_mm: 3 };
  elements: PageElement[];
}

export function emptyPage(): Page {
  return {
    format: 'dotwork-page',
    version: 2,
    name: 'Untitled',
    identity: '{weekday} {month} {day}',
    grid: { cols: COLS, rows: ROWS, pitch_mm: PITCH_MM },
    elements: [],
  };
}

/** Defaults for optional fields, as the format document lists them. */
export const DEFAULTS = {
  background: 'none',
  stripes: 'none',
  every: 1,
  boxWeight: 'thin',
  ruleWeight: 'thin',
  direction: 'down',
  checkSize: 0.7,
  textSize: 'label',
  style: 'regular',
  textTone: 'gray',
  align: 'left',
  rotate: 0,
  side: 'either',
  values: 'numbers',
  start: 1,
  step: 1,
  letter: 'A',
  sequenceTone: 'black',
  iconSize: 1,
} as const;
