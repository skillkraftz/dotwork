// Builds a book's print files: pages.pdf, print-first.pdf / print-second.pdf (one pair per signature),
// cover.pdf and a summary. Match journal-system's pocketjournal/book.py and imposition.py.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PAGE_H_MM, PAGE_W_MM, type Page } from '../format/types';
import { withSide } from '../format/spread';
import { blankTokens } from '../format/tokens';
import { bookPage, blankPage, type Book } from '../book/book';
import {
  SHEET_H_MM, SHEET_W_MM, checkPrintSettings, duplexOrder, impose, pageOrigin,
  type PageRef, type Sheet, type SheetSide, type Signature,
} from '../book/impose';
import { drawPage, mmToPt, type Fonts } from './draw';

export interface FontBytes { regular: ArrayBuffer | Uint8Array; bold: ArrayBuffer | Uint8Array }
export interface ExportedFile { name: string; bytes: Uint8Array; type: string }

async function newDocument(fontBytes: FontBytes) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };
  return { doc, fonts };
}

type PdfPage = ReturnType<PDFDocument['addPage']>;

/** Draws book pages and covers with their top-left corner at x, y (mm from the PDF page's top-left). */
function drawer(book: Book, fonts: Fonts, sheetH: number) {
  const place = (pdf: PdfPage, page: Page, x: number, y: number, pageNumber: string | null) =>
    drawPage(pdf, page, { x, y, sheetHeight: sheetH, fonts, pageNumber, expand: blankTokens });
  return {
    page: (pdf: PdfPage, n: number, x: number, y: number) => {
      place(pdf, bookPage(book, n), x, y, book.page_numbers ? String(n) : null);
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

/** One side of every sheet in the given order. Fronts come in reverse, backs forward; the back side takes the printer offset. */
async function sidesPdf(book: Book, sig: Signature, back: boolean, fontBytes: FontBytes): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const d = drawer(book, fonts, SHEET_H_MM);
  const [fronts, backs] = duplexOrder(sig.sheets.length);
  const dx = back ? book.print.back_offset_x_mm : 0;
  const dy = back ? -book.print.back_offset_y_mm : 0; // +y moves up; sheet y runs down
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

/** The cover spread: inside front cover on the left, inside back cover on the right, single-sided, centered, no creep. */
async function coverPdf(book: Book, fontBytes: FontBytes): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const d = drawer(book, fonts, SHEET_H_MM);
  const pdf = doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]);
  const l = pageOrigin(false, 0), r = pageOrigin(true, 0);
  d.cover(pdf, 'front', l.x, l.y);
  d.cover(pdf, 'back', r.x, r.y);
  return doc.save({ useObjectStreams: false });
}

export function summary(book: Book, sigs: Signature[], files: string[]): string {
  const p = book.print;
  const sheets = sigs.reduce((n, g) => n + g.sheets.length, 0);
  const maxCreep = Math.max(...sigs.map((g) => (g.sheets.length - 1) * p.paper_thickness_mm));
  return [
    `Book: ${book.name}`,
    `Pages: ${book.page_count} interior (${sheets} sheets in ${sigs.length} signature${sigs.length > 1 ? 's' : ''})${book.page_numbers ? ', numbered' : ''}`,
    `Page size: ${PAGE_W_MM} x ${PAGE_H_MM} mm, on ${SHEET_W_MM} x ${SHEET_H_MM} mm sheets`,
    `Creep: ${p.paper_thickness_mm} mm per sheet (max ${maxCreep.toFixed(2)} mm)`,
    `Back offset: x ${p.back_offset_x_mm} mm, y ${p.back_offset_y_mm} mm`,
    '',
    `Files: ${files.join(', ')}`,
    '',
    'Print each signature: print-first, put the stack back in the tray the',
    'same way, then print-second. Fold, sew, wrap in the cover, then measure',
    `${(PAGE_W_MM / 25.4).toFixed(1)} in from the fold and trim the fore-edge.`,
    'Cover: print cover.pdf single-sided on the cover paper.',
    '',
  ].join('\n');
}

/** All the PDFs and the summary for a book. Throws if the print settings can't be printed. */
export async function exportBookFiles(book: Book, fontBytes: FontBytes): Promise<ExportedFile[]> {
  const sigs = impose(book.page_count, book.print, book.print.signatures);
  const problem = checkPrintSettings(book.print, Math.max(...sigs.map((g) => g.sheets.length)));
  if (problem) throw new Error(problem);
  const pdf = (name: string, bytes: Uint8Array): ExportedFile => ({ name, bytes, type: 'application/pdf' });
  const files: ExportedFile[] = [];
  for (const sig of sigs) {
    const prefix = sigs.length > 1 ? `sig${sig.number}-` : '';
    files.push(pdf(`${prefix}print-first.pdf`, await sidesPdf(book, sig, false, fontBytes)));
    files.push(pdf(`${prefix}print-second.pdf`, await sidesPdf(book, sig, true, fontBytes)));
  }
  files.push(pdf('cover.pdf', await coverPdf(book, fontBytes)));
  files.push(pdf('pages.pdf', await pagesPdf(book, fontBytes)));
  const names = [...files.map((f) => f.name), 'preview.png'];
  files.push({ name: 'summary.txt', bytes: new TextEncoder().encode(summary(book, sigs, names)), type: 'text/plain' });
  return files;
}
