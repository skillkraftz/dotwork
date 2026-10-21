import type { Problem } from '../problems';
import { importSvg } from './import';
import { artElement } from './widget';
import type { Widget, WidgetStore } from '../widgets';

export type ArtFileResult =
  | { ok: true; widget: Widget; name: string; /** What was left out of the file, if anything. */ problem: Problem | null }
  | { ok: false; problem: Problem };

/** The art's name: the file's name without .svg. */
export const artName = (fileName: string) => fileName.replace(/\.svg$/i, '').replace(/[_]+/g, ' ').trim() || 'Art';

/** The name of art that comes with Dotwork: its file's name with the first letter capital and hyphens as spaces. */
export const builtinArtName = (id: string) => { const n = artName(`${id.replace(/-/g, ' ')}.svg`); return n[0].toUpperCase() + n.slice(1); };

/** Read an SVG file into the saved widgets as art. Says what was left out, or why nothing was imported. */
export async function importArtFile(file: File, widgets: WidgetStore): Promise<ArtFileResult> {
  const name = artName(file.name);
  let text: string;
  try { text = await file.text(); } catch (err) {
    const reason = `${file.name} couldn’t be read: ${(err as Error).message}`;
    return { ok: false, problem: { title: `Not imported: ${file.name}`, lines: [reason], details: reason } };
  }
  const r = importSvg(text);
  if (!r.ok) {
    const left = r.dropped.length ? [`Left out of the file: ${r.dropped.join(', ')}.`] : [];
    const title = `Not imported: ${file.name}`;
    return { ok: false, problem: { title, lines: [r.reason, ...left], details: [title, r.reason, ...left].join('\n') } };
  }
  const widget = widgets.add(name, [artElement(r.art)]);
  if (!r.dropped.length) return { ok: true, widget, name, problem: null };
  const title = `Imported “${name}”. Left out of the file:`;
  return { ok: true, widget, name, problem: { title, lines: r.dropped, details: [title, ...r.dropped.map((d) => `- ${d}`)].join('\n') } };
}
