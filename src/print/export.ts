// Builds a book's print files: pages.pdf, print-first.pdf / print-second.pdf (one pair per signature),
// cover.pdf and a summary. Match journal-system's pocketjournal/book.py and imposition.py.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PAGE_H_MM, PAGE_W_MM, type Page } from '../format/types';
import { withSide } from '../format/spread';
import { blankTokens } from '../format/tokens';
import { bookExpand, bookPage, blankPage, type Book } from '../book/book';
import {
  SHEET_H_MM, SHEET_W_MM, checkPrintSettings, duplexOrder, impose, offsetOf, pageOrigin,
  type PageRef, type Sheet, type SheetSide, type Signature,
} from '../book/impose';
import { drawPage, mmToPt, type Fonts } from './draw';
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

/** Draws book pages and covers with their top-left corner at x, y (mm from the PDF page's top-left). */
function drawer(book: Book, fonts: Fonts, sheetH: number) {
  const tones = tonesOf(book.print);
  const place = (pdf: PdfPage, page: Page, x: number, y: number, pageNumber: string | null, expand = blankTokens) =>
    drawPage(pdf, page, { x, y, sheetHeight: sheetH, fonts, pageNumber, expand, tones });
  return {
    page: (pdf: PdfPage, n: number, x: number, y: number) => {
      place(pdf, bookPage(book, n), x, y, book.page_numbers ? String(n) : null, bookExpand(book, n));
    },
    cover: (pdf: PdfPage, which: 'front' | 'back', x: number, y: number) => {
      place(pdf, withSide(book.cover[which] ?? blankPage(which === 'front' ? 'left' : 'right'), which === 'front' ? 'left' : 'right'), x, y, null);
    },
  };
}

/** Every page at final size, in reading order. */
async function pagesPdf(book: Book, fontBytes: FontBytes): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const d = drawer(book, fonts, PAGE_H_MM);
  for (let n = 1; n <= book.page_count; n++) d.page(doc.addPage([mmToPt(PAGE_W_MM), mmToPt(PAGE_H_MM)]), n, 0, 0);
  return doc.save({ useObjectStreams: false });
}

/** One side of every sheet in the given order. Fronts come in reverse, backs forward; each side takes its own printer offset. */
async function sidesPdf(book: Book, sig: Signature, back: boolean, fontBytes: FontBytes): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const d = drawer(book, fonts, SHEET_H_MM);
  const [fronts, backs] = duplexOrder(sig.sheets.length);
  const off = offsetOf(book.print, back ? 'back' : 'front');
  const dx = off.x, dy = -off.y; // +y moves up; sheet y runs down
  for (const i of back ? backs : fronts) {
    const sheet: Sheet = sig.sheets[i];
    const side: SheetSide = back ? sheet.back : sheet.front;
    const pdf = doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]);
    for (const [isRight, ref] of [[false, side.left], [true, side.right]] as [boolean, PageRef][]) {
      if (ref === null) continue;
      if (isRight !== Boolean(ref % 2)) throw new Error(`page ${ref} landed on the wrong side`);
      const at = pageOrigin(isRight, sheet.creep);
      d.page(pdf, ref, at.x + dx, at.y + dy);
    }
  }
  return doc.save({ useObjectStreams: false });
}

/** The cover spread: inside front cover on the left, inside back cover on the right, single-sided, centered, no creep. It takes the front offset. */
async function coverPdf(book: Book, fontBytes: FontBytes): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const d = drawer(book, fonts, SHEET_H_MM);
  const pdf = doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]);
  const off = offsetOf(book.print, 'front');
  const l = pageOrigin(false, 0), r = pageOrigin(true, 0);
  d.cover(pdf, 'front', l.x + off.x, l.y - off.y);
  d.cover(pdf, 'back', r.x + off.x, r.y - off.y);
  return doc.save({ useObjectStreams: false });
}

