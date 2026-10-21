import { artElement } from '../art/widget';
import { builtinArtName } from '../art/report';
import { importSvg } from '../art/import';
import { artProblems } from '../format/art';
import type { Art } from '../format/types';
import { slug } from '../slug';
import { makeWidget, type Widget } from '../widgets';
import { artFiles, artPresetFiles, fileId, skipped } from './examples';

/**
 * The art that comes with Dotwork: every .svg in examples/art, named after its file. A `<name>.json` beside an SVG can
 * list presets, `{ "presets": [{ "name": "Energy gauge", "fills": {...}, "strokes": {...} }] }`: the same art with
 * some of its named paths filled or lined differently, listed next to it.
 */
export function builtinArt(files: Record<string, string> = artFiles, presetFiles: Record<string, unknown> = artPresetFiles): Widget[] {
  const out: Widget[] = [];
  const presets = new Map(Object.entries(presetFiles).map(([path, raw]) => [fileId(path), [path, raw] as const]));
  for (const [path, text] of Object.entries(files)) {
    const id = fileId(path);
    const r = importSvg(text);
    if (!r.ok) { skipped(path, r.reason); continue; }
    const base = artElement(r.art);
    out.push(makeWidget(`builtin-art-${id}`, builtinArtName(id), [base]));
    const given = presets.get(id);
    const list = (given?.[1] as { presets?: unknown } | null)?.presets;
    if (given && !Array.isArray(list)) { skipped(given[0], 'a presets file is { "presets": [{ "name", "fills", "strokes" }] }.'); continue; }
    (list as { name?: unknown; fills?: Art['fills']; strokes?: Art['strokes'] }[] | undefined)?.forEach((p, i) => {
      const el: Art = { ...base, ...(p.fills ? { fills: p.fills } : {}), ...(p.strokes ? { strokes: p.strokes } : {}) };
      const problem = typeof p.name === 'string' ? artProblems(el as unknown as Record<string, unknown>)[0] : ['name', 'a preset needs a "name".'];
      if (problem) skipped(given![0], `preset ${i + 1}: ${problem[1]}`);
      else out.push(makeWidget(`builtin-art-${id}-${slug(p.name!.toString(), String(i + 1))}`, p.name!.toString(), [el]));
    });
  }
  return out;
}
