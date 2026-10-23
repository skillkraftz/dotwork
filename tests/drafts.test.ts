import { DEFAULT_PRINT } from '../src/book/impose';
import { PRINTER_KEYS, readPrinter } from '../src/printer';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { badDraftProblem, backupsOf, loadDraft, saveDraft, type DraftStorage } from '../src/drafts';
import { emptyBook, readBook, PRINT_LIMITS, type Book } from '../src/book/book';
import { errorProblem, isQuotaError, issuesProblem } from '../src/problems';
import { withBookJson } from '../src/print/bundle';
import { exportBookFiles } from '../src/print/export';
import { TEMPLATES } from '../src/builtin/templates';

class FakeStorage implements DraftStorage {
  data = new Map<string, string>();
  full = false;
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.full) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    this.data.set(k, v);
  }
}
const readIt = (data: unknown) => { const r = readBook(data); return r.ok ? { ok: true as const, value: r.book } : r; };
const check = (b: Book) => { const r = readBook(b); return r.ok ? [] : r.issues; };

/** The owner's book, made to break the book format: "page_numbers" must be true or false. */
const ownersBook = (): Book => {
  const b = TEMPLATES.find((t) => t.id === 'year-planner')!.build({ year: 2026 });
  b.name = 'Owner’s year';
  (b as unknown as Record<string, unknown>).page_numbers = 'yes';
  return b;
};

describe('the owner’s lost book', () => {
  it('is refused by the book format (this is what made the next refresh drop it)', () => {
    const issues = check(ownersBook());
    expect(issues.map((i) => i.path)).toEqual(['page_numbers']);
  });

  it('is never written over the last good draft', () => {
    const s = new FakeStorage();
    const good = ownersBook();
    good.page_numbers = true;
    expect(saveDraft(s, 'dotwork.book', good, 'book', check)).toBeNull();
    const problem = saveDraft(s, 'dotwork.book', ownersBook(), 'book', check);
    expect(problem?.lines.join('\n')).toContain('page_numbers');
    expect(JSON.parse(s.getItem('dotwork.book')!).page_numbers).toBe(true);
  });

  it('is kept under a backup key, with its reasons, when it is already stored', () => {
    const s = new FakeStorage();
    const raw = JSON.stringify(ownersBook());
    s.setItem('dotwork.book', raw);
    const d = loadDraft(s, 'dotwork.book', readIt, new Date('2026-10-20T00:00:00Z'));
    if (d.status !== 'bad') throw new Error('expected a bad draft');
    expect(d.backupKey).toBe('dotwork.book.bad.2026-10-20T00:00:00.000Z');
    expect(s.getItem(d.backupKey!)).toBe(raw);
    expect(s.getItem('dotwork.book')).toBe(raw); // the draft itself is untouched, too
    const p = badDraftProblem('book', d, []);
    expect(p.lines[0]).toContain('Nothing was deleted');
    expect(p.lines.join('\n')).toContain('page_numbers');
    expect(p.details).toContain(raw); // Copy details carries the whole draft
    // loading again doesn't pile up copies, and never replaces one
    loadDraft(s, 'dotwork.book', readIt, new Date('2026-10-21T00:00:00Z'));
    expect(backupsOf(s, 'dotwork.book')).toEqual([d.backupKey]);
  });
});

describe('drafts', () => {
  it('load when good, and say nothing when there is none', () => {
    const s = new FakeStorage();
    expect(loadDraft(s, 'dotwork.book', readIt).status).toBe('none');
    s.setItem('dotwork.book', JSON.stringify(emptyBook()));
    expect(loadDraft(s, 'dotwork.book', readIt).status).toBe('ok');
  });

  it('that are not JSON are backed up too', () => {
    const s = new FakeStorage();
    s.setItem('dotwork.book', '{"format": "dotwork-bo');
    const d = loadDraft(s, 'dotwork.book', readIt);
    expect(d.status).toBe('bad');
    expect(d.status === 'bad' && d.issues[0].message).toContain('not valid JSON');
    expect(backupsOf(s, 'dotwork.book')).toHaveLength(1);
  });

  it('still report the draft when even the backup can’t be written', () => {
    const s = new FakeStorage();
    s.setItem('dotwork.book', 'nope');
    s.full = true;
    const d = loadDraft(s, 'dotwork.book', readIt);
    expect(d.status === 'bad' && d.backupKey).toBeNull();
    expect(d.status === 'bad' && badDraftProblem('book', d, []).lines[0]).toContain('Download it now');
  });

  it('say "storage is full" only for a quota error', () => {
    const s = new FakeStorage();
    s.full = true;
    const full = saveDraft(s, 'k', emptyBook(), 'book', check)!;
    expect(full.lines).toEqual(['The browser’s storage is full.']);
    const blocked = saveDraft({ ...s, setItem() { throw new Error('SecurityError: denied'); } } as unknown as DraftStorage, 'k', emptyBook(), 'book', check)!;
    expect(blocked.lines).toEqual(['SecurityError: denied']);
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
    const book = ownersBook();
    let failure: unknown;
    try { await exportBookFiles(book, DEFAULT_PRINT, { regular: new Uint8Array(), bold: new Uint8Array() }); } catch (err) { failure = err; }
    expect(failure).toBeDefined();
    const files = withBookJson(book, [], failure);
    expect(files.map((f) => f.name)).toEqual(['book.json', 'error.txt']);
    const log = new TextDecoder().decode(files[1].bytes);
    expect(log).toContain('The export failed.');
    expect(log).toContain('page_numbers'); // every way the book breaks the format
  });

  it('says so when the files were made from a book that breaks the format', () => {
    const files = withBookJson(ownersBook(), []);
    expect(new TextDecoder().decode(files[1].bytes)).toContain('the book breaks the book format');
  });

  it('writes the reason when the book can’t be written as JSON', () => {
    const book = emptyBook(4) as Book & { self?: unknown };
    book.self = book;
    const files = withBookJson(book, []);
    expect(files[0].name).toBe('book-json-error.txt');
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

  it('can never stop a book from opening: only the signatures are read from a book’s print settings', () => {
    const b = emptyBook();
    expect(check(b)).toEqual([]);
    (b as unknown as { print: unknown }).print = { creep_per_sheet_mm: 99, signatures: 2 };
    expect(check(b)).toEqual([]);
  });
});
