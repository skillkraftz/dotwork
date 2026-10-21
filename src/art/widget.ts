import { defaultSize, type ArtData } from '../format/art';
import type { Art } from '../format/types';
import type { Widget } from '../widgets';

/**
 * Saved art is a widget of one art element: placing it copies the art into the page, like any widget, and the
 * library keeps it with the other widgets. This is the element, at its first size with its top-left corner at row 1.
 */
export const artElement = (art: ArtData): Art => ({ type: 'art', x: 0, y: 1, ...defaultSize(art.view_box), ...structuredClone(art) });

/** Whether a widget is saved art, which the library lists under Art instead of Widgets. */
export const isArtWidget = (w: Widget) => w.elements.length === 1 && w.elements[0].type === 'art';

/** The art element of a saved art widget. */
export const artOf = (w: Widget): Art => w.elements[0] as Art;
