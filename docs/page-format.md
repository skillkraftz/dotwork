# Dotwork page format, version 2

A page file describes one page as a stack of elements drawn on the 3 mm grid.
Dotwork writes these files; journal-system will read them. Both projects
follow this document. Version 2 replaces version 1's non-overlapping regions
with layered elements, so designs can overlap, use half-cell positions, and
place labels anywhere.

## The page and its grid

- The page is 88.9 x 139.7 mm (3.5" x 5.5").
- The grid is **27 x 44 cells at 3 mm pitch (81 x 132 mm), centered on the
  page**. Its top-left corner sits 3.95 mm from the page's left edge and
  3.85 mm from its top edge. Nothing is drawn outside the grid.
- **Row 0 is the header row**, drawn by the printer software: the page number
  at the top outer corner and the page's identity by the spine. While the page
  has an `identity`, the whole row belongs to the header and elements may not
  extend above y = 1. **When `identity` is empty or absent, row 0 can be drawn
  on**, except the page number's corner cells while page numbers are on: the
  two cells (6 mm) at the outer top corner, x 0 to 2 on a left page and x 25 to
  27 on a right page (`"either"` counts as right). With `page_number` set to
  `false` nothing is reserved and the whole row is free. The corner depends on
  `side`, so a page moved to the other side of the spine can start covering it;
  Dotwork then turns that placed copy's `page_number` off.

## Coordinates

- Units are grid cells, measured from the grid's top-left corner. `x` runs
  0-27 across and `y` runs 0-44 down.
- Every coordinate and size is a multiple of **0.5**, so things can sit on
  grid lines or exactly halfway between them (for example the offset
  sleep-hours column on the monthly tracker).
- Elements must stay inside the grid and below the header: `x >= 0`,
  `y >= 1`, `x + w <= 27`, `y + h <= 44`, with sizes greater than 0. When row 0
  is free (see above), `y >= 0` instead, and an element that reaches into the
  reserved page number corner is refused.
- **Elements may overlap.** They are drawn in array order, so later elements
  sit on top of earlier ones.

## Top level

| Field      | Type   | Required | Meaning |
|------------|--------|----------|---------|
| `format`   | string | yes      | `"dotwork-page"` |
| `version`  | number | yes      | `2` |
| `name`     | string | yes      | The design's name. |
| `identity` | string | no       | Header text by the spine. May contain tokens. Empty or absent frees row 0 for drawing. |
| `page_number` | boolean | no    | `false` leaves the page number off this page. Default `true`. A book's own `page_numbers` setting can turn numbers off for every page. |
| `side`     | string | no       | `"left"`, `"right"` or `"either"` (default). Which page of a spread the design is meant for. The spine is on the right of a left page and on the left of a right page. |
| `grid`     | object | yes      | Always `{ "cols": 27, "rows": 44, "pitch_mm": 3 }`. |
| `elements` | array  | yes      | The elements, bottom to top. |

## Element types

Every element has a `type`, the fields listed for it, and may have a `group`. Optional fields show their default.

### `group`: elements edited together

Any element may have `"group": "g1"`, a non-empty string. Elements with the same value form a group: the editor selects and moves them as one. The file stays a flat list and printing ignores groups.

### `pattern`: writing lines, a grid or dots

| Field | Meaning |
|-------|---------|
| `x`, `y`, `w`, `h` | The area. |
| `pattern` | `"lines"`: a rule under each row band, including the bottom edge. `"vlines"`: a rule right of each column band, including the right edge. `"grid"`: rules on every boundary, including all four edges. `"dots"`: a dot on every intersection, including the edges. |
| `every` | Spacing of the lines or dots in cells, default `1`. `2` gives 6 mm lines. |
| `weight` | `lines`, `vlines`, `grid`: `"hair"` (default, light gray), `"thin"` (0.5 pt black) or `"thick"` (1.5 pt black). |
| `dots` | `dots`: `"small"` (default, 0.5 mm) or `"large"` (0.9 mm). |
| `first` | `lines`: `true` also draws the top line. `vlines`: `true` also draws the left line. Default `false`. A grid and dots already include every edge. |

