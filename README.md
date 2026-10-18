# Dotwork

Dotwork is a small browser editor for designing the pages of a pocket
notebook. A page is 3.5" x 5.5" (88.9 x 139.7 mm) with a 27 x 44 grid of 3 mm
cells centered on it; the space around the grid is the margin and nothing prints
there. You build a page from layered elements (shade, pattern, box, rule,
checkboxes, text) placed on whole or half cells, and save it as a JSON page
file, described in [docs/page-format.md](docs/page-format.md) (version 2).
Row 0 is reserved for the page header: the page number at the outer corner and
the identity by the spine. Version 1 files are converted when imported.

![The editor with the monthly tracker open](docs/screenshots/editor-monthly-tracker.png)

## Using the editor

- **Tools** (toolbar, or the keys V S P B R C T): select, shade, pattern, box,
  rule, checkboxes, text. Drawing snaps to whole cells; hold **Shift** or tick
  **Half cells** to snap to half cells.
- **Select** by clicking (the topmost element under the pointer); **Alt-click**
  again to step down to the ones beneath. Drag to move, drag the handles to
  resize, use the arrow keys to nudge one cell (Shift: half a cell).
  **Ctrl/Cmd+D** duplicates; Delete removes; Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z
  undo and redo everything.
- **Layers** lists every element from top (drawn last) to bottom. Select, hide,
  lock, delete, and reorder with the arrows or by dragging a row. Hiding and
  locking are for editing only; they are not saved in the file.
- **Properties** shows every field of the selected element. A value that would
  break the format is refused, with the reason.
- **Page** holds the name, the identity (tokens such as `{weekday}` allowed) and
  the side: the spine and header are drawn on the correct side.

## Run locally

```sh
npm install
npm run dev      # editor at http://localhost:5173
npm test         # validator, conversion, geometry, history and rendering tests
npm run build    # type-checks, then builds to dist/
```

The current page autosaves to your browser's localStorage. Use Export JSON,
Import JSON and Export PNG (the whole 88.9 x 139.7 mm page at 600 DPI) in the toolbar.
Example pages live in [examples/](examples/); the monthly tracker, daily Good
Time Journal, idea and weekly pages recreate journal-system's pages. Compare
them with `reference/` in [docs/screenshots/](docs/screenshots/)
(`compare-*.png`: reference on the left, Dotwork's export on the right).

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which tests, builds
and publishes `dist/` to GitHub Pages. One-time setup: in the repository's
Settings > Pages, set Source to "GitHub Actions". The build uses relative
paths, so it works under `https://<user>.github.io/<repo>/`.

## Fonts

Courier Prime (regular and bold) is bundled in `src/fonts/` under the SIL Open
Font License 1.1; see `src/fonts/OFL.txt`.
