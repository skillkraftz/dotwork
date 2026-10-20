// What goes in the download besides the PDFs: the book as JSON (exactly what the export was built from), and, if
// anything went wrong, an error.txt saying what. So a failure can be found from the zip alone.
import { readBook, type Book } from '../book/book';
import { formatIssue } from '../format/validate';
import { errorText } from '../problems';
import type { ExportedFile } from './export';

const text = (name: string, body: string): ExportedFile => ({ name, bytes: new TextEncoder().encode(body), type: 'text/plain' });

/** The book as it is, as JSON; if it can't be written as JSON, the reason instead. */
export function bookJson(book: Book): ExportedFile {
  try {
    return { name: 'book.json', bytes: new TextEncoder().encode(JSON.stringify(book, null, 2) + '\n'), type: 'application/json' };
  } catch (err) {
    return text('book-json-error.txt', `The book could not be written as JSON.\n\n${errorText(err)}\n`);
  }
}

/** The error log: the export's error (if any) and every way the book breaks the format. Null when there is nothing to report. */
export function errorLog(book: Book, error?: unknown): ExportedFile | null {
  let issues: string[] = [];
  try {
    const r = readBook(book);
    if (!r.ok) issues = r.issues.map(formatIssue);
  } catch (err) {
    issues = [`Checking the book threw: ${errorText(err)}`];
  }
  if (error === undefined && issues.length === 0) return null;
  return text('error.txt', [
    error === undefined ? 'The files were made, but the book breaks the book format.' : 'The export failed.',
    `When: ${new Date().toISOString()}`,
    ...(error === undefined ? [] : ['', errorText(error)]),
    ...(issues.length ? ['', `The book breaks the format (${issues.length}):`, ...issues] : ['', 'The book itself is valid.']),
    '',
  ].join('\n'));
}

/** The files to put in the zip: what was built, the book's JSON, and an error log when there is something to say. */
export function withBookJson(book: Book, built: ExportedFile[], error?: unknown): ExportedFile[] {
  const log = errorLog(book, error);
  return [...built, bookJson(book), ...(log ? [log] : [])];
}
