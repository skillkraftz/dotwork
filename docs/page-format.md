# Dotwork page format, version 1

A page file describes one page layout as rectangular regions on the 3 mm grid.
Dotwork writes these files and journal-system reads them, so both projects
follow this document.

## Example

```json
{
  "format": "dotwork-page",
  "version": 1,
  "name": "Daily log",
  "identity": "{weekday} {month} {day}",
  "grid": { "cols": 27, "rows": 44, "pitch_mm": 3 },
  "regions": [
    {
      "x": 0, "y": 1, "w": 27, "h": 5,
      "fill": "lines",
      "border": { "bottom": "thin" },
      "labels": [{ "text": "Activity:", "row": 0 }]
    },
    {
      "x": 0, "y": 6, "w": 27, "h": 38,
      "fill": "dots"
    }
  ]
}
```

## Top level

| Field      | Type   | Required | Meaning |
|------------|--------|----------|---------|
| `format`   | string | yes      | Always `"dotwork-page"`. |
| `version`  | number | yes      | `1` for this document. |
| `name`     | string | yes      | The design's name, shown in libraries and menus. |
| `identity` | string | no       | Header text drawn by the spine. May contain tokens. Empty or missing means no identity. |
| `grid`     | object | yes      | Always `{ "cols": 27, "rows": 44, "pitch_mm": 3 }` in version 1. |
| `regions`  | array  | yes      | The regions, in drawing order. May be empty. |

## Coordinates

- Units are grid cells. `x` counts columns from the left (0-26) and `y` counts
  rows from the top (0-43).
- **Row 0 is the header row.** No region may include it, so every region has
  `y >= 1`.
- A region must fit inside the grid: `x + w <= 27` and `y + h <= 44`, with
  `w` and `h` at least 1.
- **Regions may not overlap** in version 1.
- Cells that no region covers print blank.
- Layouts are not mirrored: the same layout is used on left and right pages.

## Regions

| Field    | Type   | Required | Meaning |
|----------|--------|----------|---------|
| `x`, `y`, `w`, `h` | integers | yes | Position and size in cells. |
| `fill`   | string | yes      | What fills the region (see below). |
| `border` | object | no       | Edges to outline: `top`, `bottom`, `left`, `right`, each `"thin"` or `"thick"`. Missing edges get no line. |
| `labels` | array  | no       | Small text labels (see below). |

### Fill types

| Fill         | What prints |
|--------------|-------------|
| `blank`      | Nothing. |
| `lines`      | Light gray horizontal writing lines on the row boundaries inside the region, 3 mm apart. The region's top edge gets no line (it is the region's border or the edge above). |
| `vlines`     | The same, vertical. |
| `grid`       | Both horizontal and vertical light gray lines. |
| `dots`       | A light gray dot on every grid intersection inside the region, including its edges. |
| `checkboxes` | A small square in the first column of every other row, starting at the region's first row, with light gray writing lines across the rest of the region. |

## Labels

| Field      | Type   | Required | Meaning |
|------------|--------|----------|---------|
| `text`     | string | yes      | The label text. May contain tokens. |
| `row`      | integer| no       | Row within the region (0 = the region's first row). Default 0. |
| `align`    | string | no       | `"left"` (default) or `"right"`. Right-aligned labels are drawn as gray hints. |
| `vertical` | boolean| no       | `true` draws the label rotated, reading bottom to top, down the region's first column. Default `false`. |

Labels use Courier Prime at label size (about 6-7 pt), gray, regular weight,
sitting on their row's writing line.

## Tokens

Tokens are replaced with real values when a page is printed for a specific
date or page. Dotwork shows them with sample values in previews.

| Token        | Example   |
|--------------|-----------|
| `{weekday}`  | `MON`     |
| `{month}`    | `OCT`     |
| `{monthname}`| `OCTOBER` |
| `{day}`      | `26`      |
| `{year}`     | `2026`    |
| `{week}`     | `44`      |

Identities print in all caps. An unknown token is an error, not literal text.

## Validation

A reader must reject a file that has the wrong `format`, an unknown `version`,
a region outside the grid or in row 0, overlapping regions, an unknown fill
type, or an unknown token, and say which rule failed.
