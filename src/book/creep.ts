import { GRID_X_MM } from '../format/types';
import type { Book } from './book';
import { impose } from './impose';

/** The sheets in the biggest signature: what creep builds up over, and what the creep test uses. */
export const creepSheets = (book: Book) => Math.max(...impose(book.page_count, book.print, book.print.signatures).map((g) => g.sheets.length));

/**
 * Where the box ends up from the trimmed fore-edge, at sheet k (0 = outermost), by the book's geometry. The cut is made PAGE_W
 * from the cover's fold. Sheet k's own fold sits (the cover's thickness + k × the paper's real thickness) closer to the cut, and
 * its pages were shifted toward that fold by k × the thickness set, so
 *
 *     margin(k) = GRID_X + k × (set − real) − cover
 *
 * The cover is printed with no creep and its fold is the outermost one, so its own margin is GRID_X.
 */
export const marginAt = (k: number, set: number, real: number, cover = 0) => GRID_X_MM + k * (set - real) - cover;

/**
 * The new paper thickness, from a creep test. `difference` is the margin on the innermost sheet minus the margin on the
 * outermost sheet (mm). Sheet k protrudes k × the true thickness but is shifted by k × the thickness set, so the difference over
 * the (sheets − 1) sheets between the two is (set − true). A positive difference means the thickness set is too high.
 *
 * Compare the innermost sheet with the OUTERMOST SHEET, not with the cover. The cover wraps outside sheet 0, so its thickness
 * pushes every sheet in by the same amount: it cancels between two sheets, but not between a sheet and the cover.
 */
export const thicknessFromCreepTest = (current: number, sheets: number, difference: number) => current - difference / (sheets - 1);

/** How far the cover's thickness pushes the pages in: the cover's margin minus the outermost sheet's. */
export const coverPush = (coverMargin: number, outermostMargin: number) => coverMargin - outermostMargin;

/** The three fore-edge margins read after binding and trimming, in mm. */
export interface CreepReadings { cover: number; outermost: number; innermost: number }

/** The result of a creep test: the new thickness, and how far the cover's own thickness pushes the pages in. */
export function creepResult(current: number, sheets: number, r: CreepReadings) {
  return {
    thickness: thicknessFromCreepTest(current, sheets, r.innermost - r.outermost),
    coverPush: coverPush(r.cover, r.outermost),
  };
}
