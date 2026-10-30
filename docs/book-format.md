# Dotwork book file, version 2

A book is the 52 (or more) interior pages of a pocket notebook plus its four cover pages (inside and outside). It is an
**outline**: an ordered list of blocks (a page, a spread, free pages or a group), each with how often it repeats. The pages the
book prints are worked out from the outline by one function (`layoutOutline` in `src/book/outline.ts`); the file stores the
design, not a page list. It embeds every page it uses, so one file is the whole book. **The book file holds the design only**: how
the pages are printed (creep, shifts, offsets, rotation, scale, tones, the sheet layout) is the printer's, kept in the browser as
the printer profile (see below), so changing those settings never changes the book format or stops a book from opening. Each page
inside is a complete page file exactly as `page-format.md` defines it (version 2); this document adds nothing to the page format.

```json
{
  "format": "dotwork-book",
  "version": 2,
  "name": "Pocket journal",
  "page_count": 52,
  "page_numbers": true,
  "print": { "signatures": 1 },
  "outline": [
    { "type": "page", "page": null, "repeat": { "times": 10 } },
    { "type": "group", "name": "Ideas", "repeat": { "times": 6 }, "children": [
      { "type": "spread", "name": "Ideas spread", "left": { "...": "a dotwork-page, side left" }, "right": { "...": "a dotwork-page, side right" },
        "repeat": { "times": 1 }, "from": { "id": "example:spread:Ideas spread", "fingerprint": "1kb7x2vq4m" } },
      { "type": "page", "page": { "...": "a dotwork-page" }, "repeat": { "times": 1 } }
    ] },
    { "type": "free", "pages": [] },
    { "type": "page", "page": { "...": "a dotwork-page" }, "repeat": { "times": 1 }, "pin": "last" }
  ],
  "cover": { "front": { "...": "a dotwork-page with side \"left\"" }, "back": null, "outside_front": null, "outside_back": null }
}
```

| Field | Meaning |
|-------|---------|
| `name` | The book's name. |
| `page_count` | Interior pages: a multiple of 4, from 4 to 400. Usually 52 (13 sheets). |
| `page_numbers` | Print the page number in each page's outer top corner. On by default. The covers never carry one. |
| `print` | Optional. An object whose only meaning is `signatures`: how many signatures to split the book into, a whole number from 1 to 20, default 1 (a missing or unusable number is 1). Pages are split evenly and each signature rounds up to a multiple of 4, so a short last signature is padded with blank filler pages. Everything else in `print`, whatever its shape, is ignored: books saved by earlier versions kept the printer's settings here (and so may carry `creep_per_sheet_mm`, `layouts`, tones…), and they all still open. |
| `outline` | Required (it may be empty: every page is then blank). At most 200 blocks, laid out in order. See **The outline** below. |
| `cover.front` | The inside front cover, a left page facing page 1 when the book is open. A page or `null`. |
| `cover.back` | The inside back cover, a right page facing the last page. A page or `null`. |
| `cover.outside_front` | Optional (missing means blank). The outside front cover, a right page. A page or `null`. |
| `cover.outside_back` | Optional (missing means blank). The outside back cover, a left page. A page or `null`. |

**Old books.** A book from before the outline stored every page in a `pages` list (with `dates` and a `recipe`). It has no
`outline`, so it is not read and not converted: the Library lists it as **Old format** with Export and Delete.

**Old date settings.** Version 1 books dated pages with `{"each": "day" | "week" | "month"}` and `{"each": …, "of": "span"}` repeats. A book that has them still opens: each such repeat becomes Once (`{"times": 1}`), every block is Plain, and the layout carries one issue, "This book was made with the old date settings; set its page types again." (it goes when the outline is edited). Nothing else of version 1 is converted; the reader accepts version 1 or 2 and the app writes 2.

## The outline

A **block** is one of:

