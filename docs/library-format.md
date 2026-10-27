# Dotwork library file, version 1

Dotwork keeps pages, spreads, sections, books, widgets and art in the browser (IndexedDB), one entry each: `{ id, kind, name, updated, data }`. The page,
spread or book you are editing *is* one of these entries and is written to it as you edit (after a 400 ms pause, and when the tab is hidden or
closed); there are no drafts and no Save button. A section has no editor: it is added from a book, an import or a duplicate. **Back up library** (in the Library window) writes all of them,
the favorites and the printer profile to one JSON file, and **Restore backup** adds it back (see **Backup and restore** below). Favorites
and the printer profile themselves live in `localStorage` (`dotwork.favorites`, `dotwork.printer`); only the backup file carries them.

**The name is kept once.** In the browser's store every entry (page, spread, section and book) has its name in `name` only; its `data` has no `name` (an older
entry that still has one loses it the next time it is written). Everywhere a file is made from it (export, a book, a backup) the name is put
back into `data`, so the files are exactly as `page-format.md` and `book-format.md` describe. Names are unique within a kind: a name already
used (by a saved item or a built-in) gets ` 2`, ` 3`… added instead of being refused or replacing anything. A new document is named
`Untitled`, `Untitled 2`…; the app asks for a real name before the first export (JSON or the print zip) and before a page or spread is placed in a book. An Untitled document that was never drawn on is deleted when another is opened or the tab is closed.
If the browser can't keep documents (no IndexedDB, private mode, a refused first write) the app says so at the top and works from memory; export what you want to keep.
This file is only for Dotwork's own backups; journal-system reads the page and
spread files described in `page-format.md`, which sit inside it unchanged. Books
(`book-format.md`) and sections are in the same version 1 file. A widget or art entry is `{ name, elements }` (in the store the name is in the entry only); art is a widget of
exactly one `art` element, and every element must fit the page format wherever the widget is placed.

```json
{
  "format": "dotwork-library",
  "version": 1,
  "exported": "2026-10-18T12:00:00.000Z",
  "items": [
    { "id": "…", "kind": "page",   "name": "Daily", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-page" } },
    { "id": "…", "kind": "spread", "name": "Ideas", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-spread" } },
    { "id": "…", "kind": "section", "name": "Journal week", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-section" } },
    { "id": "…", "kind": "book",   "name": "Pocket journal", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-book" } },
    { "id": "…", "kind": "widget", "name": "Notes box", "updated": "2026-10-18T12:00:00.000Z", "data": { "name": "Notes box", "elements": [ { "type": "box", "x": 0, "y": 0, "w": 5, "h": 4 } ] } },
    { "id": "…", "kind": "art",    "name": "Star", "updated": "2026-10-18T12:00:00.000Z", "data": { "name": "Star", "elements": [ { "type": "art", "...": "one art element" } ] } }
  ],
  "favorites": [ "…", "example:Daily" ],
  "printer": { "...": "the printer profile: shared settings and both layouts' calibration" }
}
```

| Field | Meaning |
|-------|---------|
| `id` | Unique within the file. Restoring never replaces: an item whose id is already in the library is skipped when identical, and added under a new id as `<name> (from backup)` when it differs. |
| `kind` | `"page"`, `"spread"`, `"section"`, `"book"`, `"widget"` or `"art"`. |
| `name` | The name it is saved under. In a backup file the `name` inside `data` matches it (a reader also accepts any item with no `name` in `data` and uses this one). |
| `updated` | ISO date and time of the last change. |
| `data` | A complete page file, spread file, section or book file, or `{ name, elements }` for a widget or art (in the browser's store the `name` is not in `data`, see above). A version 1 page is converted when read, as everywhere the app reads a page. |
| `favorites` | Optional. The ids starred in the Library (documents by id, built-ins by their prefixed name such as `example:Daily`). An array of strings. |
| `printer` | Optional. The printer profile as `printer.ts` reads it: the shared settings (creep, fore-edge shifts, target margin, the four tones, `sheet_layout`) and `layouts` for both sheet layouts (offsets, scale, back rotation, line weights). Every number within its limits. |

## Backup and restore

**Back up library** writes every saved document, the favorites and the current printer profile. The built-ins are not in it (they come with the app).

**Restore backup** only adds. Nothing in the library is replaced or deleted:

- A document whose `id` is here and whose content is identical (the name is ignored) is **skipped**. So restoring the same backup twice adds nothing.
- A document whose `id` is here but whose content differs is added as a new document named `<name> (from backup)` (` 2`… if that is taken): **kept both**.
- A document whose `id` is new is **added**. A name already used in its kind gets ` 2` added, as everywhere.
- **Favorites** are merged with the ones already starred.
- The **printer profile** is never applied by itself. When it differs from the one in use, the app asks "Replace your printer settings with the backup's?",
  shows both sets of values, and the default answer is No.
- Afterwards a summary says how many were added, skipped and kept both, and lists anything refused with the reason (Copy details copies it all).

A reader rejects the whole file, and says which rule failed and where, if the file is not a JSON object or its `format` or `version` is wrong, `items` is not an array,
or `favorites` is not an array of strings. A single bad item (a missing or repeated `id`, an unknown `kind`, or `data` that breaks the page, spread,
section, book or widget rules) is **refused** on its own, with the reason, and the rest is restored. A `printer` that does not fit its limits is refused the same way.

## Sections

A section is a run of pages, such as a week (a weekly page, seven daily pages, a reflection, notes), that the book
builder repeats (`book-format.md`, **Recipe**). **Save pages as a section…** in the Book view makes one from a page
range of the book, as a new Library document (a taken name gets ` 2`; nothing is replaced). In the Library, Sections lists them with **Rename**, **Duplicate** (asks for a name), **Export** (the file below) and **Delete**; **Import** in the Import and export window adds a section file. There is no section editor. It keeps the pages inline, so one item is the whole section, and the same object sits inside a
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
