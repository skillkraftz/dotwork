// Dotwork page format, version 1: the shape of old files, read only so they can be converted. See docs/page-format.md, "Version 1 files".

export const FILLS = ['blank', 'lines', 'vlines', 'grid', 'dots', 'checkboxes'] as const;
export type Fill = (typeof FILLS)[number];

export const EDGES = ['top', 'bottom', 'left', 'right'] as const;
export type Edge = (typeof EDGES)[number];

export const BORDER_STYLES = ['thin', 'thick'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export type Align = 'left' | 'right';

export interface Label {
  text: string;
  row?: number;
  align?: Align;
  vertical?: boolean;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: Fill;
  border?: Partial<Record<Edge, BorderStyle>>;
  labels?: Label[];
}

export interface PageV1 {
  format: 'dotwork-page';
  version: 1;
  name: string;
  identity?: string;
  grid: { cols: 27; rows: 44; pitch_mm: 3 };
  regions: Region[];
}

