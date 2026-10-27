import type { Page } from '../format/types';
import { FIRST_SLOT, lastSlot, type Book } from './book';

export const designName = (page: Page | null) => (page ? page.name.trim() || 'Untitled' : 'Blank');

/**
 * The two slots of the opening that holds `slot`: the left (even) one and the right (odd) one. The outside covers have no
 * partner: for the outside front cover the left slot (-2) is not a page, and so is the right one (N+3) for the outside back.
 */
export const opening = (slot: number): [number, number] => {
  const left = slot - (((slot % 2) + 2) % 2);
  return [left, left + 1];
};

/** What a slot is called to a person: "Inside front cover", "Page 5". */
export function slotLabel(book: Book, slot: number): string {
  if (slot === FIRST_SLOT) return 'Outside front cover';
  if (slot === 0) return 'Inside front cover';
  if (slot === book.page_count + 1) return 'Inside back cover';
  if (slot === lastSlot(book)) return 'Outside back cover';
  return `Page ${slot}`;
}
