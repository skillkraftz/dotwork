# Dotwork library file, version 1

Dotwork keeps pages, spreads, sections, books, widgets and art in the browser (IndexedDB), one entry each: `{ id, kind, name, updated, data }`. The page,
spread or book you are editing *is* one of these entries and is written to it as you edit (after a 400 ms pause, and when the tab is hidden or
closed); there are no drafts and no Save button. A section has no editor: it is added from an import, a restore or a duplicate, and placed in a book as a group. **Back up library** (in the Library window) writes all of them,
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
exactly one `art` element or one `image` element (a PNG or JPG stored as a data URL, so a backup carries the pixels), and every element must fit the page format wherever the widget is placed.

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
| `data` | A complete page file, spread file, section or book file, or `{ name, elements }` for a widget or art (in the browser's store the `name` is not in `data`, see above). |
| `favorites` | Optional. The ids starred in the Library (documents by id, built-ins by their prefixed name such as `example:Daily`). An array of strings. |
| `printer` | Optional. The printer profile as `printer.ts` reads it: the shared settings (creep, fore-edge shifts, target margin, the four tones, `sheet_layout`), `print_method` (`auto` or `hand` for each layout) and `layouts` for both sheet layouts, each by print method and paper (`inside`, `cover`): offsets, scale, back rotation, line weights. Every number within its limits. |

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

A section is a group kept in the Library: blocks that repeat together, such as a week (a weekly page, seven daily pages, a
reflection, notes). Placing one in a book adds it as a **group** block (`book-format.md`, **The outline**). **Add…**, **Other** in
the Book view lists the saved and built-in sections. In the Library, Sections lists them with **Rename**, **Duplicate** (asks for a
name), **Export** (the file below) and **Delete**; **Import** in the Import and export window adds a section file. There is no
section editor yet, and no control that saves a group as a section: a saved section comes from an import, a restore or a duplicate.
It keeps its pages inline, so one item is the whole section.

```json
{
  "format": "dotwork-section",
  "version": 1,
  "name": "Journal week",
  "children": [
    { "type": "page", "page": { "...": "a dotwork-page" }, "repeat": { "times": 1 } },
    { "type": "page", "page": { "...": "a dotwork-page" }, "repeat": { "times": 7 } },
    { "type": "free", "pages": [ null ] }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `name` | The section's name; it matches the Library item's. |
| `children` | The group's blocks: page, spread and free blocks as in `book-format.md`, each repeating a number of times and never pinned. The section has no repeat or pin of its own: those belong to where it is placed. |

A reader rejects a section, and says which rule failed and where, for a wrong `format` or `version`, a missing name, or
`children` that is not a list of valid blocks. Built-in sections (the journal week, the month-end review, the idea spread, the book notes) come
with Dotwork; their names are reserved, and a built-in can be duplicated but not replaced.

## Old format

A book or section saved before the outline (a book with `pages`, `dates` and a `recipe`; a section with `pages`, `days` and `move`) is
not read and not converted. The Library lists it with the label **Old format**, with only **Export** (the file as it was kept) and
**Delete**; tapping it says why it cannot be opened, the last-open pointer skips it, and it is left out of the two-up bottom-book list.
Restoring a backup refuses such an item with the reason, like any item that breaks its format.
