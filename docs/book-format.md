# Dotwork book file, version 1

A book is the 52 (or more) interior pages of a pocket notebook plus its two
inside covers, with the settings its print files need. It embeds every page it
uses, so one file is the whole book. Each page inside is a complete page file
exactly as `page-format.md` defines it (version 2); this document adds nothing
to the page format.

```json
{
  "format": "dotwork-book",
  "version": 1,
  "name": "Pocket journal",
  "page_count": 52,
  "page_numbers": true,
  "print": {
    "paper_thickness_mm": 0.14,
    "back_offset_x_mm": 0,
    "back_offset_y_mm": 0,
    "signatures": 1
  },
  "pages": [ { "...": "a dotwork-page with side \"right\"" }, null, { "...": "..." } ],
  "dates": [ "2026-10-18", "2026-10-25", null ],
  "cover": { "front": { "...": "a dotwork-page with side \"left\"" }, "back": null }
}
```

| Field | Meaning |
|-------|---------|
| `name` | The book's name. |
| `page_count` | Interior pages: a multiple of 4, from 4 to 400. Usually 52 (13 sheets). |
| `page_numbers` | Print the page number in each page's outer top corner. On by default. The inside covers never carry one. |
| `print.paper_thickness_mm` | Creep: every sheet's pages shift toward the fold by (sheets outside it) × this. Default 0.14. 0 to 1. |
| `print.back_offset_x_mm`, `print.back_offset_y_mm` | Added to everything on the back side (`print-second.pdf`). +x moves right, +y moves up, as seen on the back. -10 to 10. |
| `print.signatures` | How many signatures to split the book into, 1 to 20. Pages are split evenly and each signature rounds up to a multiple of 4, so a short last signature is padded with blank filler pages. |
| `pages` | Exactly `page_count` entries; entry *i* is page *i* + 1. A page, or `null` for a blank page. |
| `dates` | Optional. Exactly `page_count` entries; entry *i* is the date of page *i* + 1, as `"YYYY-MM-DD"` (a real calendar day), or `null` for an undated page. A book without `dates` has none. The covers have no date. |
| `cover.front` | The inside front cover, a left page facing page 1 when the book is open. A page or `null`. |
| `cover.back` | The inside back cover, a right page facing the last page. A page or `null`. |

**Sides.** Page 1 is a right-hand page, so odd pages are right-hand and even
pages left-hand. Each page's `side` must match its slot (`cover.front` is
left, `cover.back` is right). Dotwork sets this when it places a design in a
slot, so the same saved page can go anywhere. If turning it would put an element
over the page number's corner (see `page-format.md`), the placed copy gets
`"page_number": false`.

**Covers.** The inside covers never print a page number, so the page-number
corner is not reserved on them: an element at row 0, x 0 to 2 of `cover.front`
is valid whatever its `page_number` says.

**Tokens.** A page with a date in `dates` prints its tokens (`{weekday}`,
`{day+1}`, `{months}` and the rest, see `page-format.md`) filled in from that
date, in `pages.pdf`, the print files and the previews. A page with no date, and
the covers, print them blank, so the date can be written in by hand. In
Dotwork's Book view, **Dates…** gives a run of pages consecutive weeks (each
dated its Sunday) or consecutive days. Dates stay with the page number, not the
design, and survive resizing the book (new pages start undated).

**Validation.** A reader rejects the whole file, and says which rule failed and
where, if the format or version is wrong, `page_count` is not a multiple of 4,
`pages` or `dates` has the wrong length, a date is not a real `YYYY-MM-DD` day, a print setting is out of range, or a page breaks
the page rules or sits on the wrong side. The page-number corner rule is not applied to the covers.

## What the print files contain

| File | Contents |
|------|----------|
| `pages.pdf` | Every interior page at final size (88.9 × 139.7 mm), in reading order. |
| `print-first.pdf`, `print-second.pdf` | Half-letter sheets (215.9 × 139.7 mm, landscape), one spread per side, centered on the fold. `print-first.pdf` holds every sheet's front in reverse order; the stack goes back in the tray the same way; `print-second.pdf` holds the backs in forward order. With more than one signature each gets its own pair: `sig1-print-first.pdf`, `sig1-print-second.pdf`, and so on. |
| `cover.pdf` | The inside front cover (left) and inside back cover (right) as one centered spread, single-sided, without creep. |
| `preview.png` | A contact sheet of the whole book, spread by spread. |
| `summary.txt` | The settings used and the printing steps. |
| `book.json` | The book exactly as it was exported from (this format). Always in the zip, so the files can be traced back to their source. |
| `error.txt` | Only if something went wrong: the export's error and every way the book breaks this format. A failed export still downloads a zip with `book.json` and `error.txt`. |

Page order, creep and centering follow journal-system's
`pocketjournal/imposition.py` and are tested with the same cases (see
`tests/imposition.test.ts`): sheet *k* of *n* carries front
`(4n − 2k, 2k + 1)` and back `(2k + 2, 4n − 2k − 1)`; creep for sheet *k* is
*k* × paper thickness; the outer 0.75 in of each side is trimmed after binding.
Text is real text in the embedded Courier Prime font and lines are vector paths,
so the PDFs stay sharp at any scale. Creep must stay inside the page margin
(3.95 mm), or the export is refused.
