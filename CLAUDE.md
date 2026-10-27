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
  sheet's pages toward the fold by (sheets outside it) x creep per sheet. In a
  thick book the round spine uses up paper, so creep per sheet is about 1.5x
  the paper's thickness (the owner's paper is about 0.16 mm; the creep test
  says about 0.30). It is a setting, found by the creep test, together with a
  fore-edge shift for the interior pages and one for the covers that put the
  trimmed fore-edge margin on a target (3.5 mm).
- **Manual duplex**: `print-first.pdf` holds every sheet's front in reverse
  order; the stack goes back in the tray the same way; `print-second.pdf`
  holds the backs in forward order. Keep this exactly. Add a back-side x/y
  offset setting for printers that shift on the second pass.
- Covers are printed separately, single-sided, as two centered spreads: `cover-outside.pdf` (outside back, a left page, and outside
  front, a right page; first pass) and `cover-inside.pdf` (inside front, a left page, and inside back, a right page; second pass).
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
- The open page, spread and book, and the saved widgets and art, are Library documents that save themselves (IndexedDB); favorites and the printer profile live in the browser's localStorage. Files
  people export are the source of truth.
- Vitest for unit tests (`npm test`) and, for end-to-end tests, Vitest driving headless Chromium through Playwright
  (`npm run test:e2e`). Keep dependencies few.

## Working rules

- Build in stages; each task leaves the app working and deployable.
- Validate every file the app loads or exports against `docs/page-format.md`.
- Pre-release: keep it lean. Dotwork isn't public and will move to a database later. Don't add
  format version bumps, migrations, conversions of old files, or new import/export options; when the format
  changes, update docs/page-format.md in place and let old drafts break. Spend the effort on what matters
  now: designing a page and laying out a book on a phone should be easy enough that someone can turn an idea
  into a finished book in 30-60 minutes. Build what covers 80% of what people want, simply; polish and edge
  cases come later.
- No back compatibility until the database. When the book, page or spread format changes, older files are not
  converted or read; the Library lists them as "Old format" with Export and Delete. No conversion code, no tests
  for old shapes. (Printer and calibration changes still never change the book format or stop a book from opening.)
- Tests: unit tests for rules and math that must be exactly right (reading files, tokens and dates, imposition and
  the print pipeline, calibration and creep math). One e2e test per feature for its main path, run at phone and
  desktop; tablet only for tests about a layout at that size. No tests for old file shapes or replaced behaviour;
  remove a feature's tests when the feature is removed. Don't add a test for every bug fixed unless the bug was in
  rules or math.
- The book file holds the design only. Printer and calibration settings live in the printer profile; changing them must never change the book format or stop a book from opening.
- Don't add features beyond the task. When a choice is unclear, take the
  simplest version and list the question in the PR.
- Every new control gets a help entry with touch and desktop text; the help test enforces it.
- Include screenshots of UI changes in every PR.
- Mobile first. Dotwork must be fully usable on a phone (390 x 844) and a
  tablet, not just on a desktop. On every screen, the page being designed gets
  most of the space. Nothing may depend on a keyboard, a mouse hover, Alt or
  Shift, double-click, or HTML drag-and-drop; those can stay as desktop
  shortcuts, but every action needs a visible touch control too. Touch targets
  are at least 44 px. Test every UI change at phone, tablet and desktop sizes,
  with touch emulation, and include screenshots of all three in the PR.

## Docs

`README.md` says what the app is and how to run it. `docs/product-map.md` is how it works today (every screen, store and rule, read from the code);
`docs/product-model.md` is how it should work next, as decisions in phases; `docs/page-format.md`, `docs/book-format.md`,
`docs/library-format.md` and `docs/print-pipeline.md` are the formats and the print pipeline. When a change makes one of these wrong, fix it in the
same PR. Where the code and a doc disagree, the code is right and the doc is a bug.

## How to finish a task