| `type` | Fields | Meaning |
|--------|--------|---------|
| `page` | `page`, `repeat`, `dates` | A page design, or `null` for a blank page, placed `repeat` times. The design is stored as designed; it is turned to face the side of each page it lands on. |
| `spread` | `name`, `left`, `right`, `repeat`, `dates`, `shared` | A left and a right page that stay together, placed `repeat` times. A spread always starts on a left page (see **Gap pages**). `left` must have `"side": "left"` and `right` `"side": "right"`. |
| `free` | `pages` | Pages the owner fills by hand. At the top level the block takes every page the other blocks leave; each entry of `pages` is the design kept on that free page (`null` is blank), and the rest are blank. Inside a group it is exactly `pages` (one blank page when empty) for each repeat of the group. |
| `group` | `name`, `children`, `repeat` | `children` are page, spread and free blocks (groups do not nest) that repeat together: a group's `repeat` repeats its whole contents. Inside a group a block's `repeat` is `{"times": n}` or (for a dated block) `{"to": …}`, and it has no `pin`. |

Every page, spread and group block has a `repeat`: `{"times": n}` (1 to 400; the default is 1), `{"to": "week" | "month"}` (a dated
page or spread only: copies to the end of the week or month, see **Page types** below) or `{"fill": true}`, **fill what is left**: as many repeats as use up the pages the other blocks leave, so the book keeps its page count. Fill is allowed only on a
top-level block. **At most one top-level block takes what is left: one fill, or one `free` block.**

A top-level page, spread or group block can be **pinned** with `"pin": 52` (a page number, 1 to 400) or `"pin": "last"` (the
last page of the book, which follows the book if it is resized). A pinned block is placed first, ending on the last page for
`"last"`; the other blocks flow around it, and the fill or free pages before it take up the slack. A block cannot both fill and be
pinned, and `free` blocks cannot be pinned. A pin that collides with another pinned block is reported as an issue in the layout.

Page, spread and group blocks may carry `"from": { "id": "...", "fingerprint": "..." }`: the Library design they were placed from
(the `id` of a saved page or spread, or `example:<name>` / `example:spread:<name>` for a built-in) and a short hash of that design
as it was placed (`src/format/fingerprint.ts`: a hash of its `identity`, `grid` and `elements`; for a spread, the two pages'
hashes joined with `/`). It is recorded only; nothing reads it yet.

**Laying the outline out** (`layoutOutline`):

1. Pinned blocks are placed first, each at its page (`"last"`: so that it ends on the last page).
2. The other blocks follow one after another from page 1, skipping pinned pages.
3. The block that takes what is left gets the largest number of repeats (or free pages) whose last page is still within the book.
4. Blocks that need more pages than the book has run past the end: the layout is **over** by the difference (the last page used
   minus `page_count`), and the Book view turns the count red, offers **Make the book N pages** (the next multiple of 4 that holds
   it) and does not print.

**Gap pages.** Spreads start on a left (even) page. Where a spread would land on a right page, or its second page is taken by a
pinned block, a **gap page** (the built-in Notes page) is inserted first. It counts in the page total and is shown as a dim row in
the outline.

**Page total.** "N of 52 pages" is the number of pages the blocks take, gap pages included; pages nothing is placed on print blank.

**Sides.** Page 1 is a right-hand page, so odd pages are right-hand and even pages left-hand; `cover.front` is left, `cover.back` is
right, `cover.outside_front` is right, `cover.outside_back` is left. A block's page is turned to the side of each page it lands on
when it is drawn. If turning it would put an element over the page number's corner (see `page-format.md`), that placed page prints
without its number; the design in the book is untouched. Cover pages are stored on their own side (`side` must match).

**Covers.** The four cover pages never print a page number, so the page-number corner is not reserved on them: an element at row 0,
x 0 to 2 of `cover.front` is valid whatever its `page_number` says. Seen from outside, the sheet that prints the outsides reads
*outside back* (left) | *outside front* (right), and the sheet that prints the insides reads *inside front* (left) | *inside back*
(right). The inside front cover is the back of the outside front cover, and so on. In Book view the four cover pages are the
slots around the pages: outside front, inside front, pages 1 to N, inside back, outside back.

