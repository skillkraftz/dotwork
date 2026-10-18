# Dotwork library file, version 1

Dotwork keeps saved pages, spreads and books in the browser. **Export library** writes
all of them to one JSON file as a backup, and **Import library** reads it back.
This file is only for Dotwork's own backups; journal-system reads the page and
spread files described in `page-format.md`, which sit inside it unchanged. Books
(`book-format.md`) were added to the same version 1 file: a reader from before
books rejects a file that holds one, and says so.

```json
{
  "format": "dotwork-library",
  "version": 1,
  "exported": "2026-10-18T12:00:00.000Z",
  "items": [
    { "id": "…", "kind": "page",   "name": "Daily", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-page" } },
    { "id": "…", "kind": "spread", "name": "Ideas", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-spread" } },
    { "id": "…", "kind": "book",   "name": "Pocket journal", "updated": "2026-10-18T12:00:00.000Z", "data": { "...": "a dotwork-book" } }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `id` | Unique within the file. Importing an item whose id is already in the library replaces it, so restoring the same backup twice changes nothing. |
| `kind` | `"page"`, `"spread"` or `"book"`. |
| `name` | The name it is saved under. The `name` inside `data` matches it. |
| `updated` | ISO date and time of the last change. |
| `data` | A complete page file (version 1 pages are converted), spread file or book file. |

A reader rejects the whole file, and says which rule failed and where, if the
format or version is wrong, an id is missing or repeated, `kind` is unknown, or
anything in `data` breaks the page, spread or book rules. Nothing is imported then.