- Run the full unit suite, then the full e2e suite. Fix failures; re-run only the failing files until they pass, then run
  both full suites once more at the end. A test that fails only in the full run is not "a flake" until it has failed and
  passed again in a second full run; say what happened.
- Never invent a stand-in for a file the owner says they attached. If it's missing, say so at the start, skip only what
  depends on it, and list it in the PR.
- Screenshots go in `docs/screenshots/` and are committed; nothing stays in a scratch folder. Take them after the last UI
  change.
- Last step, always: commit, push, open the PR (`gh pr create`, or the GitHub tool when `gh` isn't installed), and end your
  final message with the PR's URL. If opening it fails, quote the error.

## Roadmap

1. Single-page editor (done, format version 1).
2. Format version 2: layered elements, half-cell positions, shading, true
   page margins, recreations of the owner's pages (done).
3. Spreads and a library of saved pages and spreads (done).
4. Book arranger and print export (imposition, creep, manual duplex, covers)
   (done).
5. Mobile-first editor: phone and tablet layout, touch controls, home-screen
   install (done).
7. Touch gestures: nothing happens on touch-down, tap selects, one finger pans unless
   it drags the selection, action bar beside the selection, properties and layers
   in a modal (done).
8. Help mode (tap anything to see what it does; all text in `src/help.ts`) and reliable typing on
   phones: in-place panel, steppers for every number, keyboard-aware layout (done).
9. Pattern backgrounds (replaced in 10 by the Shade element), the Advanced picker, sequences, icons and saved
   widgets, with multi-select (done).
10. Editing overhaul: three-mode bottom bar, drag-select, forgiving taps, groups, properties drawer, Shade tones, pattern
    line weights (done).
11. Navigation overhaul: Page, Edit and Export menus, a settings window, a library browser with search, tabs and favorites, one import/export window, drawable header row when the identity is empty (done).
12. Rotated sequence items, date tokens with day offsets and {months}, dates on book pages, and one Download for
    pages.pdf, the covers and the print files (done).
13. Built-in library: every reference page, paired spreads, starter widgets, and book templates (year planner,
    monthly journal, blank, lined, dot grid and idea books); built-ins can't be overwritten (done).
14. Printer calibration: a Calibrate page and calibration PDF set, printer tone settings (later moved to the printer profile), settings
    listed in summary.txt (done).
15. Local-date fixes, dates that travel with their pages, a section repeated for each week of a month with a recipe to rebuild
    it for another month (now the "Weekly journal" preset of builder steps), and Flip through (done).
16. Sections (a Library item made from a run of book pages, with how its dates move) and the book builder (steps that
    repeat sections: a number of times, each week of a month, or fill what's left; Build by week is now a preset of
    steps), Flip through at 1 s by default, the Good Time page matched to its reference, and a Book bar that fits a phone
    (done).
17. Printing two books per letter sheet (Letter, two-up, with print-duplex.pdf, cut marks and labels), a layout picker with offsets
    and scale kept per layout, a Size step in Calibrate, and the outside covers (cover-outside.pdf, cover-inside.pdf) (done).
18. Books hold the design only (every printer and calibration setting is in the printer profile, so old books always open), one double-sided calibration sheet per layout with a back rotation and a scale per paper edge, and the outside covers in preview.png and Flip through (done).
19. Print pipeline in stages (layout, then the printer's positions-only correction, then the PDF), so a stretched sheet never stretches lines, dots or glyphs; line weight by direction with a pairs-and-ladder block on the calibration sheet; the 3 mm edge check as a warning; fold twist readout (done; see `docs/print-pipeline.md`).
20. The product model (`docs/product-model.md`): documents that save themselves, a book as an outline of repeated blocks with a
    calendar, links to designs and book versions, the Design / Plan / Print areas, then a database (planned, in ten phases; phases 1 to 4
    and 5a are done: self-saving documents, the full backup, token units, and the undated outline).
21. Later: dials and other components, color, sharing, a page gallery.
