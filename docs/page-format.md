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
  at the top outer corner and the page's identity by the spine. Elements may
  not extend above y = 1.

## Coordinates

- Units are grid cells, measured from the grid's top-left corner. `x` runs
  0-27 across and `y` runs 0-44 down.
- Every coordinate and size is a multiple of **0.5**, so things can sit on
  grid lines or exactly halfway between them (for example the offset
  sleep-hours column on the monthly tracker).
- Elements must stay inside the grid and below the header: `x >= 0`,
  `y >= 1`, `x + w <= 27`, `y + h <= 44`, with sizes greater than 0.
- **Elements may overlap.** They are drawn in array order, so later elements
  sit on top of earlier ones.

## Top level

| Field      | Type   | Required | Meaning |
|------------|--------|----------|---------|
| `format`   | string | yes      | `"dotwork-page"` |
| `version`  | number | yes      | `2` |
| `name`     | string | yes      | The design's name. |
| `identity` | string | no       | Header text by the spine. May contain tokens. |
| `side`     | string | no       | `"left"`, `"right"` or `"either"` (default). Which page of a spread the design is meant for. The spine is on the right of a left page and on the left of a right page. |
| `grid`     | object | yes      | Always `{ "cols": 27, "rows": 44, "pitch_mm": 3 }`. |
| `elements` | array  | yes      | The elements, bottom to top. |

## Element types

Every element has a `type` and the fields listed for it. Optional fields show
their default.

### `pattern`: shading, writing lines, grid or dots

| Field | Meaning |
|-------|---------|
| `x`, `y`, `w`, `h` | The area. |
| `pattern` | `"lines"`: a rule under each row band, including the bottom edge. `"vlines"`: a rule right of each column band, including the right edge. `"grid"`: rules on every boundary, including all four edges. `"dots"`: a dot on every intersection, including the edges. `"none"`: no lines or dots, for a plain shaded area. |
| `background` | The gray behind the pattern: `"none"` (default), `"light"`, `"medium"` or `"dark"`. |
| `stripes` | `"none"` (default), `"rows"` or `"columns"`. With stripes, only every other row or column of the background is shaded, starting with the first. |
| `every` | Spacing of the lines or dots in cells, default `1`. `2` gives 6 mm lines. Stripes are always one cell wide. |

The background is drawn first and the lines or dots on top of it, so one element
can be "writing lines on light gray, every other row". Pattern lines and dots are
light gray and thin, the same as journal-system's writing lines and dot grid.

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
| `list` | `list`: the items, repeating, each one or two characters. |
| `icons` | `icons`: icon names from the icon set, repeating. |
| `tone` | `"black"` (default) or `"gray"`. |
| `size` | `icons`: how many cells wide and tall each icon is, `1` (default) or `2`. Set `every` to at least the size so the icons do not overlap. |

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

Replaced with real values when a page is printed for a date. Dotwork shows
sample values in previews.

| Token        | Example   |
|--------------|-----------|
| `{weekday}`  | `MON`     |
| `{month}`    | `OCT`     |
| `{monthname}`| `OCTOBER` |
| `{day}`      | `26`      |
| `{year}`     | `2026`    |
| `{week}`     | `44`      |

Identities print in all caps. An unknown token is an error.

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
0.5, an element outside the grid or above y = 1, a diagonal rule, a
`checkboxes` or `sequence` element whose items leave the grid, a `sequence`
with a text item of more than two characters or an unknown icon name, or an unknown token, and say
which rule failed. Overlap is allowed.

## Version 1 files

Readers should convert version 1 files: each region becomes a `pattern` (or
`checkboxes` plus `lines`), a `box` for its borders, and `text` elements for
its labels, in that order.
