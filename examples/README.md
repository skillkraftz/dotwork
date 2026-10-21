# Examples

Everything in these folders ships with Dotwork and shows up in the Library on its own. Nothing is listed by name in
the code: add a file and it appears, take one out and it is gone. To add something you made, export it from Dotwork
and drop the file in the right folder.

| Folder | What goes in it | Shows up as |
|--------|-----------------|-------------|
| `pages/` | Page files (`dotwork-page`, see [docs/page-format.md](../docs/page-format.md)). The page's own `name` is its name. | Library > Pages, marked as an example. Opening one makes a copy. |
| `widgets/` | `{ "name": "Habit row", "elements": [ ... ] }`: page elements placed relative to each other (the first row is row 1). | Library > Widgets, and the Widgets button. |
| `art/` | SVG files. The file name is the art's name (`half-donut.svg` is "Half donut"). Give a shape an `id` (`id="needle"`) and each placement can change its fill or line. | Library > Art, and the Art button. |

Art can come with presets: a `.json` file with the same name as the SVG, listing the same art with some named paths
filled or lined differently. `art/gauge.json` makes the Engagement and Energy gauges from `art/gauge.svg`:

```json
{ "presets": [ { "name": "Engagement gauge", "fills": { "left-half": "none" }, "strokes": { "centre-line": "none" } } ] }
```

`fills` take `none`, `light`, `medium` or `dark`; `strokes` take `none`, `gray` or `black`.

A file that isn't valid is skipped (the console says which and why), and `npm test` fails on it.
Some built-in spreads and book templates use pages from `pages/` by name (Lined page, Dot grid page, Idea page, Daily Good Time Journal);
without them, those spreads are left out and the books use a notes page.
