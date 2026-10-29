// Builds a book's print files: pages.pdf, print-first.pdf / print-second.pdf (one pair per signature, and print-duplex.pdf on letter
// two-up), cover-outside.pdf / cover-inside.pdf and a summary. The sheet layouts are in sheets.ts. Match journal-system's pocketjournal/book.py and imposition.py.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PAGE_H_MM, PAGE_W_MM, type Page } from '../format/types';
import { blankTokens } from '../format/tokens';
import { FIRST_SLOT, bookExpand, bookPage, lastSlot, type Book } from '../book/book';
import {
  LAYOUT_NAMES, PAPER_SETTINGS, SHEET_H_MM, SHEET_W_MM, checkPrintSettings, duplexOrder, impose, pageOrigin,
  type PageRef, type PrintSettings, type Sheet, type SheetSide, type Signature,
} from '../book/impose';
import { drawItems, mmToPt, type Fonts } from './draw';
import type { Item } from './display';
import { layoutPage } from './layout';
import { printSide } from './correct';
import { edgeWarnings } from './edge';
import { cutMarks, halfLabel, halfLabelItem, halfTops, isTwoUp, sheetSize } from './sheets';
import { tonesOf } from './tones';
import { settingsLines } from './settingstext';

export interface FontBytes { regular: ArrayBuffer | Uint8Array; bold: ArrayBuffer | Uint8Array }
export interface ExportedFile { name: string; bytes: Uint8Array; type: string }

export async function newDocument(fontBytes: FontBytes) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };
  return { doc, fonts };
}

export type PdfPage = ReturnType<PDFDocument['addPage']>;

export type Drawer = ReturnType<typeof drawer>;

/** Lays out book pages and covers, with their top-left corner at x, y (mm from the PDF page's top-left), onto a display list. */
export function drawer(book: Book, print: Pick<PrintSettings, 'shade_light_pct' | 'shade_medium_pct' | 'shade_dark_pct' | 'gray_text_pct'>) {
  const tones = tonesOf(print);
  const place = (out: Item[], page: Page, x: number, y: number, pageNumber: string | null, expand = blankTokens) =>
    layoutPage(page, { x, y, pageNumber, expand, tones }, out);
  return {
    page: (out: Item[], n: number, x: number, y: number) => {
      place(out, bookPage(book, n), x, y, book.page_numbers ? String(n) : null, bookExpand(book, n));
    },
    /** A cover page by its slot (see book.ts): blank if it has no design, never numbered, and reading the calendar's first month. */
    cover: (out: Item[], slot: number, x: number, y: number) => place(out, bookPage(book, slot), x, y, null, bookExpand(book, slot)),
  };
}

/** Every page at final size, in reading order. */
async function pagesPdf(book: Book, print: PrintSettings, fontBytes: FontBytes): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const d = drawer(book, print);
  // The digital pages carry no printer correction.
  for (let n = 1; n <= book.page_count; n++) {
    const items: Item[] = [];
    d.page(items, n, 0, 0);
    drawItems(doc.addPage([mmToPt(PAGE_W_MM), mmToPt(PAGE_H_MM)]), items, fonts, PAGE_H_MM);
  }
  return doc.save({ useObjectStreams: false });
}

/** What goes in one half-letter sheet's place on a PDF page: whose it is, its label and how to draw it with its top edge `top` mm down the page. */
export interface HalfPlan {
  book: Book;
  /** After "Book 1 | ": the book's name and what this is, as it is written in the trim zone. */
  label: string[];
  draw: (d: Drawer, out: Item[], top: number) => void;
}
/** One PDF page: which side of the sheet it prints and what is in each half (null is blank). Half letter has one half; two-up has top and bottom. */
export interface PagePlan { side: 'front' | 'back'; halves: (HalfPlan | null)[] }

/**
 * The PDF for pages of sheets. The sheet layout, offsets, rotation, scale, shifts and tones all come from the printer profile `print`;
 * each half draws its own book's pages.
 */
