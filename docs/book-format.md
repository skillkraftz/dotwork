# Dotwork book file, version 1

A book is the 52 (or more) interior pages of a pocket notebook plus its four
cover pages (inside and outside). It embeds every page it
uses, so one file is the whole book. **The book file holds the design only**: how the pages are printed (creep, shifts,
offsets, rotation, scale, tones, the sheet layout) is the printer's, kept in the browser as the printer profile (see below),
so changing those settings never changes the book format or stops a book from opening. Each page inside is a complete page file
exactly as `page-format.md` defines it (version 2); this document adds nothing
to the page format.

```json
{
  "format": "dotwork-book",
  "version": 1,
  "name": "Pocket journal",
  "page_count": 52,
  "page_numbers": true,
  "print": { "signatures": 1 },
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
| `print` | Optional. An object whose only meaning is `signatures`: how many signatures to split the book into, a whole number from 1 to 20, default 1 (a missing or unusable number is 1). Pages are split evenly and each signature rounds up to a multiple of 4, so a short last signature is padded with blank filler pages. Everything else in `print`, whatever its shape, is ignored: books saved by earlier versions kept the printer's settings here (and so may carry `creep_per_sheet_mm`, `layouts`, tones…), and they all still open. |
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
`pages` or `dates` has the wrong length, a date is not a real `YYYY-MM-DD` day, a `recipe` is malformed (its month, a step's `repeat` or `start`, more than one `fill`, or a section: see `library-format.md`), or a page breaks
the page rules or sits on the wrong side. The page-number corner rule is not applied to the covers.

## The printer profile

Everything about how a particular printer and paper print lives in the printer profile, kept in the browser (local storage)
and used for every book; the Calibrate wizard finds it. It is not part of a book file, and a book is printed with whatever the
profile is when the files are made (the zip's `summary.txt` and `calibration.txt` record the settings used). Numbers outside the
limits below are brought back in by the fields and refused by the reader of a stored profile (which then falls back to the defaults, saying why).

| Field | Meaning |
|-------|---------|
| `creep_per_sheet_mm` | Creep: how far each sheet's content must move toward the fold relative to the sheet outside it, so every sheet's content shifts toward the fold by (sheets outside it) × this. Found by the creep test. In a thick book it is often more than the paper's thickness (about 1.5×), because the round spine uses up paper. Default 0.30 (provisional, see below). 0 to 1. |
| `fore_edge_shift_mm` | Moves the content of every interior page away from the fold by this amount (left pages left, right pages right), on top of the creep, so the trimmed fore-edge margin lands on the target. Default 2.0 (provisional). -10 to 10. |
| `cover_fore_edge_shift_mm` | The same for the covers (`cover-outside.pdf`, `cover-inside.pdf`). Default 2.2 (provisional). -10 to 10. |
| `target_fore_edge_margin_mm` | The fore-edge margin wanted on the trimmed book, content box to the trimmed edge. The creep test marks it on its rulers and the wizard aims for it. Top and bottom are unchanged (3.85 mm). Default 3.5. 1 to 10. |
| `sheet_layout` | `"half_letter"` or `"letter_two_up"`: how the sheets are laid on the paper (see **Sheet layouts** below). The offsets and scale below are those of the layout chosen here when the files are made. |
| `layouts.<layout>.front_offset_x_mm`, `.front_offset_y_mm` | Added to everything printed on the first pass with that layout: `print-first.pdf`, the fronts in `print-duplex.pdf`, `cover-outside.pdf` and the front calibration pages. +x moves right, +y moves up, as seen on that side. -10 to 10. Measured against the paper, not against the back (see below). Defaults for `half_letter`: 1.7 and -0.05; for `letter_two_up`: -0.75 and -1.6 (the owner's printer). |
| `layouts.<layout>.back_offset_x_mm`, `.back_offset_y_mm` | The same for the second pass (`print-second.pdf`, the backs in `print-duplex.pdf`, `cover-inside.pdf` and the back calibration page), as seen on that side. -10 to 10. Defaults for `half_letter`: 1.5 and 0.05; for `letter_two_up`: 0 and 1.1. Both offsets are against the paper, not against each other: to move all the print toward the top edge, add the same to both sides' y. |
| `layouts.<layout>.scale_x_pct`, `.scale_y_pct` | Where everything on the sheet lands along its 8.5 in edge (x) and along its other edge (y: 5.5 in, or 11 in for two-up), as a percent of true distance, about the sheet's centre (the sheet's centre stays put), on both sides of every print PDF and calibration sheet. 95 to 105, default 100. It cancels a printer that enlarges or shrinks the page (borderless modes enlarge it slightly); the 100 mm lines on the calibration sheet find it. The offset is added after scaling. It moves positions only: line widths, dot sizes and letters are never scaled or stretched (see [print-pipeline.md](print-pipeline.md)). |
| `layouts.<layout>.line_weight_x_pct` | How thick strokes along the paper's 8.5 in edge are drawn, as a percent of their drawn width; strokes across it are as drawn and angled ones in between (by cos² of the angle to the 8.5 in edge). 80 to 120, default 100. Dots and text are never affected. Optional: a printer can draw a line along one edge thicker than the same line across it; the pairs of lines on the calibration sheet show it, and its ladder finds the percent. Applied after the scale and the rotation, to the stroke's direction on the paper. A profile stored before it existed reads as 100. |
| `layouts.<layout>.back_rotation_deg` | Turns everything printed second (`print-second.pdf`, the backs in `print-duplex.pdf`, `cover-inside.pdf` and the back calibration pages) about the sheet's centre (the letter sheet's centre for two-up): + is counter-clockwise as seen on the back. -1.5 to 1.5, default 0. Applied after the scale and before the offset; the front is never turned. Found by the calibration sheet. A profile stored before it existed reads as 0. |
| `shade_light_pct`, `shade_medium_pct`, `shade_dark_pct`, `gray_text_pct` | How dark the printed PDFs draw the light, medium and dark shade tones and the gray text (`"tone": "gray"` on text and sequences), as a percent of black: 0 is white, 100 is black. 0 to 100, fractions allowed. The defaults, 6.3, 13.7, 25.9 and 49.8, are the grays the editor and PNGs always use (#efefef, #dcdcdc, #bdbdbd, #808080), so a default book prints as it always did. They change `pages.pdf`, the print files, `cover.pdf` and the calibration sheets only, never the editor, the preview or PNGs. |

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

The printer profile's `sheet_layout` says how a book's sheets are laid on the paper. Creep, the fore-edge shifts, the target margin and the tones are
the same for both; each layout has its own offsets, rotation and scale (`layouts`), because a printer places and sizes each paper
size and mode differently. The layout is chosen in one place, the PDF tab of the export window.

- **`half_letter`** is the paper cut in half, 5.5 × 8.5 in, one book's sheet per sheet of paper, printed landscape. The owner's
  printer prints it only as *Statement (Borderless)*, which enlarges the image slightly; set page scaling to None / Actual size and
  correct the rest with the scale. The files are what Dotwork has always made.
- **`letter_two_up`** puts two half-letter sheets on one portrait letter sheet, 215.9 × 279.4 mm, printed with normal margins
  (paper size *Letter*, not borderless, page scaling None / Actual size). The top half is **Book 1** and the bottom half **Book 2**:
  the book being exported and, by default, the same book (a second book saved in the Library can be chosen for the bottom; if
  the books have different numbers of sheets, the extra halves are blank). Each half is laid out exactly as a half-letter
  sheet, with the fold at its centre; both books print with the same printer profile.
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

**The 3 mm check (two-up).** Printers with margins can't print closer than 3 mm to the paper's edge, and the print driver may cut off
what it can't print. Before a two-up export, each page is laid out and the box around what it actually draws is carried through the
printer stage (scale, rotation, offset of the side it is printed on) at every place it lands: every sheet with its creep and fore-edge
shift, both sides, and the covers. Where content would print closer than 3 mm to the letter sheet's edge the export **goes ahead** and
warns, once for each book, side and edge, naming the closest page and its row (or column, for the left and right edges; row 0 is the
header): for example "Book 2, page 12, row 43: on the back of the letter sheet it prints 2.85 mm from the bottom edge. The print driver
may cut it off; check by printing that page." The other pages about as close are listed. The cut marks and labels warn the same way. The
warnings are in `summary.txt` and shown after the download. A page with nothing near the edge never warns, whatever the offsets. Half
letter prints borderless and is not checked.

## Offsets: measured against the paper

A printer places the image a little off on every pass. With manual duplex the sheet is turned over between passes, so a
per-pass error *e* shows on a see-through test as about 2*e*, and correcting all of it on the back would align the two
sides with each other while both stay off the paper's centre. So each side has its own offset, and each is measured against
the paper: the **fold** of the spread must land on the paper's physical centre (where the sheet folds edge to edge), and the
margins at the top and bottom must be even. The page is the full height of the sheet, so top and bottom are never trimmed.

## The calibration files

The Calibrate wizard (Export, PDF tab, **Calibrate your printer…**) builds these from the printer profile (and the book's size, for the creep test), at the real page size, with the same imposition and drawing code as the print files. Every page prints the settings that made it (seven lines in its footer). On letter two-up the creep test and the cover sheet draw every page in both halves, labelled Book 1 and Book 2 as the print files are, with the cut marks; the calibration sheet uses the whole letter sheet instead. The scale, offsets and rotation of the layout apply to the whole page.

| File | Contents |
|------|----------|
| `calibration-sheet.pdf` | One double-sided sheet per layout, two pages: page 1 is the **front** (side 1, takes the front offset), page 2 the **back** (side 2, takes the back offset and the back rotation); print them with the manual-duplex method. It uses the whole paper (the half sheet, or for two-up the whole letter sheet, 215.9 × 279.4 mm), with no halves, labels or cut marks. See below. |
| `creep-test.pdf` | **Three sheets stand for a book of any size**: the cover sheet (`calibration-cover.pdf`) and, here, only the **outermost** sheet (pages 1 and the last page) and the **innermost** sheet (the middle spread) of a book of a given page count (a multiple of 4, by default the open book's biggest signature; *sheets* = pages ÷ 4), **both sides**, in manual-duplex order: pages 1 and 2 are the fronts (innermost first), pages 3 and 4 the backs (outermost first), so it follows the real `print-first.pdf` / `print-second.pdf` method. Each page is shifted by its sheet's creep in that book (the sheets outside it × creep per sheet), the fore-edge shift and its side's offset, and says which sheet, side and pages it is, the page count it was made for, and the print range of its pass. A one-sheet book (4 pages) prints that sheet alone. The rest of the book is not printed: fold the outermost sheet around *sheets* − 2 blank sheets of the same paper, with the innermost sheet in the middle and the cover outside, bind and trim as usual, and read the fore-edge margin on the cover, page 1 and the middle spread (its right-hand page). |
| `calibration-cover.pdf` | Two pages like `cover-outside.pdf` and `cover-inside.pdf` (cover shift; page 1 the front offset, page 2 the back offset): the box and crosshairs of the outside covers, then of the inside covers. Covers stay out of the creep test. |
| `calibration.txt`, `book.json`, `error.txt` | The settings that made the files, the book as JSON, and the error log if something went wrong. |

**Rulers.** A margin ruler counts millimetres outward from the page's box line, with a tick every 0.5 mm, so the number where the paper (or the trimmed edge) ends is the margin there. The expected margin is marked with a longer tick: 3.85 mm at the top and bottom (the ruler stops there, at the edge of the unshifted page; if the paper ends past it, measure the extra with a ruler and add it) and the target margin (`target_fore_edge_margin_mm`, 3.5 by default) at the fore-edge (the ruler runs to 7 mm, past the trim line). The creep test and the cover sheet have rulers at the top, bottom and fore-edge of every page; the calibration sheet has its own fold scales (below).

**The calibration sheet.** The layout is the same for both sheet layouts and uses the whole paper: *W* × *H* is 215.9 × 139.7 mm for half letter and 215.9 × 279.4 mm for two-up, and *m* = 8.0 mm. Five marks: top (*W*/2, *m*), bottom (*W*/2, *H* − *m*), left (*m*, *H*/2), right (*W* − *m*, *H*/2) and the centre (*W*/2, *H*/2). Everything stays at least 3 mm from every paper edge, so it prints without borderless.

- *Side 1 (printed first)*: a fine **+** (0.2 mm lines, 6 mm across) at all five marks, and in the space at least 10 mm from every mark the gray ramp from 0 to 100% in 5% steps (each with text in that gray), the three shade tones and the gray text as they print now, small and large dots, hair, thin and thick ruled lines, a hairline weight strip (0.05 to 0.30 mm), **line weight by direction** and the settings footer. Line weight by direction is a block on the left page's right-hand side: *pairs* of identical lines at 0.12, 0.25 and 0.35 mm, each pair one line along the 8.5 in edge (11 mm) and one along the other edge (8 mm), labelled with the width and the edge names (a printer that draws one direction thicker shows as a difference within a pair); and a *ladder* of four lines along the 8.5 in edge at 85, 90, 95 and 100 % of 0.35 mm, labelled, beside a 0.35 mm line along the other edge. The pairs are drawn under the line weight setting (they show what it does); the ladder is exempt from it, so its steps are the same whatever the setting is. To set `line_weight_x_pct`: only if the pairs still differ after the scale is right, pick the ladder step that looks as thick as the 0.35 mm line along the other edge and enter its percent. No scales. The marks are symmetric about the sheet's centre, so each shows through the paper (the sheet turned over, left and right swapped) at the place of its mirror image.
- *Side 2 (the measuring side)*: every label reads as seen on side 2, and names directions as seen on side 2. At each of the four edge marks, a **see-through scale** centred on where side 1's + should land (−5 to +5 mm, a tick every 0.5 mm, numbers in two rows), running parallel to the edge it is at (so top and bottom read x, left and right read y). At the centre, a **+** only, a quick look-through check. Four **fold scales**, two across each centre line, 38 mm (at least 25) from the centre +: the two across the horizontal line (*y* = *H*/2, at *x* = *W*/2 ∓ 38) run up the sheet, the two across the vertical line (*x* = *W*/2, at *y* = *H*/2 ∓ 38) run to the right; each is −5 to +5 mm, a tick every 0.5 mm, the 0 longer, labelled, with its caption: "horizontal fold, left scale", "horizontal fold, right scale", "vertical fold, top scale", "vertical fold, bottom scale".  Two **100.0 mm lines** with end ticks in clear space, at least 10 mm from every mark: "parallel to the 8.5 in edge: should measure 100.0 mm" and "parallel to the 5.5 in edge" (the 11 in edge for two-up), and short instructions.
- *Names*: the sheet and the wizard name the paper's edges of the selected layout, never "across" or "down": half letter has an 8.5 in edge (top and bottom) and a 5.5 in edge (left and right); two-up an 8.5 in edge and an 11 in edge. The captions and the wizard's inputs use the same words: "see-through top x", "see-through bottom x", "see-through left y", "see-through right y", the four fold scales above, and the two 100 mm lines.

**Reading the sheet.** Print it twice if you can: if the readings differ much between the two prints, the twist comes from the paper feed, not something a setting can fix. Print page 1, put the sheet back the same way as for `print-second.pdf`, print page 2. Hold the sheet to a light and read each see-through scale where side 1's + shows through (x + to the right, y + up, as seen on side 2). Fold the sheet top edge to bottom edge, crease hard, open it, and read where the crease crosses each horizontal-fold scale (+ is up, as seen on side 2); then fold left edge to right edge and read the vertical-fold scales (+ is right). Measure the two 100 mm lines with a ruler. Every reading is optional; only what was read changes a setting. All readings are relative to the settings the sheet was printed with (its footer). When both readings of a fold pair are typed, the wizard also shows the difference between them as "twist against the paper: *X* mm over *Y* mm" (the right scale minus the left, or the bottom minus the top, over the 76 mm between the scales): information only, no setting changes from it.

*The geometry.* Work in the back's view, from the sheet's centre (the letter sheet's, for two-up), x right, y up, angles counter-clockwise. Let Rf be how far the front's print is from where it should be (its offset plus the printer's error, + right and + up as seen on the front) and Rb the same for the back, which is also turned by φ. The front is mirrored in the back's view, so a scale at *q* reads

    see-through = ( φ·q.y − Rb.x − Rf.x ,  Rf.y − Rb.y − φ·q.x )

(a front printed to the right shows through to the left; a back turned counter-clockwise puts its top to the left). So:

- **Rotation.** φ from the two x readings is (top − bottom) ÷ (q_top.y − q_bottom.y), and from the two y readings (left − right) ÷ (q_right.x − q_left.x); with both, their mean. New back rotation = printed − φ (in degrees; clamped to ±1.5, rounded to 0.001). The two x marks are *H* − 2*m* apart and the two y marks *W* − 2*m*, so on two-up the x readings have twice the lever.
- **The back against the front.** d = Rf′ − Rb, the back's translation against the front: x: reading − φ·q.y, y: reading + φ·q.x, averaged over the readings made. With only these, new back offset = printed + d (the back follows the front; the front stays).
- **Against the paper (the fold).** Folding the sheet top edge to bottom edge puts the crease on the paper's own middle, *y* = *H*/2, and left edge to right edge on *x* = *W*/2: the origin of the back's view, wherever the printer printed. A fold scale's zero is where the print put that point: the back's own error away from the middle (its translation Rb, and for a point q the turn too, φ·(−q.y, q.x)). A reading counts + up or + right, as seen on side 2, from the zero to the crease, so it is minus that error:

      horizontal fold, scale at q = (q.x, 0):  reading = −(Rb.y + φ·q.x)
      vertical fold,   scale at q = (0, q.y):  reading = −(Rb.x − φ·q.y)

  The two scales of a line are on opposite sides of the centre, so the turn cancels in their mean: **Rb.y = −(left + right) ÷ 2** and **Rb.x = −(top + bottom) ÷ 2**. Their difference is the back's turn against the paper, (left − right) ÷ (2·38 mm), which shows a twist that no offset can fix. With one scale of a line only, φ from the see-through is taken out (0 if that wasn't read): Rb.y = −reading − φ·q.x, Rb.x = −reading + φ·q.y. A print 1.1 mm too low reads +1.1 on both horizontal-fold scales. With a reading of the back against the paper, new back offset = printed − Rb.
- **The front.** Once the back is known against the paper, what is left of the see-through is the front's error, Rf = d + Rb (x mirrored): new front offset x = printed + d.x + Rb.x, new front offset y = printed − d.y − Rb.y. Without a fold reading the front is not touched.
- **Scale per paper edge.** A line of *N* mm printed at *p* % that measures *m* mm means the printer sizes by *m* ÷ (*p* × *N* ÷ 100), so the scale that cancels it is **new scale = printed scale × N ÷ measured** (a 100.0 mm line at 100 % measuring 98.8 gives 101.21 %). The line parallel to the 8.5 in edge sets `scale_x_pct`, the other `scale_y_pct`, clamped to 95 to 105.

Offsets are clamped to ±10 and rounded to 0.01 mm. Whether the front also needs a rotation against the paper is not measured: only the back is turned, against the front.
