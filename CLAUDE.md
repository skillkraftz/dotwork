# Dotwork

A web app for designing pocket notebook pages and books on a 3 mm grid, then
exporting them ready to print and bind at home. People design single pages
and two-page spreads, save them to a library, arrange them into a 52-page
book, and export print-ready PDFs.

Part of Bound for Success, the owner's pocket journal system. It must be able
to recreate every page the owner has already made (see `reference/`) and
almost anything else he can think up, without becoming complicated. Keep it
simple enough for him to read and tweak, and polished enough to show
customers later.

## The sister project

`journal-system` (a separate Python repo) generates the owner's dated books
in bulk. Both projects share the page format in `docs/page-format.md`; it is
the contract, so change it only on purpose and bump its version when you do.
Dotwork's print export follows the same physical rules as journal-system
(below), so a book from either prints and binds the same way.

## The physical book (the design must respect this)

- Final page: 3.5" x 5.5" (88.9 x 139.7 mm).
- **The grid is 27 x 44 cells at 3 mm, centered on the page**, starting 3.95
  mm from the left edge and 3.85 mm from the top. The space around it is the
  page margin; nothing prints there.
- **Row 0 is the header**, drawn by the software: page number in the top outer
  corner, the page's identity (for example "MON OCT 26") by the spine.
- Left and right pages: the spine is on the right of a left page and on the
  left of a right page. The outer corner is away from the spine.
- People write with 0.38 mm gel pens, so 3 mm is the smallest writing space.

## How books are printed (for the export stage)

- Paper is letter cut in half: 5.5" x 8.5" sheets, printed landscape with one
  spread per side.
- Each spread is centered on the sheet's fold. The outer 0.75" on each side is
  trimmed away after binding; the owner cuts 3.5" from the fold.
- Saddle-stitch page order, usually one signature of 13 sheets (52 pages);
  multiple signatures must work.
- **Creep**: inner sheets are pushed outward when nested, so shift each
  sheet's pages toward the fold by (sheets outside it) x paper thickness. The
  owner's printer and paper measured about 0.14 mm per sheet; make it a
  setting.
- **Manual duplex**: `print-first.pdf` holds every sheet's front in reverse
  order; the stack goes back in the tray the same way; `print-second.pdf`
  holds the backs in forward order. Keep this exactly. Add a back-side x/y
  offset setting for printers that shift on the second pass.
- Covers are printed separately, single-sided: inside front cover (a left
  page) and inside back cover (a right page) as one centered spread.
- journal-system implements all of this in `pocketjournal/imposition.py`. Match
  its behavior and test cases.

## Design language (match journal-system's pages)

- Font: Courier Prime (bundled, OFL). Labels about 6.5 pt so they fit in one
  3 mm row; headings about 9 pt; header identity bold, all caps.
- Black and grays only, for now. Writing lines and dots are light gray and
  thin; structure is black, thin (0.5 pt) or thick (1.5 pt). Shading comes in
  three light-to-dark tones. Color may come later, for keys and highlights.
- Quiet and dense: a lot of usable space in a little space.

## Tech choices

- Static web app: Vite + TypeScript, plain DOM and SVG, no backend. Deploys to
  GitHub Pages.
- Pages render as SVG in millimeters so the screen, the PNG and the PDF match.
- Drafts and the library live in the browser (localStorage or IndexedDB). Files
  people export are the source of truth.
- Vitest for tests. Keep dependencies few.

## Working rules

- Build in stages; each task leaves the app working and deployable.
- Validate every file the app loads or exports against `docs/page-format.md`.
- Don't add features beyond the task. When a choice is unclear, take the
  simplest version and list the question in the PR.
- Include screenshots of UI changes in every PR.

## Roadmap

1. Single-page editor (done, format version 1).
2. Format version 2: layered elements, half-cell positions, shading, true
   page margins, recreations of the owner's pages (done).
3. Spreads and a library of saved pages and spreads.
4. Book arranger and print export (imposition, creep, manual duplex, covers).
5. Later: dials and other components, color, sharing, a page gallery.
