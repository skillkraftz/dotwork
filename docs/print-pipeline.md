# The print pipeline

Every printed file (the book's `print-first.pdf` and `print-second.pdf` or `print-duplex.pdf`, by the print method, the covers, and all the calibration sheets) is
made in three stages. Each stage knows only about its own job, so a page size can later plug into the first one without touching the
other two. (There is no project or page-size feature yet.)

```
pages, labels, cut marks, calibration content
        │  layout    src/print/layout.ts, sheets.ts, calibrate.ts
        ▼
display list: lines, rects, dots, text, paths, clips, in mm on the PDF page   (src/print/display.ts)
        │  printer   src/print/correct.ts
        ▼
the same list, with positions moved by the side's scale, rotation and offset
        │  pdf       src/print/draw.ts
        ▼
the PDF page
```

## 1. Layout

Turns a page (or a calibration sheet, a label, the cut marks) into a **display list** in millimetres from the top left of the PDF page,
y down, **before any printer correction**. The items are:

| item | what it holds |
| --- | --- |
| `line` | endpoints, width, cap (`butt`, `round`, `square`) and colour; `fixed` keeps it out of the line weight by direction |
| `rect` | a filled rectangle |
| `dots` | round dots on a lattice: the pattern's top-left, the column and row offsets in mm, the dot diameter, colour |
| `text` | the string, anchor (on the baseline), font, size, alignment (`start`, `middle`, `end`) and rotation in degrees |
| `image` | a PNG or JPG (its data URL) filling a rectangle, with the quarter turn (0, 90, 180, 270 clockwise) the design gave it; always in its own colours. The PDF stage embeds each distinct picture once per PDF (`embedImages`, which runs before `drawItems` because PDF libraries decode images asynchronously) |
| `path` | absolute M, L, C and Z points, a fill, a stroke (width, colour, cap) or both: art and icons |
| `clip` / `unclip` | everything between is cut off outside the polygon (each page is clipped to its own box) |

An outlined box is four lines with squared ends, so its corners are filled and each side takes its own direction's line weight. A
book page is laid out by `layoutPage` with its top-left corner where it goes on the sheet (so the creep and the fore-edge shift are
layout); the half-letter sheets of a two-up page are laid out one above the other, with their labels and the cut marks. The screen draws
a page from the same model (`src/render.ts`) with no printer correction; the layout stage is the print side of that, and with no
correction it is that page.

## 2. Printer

`correct(items, transform, sheetWidth, sheetHeight, lineWeight)` applies one side's correction (`transformOf` in `sheets.ts`): the **scale
per axis** about the sheet's centre, the **rotation** (the back only) about it, and the **offset**. It moves **positions only**, and it
**places** items rather than turning them. Every position lands where `mapPoint(transform, w, h, p)` says, but each item goes there by its
centre and keeps its own shape:

* a **line** is placed at its rotated midpoint; a horizontal or vertical line stays exactly horizontal or vertical, an angled one keeps
  its angle, and the length is the same (times the scale);
* a **rect** is placed at its rotated centre and stays axis-aligned; so is an **image** (its pixels are never turned by the printer, only by the design's own `rotate`);
* a **text** anchor moves; the glyphs stay upright (no rotation in the text matrix) and keep the rotation the design gave them;
* **dots** each move to their rotated centre, round and the same size;
* a **path** (art, icons) is placed at the rotated centre of its points, not turned; clip polygons likewise.

Why: the back's rotation is tiny (at most 1.5°), but a printer draws a slightly turned line as a long staircase, which shows as blotchy
thin lines. Turning where things are, not what they are, keeps every line a clean horizontal or vertical. Within one page the rotation
therefore shifts items slightly relative to each other (at most 0.0032 rad × the distance, about 0.2 mm across a page) instead of turning
the page as a whole.

* **never** widths, dot diameters, font sizes or glyph shapes are scaled. A printer that stretches one axis moves where things go and how
  far apart; it does not make lines in one direction thicker, dots oval or letters tall.

With a scale of 100 % and no rotation the list is the layout list moved by the offset.

One width can change, on purpose: the **line weight along the 8.5 in edge** (`line_weight_x_pct` of the layout). A stroke's width is
multiplied by `1 + (p − 1) · cos²θ`, where *p* is the setting as a factor and θ the stroke's angle to the 8.5 in edge: a
stroke along it by *p*, a stroke across it by 1, in between by angle. Dots, text, fills and paths are unaffected. It is for a printer that
draws lines in one direction thicker; the calibration sheet's line pairs show it.

## 3. PDF

`drawItems(pdf, items, fonts, sheetHeight)` draws the list as it is: PDF y-up points, real text. Dot lattices are written once per distinct
shape as a form (`dotset`: round, unscaled dots at the corrected positions, written to 0.01 pt) and placed on every page that has it, so a
52-page dot grid book stays under 1 s and 500 KB. The key of a form includes the side's scale and rotation, so the front and the back each
get one form for a pattern.

`pages.pdf` (the digital pages at final size) goes through layout and PDF with no printer stage.

## Plugging in another page size

A different page size changes what the layout stage produces (where the pages sit on the sheet, the grid, the margins), and the sheet
sizes in `sheetSize`. The printer and PDF stages work on display lists and a sheet size and need no change.
