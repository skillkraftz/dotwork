# Dotwork

Dotwork is a web app for designing pocket notebook pages and books and printing them at home. A page is 3.5" x 5.5"
(88.9 x 139.7 mm) with a 27 x 44 grid of 3 mm cells; you draw pages and two-page spreads on that grid, keep them in a library, arrange
them into a book (52 pages by default, plus four covers), and export print-ready PDFs that you print on a home printer, fold, bind and trim.

It is part of Bound for Success, the owner's pocket journal system, and recreates every page he has already made (`reference/` holds
previews of them). It runs entirely in the browser: no backend, nothing leaves the device, and it works on a phone.

![The editor with the monthly tracker open](docs/screenshots/editor-monthly-tracker.png)

## What it does today

- **Design pages and spreads.** A page is a stack of layered elements on whole or half cells: pattern (lines, grid, dots), shade
  (three tones), box, rule, checkboxes, text, sequence (numbers, letters, lists, icons) and imported SVG art. Row 0 is the header the
  software draws (page number at the outer corner, the page's identity by the spine; leave the identity empty to draw there). Date tokens
  such as `{weekday}` and `{day+1}` print the page's day, week or month in a book with a calendar (a book without one prints them blank). Tools are in a three-mode bottom bar (Select, Draw, Advanced); selection is by
  tap or drag-box, with groups, layers, a properties drawer, widgets (saved selections) and a help mode that explains any control.
- **Keep them in a Library.** Pages, spreads, sections (groups of blocks), books, widgets and art, with search, tabs, favorites and a
  backup file. It comes filled with every reference page, paired spreads, starter widgets, sections and book templates; built-ins can't be
  changed, only copied.
- **Arrange a book.** A book is an **outline**: a list of blocks (a page, a spread, free pages, or a group that repeats its contents), each
  repeated a number of times or filling what is left, and optionally pinned to a page such as the last. The Book view shows the outline as rows
  with the live total ("48 of 52 pages", red when it is over, with **Make the book N pages**), Up / Down, Duplicate, Delete and moving a block
  into or out of a group; spreads always start on a left page, with a gap page where needed. It shows the pages it makes one at a time (or an
  opening), covers included, and flips through the result. A book from before the outline is listed in the Library as Old format.
- **Print.** One zip with `pages.pdf`, the covers (`cover-outside.pdf`, `cover-inside.pdf`), and print-ready files for manual duplex
  (`print-first.pdf` reversed, then `print-second.pdf`; `print-duplex.pdf` for a printer that duplexes itself), on half letter or two books
  per letter sheet, with creep, fore-edge shifts, `preview.png` and a `summary.txt`. A **Calibrate** wizard makes a calibration sheet and a creep
  test and turns your readings into the printer profile (offsets, rotation, scale, tones). The printer profile lives in the browser and
  is never part of a book.
- **Export** the open page, spread or book as JSON, a page or spread as PNG (150, 300 or 600 dpi), and import JSON back.
- **Phone first.** Everything works by touch at 390 x 844 and up (44 px targets, no hover, keyboard or drag-and-drop required); keyboard and
  mouse shortcuts are extras. A web manifest lets you add it to the home screen.

![Phone: selection above the properties sheet](docs/screenshots/mobile/phone-selection-above-sheet.png)

Work saves itself in the browser. The page, spread or book you are editing *is* a document in the Library (IndexedDB) and is written after each
change (a "Saved" mark says so); there is no Save button. Opening another document writes the current one first and replaces nothing. A
browser that can't keep documents (no IndexedDB, a private window) is told so at the top. Widgets and art are Library documents too. Favorites and
the printer profile are in `localStorage`. **Back up library** saves all of it in one file and **Restore backup** only ever adds. Exported files are the source of truth.
[docs/product-map.md](docs/product-map.md) lists every screen, store and rule as the code has them.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest): formats, geometry, rendering, imposition, PDF, library
npm run test:e2e   # drives the app in headless Chromium at phone, tablet and desktop sizes
npm run build      # type-checks, then builds to dist/
```

Every push to `main` runs `.github/workflows/deploy.yml`, which tests, builds and publishes `dist/` to GitHub Pages (one-time setup:
Settings > Pages > Source: GitHub Actions). The build uses relative paths, so it works under `https://<user>.github.io/<repo>/`.

## Where things are

| | |
|---|---|
| `src/` | The app (TypeScript, plain DOM and SVG). `format/` the page format, `book/` books and imposition, `print/` the PDFs, `library/`, `builtin/` pages, sections, templates in code, `help.ts` all help text |
| `examples/` | Page and spread files, widgets and art that ship in the Library; drop a file in and it appears ([examples/README.md](examples/README.md)) |
| `reference/` | Preview images of the owner's existing journal-system pages; `docs/screenshots/compare-*.png` set them beside Dotwork's export |
| `tests/` | Unit tests for rules and math; `tests/e2e/` one browser test per feature, at phone and desktop sizes; `tests/fixtures/` the owner's example books |
| `CLAUDE.md` | The project brief and working rules |

## Docs

| | |
|---|---|
| [docs/page-format.md](docs/page-format.md) | The page file (version 2) and tokens. Shared with journal-system, the sister Python project that generates dated books in bulk |
| [docs/book-format.md](docs/book-format.md) | The book file and its outline, the printer profile, the print files, sheet layouts and the calibration files |
| [docs/library-format.md](docs/library-format.md) | The library backup file, the section file and Old format |
| [docs/print-pipeline.md](docs/print-pipeline.md) | How the print files are made: layout, then the printer's positions-only correction, then the PDF |
| [docs/product-map.md](docs/product-map.md) | How the app works today, from the code |
| [docs/product-model.md](docs/product-model.md) | How it should work next |
| [docs/screenshots/](docs/screenshots/) | Phone, tablet and desktop screenshots, by feature |

## Where it's going

The next step is not more features but a simpler shape. [docs/product-model.md](docs/product-model.md) describes it. Done so far: every page, spread, section
and book is a document that saves itself, and a book is an outline of blocks (pages, spreads, groups) each with a repeat (×N, "fill what's left") and
an optional pin. A book may have a calendar, and blocks repeat "each day / week / month of the calendar" so dates are worked out, never typed; free pages hold designs of their own. The week block and the Monthly log are in. Next: pages stay linked
to their designs so a change can be brought into a book, with snapshots to go back; and the app is organised as Design, Plan and Print, sharing one
Library. A database comes after that.

## Fonts

Courier Prime (regular and bold) is bundled in `src/fonts/` under the SIL Open Font License 1.1; see `src/fonts/OFL.txt`. Line icons are
mostly from Lucide (ISC), see `src/icons/LICENSE.txt`.