/** Short advice for printing, from the steps above: the real procedure (print-first, same way back in the tray, print-second) and the calibration set. */
export const PRINT_TIPS = [
  '- Print the calibration set first (Calibrate, in the PDF tab of Import and Export). It shows how your printer',
  '  places and tones the pages without printing a whole book: the best way to avoid wasting paper.',
  '- Then print one signature before the whole book.',
  '- Print at actual size (100%): turn off fit-to-page and scale-to-fit.',
  '- Use the same paper and printer settings for print-first and print-second.',
  '- Print at your printer\'s best quality. Firefox may not use the quality set in the printer\'s own defaults, and normal',
  '  quality feeds the paper too fast and misaligns lines. Check the quality in the print dialog\'s printer options, or',
  '  set the default in CUPS (localhost:631) on Linux.',
];

export function summary(book: Book, sigs: Signature[], files: string[], now = new Date()): string {
  const p = book.print;
  const sheets = sigs.reduce((n, g) => n + g.sheets.length, 0);
  const maxCreep = Math.max(...sigs.map((g) => (g.sheets.length - 1) * p.paper_thickness_mm));
  return [
    `Book: ${book.name}`,
    `Pages: ${book.page_count} interior (${sheets} sheets in ${sigs.length} signature${sigs.length > 1 ? 's' : ''})${book.page_numbers ? ', numbered' : ''}`,
    `Sheets: ${SHEET_W_MM} x ${SHEET_H_MM} mm; creep at most ${maxCreep.toFixed(2)} mm`,
    '',
    'Print settings used for these files:',
    ...settingsLines(book, now).map((l) => `  ${l}`),
    '  (offsets: + is right and up, as seen on that side. Front: print-first.pdf and cover.pdf. Back: print-second.pdf. Tones: 0 = white, 100 = black.)',
    '',
    `Files: ${files.join(', ')}`,
    '',
    'Print each signature: print-first, put the stack back in the tray the',
    'same way, then print-second. Fold, sew, wrap in the cover, then measure',
    `${(PAGE_W_MM / 25.4).toFixed(1)} in from the fold and trim the fore-edge.`,
    'Cover: print cover.pdf single-sided on the cover paper.',
    '',
    'Tips:',
    ...PRINT_TIPS,
    '',
  ].join('\n');
}

/** Which of a book's files to build; everything unless told otherwise. */
export interface Include { signatures?: boolean; cover?: boolean; pages?: boolean }

/** The PDFs and the summary for a book. Throws if the print settings can't be printed. */
export async function exportBookFiles(book: Book, fontBytes: FontBytes, include: Include = {}): Promise<ExportedFile[]> {
  const { signatures = true, cover = true, pages = true } = include;
  const sigs = impose(book.page_count, book.print, book.print.signatures);
  if (signatures) {
    const problem = checkPrintSettings(book.print, Math.max(...sigs.map((g) => g.sheets.length)));
    if (problem) throw new Error(problem);
  }
  const pdf = (name: string, bytes: Uint8Array): ExportedFile => ({ name, bytes, type: 'application/pdf' });
  const files: ExportedFile[] = [];
  if (signatures) {
    for (const sig of sigs) {
      const prefix = sigs.length > 1 ? `sig${sig.number}-` : '';
      files.push(pdf(`${prefix}print-first.pdf`, await sidesPdf(book, sig, false, fontBytes)));
      files.push(pdf(`${prefix}print-second.pdf`, await sidesPdf(book, sig, true, fontBytes)));
    }
  }
  if (cover) files.push(pdf('cover.pdf', await coverPdf(book, fontBytes)));
  if (pages) files.push(pdf('pages.pdf', await pagesPdf(book, fontBytes)));
  if (signatures) {
    const names = [...files.map((f) => f.name), 'preview.png'];
    files.push({ name: 'summary.txt', bytes: new TextEncoder().encode(summary(book, sigs, names)), type: 'text/plain' });
  }
  return files;
}
