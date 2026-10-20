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
    "front_offset_x_mm": 0,
    "front_offset_y_mm": 0,
    "back_offset_x_mm": 0,
    "back_offset_y_mm": 0,
    "signatures": 1,
    "shade_light_pct": 6.3,
    "shade_medium_pct": 13.7,
    "shade_dark_pct": 25.9,
    "gray_text_pct": 49.8
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
| `print.front_offset_x_mm`, `print.front_offset_y_mm` | Added to everything on the front side: `print-first.pdf`, `cover.pdf` and the front calibration page. +x moves right, +y moves up, as seen on the front. -10 to 10. Measured against the paper, not against the back (see below). |
| `print.back_offset_x_mm`, `print.back_offset_y_mm` | The same for the back side (`print-second.pdf` and the back calibration page), as seen on the back. -10 to 10. |
| `print.signatures` | How many signatures to split the book into, 1 to 20. Pages are split evenly and each signature rounds up to a multiple of 4, so a short last signature is padded with blank filler pages. |
| `print.shade_light_pct`, `print.shade_medium_pct`, `print.shade_dark_pct`, `print.gray_text_pct` | How dark the printed PDFs draw the light, medium and dark shade tones and the gray text (`"tone": "gray"` on text and sequences), as a percent of black: 0 is white, 100 is black. 0 to 100, fractions allowed. The defaults, 6.3, 13.7, 25.9 and 49.8, are the grays the editor and PNGs always use (#efefef, #dcdcdc, #bdbdbd, #808080), so a default book prints as it always did. They change `pages.pdf`, the print files, `cover.pdf` and the calibration sheets only, never the editor, the preview or PNGs. |
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
`pages` or `dates` has the wrong length, a date is not a real `YYYY-MM-DD` day, a print setting (any `print.*` number, the four offsets included) is missing or out of range, or a page breaks
the page rules or sits on the wrong side. The page-number corner rule is not applied to the covers.

## What the print files contain

| File | Contents |
|------|----------|
| `pages.pdf` | Every interior page at final size (88.9 × 139.7 mm), in reading order. |
| `print-first.pdf`, `print-second.pdf` | Half-letter sheets (`print-first.pdf` takes the front offset, `print-second.pdf` the back offset) (215.9 × 139.7 mm, landscape), one spread per side, centered on the fold. `print-first.pdf` holds every sheet's front in reverse order; the stack goes back in the tray the same way; `print-second.pdf` holds the backs in forward order. With more than one signature each gets its own pair: `sig1-print-first.pdf`, `sig1-print-second.pdf`, and so on. |
| `cover.pdf` | The inside front cover (left) and inside back cover (right) as one centered spread, single-sided, without creep. It takes the front offset. |
| `preview.png` | A contact sheet of the whole book, spread by spread. |
| `summary.txt` | The print settings that made the files (paper thickness, signatures, front and back offset x and y, every tone percentage, page size, app version, date), the printing steps, and short tips: print the calibration set first, one signature before the whole book, at actual size, with the same settings for both passes, and at the printer's best quality. |
| `book.json` | The book exactly as it was exported from (this format). Always in the zip, so the files can be traced back to their source. |
| `error.txt` | Only if something went wrong: the export's error and every way the book breaks this format. A failed export still downloads a zip with `book.json` and `error.txt`. |

## Offsets: measured against the paper

A printer places the image a little off on every pass. With manual duplex the sheet is turned over between passes, so a
per-pass error *e* shows on a see-through test as about 2*e*, and correcting all of it on the back would align the two
sides with each other while both stay off the paper's centre. So each side has its own offset, and each is measured against
the paper: the **fold** of the spread must land on the paper's physical centre (where the sheet folds edge to edge), and the
margins at the top and bottom must be even. The page is the full height of the sheet, so top and bottom are never trimmed.

## The calibration files

The Calibrate wizard (Export, PDF tab, **Calibrate your printer…**) builds these from the book's print settings, at the book's real page size, with the same imposition and drawing code as the print files. Every page prints the settings that made it (five lines in its footer).

| File | Contents |
|------|----------|
| `calibration-alignment.pdf` | One file, two pages. Page 1 is the front (takes the front offset), page 2 the back (takes the back offset); print them with the book's manual-duplex method. Both: the page edge, the content-area box with crosshairs at its corners and centre (which coincide when held to a light once the offsets are right), a **fold scale** across the centre (-5 to +5 mm, ticks every 0.5 mm, 0 where the spread's fold lands) and a **ruler** at the top and bottom of each page. The front also has a gray ramp from 0 to 100% in 5% steps (each with text in that gray), the three shade tones and the gray text as they print now, small and large dots, hair, thin and thick ruled lines, and a hairline weight strip (0.05 to 0.30 mm). |
| `creep-test.pdf` | Every sheet of the book's biggest signature, **both sides**, in manual-duplex order: pages 1 to *N* are the fronts (last sheet first), pages *N* + 1 to 2*N* the backs (first sheet first), so it follows the real `print-first.pdf` / `print-second.pdf` method. Each page is shifted by its sheet's creep and its side's offset, and says which sheet, side and pages it is, and the print range of its pass. |
| `calibration-cover.pdf` | One single-sided sheet like `cover.pdf` (front offset): the box and crosshairs of both inside covers. |
| `calibration.txt`, `book.json`, `error.txt` | The settings that made the files, the book as JSON, and the error log if something went wrong. |