export async function sheetsPdf(plans: PagePlan[], print: PrintSettings, fontBytes: FontBytes): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const layout = print.sheet_layout, { w, h } = sheetSize(layout), tops = halfTops(layout), twoUp = isTwoUp(layout);
  const drawers = new Map<Book, Drawer>();
  const drawerOf = (b: Book) => drawers.get(b) ?? drawers.set(b, drawer(b, print)).get(b)!;
  for (const plan of plans) {
    // Layout (every half, the labels, the cut marks), then the side's correction, then the PDF.
    const items: Item[] = [];
    plan.halves.forEach((half, i) => {
      if (!half) return;
      half.draw(drawerOf(half.book), items, tops[i]);
      if (twoUp) items.push(halfLabelItem(halfLabel(fonts.regular, i as 0 | 1, ...half.label), tops[i]));
    });
    if (twoUp) items.push(...cutMarks());
    drawItems(doc.addPage([mmToPt(w), mmToPt(h)]), printSide(items, print, plan.side, w, h), fonts, h);
  }
  return doc.save({ useObjectStreams: false });
}

const bookTitle = (b: Book) => b.name.trim() || 'Untitled book';

/** Sheet `j` of a signature, one side, as a half: null if the signature (or the sheet) isn't there. */
function sheetHalf(book: Book, print: PrintSettings, sig: Signature | undefined, j: number, side: 'front' | 'back', signatures: number): HalfPlan | null {
  const sheet: Sheet | undefined = sig?.sheets[j];
  if (!sig || !sheet) return null;
  const refs: SheetSide = sheet[side];
  return {
    book,
    label: [bookTitle(book), `${signatures > 1 ? `signature ${sig.number}, ` : ''}sheet ${j + 1} of ${sig.sheets.length}`, side],
    draw: (d, out, top) => {
      for (const [isRight, ref] of [[false, refs.left], [true, refs.right]] as [boolean, PageRef][]) {
        if (ref === null) continue;
        if (isRight !== Boolean(ref % 2)) throw new Error(`page ${ref} landed on the wrong side`);
        const at = pageOrigin(isRight, sheet.creep, print.fore_edge_shift_mm);
        d.page(out, ref, at.x, top + at.y);
      }
    },
  };
}

/** The books on a sheet: the top one, and for two-up the bottom one. */
export interface Books { top: Book; bottom: Book }

/** What is printed on one side of sheet `j` of signature `i`: the top book's, and for two-up the bottom book's. */
function sheetPage(b: Books, print: PrintSettings, topSigs: Signature[], bottomSigs: Signature[], i: number, j: number, side: 'front' | 'back'): PagePlan {
  const halves = [sheetHalf(b.top, print, topSigs[i], j, side, topSigs.length)];
  if (isTwoUp(print.sheet_layout)) halves.push(sheetHalf(b.bottom, print, bottomSigs[i], j, side, bottomSigs.length));
  return { side, halves };
}

/** How many signatures and, in each, how many sheets the layout needs: the bigger of the two books, so the other's extra halves stay blank. */
function sheetCounts(print: PrintSettings, topSigs: Signature[], bottomSigs: Signature[]): number[] {
  const two = isTwoUp(print.sheet_layout), count = Math.max(topSigs.length, two ? bottomSigs.length : 0);
  return Array.from({ length: count }, (_, i) => Math.max(topSigs[i]?.sheets.length ?? 0, two ? bottomSigs[i]?.sheets.length ?? 0 : 0));
}

/**
 * The cover sheet of a pass. Outside: the outside back cover on the left, the outside front on the right. Inside: the inside
 * front cover on the left, the inside back on the right. Neither has creep; each moves away from the fold by its book's cover
 * shift, on its own side of the fold, so the inside front lands behind the outside front. The outside is printed first (the
 * front offset), the inside second (the back offset).
 */
function coverHalf(book: Book, print: PrintSettings, pass: 'outside' | 'inside'): HalfPlan {
  const [left, right] = pass === 'outside' ? [lastSlot(book), FIRST_SLOT] : [0, book.page_count + 1];
  return {
    book,
    label: [bookTitle(book), `${pass} cover`],
    draw: (d, out, top) => {
      const shift = print.cover_fore_edge_shift_mm, l = pageOrigin(false, 0, shift), r = pageOrigin(true, 0, shift);
      d.cover(out, left, l.x, top + l.y);
      d.cover(out, right, r.x, top + r.y);
    },
  };
}

/** The cover PDF of a pass: one sheet, single-sided. Two-up puts the top book's covers on the top half and the bottom book's below. */
const coverPdf = (b: Books, print: PrintSettings, pass: 'outside' | 'inside', fontBytes: FontBytes) =>
  sheetsPdf([{ side: pass === 'outside' ? 'front' : 'back', halves: isTwoUp(print.sheet_layout) ? [coverHalf(b.top, print, pass), coverHalf(b.bottom, print, pass)] : [coverHalf(b.top, print, pass)] }], print, fontBytes);

