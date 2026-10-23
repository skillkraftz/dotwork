# Dotwork book file, version 1

A book is the 52 (or more) interior pages of a pocket notebook plus its four
cover pages (inside and outside), with the settings its print files need. It embeds every page it
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
    "creep_per_sheet_mm": 0.3,
    "fore_edge_shift_mm": 2,
    "cover_fore_edge_shift_mm": 2.2,
    "target_fore_edge_margin_mm": 3.5,
    "sheet_layout": "half_letter",
    "layouts": {
      "half_letter": { "front_offset_x_mm": 1.7, "front_offset_y_mm": -0.05, "back_offset_x_mm": 1.5, "back_offset_y_mm": 0.05, "scale_x_pct": 100, "scale_y_pct": 100 },
      "letter_two_up": { "front_offset_x_mm": 0, "front_offset_y_mm": 0, "back_offset_x_mm": 0, "back_offset_y_mm": 0, "scale_x_pct": 100, "scale_y_pct": 100 }
    },
    "signatures": 1,
    "shade_light_pct": 6.3,
    "shade_medium_pct": 13.7,
    "shade_dark_pct": 25.9,
    "gray_text_pct": 49.8
  },
  "pages": [ { "...": "a dotwork-page with side \"right\"" }, null, { "...": "..." } ],
  "dates": [ "2026-10-18", "2026-10-25", null ],
  "cover": { "front": { "...": "a dotwork-page with side \"left\"" }, "back": null, "outside_front": null, "outside_back": null },
  "recipe": { "month": "2026-11", "weekday": 0, "section": { "...": "see Recipe below" } }
}
```

| Field | Meaning |
|-------|---------|
| `name` | The book's name. |
| `page_count` | Interior pages: a multiple of 4, from 4 to 400. Usually 52 (13 sheets). |
| `page_numbers` | Print the page number in each page's outer top corner. On by default. The covers never carry one. |
| `print.creep_per_sheet_mm` | Creep: how far each sheet's content must move toward the fold relative to the sheet outside it, so every sheet's content shifts toward the fold by (sheets outside it) × this. Found by the creep test. In a thick book it is often more than the paper's thickness (about 1.5×), because the round spine uses up paper. Default 0.30 (provisional, see below). 0 to 1. |
| `print.fore_edge_shift_mm` | Moves the content of every interior page away from the fold by this amount (left pages left, right pages right), on top of the creep, so the trimmed fore-edge margin lands on the target. Default 2.0 (provisional). -10 to 10. |
| `print.cover_fore_edge_shift_mm` | The same for the covers (`cover-outside.pdf`, `cover-inside.pdf`). Default 2.2 (provisional). -10 to 10. |
| `print.target_fore_edge_margin_mm` | The fore-edge margin wanted on the trimmed book, content box to the trimmed edge. The creep test marks it on its rulers and the wizard aims for it. Top and bottom are unchanged (3.85 mm). Default 3.5. 1 to 10. |
| `print.sheet_layout` | `"half_letter"` or `"letter_two_up"`: how the sheets are laid on the paper (see **Sheet layouts** below). The offsets and scale below are those of the layout chosen here when the files are made. |
| `print.layouts.<layout>.front_offset_x_mm`, `.front_offset_y_mm` | Added to everything printed on the first pass with that layout: `print-first.pdf`, the fronts in `print-duplex.pdf`, `cover-outside.pdf` and the front calibration pages. +x moves right, +y moves up, as seen on that side. -10 to 10. Measured against the paper, not against the back (see below). Defaults for `half_letter`: 1.7 and -0.05, the owner's printer; for `letter_two_up`: 0. |
| `print.layouts.<layout>.back_offset_x_mm`, `.back_offset_y_mm` | The same for the second pass (`print-second.pdf`, the backs in `print-duplex.pdf`, `cover-inside.pdf` and the back calibration page), as seen on that side. -10 to 10. Defaults for `half_letter`: 1.5 and 0.05; for `letter_two_up`: 0. |
| `print.layouts.<layout>.scale_x_pct`, `.scale_y_pct` | The size of everything on the sheet, across and down, as a percent of true size, about the sheet's centre (the sheet's centre stays put), on both sides of every print PDF and calibration sheet. 95 to 105, default 100. It cancels a printer that enlarges or shrinks the page (borderless modes enlarge it slightly); the Calibrate wizard's Size step finds it. The offset is added after scaling. |
| `print.signatures` | How many signatures to split the book into, 1 to 20. Pages are split evenly and each signature rounds up to a multiple of 4, so a short last signature is padded with blank filler pages. |
| `print.shade_light_pct`, `print.shade_medium_pct`, `print.shade_dark_pct`, `print.gray_text_pct` | How dark the printed PDFs draw the light, medium and dark shade tones and the gray text (`"tone": "gray"` on text and sequences), as a percent of black: 0 is white, 100 is black. 0 to 100, fractions allowed. The defaults, 6.3, 13.7, 25.9 and 49.8, are the grays the editor and PNGs always use (#efefef, #dcdcdc, #bdbdbd, #808080), so a default book prints as it always did. They change `pages.pdf`, the print files, `cover.pdf` and the calibration sheets only, never the editor, the preview or PNGs. |
| `pages` | Exactly `page_count` entries; entry *i* is page *i* + 1. A page, or `null` for a blank page. |
| `dates` | Optional. Exactly `page_count` entries; entry *i* is the date of page *i* + 1, as `"YYYY-MM-DD"` (a real calendar day), or `null` for an undated page. A book without `dates` has none. The covers have no date. |
| `recipe` | Optional. The steps **Build book** made the pages from, so it can be run again for another month. See **Recipe** below. |
| `cover.front` | The inside front cover, a left page facing page 1 when the book is open. A page or `null`. |
| `cover.back` | The inside back cover, a right page facing the last page. A page or `null`. |
| `cover.outside_front` | Optional (missing means blank). The outside front cover, a right page. A page or `null`. |
| `cover.outside_back` | Optional (missing means blank). The outside back cover, a left page. A page or `null`. |

**Sides.** Page 1 is a right-hand page, so odd pages are right-hand and even
pages left-hand. Each page's `side` must match its slot (`cover.front` is
left, `cover.back` is right, `cover.outside_front` is right, `cover.outside_back` is left). Dotwork sets this when it places a design in a
slot, so the same saved page can go anywhere. If turning it would put an element
over the page number's corner (see `page-format.md`), the placed copy gets
`"page_number": false`.

**Covers.** The four cover pages never print a page number, so the page-number
corner is not reserved on them: an element at row 0, x 0 to 2 of `cover.front`
is valid whatever its `page_number` says. Seen from outside, the sheet that prints
the outsides reads *outside back* (left) | *outside front* (right), and the sheet that
prints the insides reads *inside front* (left) | *inside back* (right). The inside
front cover is the back of the outside front cover, and so on. In Book view the four
cover pages are the slots around the pages: outside front, inside front, pages 1 to
N, inside back, outside back.

**Tokens.** A page with a date in `dates` prints its tokens (`{weekday}`,
`{day+1}`, `{months}` and the rest, see `page-format.md`) filled in from that
date, in `pages.pdf`, the print files and the previews. A page with no date, and
the covers, print them blank, so the date can be written in by hand. In
Dotwork's Book view, **Dates…** gives a run of pages consecutive weeks (each
dated its Sunday) or consecutive days. Dates travel with their page: moving or
swapping pages moves their dates, and a page given a design with no date tokens loses its date. Dates survive
resizing the book (new pages start undated). **Dates…** starts from the nearest dated page before the current one,
continuing its rhythm (a day or a week later), and from today (the local date, never UTC) only when the book has none.

**Recipe.** **Build book…** builds every interior page from a list of *steps*, each repeating a *section* (a run
of pages kept in the Library, see `library-format.md`). It replaces every interior page and its date, as one Undo step,
and keeps the steps in `recipe`, so the book can be built again for another month by changing a step's month or start date:

```json
"recipe": {
  "month": "2026-11",
  "gap": { "...": "a page; Notes when absent" },
  "steps": [
    { "section": { "...": "a dotwork-section" }, "repeat": { "kind": "weeks", "only_in_month": true } },
    { "section": { "...": "a dotwork-section" }, "repeat": { "kind": "times", "count": 1 }, "start": "2026-11-01" },
    { "section": { "...": "a dotwork-section" }, "repeat": { "kind": "fill" } }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `month` | The month the steps start from, `"YYYY-MM"`: the month of every `weeks` step without a month of its own, and the 1st of it is the first date of every other step without a `start`. |
| `gap` | The page that keeps parts on their side of the spine. A Notes page when absent. |
| `steps` | Up to 40, laid out in order from page 1. Each holds a whole `section` (so the book file is self-contained), a `repeat`, and optionally a `start`. |
| `repeat` | `{"kind": "times", "count": n}`: n repeats (1 to 400). `{"kind": "weeks", "month": "YYYY-MM", "only_in_month": b}`: one repeat for each week touching the month (`month` is optional, the recipe's by default); every repeat starts on the section's `weekday`, the week holding the 1st first, until a week starts after the month's last day. With `only_in_month`, a **day page** (its tokens read its own day, `{weekday}` or `{day}`, with no offset and no `{months}`) dated outside the month is left out; week pages and undated pages stay. `{"kind": "fill"}`: as many whole repeats as fit in the pages the other steps leave; at most one step may do this. The steps after it sit on the last pages of the book, and any pages left over stay blank between. |
| `start` | The first date (`YYYY-MM-DD`) of a `times` or `fill` step; later repeats move it as the section's `move` says (`none`, a `day`, a `week` or a `month`, keeping the day of the month unless the month is too short). A `weeks` step ignores it. |

Each repeat of a section starts on the side of the spine the section began on (`left`). If it would begin on the other
side, one gap page is inserted first; when steps after a `fill` don't end exactly on the last page, the pages after them are
gap pages. A page dated by the section is dated its repeat's first date plus its `days`; an undated page stays undated.
The build can't be applied when the steps need more pages than the book has (the window says by how many); fewer leaves
the rest blank, and the window shows "38 of 52 used, 14 left" as the steps change.

**Validation.** A reader rejects the whole file, and says which rule failed and
where, if the format or version is wrong, `page_count` is not a multiple of 4,
`pages` or `dates` has the wrong length, a date is not a real `YYYY-MM-DD` day, a print setting (any `print.*` number, `sheet_layout`, and every offset and scale of both layouts) is missing or out of range, a `recipe` is malformed (its month, a step's `repeat` or `start`, more than one `fill`, or a section: see `library-format.md`), or a page breaks
the page rules or sits on the wrong side. The page-number corner rule is not applied to the covers.

## What the print files contain

| File | Contents |
|------|----------|
| `pages.pdf` | Every interior page at final size (88.9 × 139.7 mm), in reading order. |
| `print-first.pdf`, `print-second.pdf` | Half letter: half-letter sheets (215.9 × 139.7 mm, landscape), one spread per side, centered on the fold. `print-first.pdf` (first pass, front offset) holds every sheet's front in reverse order; the stack goes back in the tray the same way; `print-second.pdf` (second pass, back offset) holds the backs in forward order. With more than one signature each gets its own pair: `sig1-print-first.pdf`, `sig1-print-second.pdf`, and so on. Letter two-up: the same files, on letter sheets (see below), for when the printer can't duplex by itself. |
| `print-duplex.pdf` | Letter two-up only (and `sig1-print-duplex.pdf` and so on): for a printer that duplexes by itself, flipping on the long edge. Front, back, front, back… from the outermost sheet in. |
| `cover-outside.pdf`, `cover-inside.pdf` | The cover sheet, single-sided, without creep, moved by the cover shift. `cover-outside.pdf` (outside back on the left, outside front on the right) is the first pass and takes the front offset; `cover-inside.pdf` (inside front on the left, inside back on the right) is printed on the back of it, second, and takes the back offset. Each cover page is moved away from the fold by the cover shift on its own side of the fold, so (turned over, left and right swap) the inside front lands exactly behind the outside front. Letter two-up prints two covers per sheet, the top book's above the bottom book's. |
| `preview.png` | A contact sheet of the whole book, spread by spread. |
| `summary.txt` | The print settings that made the files (creep per sheet, fore-edge shift, cover shift, target margin, signatures, the sheet layout with its scale and its front and back offset x and y, every tone percentage, page size, app version, date), the sheet layout, the printer's paper settings, for two-up the top and bottom book and the sheet order, the printing steps, and short tips: print the calibration set first, one signature before the whole book, at actual size, with the same settings for both passes, and at the printer's best quality. |
| `book.json` | The book exactly as it was exported from (this format). Always in the zip, so the files can be traced back to their source. |
| `error.txt` | Only if something went wrong: the export's error and every way the book breaks this format. A failed export still downloads a zip with `book.json` and `error.txt`. |

## Sheet layouts

`print.sheet_layout` says how a book's sheets are laid on the paper. Creep, the fore-edge shifts, the target margin and the tones are
the same for both; each layout has its own offsets and scale (`print.layouts`), because a printer places and sizes each paper
size and mode differently. The printer profile kept in the browser holds both layouts too.

- **`half_letter`** is the paper cut in half, 5.5 × 8.5 in, one book's sheet per sheet of paper, printed landscape. The owner's
  printer prints it only as *Statement (Borderless)*, which enlarges the image slightly; set page scaling to None / Actual size and
  correct the rest with the scale. The files are what Dotwork has always made.
- **`letter_two_up`** puts two half-letter sheets on one portrait letter sheet, 215.9 × 279.4 mm, printed with normal margins
  (paper size *Letter*, not borderless, page scaling None / Actual size). The top half is **Book 1** and the bottom half **Book 2**:
  the book being exported and, by default, the same book (a second book saved in the Library can be chosen for the bottom; if
  the books have different numbers of sheets, the extra halves are blank). Each half is laid out exactly as a half-letter
  sheet, with the fold at its centre, using its own book's creep, shifts and tones; the layout, offsets and scale are Book 1's.
  Duplex flips on the long edge: the top stays the top and left and right swap, so a point (*x*, *y*) on a front is at (215.9 − *x*, *y*)
  on its back, and each half's back is drawn in the same half of the back page, as the half-letter back is.

**Sheet order (two-up).** Letter sheet *k* holds sheet *k* of Book 1 on its top half and sheet *k* of Book 2 on its bottom half
(*k* = 1 is the outermost sheet). `print-duplex.pdf` runs front, back for *k* = 1, 2, 3 …; `print-first.pdf` holds the fronts of
*k* = *n* … 1 and `print-second.pdf` the backs of *k* = 1 … *n*, the same convention as half letter. A printer that lays each sheet
on top of the last (the first at the bottom), which is also how the manual pair ends up, leaves a pile with sheet 1 at the bottom and
the innermost on top. Cut the whole pile once along the cut marks: the top halves are Book 1 and the bottom halves Book 2, each in
nesting order. If the printer stacks the other way, each pile is in reverse order: turn it round. `summary.txt` says this.

**Cut marks and labels (two-up).** A short mark at each end of the middle line (y = 139.7 mm), in the side trim zones that are
cut off when trimming, shows where to cut. Each half is labelled along the left trim zone, in 2.4 mm type:
`Book 1 | <name> | sheet 3 of 13 | front` (`signature 2, sheet 3 of 13` when the book has more than one signature; the cover
sheets say `outside cover` or `inside cover`). A blank half has no label.

**The 3 mm rule (two-up).** Printers with margins can't print closer than 3 mm to the paper's edge. Before a two-up file is made,
every page's content box (at the least and most creep and shift of each book, and the cover), the cut marks and the labels are
moved by the scale and the offset of both sides and checked; if anything would be closer than 3 mm to the letter sheet's edge,
the export is refused and says what, how far and on which side (for example, the grid starts 3.85 mm below the top, so a front
offset of 1 mm up or a height scale above 100.6 % is refused). Half letter prints borderless and is not checked.

## Offsets: measured against the paper

A printer places the image a little off on every pass. With manual duplex the sheet is turned over between passes, so a
per-pass error *e* shows on a see-through test as about 2*e*, and correcting all of it on the back would align the two
sides with each other while both stay off the paper's centre. So each side has its own offset, and each is measured against
the paper: the **fold** of the spread must land on the paper's physical centre (where the sheet folds edge to edge), and the
margins at the top and bottom must be even. The page is the full height of the sheet, so top and bottom are never trimmed.

## The calibration files

The Calibrate wizard (Export, PDF tab, **Calibrate your printer…**) builds these from the book's print settings, at the book's real page size, with the same imposition and drawing code as the print files. Every page prints the settings that made it (seven lines in its footer). On letter two-up every page is drawn in both halves, labelled Book 1 and Book 2 as the print files are, with the cut marks; the scale and offsets of the layout apply to the whole page.

| File | Contents |
|------|----------|
| `calibration-size.pdf` | One single-sided page (takes the front offset and the scale). A horizontal line and a vertical line, each 100.0 mm between end ticks and labelled "should measure 100.0 mm", and a block of dots labelled with its count and span: "28 dots across = 81.0 mm" and "44 dots down = 129.0 mm" (the outermost dots, centre to centre; that is the Dot grid page's 27 × 43 cells of 3 mm, 28 × 44 dots). |
| `calibration-alignment.pdf` | One file, two pages. Page 1 is the front (takes the front offset), page 2 the back (takes the back offset); print them with the book's manual-duplex method. Both: the page edge, the content-area box with crosshairs at its corners and centre (which coincide when held to a light once the offsets are right), a **fold scale** across the centre (-5 to +5 mm, ticks every 0.5 mm, 0 where the spread's fold lands) and a **ruler** at the top and bottom of each page. The front also has a gray ramp from 0 to 100% in 5% steps (each with text in that gray), the three shade tones and the gray text as they print now, small and large dots, hair, thin and thick ruled lines, and a hairline weight strip (0.05 to 0.30 mm). |
| `creep-test.pdf` | Every sheet of the book's biggest signature, **both sides**, in manual-duplex order: pages 1 to *N* are the fronts (last sheet first), pages *N* + 1 to 2*N* the backs (first sheet first), so it follows the real `print-first.pdf` / `print-second.pdf` method. Each page is shifted by its sheet's creep, the fore-edge shift and its side's offset, and says which sheet, side and pages it is, and the print range of its pass. |
| `calibration-cover.pdf` | Two pages like `cover-outside.pdf` and `cover-inside.pdf` (cover shift; page 1 the front offset, page 2 the back offset): the box and crosshairs of the outside covers, then of the inside covers. Covers stay out of the creep test. |
| `calibration.txt`, `book.json`, `error.txt` | The settings that made the files, the book as JSON, and the error log if something went wrong. |

**Rulers.** A margin ruler counts millimetres outward from the page's box line, with a tick every 0.5 mm, so the number where the paper (or the trimmed edge) ends is the margin there. The expected margin is marked with a longer tick: 3.85 mm at the top and bottom (the ruler stops there, at the edge of the unshifted page; if the paper ends past it, measure the extra with a ruler and add it) and the target margin (`target_fore_edge_margin_mm`, 3.5 by default) at the fore-edge (the ruler runs to 7 mm, past the trim line). The creep test and the cover sheet have rulers at the top, bottom and fore-edge of every page; the alignment sheet at the top and bottom.

**Reading the size sheet.** Print it with page scaling None / Actual size and the paper size the step names (*Statement (Borderless)* for half letter, *Letter* for two-up). With a ruler, measure each line between its end ticks, in mm. A line printed at *p* % that measures *m* mm means the printer sizes by *m* ÷ *p*, so the scale that cancels it is **new scale = 100 × printed scale ÷ measured** (printed scale is in the footer; a sheet printed at 100 % measuring 98.8 mm gives 101.21 %). The horizontal line sets `scale_x_pct` and the vertical line `scale_y_pct` of the selected layout, clamped to 95 to 105. The dot block is for counting without a ruler's help: 28 dots across span 81.0 mm and 44 down span 129.0 mm.

**Reading the alignment sheet.** Print page 1, put the sheet back the same way as for `print-second.pdf`, print page 2. Fold the sheet in half edge to edge, crease it hard, open it. On each side:

- *x*: read where the crease crosses the fold scale (+ to the right, as seen on that side). New offset x = the offset printed in the footer + the reading. The scale's 0 is where the fold landed, so a crease to the left of 0 means the page landed too far right.
- *y*: read the margin where the paper ends on the top ruler and on the bottom ruler. With both, new offset y = printed offset y + (top − bottom) ÷ 2 (+ is up): the page is centered, so a sheet cut a little tall or short cancels out. With only one, that margin is brought to 3.85: new offset y = printed + (top − 3.85), or printed + (3.85 − bottom).

Offsets are clamped to the limits above and rounded to 0.01 mm.

**Reading the creep test and the cover sheet.** Print `calibration-cover.pdf` on the cover stock (page 1, the sheet back the same way, page 2) and `creep-test.pdf` on the real paper (pages 1 to *N*, the stack back the same way, pages *N* + 1 to 2*N*), fold, bind and trim like a book, then read the fore-edge margin on a right-hand page of the cover, of sheet 1 (outermost) and of sheet *N* (innermost): the number on the ruler where the trimmed edge falls. Set the creep per sheet *before* printing (the paper's thickness is a good start); the wizard shows the values the test prints with, and each page's footer and `calibration.txt` record them.

The cut is made 3.5 in from the cover's fold, and a thick saddle-stitched book has a round spine. Paper going round the curve is used up, so outer pages' content lands about (π/2 − 1) × *r* further from the fore-edge than designed (*r* is the spine's radius, about half the book's thickness), and each sheet's fore-edge creeps out about (π/2) × the caliper per sheet, not 1 ×. So the margin at sheet *k* (0 outermost), printed with creep *c* and fore-edge shift *s*, is

> margin(*k*) = *A* + *k* × (*c* − *g*) − *s*

where *A* is the outermost margin with no shift (more than the page's own 3.95 mm, because of the curve) and *g* is how far each sheet really creeps. The cover is the outermost fold and has no creep: margin = *A*c − (cover shift). A bigger shift moves the content toward the fore-edge, so it makes the margin smaller. The wizard fits *A*, *g* and *A*c to the three readings, from the values the test was **printed** with (never whatever is set now), and sets:

- **new creep = printed creep + (outermost − innermost) ÷ (sheets − 1).** A bigger margin on the innermost sheet than on the outermost means the inner sheets were moved in too far: less creep. Compare the innermost sheet with the *outermost sheet*, not with the cover, which has a different fold.
- **new fore-edge shift = printed shift + (outermost − target).** A margin bigger than the target means the content must move toward the fore-edge: a bigger shift.
- **new cover shift = printed cover shift + (cover − target).**

With the new settings, every margin comes out at the target; the wizard shows the predicted margins and the spine-side margin of the innermost page on the paper (3.95 mm less how far its content moved toward the fold), and warns when that is under 2 mm. Worked example: printed with creep 0.14 and no shifts, target 3.5, 13 sheets, readings cover 5.7, outermost 5.5, innermost 3.6 → creep 0.14 + 1.9 ÷ 12 ≈ 0.298, fore-edge shift +2.0, cover shift +2.2.

**The defaults are provisional.** `DEFAULT_PRINT` holds the owner's calibration (half-letter offsets 1.7 / -0.05 and 1.5 / 0.05, scale 100 %; letter two-up offsets 0 and scale 100 % until calibrated; creep 0.30, shifts 2.0 and 2.2, target 3.5) in case the saved printer profile is cleared. The creep and the two shifts come from the example above, not from a creep test run with them, until the owner's next test confirms them. A saved printer profile always takes precedence.

Page order, creep and centering follow journal-system's
`pocketjournal/imposition.py` and are tested with the same cases (see
`tests/imposition.test.ts`): sheet *k* of *n* carries front
`(4n − 2k, 2k + 1)` and back `(2k + 2, 4n − 2k − 1)`; creep for sheet *k* is
*k* × creep per sheet (journal-system calls it paper thickness; dotwork's fore-edge shifts have no counterpart there yet); the outer 0.75 in of each side is trimmed after binding.
Text is real text in the embedded Courier Prime font and lines are vector paths,
so the PDFs stay sharp at any scale. Content must stay on the sheet and off the fold: on every
sheet and on the cover, the page's 3.95 mm spine-side margin less the content's move toward the fold must stay above
0, and the fore-edge side must stay on the paper, or the export is refused with the reason.
