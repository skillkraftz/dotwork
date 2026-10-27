import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT } from '../src/book/impose';
import { PRINTER_KEYS, readPrinter } from '../src/printer';
import { emptyBook, PRINT_LIMITS, type Book } from '../src/book/book';
import { errorProblem, isQuotaError, issuesProblem } from '../src/problems';
import { withBookJson } from '../src/print/bundle';
import { exportBookFiles } from '../src/print/export';
import { TEMPLATES } from '../src/builtin/templates';

/** A book made to break the book format: "page_numbers" must be true or false. */
const brokenBook = (): Book => {
  const b = TEMPLATES.find((t) => t.id === 'year-planner')!.build({ year: 2026 });
  (b as unknown as Record<string, unknown>).page_numbers = 'yes';
  return b;
};

describe('problems', () => {
  it('say "storage is full" only for a quota error, and carry the real reason', () => {
    expect(isQuotaError(Object.assign(new Error('x'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' }))).toBe(true);
    expect(isQuotaError(new Error('quota'))).toBe(false);
    expect(errorProblem('t', new Error('boom')).details).toContain('boom');
  });

  it('list a few issues on screen and every one in the details', () => {
    const issues = Array.from({ length: 9 }, (_, i) => ({ rule: 'r', path: `pages[${i}]`, message: 'bad' }));
    const p = issuesProblem('title', issues);
    expect(p.lines).toHaveLength(6);
    expect(p.details).toContain('pages[8]');
  });
});

describe('the zip', () => {
  const fonts = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };

  it('carries the book as JSON beside the PDFs, with no error log when all is well', async () => {
    const book = emptyBook(8);
    const files = withBookJson(book, await exportBookFiles(book, DEFAULT_PRINT, fonts, { pages: true, cover: false, signatures: false }));
    expect(files.map((f) => f.name)).toEqual(['pages.pdf', 'book.json']);
    expect(JSON.parse(new TextDecoder().decode(files[1].bytes))).toEqual(book);
  });

  it('puts the error in an error.txt when the export fails, and still has the book', async () => {
    const book = brokenBook();
    let failure: unknown;
    try { await exportBookFiles(book, DEFAULT_PRINT, { regular: new Uint8Array(), bold: new Uint8Array() }); } catch (err) { failure = err; }
    expect(failure).toBeDefined();
    const files = withBookJson(book, [], failure);
    expect(files.map((f) => f.name)).toEqual(['book.json', 'error.txt']);
    const log = new TextDecoder().decode(files[1].bytes);
    expect(log).toContain('The export failed.');
    expect(log).toContain('page_numbers'); // every way the book breaks the format
  });

  it('says so when the files were made from a book that breaks the format, and writes the reason when the book can’t be written as JSON', () => {
    expect(new TextDecoder().decode(withBookJson(brokenBook(), [])[1].bytes)).toContain('the book breaks the book format');
    const book = emptyBook(4) as Book & { self?: unknown };
    book.self = book;
    expect(withBookJson(book, [])[0].name).toBe('book-json-error.txt');
  });
});

describe('print limits', () => {
  it('are the ones the printer profile enforces', () => {
    for (const key of PRINTER_KEYS) {
      const { min, max } = PRINT_LIMITS[key];
      for (const v of [min, max]) expect(readPrinter({ ...DEFAULT_PRINT, [key]: v }).ok, `${key}=${v}`).toBe(true);
      const r = readPrinter({ ...DEFAULT_PRINT, [key]: max + 1 });
      expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual([key]);
    }
  });
});
