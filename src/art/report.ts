import { errorProblem, type Problem } from '../problems';
import { importSvg } from './import';
import { readImageFile } from './image';
import { artElement, imageElement } from './widget';
import type { Widget, WidgetStore } from '../widgets';

export type ArtFileResult =
  | { ok: true; widget: Widget; name: string; /** What was left out of the file, if anything. */ problem: Problem | null }
  | { ok: false; problem: Problem };

/** The art's name: the file's name without .svg, .png or .jpg. */
export const artName = (fileName: string) => fileName.replace(/\.(svg|png|jpe?g)$/i, '').replace(/[_]+/g, ' ').trim() || 'Art';

/** The name of art that comes with Dotwork: its file's name with the first letter capital and hyphens as spaces. */
export const builtinArtName = (id: string) => { const n = artName(`${id.replace(/-/g, ' ')}.svg`); return n[0].toUpperCase() + n.slice(1); };

/** Whether a file is a PNG or JPG picture rather than an SVG drawing (by its name or its type; the bytes are checked when it is read). */
export const isImageFile = (file: Pick<File, 'name' | 'type'>) => /\.(png|jpe?g)$/i.test(file.name) || /^image\/(png|jpeg)$/.test(file.type);

/** Read a PNG or JPG file into the saved art as an image, scaled down if it is bigger than 2400 px. */
async function importImage(file: File, widgets: WidgetStore): Promise<ArtFileResult> {
  const name = artName(file.name);
  const title = `Not imported: ${file.name}`;
  const r = await readImageFile(file);
  if (!r.ok) return { ok: false, problem: { title, lines: [r.reason], details: [title, r.reason].join('\n') } };
  try {
    return { ok: true, widget: await widgets.add(name, [imageElement(r.src, r.width_px, r.height_px)]), name, problem: null };
  } catch (err) { return { ok: false, problem: errorProblem(`Not imported: ${file.name} couldn’t be saved.`, err) }; }
}

/** Read an SVG, PNG or JPG file into the saved widgets as art. Says what was left out of an SVG, or why nothing was imported. */
export async function importArtFile(file: File, widgets: WidgetStore): Promise<ArtFileResult> {
  if (isImageFile(file)) return importImage(file, widgets);
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
  let widget: Widget;
  try { widget = await widgets.add(name, [artElement(r.art)]); } catch (err) {
    return { ok: false, problem: errorProblem(`Not imported: ${file.name} couldn’t be saved.`, err) };
  }
  if (!r.dropped.length) return { ok: true, widget, name, problem: null };
  const title = `Imported “${name}”. Left out of the file:`;
  return { ok: true, widget, name, problem: { title, lines: r.dropped, details: [title, ...r.dropped.map((d) => `- ${d}`)].join('\n') } };
}
