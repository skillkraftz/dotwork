// Dotwork page format, version 2. See docs/page-format.md.
import type { ArtFill, ArtPath, ArtScaling, ArtStroke } from './art';

export const COLS = 27;
export const ROWS = 44;
export const PITCH_MM = 3;

/** The physical page and where the grid sits on it (the grid is centered). */
export const PAGE_W_MM = 88.9;
export const PAGE_H_MM = 139.7;
const centered = (page: number, cells: number) => +((page - cells * PITCH_MM) / 2).toFixed(3);
export const GRID_X_MM = centered(PAGE_W_MM, COLS); // 3.95
export const GRID_Y_MM = centered(PAGE_H_MM, ROWS); // 3.85

export const PATTERNS = ['lines', 'vlines', 'grid', 'dots'] as const;
export type PatternKind = (typeof PATTERNS)[number];
export const DOT_SIZES = ['small', 'large'] as const;
export type DotSize = (typeof DOT_SIZES)[number];

/** The letters of a shade's tones: light, medium, dark or blank. */
export const TONE_LETTERS = ['L', 'M', 'D', 'B'] as const;
export type ToneLetter = (typeof TONE_LETTERS)[number];
export const ALONGS = ['rows', 'columns', 'checker'] as const;
export type Along = (typeof ALONGS)[number];

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

/** Writing lines, a grid or dots over an area. */
export interface Pattern extends Area {
  type: 'pattern';
  pattern: PatternKind;
  every?: number;
  /** lines, vlines and grid: how heavy the lines are. */
  weight?: RuleWeight;
  /** dots: how big the dots are. */
  dots?: DotSize;
  /** lines: also draw the top line. vlines: also draw the left line. */
  first?: boolean;
}

/** A gray tint over an area: `tones` (letters L, M, D, B) repeat along rows, columns or as a checkerboard. */
export interface Shade extends Area {
  type: 'shade';
  tones: string;
  along?: Along;
  /** How many cells each tone step covers. */
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
  /** Turns every item about the center of its own cell: 90 reads bottom to top, 270 top to bottom. */
  rotate?: Rotation;
}

/** Imported artwork placed like a box: shapes in the art's own units, fitted or stretched into the area. See format/art.ts. */
export interface Art extends Area {
  type: 'art';
  view_box: [number, number, number, number];
  paths: ArtPath[];
  /** `fit` (default) keeps the art's proportions and centers it; `stretch` fills the area. */
  scaling?: ArtScaling;
  /** Per placement, the fill of named paths (by their `id`) in place of the one the art came with. */
  fills?: Record<string, ArtFill>;
  /** Per placement, the line of named paths (by their `id`) in place of the one the art came with. */
  strokes?: Record<string, ArtStroke>;
}

/** The days an element can be limited to: only on weekends (Saturday and Sunday) or only on weekdays. */
export const DAY_FILTERS = ['weekends', 'weekdays'] as const;
export type DayFilter = (typeof DAY_FILTERS)[number];

/**
 * Every element can belong to a group: elements with the same `group` are edited together. Printing ignores it.
 * `days` limits it to the weekends or the weekdays of the day it reads (a week block's day row, or a day page); where no day is read it always shows.
 */
export interface Grouped { group?: string; days?: DayFilter }

/** One of a generated element's three pieces: a widget's elements, relative to its top-left corner (so the first row is row 0 or 1 and the first column 0), with the widget's name. */
export interface Part { name: string; elements: PageElement[] }

export const GENERATED_KINDS = ['week'] as const;
export type GeneratedKind = (typeof GENERATED_KINDS)[number];

/**
 * A piece drawn from the book when the page is printed. The `week` block stacks `goals`, a `day` for each day of the page's week that is
 * inside the calendar, and `outcomes`, in the box (see format/week.ts): the box's height sets the height of a day row.
 */
export interface Generated extends Area {
  type: 'generated';
  kind: GeneratedKind;
  goals: Part;
  day: Part;
  outcomes: Part;
}

export type PageElement = (Pattern | Shade | Box | Rule | Checkboxes | Text | Sequence | Art | Generated) & Grouped;
export type ElementType = PageElement['type'];
export const ELEMENT_TYPES: readonly ElementType[] = ['pattern', 'shade', 'box', 'rule', 'checkboxes', 'text', 'sequence', 'art', 'generated'];

export interface Page {
  format: 'dotwork-page';
  version: 2;
  name: string;
  identity?: string;
  /** Whether the page number prints in the header's outer corner. Default true. */
  page_number?: boolean;
  side?: PageSide;
  /** Draw the page flipped left to right when it is on a left page (see format/mirror.ts). Default false. */
  mirror_left?: boolean;
  grid: { cols: 27; rows: 44; pitch_mm: 3 };
  elements: PageElement[];
}

export function emptyPage(): Page {
  return {
    format: 'dotwork-page',
    version: 2,
    name: 'Untitled',
    grid: { cols: COLS, rows: ROWS, pitch_mm: PITCH_MM },
    elements: [],
  };
}

/** Defaults for optional fields, as the format document lists them. */
export const DEFAULTS = {
  every: 1,
  shadeTones: 'L',
  along: 'rows',
  patternWeight: 'hair',
  dots: 'small',
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
  scaling: 'fit',
} as const;
