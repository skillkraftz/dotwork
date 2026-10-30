// How to print each test file, in words, for the print method. One place, so calibration.txt and the Calibrate steps say the same thing.
import type { PrintMethod } from '../book/impose';

/** calibration-sheet.pdf: two pages, the front and the back of one sheet. */
export const sheetHow = (method: PrintMethod) => method === 'auto'
  ? 'Print calibration-sheet.pdf double-sided and let the printer flip the paper (auto duplex, flip on the long edge): page 1 is the front, page 2 the back.'
  : 'Print calibration-sheet.pdf by hand: page 1, put the sheet back in the tray as for print-second, then page 2.';

/** creep-test.pdf: `sheets` sheets, both sides, `pdfPages` pages in all. */
export const creepHow = (method: PrintMethod, sheets: number) => method === 'auto'
  ? `Print creep-test.pdf double-sided and let the printer flip the paper (auto duplex): all ${2 * sheets} pages, each sheet's front then its back (outermost sheet first).`
  : `Print creep-test.pdf by hand: pages 1 to ${sheets}, put the stack back in the tray the same way, then pages ${sheets + 1} to ${2 * sheets}.`;

/** calibration-cover.pdf: page 1 the outside, page 2 the inside. */
export const coverHow = (method: PrintMethod) => method === 'auto'
  ? 'Print calibration-cover.pdf on your cover stock double-sided and let the printer flip the paper (auto duplex): page 1 is the outside, page 2 the inside.'
  : 'Print calibration-cover.pdf on your cover stock by hand: page 1 (the outside), put the sheet back the same way, then page 2 (the inside).';