Hair lines and dots are light gray and thin, the same as journal-system's writing lines and dot grid. Tinting an area is the `shade` element's job.

### `shade`: a gray tint

| Field | Meaning |
|-------|---------|
| `x`, `y`, `w`, `h` | The area. |
| `tones` | A string of the letters `L` (light), `M` (medium), `D` (dark) and `B` (blank), repeated across the area. `"L"` is solid light; `"LB"` is every other row; `"LBBMBB"` is a custom repeat. Required, at least one letter, capitals only. |
| `along` | `"rows"` (default): each row takes the next tone. `"columns"`: each column does. `"checker"`: the cell at row r, column c takes tone number (r + c) mod the number of tones, so `"LB"` is a checkerboard. |
| `every` | How many cells each tone step covers, default `1`, a multiple of `0.5`. The last step is cut to the area. |

Rows, columns and cells are counted from the area's top-left corner. Light, medium and dark are `#efefef`, `#dcdcdc` and `#bdbdbd`; blank draws nothing.

### `box`: an outline

| Field | Meaning |
|-------|---------|
| `x`, `y`, `w`, `h` | The rectangle. |
| `sides` | Which sides to draw, default all four: any of `"top"`, `"bottom"`, `"left"`, `"right"`. |
| `weight` | `"thin"` (default, 0.5 pt black) or `"thick"` (1.5 pt black). |

### `rule`: a single straight line

| Field | Meaning |
|-------|---------|
| `x1`, `y1`, `x2`, `y2` | Start and end. The line must be horizontal or vertical. |
| `weight` | `"hair"` (a gray writing line), `"thin"` (default) or `"thick"`. |

### `checkboxes`: a row or column of small squares

| Field | Meaning |
|-------|---------|
| `x`, `y` | The top-left cell of the first box. |
| `count` | How many boxes. |
| `every` | Cells from one box to the next, default `1`. |
| `direction` | `"down"` (default) or `"across"`. |
| `size` | Box size as a fraction of a cell, `0.5` to `1`, default `0.7`. Each box is centered in its cell. |
| `weight` | `"thin"` (default) or `"thick"`. |

### `sequence`: a run of cells with one item in each

| Field | Meaning |
|-------|---------|
| `x`, `y` | The top-left corner of the first cell. |
| `count` | How many items. |
| `direction` | `"down"` (default) or `"across"`. |
| `every` | Cells from one item to the next, default `1`; a multiple of `0.5`. |
| `values` | What the items are: `"numbers"` (default), `"letters"`, `"list"` or `"icons"`. |
| `start` | `numbers`: the first number (default `1`). `letters`: the first letter (default `"A"`; a small letter gives small letters). |
| `step` | `numbers`: what to add each time, default `1`. |
| `list` | `list`: the items, repeating, each one or two characters. May be empty or missing while the person is still typing; nothing is drawn then. |
| `icons` | `icons`: icon names from the icon set, repeating. |
| `tone` | `"black"` (default) or `"gray"`. |
| `size` | `icons`: how many cells wide and tall each icon is, `1` (default) or `2`. Set `every` to at least the size so the icons do not overlap. |
| `rotate` | `0` (default), `90` (reads bottom to top) or `270` (reads top to bottom), as for `text`. Every item turns about the center of its own cell (an icon about the center of its 1 or 2 cell square), so the run's position and bounds do not change. |

Text items are at most two characters, so a number that would reach three
characters (100, or -10) is an error. Each text item is centered in its own cell
by the width of its characters, with no inset, in the label size; the baseline is
the same as a `text` element's. A letters run goes A to Z and then AA, AB and on.
An icon fills its 1 x 1 or 2 x 2 cells, starting at the item's cell.

A single icon is a sequence of one: `{ "type": "sequence", "values": "icons",
"icons": ["sun"], "x": 4, "y": 6, "count": 1 }`. The run must fit in the grid: it
covers `(count - 1) * every + size` cells along its direction (`size` is 1 for
text).

#### Icons

