# Dotwork

Dotwork is a small browser editor for designing the pages of a pocket
notebook. A page is 3.5" x 5.5" (88.9 x 139.7 mm) with a 27 x 44 grid of 3 mm
cells centered on it; the space around the grid is the margin and nothing prints
there. You build a page from layered elements (pattern, box, rule,
checkboxes, text, sequence) placed on whole or half cells, and save it as a JSON page
file, described in [docs/page-format.md](docs/page-format.md) (version 2).
Row 0 is reserved for the page header: the page number at the outer corner and
the identity by the spine. Version 1 files are converted when imported.

![The editor with the monthly tracker open](docs/screenshots/editor-monthly-tracker.png)

## Using the editor

- **Tools** (bottom bar on a phone, toolbar on a desktop, or the keys V P B R C T A): select, advanced, pattern, box,
  rule, checkboxes, text. Drawing snaps to whole cells; hold **Shift** or tick
  **Half cells** to snap to half cells.
- **Select** by clicking (the topmost element under the pointer); **Alt-click**
  again to step down to the ones beneath. Drag to move, drag the handles to
  resize, use the arrow keys to nudge one cell (Shift: half a cell).
  **Ctrl/Cmd+D** duplicates; Delete removes; Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z
  undo and redo everything.
- **Pattern** is also how you shade: it has a background (none, light, medium or dark, optionally every other
  row or column) under its lines, grid or dots, and a pattern of "none" gives a plain shaded area.
- **Advanced** (the tool next to Select, or the key A) opens a list of widgets: **Sequence** (numbers, letters, a
  repeating list or icons, one per cell, down or across), **Icon** (about 60 line icons from a big tappable grid,
  placed at 1 or 2 cells), and your **saved widgets**.
- **Several at once**: on a touch screen tap **Select more** in the bar beside the selection, then tap the others;
  with a mouse Shift-click, or drag a box around them. A selection moves, copies and deletes together, and
  **Save widget** keeps it (with a name) under Advanced to place on any page. Placing adds ordinary copies, with
  no link back. Widgets are kept in the browser, beside the library.
- **Layers** lists every element from top (drawn last) to bottom. Select, hide,
  lock, delete, and reorder with the arrows or by dragging a row. Hiding and
  locking are for editing only; they are not saved in the file.
- **Properties** shows every field of the selected element. A value that would
  break the format is refused, with the reason.
- **Page** holds the name, the identity (tokens such as `{weekday}` allowed) and
  the side: the spine and header are drawn on the correct side.

## On a phone or tablet

The same app is laid out for touch below 1000 px wide: a one-row top bar (Page /
Spread / Book, Undo, Redo, and a menu holding Library, New, examples, import and
export, Preview and Help), the page filling the screen, and the tools along the
bottom (including a **Half** toggle that replaces holding Shift).

![Phone: selection above the properties sheet](docs/screenshots/mobile/phone-selection-above-sheet.png)

- **Pinch** to zoom, **two fingers** to pan, the **Fit** button to bring the
  whole page back.
- Selecting an element opens the **bottom sheet** (properties with nudge arrows
  for a cell or half a cell; tabs for Layers and Page). Pull the grip up or
  swipe it down; the page scrolls so the selection never hides under it.
- **Long-press** an element for duplicate, delete, bring forward, send backward
  and select the one underneath. Resize handles are finger-sized.
- **Spread** edits one page at a time (Left / Right, or swipe over an empty
  part of the page); **View spread** shows the pair as it will look open.
- Library and print-file windows are full-screen sheets; on a phone the print
  files download as one zip.
- A web app manifest and icon let you add Dotwork to the home screen.

Screenshots for phone, tablet and desktop are in
[docs/screenshots/mobile/](docs/screenshots/mobile/).

## Run locally

```sh
npm install
npm run dev      # editor at http://localhost:5173
npm test         # validator, conversion, geometry, history, rendering, imposition and PDF tests
npm run build    # type-checks, then builds to dist/
npm run test:e2e # drives the app in headless Chromium at phone, tablet and desktop sizes
```

The current page autosaves to your browser's localStorage. Use Export JSON,
Import JSON and Export PNG (the whole 88.9 x 139.7 mm page at 600 DPI) in the toolbar.
Example pages live in [examples/](examples/); the monthly tracker, daily Good
Time Journal, idea and weekly pages recreate journal-system's pages. Compare
them with `reference/` in [docs/screenshots/](docs/screenshots/)
(`compare-*.png`: reference on the left, Dotwork's export on the right).

## Books and print files

The **Book** view arranges a book (52 pages by default; the count is a setting,
rounded to a multiple of 4) as spreads, the way it opens: the inside front cover
beside page 1, pages 2 and 3, and so on to the last page beside the inside back
cover.

![The book builder on a phone](docs/screenshots/book/phone-book-empty.png)

- The book is shown **one page at a time**, large. Use the arrows (or swipe, or
  the arrow keys) to step through the inside front cover, pages 1 to N and the
  inside back cover. **Spreads** shows the current opening side by side; tap a
  page in it to pick that page.
- **Choose design…** opens a picker of large, named thumbnails: Blank, your saved
  pages, saved spreads (on a left page; a spread fills this page and the next)
  and the built-in examples. Choosing one places it on this page.
- **Apply to more pages…** copies this page's design to pages __ to __, every
  page from here to __, or every left or right page in a range. It lists the
  pages that will change before you apply. **Clear** blanks this page and
  **Undo** steps back.
- **Contents** lists every page with its design and a thumbnail; tap a row to
  jump there. Runs of the same design fold into one row ("Pages 5–30") that
  expands on tap. On a phone it opens from the **Contents** button.
- **Page numbers** are on by default, in each page's outer top corner. Date
  tokens (`{weekday}` and so on) print blank so the date can be written in.
- **Book settings**: paper thickness for creep (0.14 mm), the back-side offset
  (x and y, for printers that shift on the second pass) and the number of
  signatures. A creep that would cross the fold is refused with the reason.
- **Export print files** builds `pages.pdf`, `print-first.pdf` and
  `print-second.pdf` (one pair per signature), `cover.pdf`, a `preview.png`
  contact sheet and a `summary.txt`, and offers them one by one or as a zip.
  Text stays real text in the embedded Courier Prime and lines stay vector.

![The print files](docs/screenshots/book-export.png)

A book is saved to the Library beside pages and spreads, and **Export JSON** /
**Import JSON** read and write it as a file; the format and the print files are
described in [docs/book-format.md](docs/book-format.md). The imposition is a
port of journal-system's `pocketjournal/imposition.py`, tested with the same
cases. Print each signature the way it says in `summary.txt`: `print-first.pdf`,
put the stack back in the tray the same way, then `print-second.pdf`.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which tests, builds
and publishes `dist/` to GitHub Pages. One-time setup: in the repository's
Settings > Pages, set Source to "GitHub Actions". The build uses relative
paths, so it works under `https://<user>.github.io/<repo>/`.

## Fonts

Courier Prime (regular and bold) is bundled in `src/fonts/` under the SIL Open
Font License 1.1; see `src/fonts/OFL.txt`.
