# Dotwork

Dotwork is a small browser editor for designing the one-page layouts printed in
a dot-grid notebook. A page is a 27 x 44 grid of 3 mm cells (81 x 132 mm).
You draw rectangular regions on it (lined, dotted, grid, checkboxes, borders,
labels) and save the result as a JSON page file, described in
[docs/page-format.md](docs/page-format.md). Row 0 is reserved for the page
header (identity text by the spine, page number at the outer corner).

## Run locally

```sh
npm install
npm run dev      # editor at http://localhost:5173
npm test         # validator, geometry and history tests
npm run build    # type-checks, then builds to dist/
```

The current page autosaves to your browser's localStorage. Use Export JSON,
Import JSON and Export PNG (81 x 132 mm at 600 DPI) in the toolbar.
Example pages live in [examples/](examples/).

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which tests, builds
and publishes `dist/` to GitHub Pages. One-time setup: in the repository's
Settings > Pages, set Source to "GitHub Actions". The build uses relative
paths, so it works under `https://<user>.github.io/<repo>/`.

## Fonts

Courier Prime (regular and bold) is bundled in `src/fonts/` under the SIL Open
Font License 1.1; see `src/fonts/OFL.txt`.