/** Short advice for printing, from the steps above: the real procedure (print-first, same way back in the tray, print-second) and the calibration set. */
export const PRINT_TIPS = [
  '- Print the calibration set first (Calibrate, in the PDF tab of Import and Export). It shows how your printer',
  '  places and sizes the pages without printing a whole book: the best way to avoid wasting paper.',
  '- Then print one signature before the whole book.',
  '- Print at actual size (100%): turn off fit-to-page and scale-to-fit.',
  '- Use the same paper and printer settings for print-first and print-second.',
  '- Print at your printer\'s best quality. Firefox may not use the quality set in the printer\'s own defaults, and normal',
  '  quality feeds the paper too fast and misaligns lines. Check the quality in the print dialog\'s printer options, or',
  '  set the default in CUPS (localhost:631) on Linux.',
];

/** The sheet order, derived: said in summary.txt so a pile can be checked by eye. */
export const TWO_UP_ORDER = [
  'Sheet order: letter sheet k holds sheet k of Book 1 on its top half and sheet k of Book 2 on its bottom half (k = 1 is the',
  'outermost sheet). print-duplex.pdf runs front, back for k = 1, 2, 3 … A printer that lays each sheet on top of the last',
  '(first one at the bottom), which is how the manual print-first / print-second pair ends up too, gives a pile with sheet 1 at',
  'the bottom and the innermost sheet on top. Cut the whole pile once along the cut marks: the top halves are Book 1 and the bottom',
  'halves Book 2, each in nesting order. If your printer stacks the other way, each pile is in reverse order: turn it round.',
];

export function summary(books: Books, p: PrintSettings, sigs: Signature[], files: string[], now = new Date(), bottomSigs: Signature[] = sigs, warnings: string[] = []): string {
  const book = books.top, twoUp = isTwoUp(p.sheet_layout);
  const sheets = sigs.reduce((n, g) => n + g.sheets.length, 0);
  const maxCreep = Math.max(...sigs.map((g) => (g.sheets.length - 1) * p.creep_per_sheet_mm));
  const { w, h } = sheetSize(p.sheet_layout);
  return [
    `Book: ${book.name}`,
    `Pages: ${book.page_count} interior (${sheets} sheets in ${sigs.length} signature${sigs.length > 1 ? 's' : ''})${book.page_numbers ? ', numbered' : ''}`,
    `Sheets: ${SHEET_W_MM} x ${SHEET_H_MM} mm; creep at most ${maxCreep.toFixed(2)} mm`,
    `Sheet layout: ${LAYOUT_NAMES[p.sheet_layout]} (${w} x ${h} mm)`,
    `Printer: ${PAPER_SETTINGS[p.sheet_layout]}`,
    ...(twoUp ? [
      `Top: Book 1, ${bookTitle(books.top)} (${sigs.reduce((n, g) => n + g.sheets.length, 0)} sheets)`,
      `Bottom: Book 2, ${bookTitle(books.bottom)} (${bottomSigs.reduce((n, g) => n + g.sheets.length, 0)} sheets; a book with fewer sheets leaves its half blank)`,
      'Both books print with the same printer settings.',
    ] : []),
    '',
    'Print settings used for these files:',
    ...settingsLines(p, now, book.print.signatures).map((l) => `  ${l}`),
    '  (offsets: + is right and up, as seen on that side. Front: the first pass. Back: the second. Back rotation: + is counter-clockwise as seen on the back. Tones: 0 = white, 100 = black.)',
    '',
    `Files: ${files.join(', ')}`,
    '',
    ...(warnings.length ? ['Warnings:', ...warnings.map((w) => `  - ${w}`), ''] : []),
    ...(twoUp ? [
      'Print each signature on a printer that duplexes by itself: print-duplex.pdf, flip on the long edge (top stays top).',
      'Without auto-duplex: print-first, put the stack back in the tray the same way, then print-second.',
      ...TWO_UP_ORDER,
      'Cut marks: at the middle line in the side trim zones (they are cut off when trimming). Each half is labelled in its trim zone.',
    ] : [
      'Print each signature: print-first, put the stack back in the tray the',
      'same way, then print-second.',
    ]),
    'Fold, sew, wrap in the cover, then measure',
    `${(PAGE_W_MM / 25.4).toFixed(1)} in from the fold and trim the fore-edge.`,
    `Covers: print cover-outside.pdf single-sided on the cover paper, put the sheet back the same way, then print cover-inside.pdf${twoUp ? ' (two covers per sheet)' : ''}.`,
    '',
    'Tips:',
    ...PRINT_TIPS,
    '',
  ].join('\n');
}