**The calendar.** A book may have `"calendar": { "start": "2026-11-01", "end": "2026-11-30", "week_starts": 0 }`: two real days
(`start` not after `end`, at most 800 days apart) and the day weeks start on (0 Sunday, the default, to 6 Saturday). The app asks for
a first month, a year and a number of months (default 1) and writes the first and last day. A book without a calendar is
**undated**: nothing below applies, and every date token prints blank. The calendar has **days** (each day from `start` to `end`),
**weeks** (each calendar week that touches the range) and **months** (each month that touches it). The first and last week or month
may be partial: a page reads only the days of it inside the calendar. January 2027 has six weeks: Fri 1 to Sat 2, four full
weeks, then Sun 31.

**Page types.** A page or spread block may carry `"dates"`: `"day"`, `"week"`, `"month"`, `"week-review"` or `"month-review"`; left out it is
**Plain** and reads nothing (groups and free pages have no type). The layout walks the outline in order (a group's children in order,
each repeat of the group in turn, pinned blocks too: a block's dates come from its place in the outline, not its page number) with
three counters that start at the calendar's first day, first week and first month. Each copy of a **Day page** reads the next day,
each copy of a **Week page** the next week (a partial first or last week reads only its days inside the calendar), each copy of a
**Month page** the next month. A **Week review** reads the week of the last Day page before it in the walk (no Day page yet: the last
Week page; none: the first week), a **Month review** the month of that day (else the last Month page, else the first month); a review
uses no counter. A spread is one copy: both pages read the same date. `"shared": false` ("Each page its own date") gives the left page
one date and the right the next, so a copy takes two (left page week *k*, right page week *k*+1; a last right page past the calendar
is left undated without an issue). A fill that comes before dated blocks counts the copies it actually gets, so the dates after it
follow. Without a calendar everything prints blank and a run to the end of a week or month is one copy.

**Runs.** `{"to": "week"}` (Day pages) makes copies until the last day of the week of the next day (the week's last day, or the
calendar's end); `{"to": "month"}` (Day and Week pages) until the end of the month of the next date (for a week, the month its first
day is in), or the calendar's end. They make as many copies as there are days or weeks left, so a partial week makes fewer; with
`"shared": false` a copy takes two. A run that starts after the calendar's end makes none.

**Past the calendar.** A dated copy whose date falls after the calendar's last day prints its tokens blank and the layout reports
one issue for the block: "Page *N* is past the calendar's last day (Nov 30)." (*N* is the first such page.)

**Tokens.** Each dated page placed by the outline reads one day, week or month, as the days of it inside the calendar. A day page reads its
day. A week page: `{day}`, `{weekday}`, `{month}`, `{year}` are the **week's** first day (a Sunday with the default week start) and
`{day+N}` / `{weekday+N}` its Nth day, so day columns never shift; a date token whose day is outside the calendar prints blank
(`{day}`, `{day+N}`, and `{month}`, `{monthname}`, `{year}` without an offset), while `{weekday}` names always print because they label
columns. `{x@start}` reads the first day of what the page covers *inside the calendar* and `{x@end}` the last day inside it (neither
takes an offset), so the last week of November 2026 reads `NOV 29 – NOV 30` and the first week of January 2027 `JAN 1 – JAN 2` with
`{month@start} {day@start} – {month@end} {day@end}`. A month page reads its first day inside the calendar. `{week}` is the week's number **by the book's year**
(the year `start` is in): the week holding 1 January of that year, counted from the week start, is week 1, so Dec 27 to Jan 2 is week
53 in a book that starts in December 2026 and week 1 in one that starts in January 2027; `{week+1}` is the next week's number.
`{months}` of a week or month that spans two months reads `DEC / JAN`. Pages that read nothing (no calendar, a gap page, a block
Plain, a day beyond the calendar) print every token blank, so the date can be written in by hand. The four covers read the calendar's first month, as a month page does (`{monthname}` NOVEMBER, `{month}` NOV, `{year}` 2026, offsets in their own unit so `{monthname+1}` is DECEMBER, day tokens the first day inside the calendar); a book without a calendar prints them blank. The
outline row of a page that prints dates says what its first repeat prints (`reads: SUN NOV 1`, `reads: NOV 1 – NOV 7`). The dates
reach `pages.pdf`, the print files, the cover PDFs, `preview.png` and Flip through. See `src/format/calendar.ts` and `layoutOutline`.

**Free pages and the calendar.** Free pages and the designs on them (a page chosen on a free page is stored in the block's `pages`)
are kept when the calendar changes: free page *i* stays free page *i* while the other blocks' pages move. A stored free page that
no longer fits the book is kept, marked "doesn't fit" in its row, and the book is over by that many pages (printing waits); clearing
the design on it (blank pages at the end of `pages` are dropped) takes it out.

**Validation.** A reader rejects the whole file, and says which rule failed and where, if the format or version is wrong,
`page_count` is not a multiple of 4, `outline` is missing or not a list, a block has an unknown `type`, a `repeat` or `pin` is out of
range, a `fill` is on a pinned block or inside a group, a `dates` or `to` does not fit (a `to` needs a type that suits it) or a `calendar` is not real, a group is inside a group, a spread's pages are on the wrong sides, more than
one top-level block takes what is left, a `from` is not `{id, fingerprint}`, or a page breaks the page rules. The page-number corner
rule is not applied to the covers.

## The printer profile

Everything about how a particular printer and paper print lives in the printer profile, kept in the browser (local storage)
and used for every book; the Calibrate wizard finds it. It is not part of a book file, and a book is printed with whatever the
profile is when the files are made (the zip's `summary.txt` and `calibration.txt` record the settings used). Numbers outside the
limits below are brought back in by the fields and refused by the reader of a stored profile (which then falls back to the defaults, saying why).
A layout, or a setting of one, that a stored profile does not have takes the default's value (never zero), and only the layouts that differ from the defaults are stored, so a layout you have not changed follows the defaults. **Reset these offsets to defaults** (Export, PDF tab) shows the values of the layout, print method and paper being shown next to the defaults and, once confirmed, puts them back.

A profile saved before print methods and paper sets existed (one profile per layout, `layouts.<layout>.front_offset_x_mm` and so on) is read as is: its numbers become the **inside paper's** for **both** methods of that layout, and the **cover paper's** start as a copy of them. Nothing is reset.

| Field | Meaning |
|-------|---------|
| `creep_per_sheet_mm` | Creep: how far each sheet's content must move toward the fold relative to the sheet outside it, so every sheet's content shifts toward the fold by (sheets outside it) × this. Found by the creep test. In a thick book it is often more than the paper's thickness (about 1.5×), because the round spine uses up paper. Default 0.30 (provisional, see below). 0 to 1. |
| `fore_edge_shift_mm` | Moves the content of every interior page away from the fold by this amount (left pages left, right pages right), on top of the creep, so the trimmed fore-edge margin lands on the target. Default 2.0 (provisional). -10 to 10. |
| `cover_fore_edge_shift_mm` | The same for the covers (`cover-outside.pdf`, `cover-inside.pdf`). Default 2.2 (provisional). -10 to 10. |
| `target_fore_edge_margin_mm` | The fore-edge margin wanted on the trimmed book, content box to the trimmed edge. The creep test marks it on its rulers and the wizard aims for it. Top and bottom are unchanged (3.85 mm). Default 3.5. 1 to 10. |
| `sheet_layout` | `"half_letter"` or `"letter_two_up"`: how the sheets are laid on the paper (see **Sheet layouts** below). The offsets and scale below are those of the layout chosen here when the files are made. |
| `print_method.<layout>` | `"auto"` or `"hand"`: how that layout's paper is turned for its second side. **Auto duplex** (`"auto"`): the printer flips the paper itself, so the book's sheets are one file, `print-duplex.pdf` (each sheet's front then its back), and the creep test is ordered the same way. **By hand** (`"hand"`): you print one side, put the stack back and print the other, so the files are `print-first.pdf` and `print-second.pdf`. A printer places the back differently in the two, so each method has its own offsets. Default: `half_letter` by hand, `letter_two_up` auto. Chosen at the top of Calibrate and in the print settings (Export, PDF tab). |
| `layouts.<layout>.<method>.<paper>` | Every setting below is kept for each layout, each print method (`auto`, `hand`) and each paper: `inside` (the book's pages, the creep test and the calibration sheet when it is made for the inside paper) or `cover` (the covers, `calibration-cover.pdf`, and a calibration sheet made for the cover paper), because heavier cover stock is placed differently. The files use the set of the **selected layout's print method**: the interior files the inside paper's, the cover files the cover paper's. Calibrate and the print settings show which set they read and write. In the rows below, `layouts.<layout>` means one such set. |
| `layouts.<layout>.front_offset_x_mm`, `.front_offset_y_mm` | Added to everything printed on the first pass with that layout: `print-first.pdf`, the fronts in `print-duplex.pdf`, `cover-outside.pdf` and the front calibration pages. +x moves right, +y moves up, as seen on that side. -10 to 10. Measured against the paper, not against the back (see below). Defaults for `half_letter`: 1.7 and -0.05; for `letter_two_up`: -0.25 and -1.55 (the owner's printer). |
| `layouts.<layout>.back_offset_x_mm`, `.back_offset_y_mm` | The same for the second pass (`print-second.pdf`, the backs in `print-duplex.pdf`, `cover-inside.pdf` and the back calibration page), as seen on that side. -10 to 10. Defaults for `half_letter`: 1.5 and 0.05; for `letter_two_up`: -0.4 and 1. Both offsets are against the paper, not against each other: to move all the print toward the top edge, add the same to both sides' y. |
| `layouts.<layout>.scale_x_pct`, `.scale_y_pct` | Where everything on the sheet lands along its 8.5 in edge (x) and along its other edge (y: 5.5 in, or 11 in for two-up), as a percent of true distance, about the sheet's centre (the sheet's centre stays put), on both sides of every print PDF and calibration sheet. 95 to 105, default 100 (except `letter_two_up`'s y, 101.01, the owner's printer). It cancels a printer that enlarges or shrinks the page (borderless modes enlarge it slightly); the 100 mm lines on the calibration sheet find it. The offset is added after scaling. It moves positions only: line widths, dot sizes and letters are never scaled or stretched (see [print-pipeline.md](print-pipeline.md)). |
| `layouts.<layout>.line_weight_x_pct` | How thick strokes along the paper's 8.5 in edge are drawn, as a percent of their drawn width; strokes across it are as drawn and angled ones in between (by cos² of the angle to the 8.5 in edge). 80 to 120, default 100. Dots and text are never affected. Optional: a printer can draw a line along one edge thicker than the same line across it; the pairs of lines on the calibration sheet show it, and its ladder finds the percent. Applied after the scale and the rotation, to the stroke's direction on the paper. A profile stored before it existed reads as 100. |
| `layouts.<layout>.back_rotation_deg` | Rotates everything printed second (`print-second.pdf`, the backs in `print-duplex.pdf`, `cover-inside.pdf` and the back calibration pages) about the sheet's centre (the letter sheet's centre for two-up): + is counter-clockwise as seen on the back. Each line, rectangle, letter and dot is *placed* at its rotated position and not turned, so lines stay exactly horizontal or vertical (see [print-pipeline.md](print-pipeline.md)). -1.5 to 1.5, default 0 (`letter_two_up`: -0.183, the owner's printer). Applied after the scale and before the offset; the front is never turned. Found by the calibration sheet. A profile stored before it existed reads as 0. |
| `shade_light_pct`, `shade_medium_pct`, `shade_dark_pct`, `gray_text_pct` | How dark the printed PDFs draw the light, medium and dark shade tones and the gray text (`"tone": "gray"` on text and sequences), as a percent of black: 0 is white, 100 is black. 0 to 100, fractions allowed. The defaults, 6.3, 13.7, 25.9 and 49.8, are the grays the editor and PNGs always use (#efefef, #dcdcdc, #bdbdbd, #808080), so a default book prints as it always did. They change `pages.pdf`, the print files, `cover.pdf` and the calibration sheets only, never the editor, the preview or PNGs. |

## What the print files contain

| File | Contents |
|------|----------|
| `pages.pdf` | Every interior page at final size (88.9 × 139.7 mm), in reading order. |
| `print-first.pdf`, `print-second.pdf` | **By hand** only. Half letter: half-letter sheets (215.9 × 139.7 mm, landscape), one spread per side, centered on the fold. `print-first.pdf` (first pass, front offset) holds every sheet's front in reverse order; the stack goes back in the tray the same way; `print-second.pdf` (second pass, back offset) holds the backs in forward order. With more than one signature each gets its own pair: `sig1-print-first.pdf`, `sig1-print-second.pdf`, and so on. Letter two-up: the same files, on letter sheets (see below). |
| `print-duplex.pdf` | **Auto duplex** only (and `sig1-print-duplex.pdf` and so on), on either layout: for a printer that duplexes by itself, flipping on the long edge. Front, back, front, back… from the outermost sheet in. It replaces the print-first / print-second pair; the book gets one or the other, never both. |
| `cover-outside.pdf`, `cover-inside.pdf` | The cover sheet (both methods), single-sided, without creep, moved by the cover shift, with the **cover paper's** offsets. `cover-outside.pdf` (outside back on the left, outside front on the right) is the first pass and takes the front offset; `cover-inside.pdf` (inside front on the left, inside back on the right) is printed on the back of it, second, and takes the back offset. Each cover page is moved away from the fold by the cover shift on its own side of the fold, so (turned over, left and right swap) the inside front lands exactly behind the outside front. Letter two-up prints two covers per sheet, the top book's above the bottom book's. |
| `preview.png` | A contact sheet of the whole book, spread by spread. |
| `summary.txt` | The print settings that made the files (creep per sheet, fore-edge shift, cover shift, target margin, signatures, the sheet layout and print method with its scale and its front and back offset x and y for the inside paper, and the cover paper's offsets, every tone percentage, page size, app version, date), the sheet layout, the print method, the printer's paper settings, for two-up the top and bottom book and the sheet order, the printing steps for the chosen method only, and short tips: print the calibration set first, one signature before the whole book, at actual size, with the same settings for every sheet, and at the printer's best quality. |
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
(*k* = 1 is the outermost sheet). With auto duplex, `print-duplex.pdf` runs front, back for *k* = 1, 2, 3 …; by hand, `print-first.pdf` holds the fronts of
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

## The Calibrate wizard

**Calibrate your printer…** (Export, PDF tab) is three steps for the sheet layout chosen in the PDF tab, one on screen at a time with Back and Next.
Everything typed there is kept as the printer's settings, never in the book.

1. **Sheet**: downloads `calibration-sheet.pdf`; the readings from it become the back's offsets and rotation, the front's offsets and the scale of each paper edge (below).
2. **Creep and cover**: downloads a zip with `creep-test.pdf` (the inside paper's set) and `calibration-cover.pdf` (the cover paper's set), both ordered and explained for the print method; the fore-edge margins measured after binding and trimming become the creep, fore-edge shift and cover shift. The page count and the values the test prints with are editable first.
3. **Check** (optional): prints the corrected creep test again and compares the margins with the targets; it also holds the tone fields.

## The calibration files

The Calibrate wizard (Export, PDF tab, **Calibrate your printer…**) builds these from the printer profile (and the book's size, for the creep test), at the real page size, with the same imposition and drawing code as the print files. Every page prints the settings that made it (eight lines in its footer), the second of which, `made for <layout> | <auto duplex or by hand> | <inside or cover> paper`, says how it should be printed. On letter two-up the creep test and the cover sheet draw every page in both halves, labelled Book 1 and Book 2 as the print files are, with the cut marks; the calibration sheet uses the whole letter sheet instead. The scale, offsets and rotation of the layout apply to the whole page.

| File | Contents |
|------|----------|
| `calibration-sheet.pdf` | One double-sided sheet per layout, two pages: page 1 is the **front** (side 1, takes the front offset), page 2 the **back** (side 2, takes the back offset and the back rotation); print them as the print method says (by hand: page 1, the sheet back in the tray as for `print-second.pdf`, then page 2; auto duplex: both pages double-sided). It is made for the paper set chosen in Calibrate (inside by default) and uses that set's offsets. It uses the whole paper (the half sheet, or for two-up the whole letter sheet, 215.9 × 279.4 mm), with no halves, labels or cut marks. See below. |
| `creep-test.pdf` | **Three sheets stand for a book of any size**: the cover sheet (`calibration-cover.pdf`) and, here, only the **outermost** sheet (pages 1 and the last page) and the **innermost** sheet (the middle spread) of a book of a given page count (a multiple of 4, by default the open book's biggest signature; *sheets* = pages ÷ 4), **both sides**, in the order of the print method. By hand: pages 1 and 2 are the fronts (innermost first), pages 3 and 4 the backs (outermost first), as `print-first.pdf` / `print-second.pdf` are printed. Auto duplex: the outermost sheet's front and back, then the innermost sheet's front and back, as `print-duplex.pdf` is printed (so each sheet's back is its own). Each page is shifted by its sheet's creep in that book (the sheets outside it × creep per sheet), the fore-edge shift and its side's offset, and says which sheet, side and pages it is, the page count it was made for, and the print range of its pass. A one-sheet book (4 pages) prints that sheet alone. The rest of the book is not printed: fold the outermost sheet around *sheets* − 2 blank sheets of the same paper, with the innermost sheet in the middle and the cover outside, bind and trim as usual, and read the fore-edge margin on the cover, page 1 and the middle spread (its right-hand page). |
| `calibration-cover.pdf` | Two pages like `cover-outside.pdf` and `cover-inside.pdf` (cover shift and the cover paper's offsets; page 1 the front offset, page 2 the back offset; the instruction follows the print method): the box and crosshairs of the outside covers, then of the inside covers. Covers stay out of the creep test. |
| `calibration.txt`, `book.json`, `error.txt` | The settings that made the files, the book as JSON, and the error log if something went wrong. |

**Rulers.** A margin ruler counts millimetres outward from the page's box line, with a tick every 0.5 mm, so the number where the paper (or the trimmed edge) ends is the margin there. The expected margin is marked with a longer tick: 3.85 mm at the top and bottom (the ruler stops there, at the edge of the unshifted page; if the paper ends past it, measure the extra with a ruler and add it) and the target margin (`target_fore_edge_margin_mm`, 3.5 by default) at the fore-edge (the ruler runs to 7 mm, past the trim line). The creep test and the cover sheet have rulers at the top, bottom and fore-edge of every page; the calibration sheet has its own fold scales (below).

**The calibration sheet.** The layout is the same for both sheet layouts and uses the whole paper: *W* × *H* is 215.9 × 139.7 mm for half letter and 215.9 × 279.4 mm for two-up, and *m* = 8.0 mm. Five marks: top (*W*/2, *m*), bottom (*W*/2, *H* − *m*), left (*m*, *H*/2), right (*W* − *m*, *H*/2) and the centre (*W*/2, *H*/2). Everything stays at least 3 mm from every paper edge, so it prints without borderless.

- *Side 1 (printed first)*: a fine **+** (0.2 mm lines, 6 mm across) at all five marks, and in the space at least 10 mm from every mark the gray ramp from 0 to 100% in 5% steps (each with text in that gray), the three shade tones and the gray text as they print now, small and large dots, hair, thin and thick ruled lines, a hairline weight strip (0.05 to 0.30 mm), **line weight by direction** and the settings footer. Line weight by direction is a block on the left page's right-hand side: *pairs* of identical lines at 0.12, 0.25 and 0.35 mm, each pair one line along the 8.5 in edge (11 mm) and one along the other edge (8 mm), labelled with the width and the edge names, and with the width each is **drawn** at after the line weight setting ("drawn 0.315 mm", and "other 0.350 mm" for the line along the other edge), so the setting's effect can be read on paper even where the printer can't show it (steps under about 0.04 mm may be below what it can show: if 100 % and 90 % look the same, keep 100 %) (a printer that draws one direction thicker shows as a difference within a pair); and a *ladder* of four lines along the 8.5 in edge at 85, 90, 95 and 100 % of 0.35 mm, labelled, beside a 0.35 mm line along the other edge. The pairs are drawn under the line weight setting (they show what it does); the ladder is exempt from it, so its steps are the same whatever the setting is. To set `line_weight_x_pct`: only if the pairs still differ after the scale is right, pick the ladder step that looks as thick as the 0.35 mm line along the other edge and type it in the wizard's "ladder step" box: it appears in New settings like every other reading, with the same Use button. No scales. The marks are symmetric about the sheet's centre, so each shows through the paper (the sheet turned over, left and right swapped) at the place of its mirror image.
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