Icon names are plain lowercase names, with hyphens. A reader draws them from its
own copy of the set; Dotwork's is in `src/icons/icons.ts` (line art on a 24 x 24
grid, mostly from Lucide, ISC licence, see `src/icons/LICENSE.txt`). Names:

- rapid log: `task` `done` `migrated` `scheduled` `note` `event` `priority` `inspiration` `explore`
- checkboxes: `box` `box-check` `box-x`
- moods: `angry` `sad` `neutral` `happy` `laugh`
- weather: `sun` `cloud` `rain` `snow` `wind`
- moon: `moon-new` `moon-first` `moon-full` `moon-last`
- habits: `water` `exercise` `sleep` `pill` `food` `coffee`
- errands: `home` `work` `phone` `mail` `cart` `money` `car` `plane` `pin` `calendar` `clock`
- more: `gift` `cake` `heart` `star` `lightbulb` `flag` `trophy` `book` `music` `camera`
- arrows: `arrow-up` `arrow-down` `arrow-left` `arrow-right`

Icons are drawn with thin round-capped lines, 0.26 mm at one cell and 0.36 mm at
two; the moon phases also have a solid part.

### `art`: imported artwork

Artwork placed on the grid like a box. Dotwork reads an SVG file once and stores the result inside the page, so the page
file is self-contained and a reader never opens an SVG.

| Field | Meaning |
|-------|---------|
| `x`, `y`, `w`, `h` | The rectangle the art fills, as for `box`. |
| `view_box` | `[x, y, width, height]`: the art's own drawing area, in the units the paths use. Width and height greater than 0. |
| `paths` | The shapes, bottom to top. At least one, at most 200. |
| `fills` | Optional. `{ "right-half": "dark" }`: for this placement, the fill of the paths with those ids, in place of the path's own `fill`. Values are `"none"`, `"light"`, `"medium"` or `"dark"`; every key must be the `id` of a path. |
| `strokes` | Optional. `{ "centre-line": "none" }`: for this placement, the line of the paths with those ids, in place of the path's own `stroke`. Values are `"none"`, `"gray"` or `"black"`; every key must be the `id` of a path. A path with no line of its own can't be given one. |
| `scaling` | `"fit"` (default): keep the art's proportions and center it in the rectangle. `"stretch"`: fill the rectangle. |

Each path is `{ "id": "right-half", "d": "...", "fill": "light", "stroke": "black", "stroke_mm": 0.3, "linecap": "round" }`:

- `id` is optional: the `id` the shape had in the SVG file (letters, digits and `_ . : -`, starting with a letter, up to 40 characters), unique within the art. It names the path so a placement can change it with `fills` and `strokes`. A path with a fill or a closing `Z` can be given a fill; a path with a line can be given a line. A named path with no fill and no line is kept (it draws nothing until a placement fills it).

- `d` is path data in the art's units using only **absolute `M`, `L`, `C` and `Z`** (move, line, cubic curve, close),
  written as `M10 20L30 40C1 2 3 4 5 6Z`: a command letter, then exactly its numbers (2, 2, 6 and 0), separated by spaces.
  A path starts with `M`, and `L` and `C` need a current point (after a `Z`, start again with `M`). Dotwork's importer turns circles,
  ellipses, rectangles, lines, polylines, polygons, arcs, quadratic curves, relative commands and every `transform` into this form.
  Every point, control points included, lies inside `view_box` (a 1% margin is allowed). At most 40,000 characters of path data in all.
- `fill` and `stroke` are `"black"`, `"dark"`, `"medium"`, `"light"`, `"gray"`, `"white"` or `"none"`. Black is black, white
  is white, gray is the gray of gray text, and dark, medium and light are the shade tones (the printed PDFs use the book's
  print tones for these, as they do for `shade` and gray `text`). A path with no fill and no stroke draws nothing.
- `stroke_mm` is the line width in mm, from 0 to 3, and greater than 0 when there is a stroke. It is a width on paper: **resizing the art
  does not change it**. Lines are drawn with mitered joins, and paths are filled with the non-zero rule.
- `linecap` is optional: how a line ends, `"butt"` (default, flat at the end point), `"round"` or `"square"` (both extend half the line width past it).

