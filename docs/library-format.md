# Dotwork library file, version 1

Dotwork keeps pages, spreads, sections and books in the browser (IndexedDB), one entry each: `{ id, kind, name, updated, data }`. The page
or spread you are editing *is* one of these entries and is written to it as you edit (after a 400 ms pause, and when the tab is hidden or
closed); there are no drafts and no Save button for a page or a spread. **Back up library** (in the Library window) writes all of them to
one JSON file, and **Restore backup** reads it back. Widgets, art and favorites are kept in `localStorage`, not in the Library store, so a
backup does not carry them.

**The name is kept once.** In the browser's store a page or spread entry has its name in `name` only; its `data` has no `name` (an older
entry that still has one loses it the next time it is written). Everywhere a file is made from it (export, a book, a backup) the name is put
back into `data`, so the page and spread files are exactly as `page-format.md` describes. Names are unique within a kind: a name already
used (by a saved item or a built-in) gets ` 2`, ` 3`… added instead of being refused or replacing anything. A new document is named
`Untitled`, `Untitled 2`…; the app asks for a real name before the first export and before the document is placed in a book.
This file is only for Dotwork's own backups; journal-system reads the page and
spread files described in `page-format.md`, which sit inside it unchanged. Books
(`book-format.md`) and sections are in the same version 1 file.

```json
{
  "format": "dotwork-library",
  "version": 1,
  "exported": "2026-10-18T12:00:00.000Z",
  "items": [
    { "id": "…", "kind": "page",   "name": "Daily", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-page" } },
    { "id": "…", "kind": "spread", "name": "Ideas", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-spread" } },
    { "id": "…", "kind": "section", "name": "Journal week", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-section" } },
    { "id": "…", "kind": "book",   "name": "Pocket journal", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-book" } }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `id` | Unique within the file. Importing an item whose id is already in the library replaces it, so restoring the same backup twice changes nothing (phase 3 of `product-model.md` changes this to never replace). |
| `kind` | `"page"`, `"spread"`, `"section"` or `"book"`. |
| `name` | The name it is saved under. In a backup file the `name` inside `data` matches it (a reader also accepts a page or spread with no `name` in `data` and uses this one). |
| `updated` | ISO date and time of the last change. |
| `data` | A complete page file, spread file, section or book file (in the browser's store a page or spread has no `name`, see above). A version 1 page is converted when read, as everywhere the app reads a page. |

A reader rejects the whole file, and says which rule failed and where, if the
format or version is wrong, an id is missing or repeated, `kind` is unknown, or
anything in `data` breaks the page, spread, section or book rules. Nothing is imported then.

## Sections

A section is a run of pages, such as a week (a weekly page, seven daily pages, a reflection, notes), that the book
builder repeats (`book-format.md`, **Recipe**). **Save pages as a section…** in the Book view makes one from a page
range of the book. It keeps the pages inline, so one item is the whole section, and the same object sits inside a
book's `recipe` steps.

```json
{
  "format": "dotwork-section",
  "version": 1,
  "name": "Journal week",
  "pages": [ { "...": "a dotwork-page" }, null ],
  "days": [ 0, null ],
  "weekday": 0,
  "move": "week",
  "left": false
}
```

| Field | Meaning |
|-------|---------|
| `name` | The section's name; it matches the Library item's. |
| `pages` | 1 to 100 page designs, `null` for a blank page. Each is a complete page file. Placing one turns it to face the side of the page it lands on. |
| `days` | One entry per page: its date as whole days after the section's first dated page, or `null` for an undated page. Dates are kept relative, so a repeat only needs its first date. |
| `weekday` | The weekday (0 is Sunday) of the first dated page, so "each week of a month" starts every repeat on it. 0 when nothing is dated. |
| `move` | How the dates move from one repeat to the next: `none`, `day`, `week` or `month`. `none` when nothing is dated. |
| `left` | The section began on a left-hand (even) page. Every repeat begins on the same side. |

A reader rejects a section, and says which rule failed and where, for a wrong `format` or `version`, a missing name,
`pages` that is empty or too long or holds an invalid page, `days` of the wrong length or not whole numbers or null, a
`weekday` outside 0 to 6, an unknown `move`, or a `left` that is not true or false. Built-in sections (the journal
week, the month-end review, idea spreads, the book notes) come with Dotwork; their names are reserved, and a built-in
can be duplicated but not replaced.
