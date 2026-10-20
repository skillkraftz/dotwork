import type { Book } from './book';
import { impose } from './impose';

/** The sheets in the biggest signature: what creep builds up over, and what the creep test uses. */
export const creepSheets = (book: Book) => Math.max(...impose(book.page_count, book.print, book.print.signatures).map((g) => g.sheets.length));

/**
 * The new paper thickness, from a creep test. `difference` is the distance of the box from the trimmed edge on the innermost
 * sheet minus the same on the outermost (mm). Sheet k is shifted toward the fold by k × the thickness set, but really
 * protrudes k × the true thickness, so the margin at sheet k is 3.95 + k × (set − true): the difference over the (sheets − 1)
 * sheets between the two is (set − true). A positive difference means the thickness set is too high.
 */
export const thicknessFromCreepTest = (current: number, sheets: number, difference: number) => current - difference / (sheets - 1);

