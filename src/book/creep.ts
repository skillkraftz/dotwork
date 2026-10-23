import type { Book } from './book';
import { impose, spineMargin, type PrintSettings } from './impose';

/** The sheets in the biggest signature: what creep builds up over, and what the creep test uses. */
export const creepSheets = (book: Book, print: PrintSettings) => Math.max(...impose(book.page_count, print, book.print.signatures).map((g) => g.sheets.length));

/**
 * The creep model. The owner reads the fore-edge margin on the trimmed book: the box's outer edge to the trimmed edge. For
 * sheet k (0 = outermost) printed with `creep` per sheet and a fore-edge `shift`,
 *
 *     margin(k) = A + k × (creep − g) − shift
 *
 * - `A` is the margin of the outermost sheet with no creep and no shift. It is NOT the page's own 3.95 mm: a saddle-stitched
 *   book this thick has a round spine, and paper going round the curve is used up, so outer pages' content lands about
 *   (π/2 − 1) × r further from the fore-edge than designed (r is about half the book's thickness).
 * - `g` is how far each sheet's fore-edge really creeps out going inward: about (π/2) × the paper's thickness in a thick book,
 *   not 1 ×. It is what the creep setting has to equal for every sheet to land on the same margin.
 * - The shift moves content toward the fore-edge, so a bigger shift makes the margin smaller. The cover is the outermost fold
 *   and has no creep: margin = Ac − cover shift.
 */
export interface Binding { A: number; g: number; Ac: number | null }

/** What the three fore-edge margins were printed with. */
export interface Printed { creep: number; foreEdgeShift: number; coverShift: number; target: number }

/** The three fore-edge margins read after binding and trimming, in mm. `cover` is null when it wasn't read. */
export interface CreepReadings { cover: number | null; outermost: number; innermost: number }

/** The settings a creep test leads to. */
export interface CreepSettings { creep: number; foreEdgeShift: number; coverShift: number }

export const marginAt = (k: number, creep: number, shift: number, b: Pick<Binding, 'A' | 'g'>) => b.A + k * (creep - b.g) - shift;
export const coverMarginAt = (shift: number, Ac: number) => Ac - shift;

/** The binding a creep test shows, from the values it was printed with and the margins read (`Ac` is null without a cover reading). */
export function bindingFromReadings(printed: Printed, sheets: number, r: CreepReadings): Binding {
  const diff = r.innermost - r.outermost; // = (sheets − 1) × (printed creep − g)
  return {
    A: r.outermost + printed.foreEdgeShift,
    g: printed.creep - diff / (sheets - 1),
    Ac: r.cover === null ? null : r.cover + printed.coverShift,
  };
}

/**
 * The new settings, from the values the test was printed with (never the current ones) and the margins read:
 *
 *     creep       = printed creep + (outermost − innermost) ÷ (sheets − 1)
 *                   (a bigger margin on the inner sheet means it was moved in too far: creep less)
 *     shift       = printed shift + (outermost − target)
 *                   (a margin bigger than the target: move the content toward the fore-edge, i.e. a bigger shift)
 *     cover shift = printed cover shift + (cover − target)
 *
 * Compare the innermost sheet with the OUTERMOST SHEET, not with the cover: they differ by the cover's thickness.
 */
export function creepResult(printed: Printed, sheets: number, r: CreepReadings): CreepSettings {
  return {
    creep: printed.creep + (r.outermost - r.innermost) / (sheets - 1),
    foreEdgeShift: printed.foreEdgeShift + (r.outermost - printed.target),
    coverShift: r.cover === null ? printed.coverShift : printed.coverShift + (r.cover - printed.target),
  };
}

/** The fore-edge margins a book printed with `next` would have, by the model: all the target if nothing was clamped. */
export function predictedMargins(printed: Printed, sheets: number, r: CreepReadings, next: CreepSettings) {
  const b = bindingFromReadings(printed, sheets, r);
  return {
    cover: b.Ac === null ? null : coverMarginAt(next.coverShift, b.Ac),
    outermost: marginAt(0, next.creep, next.foreEdgeShift, b),
    innermost: marginAt(sheets - 1, next.creep, next.foreEdgeShift, b),
  };
}

/** Below this, the innermost page's spine-side margin on the paper is getting small: the writing runs into the gutter. */
export const SPINE_WARN_MM = 2;

/** The innermost page's margin at the spine, on the paper (page margin minus how far the content moved toward the fold). */
export const innermostSpineMargin = (sheets: number, s: CreepSettings) => spineMargin((sheets - 1) * s.creep - s.foreEdgeShift);