Fit scales the view box by the larger of what fits the width and the height (mm per unit = `min(w x 3 / view_box width, h x 3 / view_box height)`),
centered; stretch scales the two directions separately. A reader draws `d` through that scale and offset and leaves `stroke_mm` alone.

The importer reads shapes (paths, circles, ellipses, rectangles, lines, polylines, polygons) and applies every transform. It leaves out text, images,
gradients, filters, masks, scripts, styles, links to other files and presentation attributes it cannot honor (line joins, even-odd fills and so on), and
lists what it left out; an empty or oversized result is refused with the reason.

### `text`: a label or heading

| Field | Meaning |
|-------|---------|
| `x`, `y` | The anchor: the top-left corner of the cell band the text sits in. |
| `text` | The text. May contain tokens. |
| `size` | `"label"` (default, about 6.5 pt, fits one row) or `"heading"` (about 9 pt). |
| `style` | `"regular"` (default) or `"bold"`. |
| `tone` | `"gray"` (default) or `"black"`. |
| `align` | `"left"` (default), `"center"` or `"right"`. For center and right, `x` is the text's center or right end. |
| `rotate` | `0` (default), `90` (reads bottom to top) or `270` (reads top to bottom). Rotated text is anchored the same way in its rotated frame. |

Text sits on its row's baseline, the way labels sit on writing lines in
journal-system. Font: Courier Prime.

## Tokens

Replaced with real values when a page is printed for a date (a book can give
each of its pages a date, see `book-format.md`). A page with no date prints
tokens blank. Dotwork shows sample values in the editor, for Monday
2026-10-26.

| Token        | Example   |
|--------------|-----------|
| `{weekday}`  | `MON`     |
| `{month}`    | `OCT`     |
| `{monthname}`| `OCTOBER` |
| `{day}`      | `26`      |
| `{year}`     | `2026`    |
| `{week}`     | `44`      |
| `{months}`   | `OCT`, or `NOV / DEC` when the 7 days from the date reach the next month |

**Day offsets.** Any token may carry a whole-day offset: `{day+1}` is the day
of the month tomorrow, `{weekday+6}` the weekday six days on, `{day-1}`
yesterday's. The offset counts from the page's date (from the sample date in
the editor). So a weekly page dated its Sunday can show `{weekday}` ...
`{weekday+6}` and `{day}` ... `{day+6}`.

**Weeks** run Sunday to Saturday, and week 1 is the week that holds January 1
(as in journal-system): 2026-10-18 is week 43, and week 1 of 2027 starts on
2026-12-27.

Identities print in all caps. An unknown token (or a malformed offset) is an
error.

## Spreads

A spread file pairs a left and a right page:

```json
{
  "format": "dotwork-spread",
  "version": 2,
  "name": "Ideas spread",
  "left":  { "...": "a complete dotwork-page, side left" },
  "right": { "...": "a complete dotwork-page, side right" }
}
```

Nothing may cross the spine; each side is its own page. A reader must check
both pages against every page rule, and reject a spread whose `left` page does
not have `"side": "left"` or whose `right` page does not have
`"side": "right"`.

## Validation

A reader must reject a file with the wrong `format`, an unknown `version`, an
unknown element type or field value, a coordinate that is not a multiple of
0.5, an element outside the grid or above the first usable row (y = 1, or y = 0 when row 0 is free), an element on the page number's corner, a diagonal rule, a
`checkboxes` or `sequence` element whose items leave the grid, a `shade` whose `tones` are not the letters L, M, D and B, an `art` whose `view_box`, `paths`, path data, tones or line widths break the rules above (or whose points leave the view box), an empty `group`, a `sequence`
with a text item of more than two characters or an unknown icon name, or an unknown token, and say
which rule failed. Overlap is allowed.

## Version 1 files

Dotwork still converts version 1 files when it reads them (`src/format/convert.ts`), though it no longer writes them. Readers should convert version 1 files: each region becomes a `pattern` (or
`checkboxes` plus `lines`), a `box` for its borders, and `text` elements for
its labels, in that order.
