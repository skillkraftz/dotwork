# Dotwork

A web app for designing notebook page layouts on a 3 mm dot grid. People drag
out regions between dots, choose what fills each one (lines, dots, grid,
checkboxes, blank), add small labels, and export the page as a JSON file. A
separate project, `journal-system` (the Python generator), reads those files
and prints them into real bound pocket notebooks.

This is part of Bound for Success, a pocket journal system the owner is
building. Keep it simple enough for him to read and tweak, and polished enough
to show customers later.

## How the two projects fit together

- **Dotwork** (this repo) designs pages. Its output is a page file in the
  format described in `docs/page-format.md`. That document is the contract;
  change it only on purpose, and bump its version when you do.
- **journal-system** (a separate repo) handles everything about printing:
  imposition, creep, page numbers, duplex files, binding. It will gain a page
  type that reads Dotwork files. Dotwork never needs to know about printing.

## The physical page (the design must respect this)

- Final page: 3.5" x 5.5" (88.9 x 139.7 mm), trimmed by hand from a folded
  half-letter sheet.
- Margins are 3 mm on all sides. Inside them is a centered grid of
  **27 x 44 cells at 3 mm pitch**. Every region snaps to whole cells.
- **Row 0 is reserved for the page header**, which the generator draws: page
  number in the top outer corner, the page's identity (for example "MON OCT 26"
  or "IDEA") by the spine. A layout supplies the identity text only; it never
  draws in row 0.
- People write with 0.38 mm gel pens, so 3 mm is the smallest line spacing.

## Design language (match journal-system's pages)

- Font: Courier Prime (bundle it; OFL license). Labels about 6-7 pt so they fit
  in one 3 mm row; header identity bold, about 9 pt.
- Black and grays only. Writing lines and dots are light gray and thin;
  structural borders are black, thin (0.5 pt) or thick (1.5 pt).
- Labels are small, gray, regular weight, tucked in a corner of their region,
  and may run vertically to save space. All-caps for header identities.
- The look should be quiet and dense: a lot of usable space in a little space.

## Tech choices

- Static web app: Vite + TypeScript, no backend. It must deploy to GitHub
  Pages.
- Render the page as SVG in millimeters, so the on-screen preview and the
  exported files match the printed result.
- Save drafts in localStorage; the source of truth is the exported JSON file.
- Vitest for tests. Keep dependencies few.

## Working rules

- Build in stages. Each task should leave the app working and deployable.
- The page format in `docs/page-format.md` is the contract with
  journal-system. Validate every file the app loads or exports against it.
- Don't add features beyond the task. When a choice is unclear, take the
  simplest version and list the question in the PR description.
- Include screenshots of UI changes in every PR.

## Roadmap (later stages, not now)

1. Single-page editor and the page format (first task).
2. Page library: many saved pages, thumbnails, duplicate, rename.
3. Tokens preview: show `{day}`, `{date}` and similar fields with sample dates.
4. Components: the Engagement/Energy dials, checkbox columns with keys.
5. Book composer: arrange pages into a 52-page book, export a journal-system
   recipe.
6. Sharing and a community page gallery.
