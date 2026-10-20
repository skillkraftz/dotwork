// Test helper: the text drawn on each page of a PDF made by pdf-lib with embedded TrueType fonts.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';

const decode = (s: PDFRawStream) => new TextDecoder('latin1').decode(decodePDFRawStream(s).decode());

/** Glyph id -> text, from a font's ToUnicode CMap. */
function toUnicode(doc: PDFDocument, font: PDFDict): Map<string, string> {
  const map = new Map<string, string>();
  const stream = doc.context.lookup(font.get(PDFName.of('ToUnicode'))) as PDFRawStream;
  const cmap = decode(stream);
  const utf16 = (hex: string) => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(m[1].toLowerCase(), utf16(m[2]));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const [lo, hi] = [parseInt(m[1], 16), parseInt(m[2], 16)];
      for (let g = lo; g <= hi; g++) map.set(g.toString(16).padStart(m[1].length, '0'), String.fromCharCode(parseInt(m[3], 16) + g - lo));
    }
  }
  return map;
}

export interface PageInfo { width: number; height: number; strings: string[]; content: string }

export async function readPdf(bytes: Uint8Array): Promise<PageInfo[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    const content = refs.map((r) => decode(doc.context.lookup(r as PDFRef) as PDFRawStream)).join('\n');
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const maps = new Map<string, Map<string, string>>();
    for (const [name] of fonts.entries()) maps.set(name.asString(), toUnicode(doc, fonts.lookup(name, PDFDict)));
    const strings: string[] = [];
    let current = new Map<string, string>();
    for (const m of content.matchAll(/\/(\S+)\s+[\d.]+\s+Tf|<([0-9a-f]+)>\s*Tj/gi)) {
      if (m[1]) current = maps.get('/' + m[1]) ?? new Map();
      else strings.push((m[2].match(/.{4}/g) ?? []).map((g) => current.get(g.toLowerCase()) ?? '?').join(''));
    }
    const { width, height } = page.getSize();
    return { width, height, strings, content };
  });
}

/** Every text draw on a page, in order, with its position in mm from the page's top left (the text's start and its baseline). */
export function textPositions(page: PageInfo): { text: string; x: number; y: number }[] {
  const PT = 72 / 25.4;
  const at = [...page.content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => ({ x: +m[1] / PT, y: page.height / PT - +m[2] / PT }));
  return page.strings.map((text, i) => ({ text, ...at[i] }));
}