**Rulers.** A margin ruler counts millimetres outward from the page's box line, with a tick every 0.5 mm, so the number where the paper (or the trimmed edge) ends is the margin there. The expected margin is marked with a longer tick: 3.85 mm at the top and bottom (the ruler stops there, at the edge of the unshifted page; if the paper ends past it, measure the extra with a ruler and add it) and 3.95 mm at the fore-edge (the ruler runs to 7 mm, past the trim line). The creep test and the cover sheet have rulers at the top, bottom and fore-edge of every page; the alignment sheet at the top and bottom.

**Reading the alignment sheet.** Print page 1, put the sheet back the same way as for `print-second.pdf`, print page 2. Fold the sheet in half edge to edge, crease it hard, open it. On each side:

- *x*: read where the crease crosses the fold scale (+ to the right, as seen on that side). New offset x = the offset printed in the footer + the reading. The scale's 0 is where the fold landed, so a crease to the left of 0 means the page landed too far right.
- *y*: read the margin where the paper ends on the top ruler and on the bottom ruler. With both, new offset y = printed offset y + (top − bottom) ÷ 2 (+ is up): the page is centered, so a sheet cut a little tall or short cancels out. With only one, that margin is brought to 3.85: new offset y = printed + (top − 3.85), or printed + (3.85 − bottom).

Offsets are clamped to the limits above and rounded to 0.01 mm.

**Reading the creep test and the cover sheet.** Print `calibration-cover.pdf` on the cover stock and `creep-test.pdf` on the real paper (pages 1 to *N*, the stack back the same way, pages *N* + 1 to 2*N*), fold, bind and trim like a book, then read the fore-edge margin on a right-hand page of the cover, of sheet 1 (outermost) and of sheet *N* (innermost). The cut is made 3.5 in from the cover's fold, and the cover wraps outside sheet 0, so with *c* the cover's thickness, *set* the thickness set and *real* the paper's true thickness, the margin at sheet *k* (0 outermost) is 3.95 + *k* × (*set* − *real*) − *c*, and the cover's own is 3.95. So:

- **new thickness = current thickness − (innermost − outermost) ÷ (sheets − 1).** Compare the middle with the *outermost sheet*, not with the cover: the cover's thickness pushes every sheet in by the same amount, so it cancels between two sheets but not between a sheet and the cover (comparing with the cover would be off by *c* ÷ (sheets − 1)). A positive difference means the thickness set is too high.
- **cover push = cover − outermost** (= *c*): how far the cover's own thickness pushes all the pages in. It is shown, not applied.

Page order, creep and centering follow journal-system's
`pocketjournal/imposition.py` and are tested with the same cases (see
`tests/imposition.test.ts`): sheet *k* of *n* carries front
`(4n − 2k, 2k + 1)` and back `(2k + 2, 4n − 2k − 1)`; creep for sheet *k* is
*k* × paper thickness; the outer 0.75 in of each side is trimmed after binding.
Text is real text in the embedded Courier Prime font and lines are vector paths,
so the PDFs stay sharp at any scale. Creep must stay inside the page margin
(3.95 mm), or the export is refused.