/** Which of a book's files to build; everything unless told otherwise. */
export interface Include { signatures?: boolean; cover?: boolean; pages?: boolean }

/** Why the books can't be printed with their settings, or null. `bottom` is checked only on a two-up sheet. */
export function exportProblem(print: PrintSettings, topSigs: Signature[], bottomSigs: Signature[], twoUp = isTwoUp(print.sheet_layout)): string | null {
  const biggest = (sigs: Signature[]) => Math.max(...sigs.map((g) => g.sheets.length));
  const own = (sigs: Signature[], name: string) => {
    const problem = checkPrintSettings(print, biggest(sigs));
    return problem && `${name}${problem}`;
  };
  return own(topSigs, twoUp ? 'Book 1: ' : '') ?? (twoUp ? own(bottomSigs, 'Book 2: ') : null);
}

/** The files of an export and what to tell the owner about them: content the print driver might cut off at the sheet's edge. */
export type ExportedFiles = ExportedFile[] & { warnings: string[] };

/**
 * The PDFs and the summary for a book (and, on a two-up sheet, for the book on the bottom half: the same book unless told), printed
 * with the printer profile `print`. Throws if the print settings can't be printed.
 */
export async function exportBookFiles(book: Book, print: PrintSettings, fontBytes: FontBytes, include: Include = {}, bottomBook: Book = book): Promise<ExportedFiles> {
  const { signatures = true, cover = true, pages = true } = include;
  const books: Books = { top: book, bottom: bottomBook };
  const topSigs = impose(book.page_count, print, book.print.signatures);
  const bottomSigs = isTwoUp(print.sheet_layout) ? impose(bottomBook.page_count, print, bottomBook.print.signatures) : topSigs;
  if (signatures || cover) {
    const problem = exportProblem(print, topSigs, bottomSigs);
    if (problem) throw new Error(problem);
  }
  // Near the sheet's edge is a warning, not a refusal: the files are made, and the owner checks by printing that page.
  const warnings = signatures || cover ? edgeWarnings(books, print, topSigs, bottomSigs) : [];
  const pdf = (name: string, bytes: Uint8Array): ExportedFile => ({ name, bytes, type: 'application/pdf' });
  const files: ExportedFiles = Object.assign([] as ExportedFile[], { warnings });
  const twoUp = isTwoUp(print.sheet_layout);
  if (signatures) {
    const counts = sheetCounts(print, topSigs, bottomSigs);
    for (const [i, n] of counts.entries()) {
      const prefix = counts.length > 1 ? `sig${i + 1}-` : '';
      const [fronts, backs] = duplexOrder(n);
      const make = (order: [number, 'front' | 'back'][]) => sheetsPdf(order.map(([j, side]) => sheetPage(books, print, topSigs, bottomSigs, i, j, side)), print, fontBytes);
      // print-duplex: front, back, front, back… from the outermost sheet in, so a pile built in print order nests as it is.
      if (twoUp) files.push(pdf(`${prefix}print-duplex.pdf`, await make(Array.from({ length: n }, (_, j): [number, 'front' | 'back'][] => [[j, 'front'], [j, 'back']]).flat())));
      files.push(pdf(`${prefix}print-first.pdf`, await make(fronts.map((j) => [j, 'front']))));
      files.push(pdf(`${prefix}print-second.pdf`, await make(backs.map((j) => [j, 'back']))));
    }
  }
  if (cover) {
    files.push(pdf('cover-outside.pdf', await coverPdf(books, print, 'outside', fontBytes)));
    files.push(pdf('cover-inside.pdf', await coverPdf(books, print, 'inside', fontBytes)));
  }
  if (pages) files.push(pdf('pages.pdf', await pagesPdf(book, print, fontBytes)));
  if (signatures) {
    const names = [...files.map((f) => f.name), 'preview.png'];
    files.push({ name: 'summary.txt', bytes: new TextEncoder().encode(summary(books, print, topSigs, names, new Date(), bottomSigs, warnings)), type: 'text/plain' });
  }
  return files;
}
