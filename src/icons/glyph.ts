import { ICON_GRID, ICONS } from './icons';

/** An icon as a small inline SVG for the app's own controls, drawn in the text colour. */
export function iconGlyph(name: string): string {
  const shape = ICONS[name];
  if (!shape) return '';
  const fill = shape.fill ? `<path d="${shape.fill}" fill="currentColor" stroke="none"/>` : '';
  return `<svg class="glyph" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fill}<path d="${shape.stroke}"/></svg>`;
}
