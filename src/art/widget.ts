import { defaultSize, type ArtData } from '../format/art';
import type { Art, Image } from '../format/types';
import type { Widget } from '../widgets';

/**
 * Saved art is a widget of one art element: placing it copies the art into the page, like any widget, and the
 * library keeps it with the other widgets. This is the element, at its first size with its top-left corner at row 1.
 */
export const artElement = (art: ArtData): Art => ({ type: 'art', x: 0, y: 1, ...defaultSize(art.view_box), ...structuredClone(art) });

/** Saved images are the same: a widget of one image element, at its first size (the longer side is `LONG_SIDE_CELLS`). */
export const imageElement = (src: string, width_px: number, height_px: number): Image =>
  ({ type: 'image', x: 0, y: 1, ...defaultSize([0, 0, width_px, height_px]), src, width_px, height_px });

/** Whether a widget is saved art or a saved image, which the library lists under Art instead of Widgets. */
export const isArtWidget = (w: Widget) => w.elements.length === 1 && (w.elements[0].type === 'art' || w.elements[0].type === 'image');

/** The art or image element of a saved art widget. */
export const artOf = (w: Widget): Art | Image => w.elements[0] as Art | Image;
