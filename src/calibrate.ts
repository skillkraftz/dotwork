import { h } from './panel';
import { errorProblem, problemView, type Problem } from './problems';
import { zip } from './print/zip';
import { withBookJson } from './print/bundle';
import type { ExportedFile } from './print/export';
import { loadFontBytes } from './print/fonts';
import { creepResult, creepSheets } from './book/creep';
import { offsetsFromReadings, type SideReadings } from './book/alignment';
import { GRID_X_MM, GRID_Y_MM } from './format/types';
import { PRINT_LIMITS, type Book } from './book/book';
import type { PrintSettings } from './book/impose';
import { printField } from './settings';
import { slug } from './slug';
import type { PrinterSettings } from './printer';

/** What the Calibrate wizard needs from the editor around it. */
export interface CalibrateHost {
  book(): Book;
  editBook(change: (book: Book) => void): void;
  download(blob: Blob, filename: string): void;
  /** The printer's saved settings (see printer.ts): save what the owner enters here, so new books start from them. */
  printer: { saved(): PrinterSettings | null; save(print: PrintSettings): Problem | null };
}

/** The tip for step 1, and for summary.txt: a printer's own quality setting decides how well the lines line up. */
export const QUALITY_TIP = 'Print at your printer’s best quality. Firefox may not use the quality set in the printer’s own defaults, and normal quality feeds the paper too fast and misaligns lines. Check the quality in the print dialog’s printer options, or set the default in CUPS (localhost:631) on Linux.';

const STEPS = ['Alignment', 'Creep and cover', 'Check'] as const;
const OFFSETS = ['front_offset_x_mm', 'front_offset_y_mm', 'back_offset_x_mm', 'back_offset_y_mm'] as const;
const OFFSET_NAMES: Record<(typeof OFFSETS)[number], string> = { front_offset_x_mm: 'Front x', front_offset_y_mm: 'Front y', back_offset_x_mm: 'Back x', back_offset_y_mm: 'Back y' };

/** A typed number, or null for an empty or unreadable box. */
const num = (text: string): number | null => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text));
const mm = (v: number) => `${Math.round(v * 100) / 100}`;

/**
 * The Calibrate wizard: one step at a time, Back and Next, each step with a short instruction, its download, the readings to
 * enter and the result. Whatever it changes is also saved as the printer's settings.
 */
export class CalibrateDialog {
  private dialog: HTMLDialogElement;
  private body = h('div', { class: 'export-body calibrate-body' });
  private status = h('p', { class: 'lib-msg', role: 'status', hidden: true });
  private progress = h('p', { class: 'cal-progress', 'data-key': 'calibrate-progress' });
  private back = h('button', { type: 'button', 'data-key': 'calibrate-back', 'data-help': 'calibrate-back' }, 'Back');
  private next = h('button', { type: 'button', class: 'primary', 'data-key': 'calibrate-next', 'data-help': 'calibrate-next' }, 'Next');
  private step = 0;
  // What was typed. Kept as text so a half-typed number isn't lost when a result is redrawn.
  private read = { front: { fold: '', top: '', bottom: '' }, back: { fold: '', top: '', bottom: '' }, cover: '', outermost: '', innermost: '', fore: '', top: '', bottom: '' };
  /** The offsets the alignment sheet was printed with (they are in its footer): a reading is relative to them. */
  private printed: Pick<PrintSettings, (typeof OFFSETS)[number]> | null = null;

  /** `done` runs when the wizard is closed (the export window reopens). */
  constructor(private host: CalibrateHost, private done: () => void) {
    this.back.onclick = () => this.go(this.step - 1);
    this.next.onclick = () => this.go(this.step + 1);
    this.dialog = h('dialog', { class: 'library calibrate', 'aria-label': 'Calibrate your printer' },
      h('header', {}, h('h2', {}, 'Calibrate your printer'), h('button', { type: 'button', 'data-help': 'calibrate-close', onclick: () => this.dialog.close() }, 'Done')),
      this.status,
      this.progress,
      this.body,
      h('div', { class: 'cal-nav' }, this.back, this.next)) as HTMLDialogElement;
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    this.dialog.addEventListener('close', () => this.done());
    document.body.append(this.dialog);
  }

  get isOpen() { return this.dialog.open; }

  show() {
    this.status.hidden = true;
    this.go(0);
    if (!this.dialog.open) this.dialog.showModal();
  }

  private go(step: number) {
    this.step = Math.min(STEPS.length - 1, Math.max(0, step));
    this.progress.textContent = `Step ${this.step + 1} of ${STEPS.length}: ${STEPS[this.step]}`;
    this.back.disabled = this.step === 0;
    this.next.disabled = this.step === STEPS.length - 1;
    this.body.replaceChildren(...[() => this.alignment(), () => this.creep(), () => this.check()][this.step]());
    this.body.scrollTop = 0;
  }

  // ---- shared bits ----------------------------------------------------------

  private say(problem: Problem | string | null) {
    this.status.hidden = problem === null;
    this.status.replaceChildren(...(problem === null ? [] : [typeof problem === 'string' ? h('span', {}, problem) : problemView(problem)]));
  }

  /** Change the book, and keep the same settings as the printer's. A browser that won't store them is told, with its reason (returned, and shown). */
  private change(change: (b: Book) => void): Problem | null {
    this.host.editBook(change);
    const problem = this.host.printer.save(this.host.book().print);
    this.say(problem);
    return problem;
  }

  private field(key: Parameters<typeof printField>[2]) {
    return printField(() => this.host.book(), (c) => this.change(c), key);
  }

  /** A number box for a reading. `set` gets the typed text; `result` is redrawn after every change. */
  private reading(label: string, help: string, value: string, set: (text: string) => void, result: () => void): HTMLElement {
    const input = h('input', { type: 'number', value, step: 0.1, inputmode: 'decimal', 'aria-label': label, 'data-key': help, 'data-help': help });
    input.oninput = () => { set(input.value); result(); };
    return h('label', { class: 'compact' }, label, input);
  }

  private button(label: string, key: string, onclick: () => void | Promise<void>, primary = true) {
    const b = h('button', { type: 'button', class: primary ? 'primary' : '', 'data-key': key, 'data-help': key }, label);
    b.onclick = async () => { b.disabled = true; try { await onclick(); } finally { b.disabled = false; } };
    return h('div', { class: 'export-actions' }, b);
  }

  /** Build files with `make` and hand them over: one PDF as it is, several in a zip. A failure still downloads a zip with the book and an error.txt. */
  private async download(name: string, make: (book: Book, fontBytes: Awaited<ReturnType<typeof loadFontBytes>>) => Promise<ExportedFile[]>) {
    const book = this.host.book();
    this.say('Building the files…');
    let files: ExportedFile[] = [];
    let failure: unknown;
    try {
      const fontBytes = await loadFontBytes();
      files = await make(book, fontBytes);
    } catch (err) {
      failure = err;
    }
    try {
      if (failure === undefined && files.length === 1) this.host.download(new Blob([files[0].bytes as BlobPart], { type: files[0].type }), files[0].name);
      else this.host.download(new Blob([zip(withBookJson(book, files, failure)) as BlobPart], { type: 'application/zip' }), `${slug(book.name, 'book')}-${name}.zip`);
    } catch (err) {
      this.say(errorProblem('The download could not be made.', err));
      return;
    }
    this.say(failure === undefined ? null : errorProblem('The files could not be built. A zip with the book as JSON and an error.txt was downloaded instead.', failure));
  }

  private downloadAlignment = () => this.button('Download calibration-alignment.pdf', 'calibrate-download-alignment', async () => {
    const o = this.host.book().print;
    this.printed = { front_offset_x_mm: o.front_offset_x_mm, front_offset_y_mm: o.front_offset_y_mm, back_offset_x_mm: o.back_offset_x_mm, back_offset_y_mm: o.back_offset_y_mm };
    await this.download('calibration-alignment', async (book, fontBytes) => [await (await import('./print/calibrate')).alignmentFile(book, fontBytes)]);
  });

  private downloadCreep = () => this.button('Download the creep test', 'calibrate-download-creep', () =>
    this.download('creep-test', async (book, fontBytes) => (await import('./print/calibrate')).creepFiles(book, fontBytes)));

  // ---- step 1: alignment ----------------------------------------------------

  private alignment(): HTMLElement[] {
    const result = h('div', { class: 'cal-result', role: 'status', 'data-key': 'calibrate-alignment-result' });
    const side = (which: 'front' | 'back'): SideReadings => ({ fold: num(this.read[which].fold), top: num(this.read[which].top), bottom: num(this.read[which].bottom) });
    const redraw = () => {
      const book = this.host.book(), printed = this.printed ?? book.print;
      const f = side('front'), b = side('back');
      const any = [f, b].some((s) => s.fold !== null || s.top !== null || s.bottom !== null);
      if (!any) { result.replaceChildren(h('p', { class: 'hint' }, 'Enter what you read to see the new offsets.')); return; }
      const next = offsetsFromReadings(printed, f, b);
      const rows = OFFSETS.map((k) => h('li', {}, `${OFFSET_NAMES[k]}: ${mm(printed[k])} → `, h('strong', {}, `${mm(next[k])} mm`)));
      const use = this.button('Use these values', 'calibrate-use-offsets', () => {
        const problem = this.change((bk) => Object.assign(bk.print, next));
        this.printed = null;
        for (const w of ['front', 'back'] as const) this.read[w] = { fold: '', top: '', bottom: '' };
        this.go(0);
        this.say(problem ?? 'Saved as your printer’s settings. Print the sheet again to check: the front and back crosshairs should coincide when held to a light, and the readings should now be 0 at the fold and 3.85 at the top and bottom.');
      });
      result.replaceChildren(h('ul', { class: 'cal-values' }, ...rows), use);
    };
    const r = (which: 'front' | 'back', key: 'fold' | 'top' | 'bottom', label: string, help: string) =>
      this.reading(label, help, this.read[which][key], (t) => { this.read[which][key] = t; }, redraw);
    redraw();
    return [
      h('p', { class: 'hint' }, QUALITY_TIP),
      h('ol', { class: 'cal-how' },
        h('li', {}, 'Print page 1 only, put the sheet back in the tray the same way as for print-second, then print page 2 only. (A duplex printer can print both.)'),
        h('li', {}, 'Fold the sheet in half edge to edge, crease it hard and open it. On each side, read where the crease crosses the fold scale (+ is to the right).'),
        h('li', {}, 'On each side, read the margin where the paper ends on the top ruler and on the bottom ruler (3.85 is right). If the paper ends past the last tick, measure the extra with a ruler and add it to 3.85.')),
      this.downloadAlignment(),
      h('h3', {}, 'Front (page 1)'),
      r('front', 'fold', 'Crease on the fold scale', 'calibrate-read-front-fold'),
      r('front', 'top', 'Margin at the top edge', 'calibrate-read-front-top'),
      r('front', 'bottom', 'Margin at the bottom edge', 'calibrate-read-front-bottom'),
      h('h3', {}, 'Back (page 2)'),
      r('back', 'fold', 'Crease on the fold scale', 'calibrate-read-back-fold'),
      r('back', 'top', 'Margin at the top edge', 'calibrate-read-back-top'),
      r('back', 'bottom', 'Margin at the bottom edge', 'calibrate-read-back-bottom'),
      h('p', { class: 'hint' }, 'Each reading is on the side you read it on, as you look at it. With both the top and the bottom, the page is centered, so a sheet cut a little tall or short cancels out. The new value is the one printed in the sheet’s footer plus what you read.'),
      h('h3', {}, 'New offsets'),
      result,
    ];
  }

  // ---- step 2: creep and cover ----------------------------------------------

  private creep(): HTMLElement[] {
    const book = this.host.book(), n = creepSheets(book);
    const result = h('div', { class: 'cal-result', role: 'status', 'data-key': 'calibrate-creep-result' });
    const redraw = () => {
      const [cover, outermost, innermost] = [num(this.read.cover), num(this.read.outermost), num(this.read.innermost)];
      const now = this.host.book().print.paper_thickness_mm;
      if (n < 2) { result.replaceChildren(h('p', { class: 'hint' }, 'The book has one sheet, so there is no creep to measure.')); return; }
      if (outermost === null || innermost === null) { result.replaceChildren(h('p', { class: 'hint' }, 'Enter the outermost and the innermost sheet’s margins to see the new thickness.')); return; }
      const r = creepResult(now, n, { cover: cover ?? outermost, outermost, innermost });
      const thickness = Math.min(PRINT_LIMITS.paper_thickness_mm.max, Math.max(PRINT_LIMITS.paper_thickness_mm.min, Math.round(r.thickness * 1000) / 1000));
      const use = this.button('Use this thickness', 'calibrate-use-thickness', () => {
        const problem = this.change((bk) => { bk.print.paper_thickness_mm = thickness; });
        this.read.cover = this.read.outermost = this.read.innermost = '';
        this.go(1);
        this.say(problem ?? 'Saved as your printer’s settings. Print the creep test again to check.');
      });
      result.replaceChildren(
        h('p', {}, 'Paper thickness: ', h('strong', {}, `${mm(now)} → ${mm(thickness)} mm`)),
        ...(cover === null ? [] : [h('p', { class: 'hint' }, `The cover pushes the pages in by ${mm(r.coverPush)} mm (its margin minus the outermost sheet’s). That doesn’t change the paper thickness.`)]),
        use);
    };
    const r = (label: string, help: string, key: 'cover' | 'outermost' | 'innermost') => this.reading(label, help, this.read[key], (t) => { this.read[key] = t; }, redraw);
    redraw();
    return [
      h('ol', { class: 'cal-how' },
        h('li', {}, 'Print calibration-cover.pdf on your cover stock, single-sided.'),
        h('li', {}, `Print creep-test.pdf on your real paper: pages 1 to ${n}, put the stack back in the tray the same way, then pages ${n + 1} to ${2 * n}.`),
        h('li', {}, 'Hold a sheet to a light: the boxes should line up through the paper. Fold, bind and trim as you do a book.'),
        h('li', {}, `Read the fore-edge margin on each right-hand page: the cover (inside back cover), the front of sheet 1 and the front of sheet ${n}. The number where the paper ends is the margin.`)),
      this.downloadCreep(),
      h('p', { class: 'hint' }, `Your biggest signature has ${n} sheet${n > 1 ? 's' : ''}; the test uses the paper thickness and offsets set now.`),
      h('h3', {}, 'Margins you read (mm)'),
      r('Cover', 'calibrate-read-cover', 'cover'),
      r(`Sheet 1 (outermost)`, 'calibrate-read-outermost', 'outermost'),
      r(`Sheet ${n} (innermost)`, 'calibrate-read-innermost', 'innermost'),
      h('p', { class: 'hint' }, 'Compare the middle with the outermost sheet, not with the cover: the cover wraps outside sheet 1 and pushes every sheet in by its own thickness, which cancels between two sheets but not between a sheet and the cover.'),
      h('h3', {}, 'New thickness'),
      result,
    ];
  }

  // ---- step 3: check, and tones ---------------------------------------------

  private check(): HTMLElement[] {
    const result = h('ul', { class: 'cal-values', 'data-key': 'calibrate-check-result', role: 'status' });
    const redraw = () => {
      const rows: [string, string, number][] = [['Fore-edge', this.read.fore, GRID_X_MM], ['Top', this.read.top, GRID_Y_MM], ['Bottom', this.read.bottom, GRID_Y_MM]];
      const done = rows.filter(([, t]) => num(t) !== null);
      result.replaceChildren(...(done.length === 0 ? [h('li', { class: 'hint' }, 'Enter what you measure to see how far each margin is from its target.')]
        : done.map(([name, t, target]) => {
          const d = num(t)! - target;
          return h('li', {}, `${name}: ${mm(num(t)!)} mm, target ${target} mm: `, h('strong', {}, Math.abs(d) < 0.05 ? 'on target' : `${mm(Math.abs(d))} mm too ${d > 0 ? 'big' : 'small'}`));
        })));
    };
    const r = (label: string, help: string, key: 'fore' | 'top' | 'bottom') => this.reading(label, help, this.read[key], (t) => { this.read[key] = t; }, redraw);
    redraw();
    return [
      h('p', { class: 'export-what' }, 'Optional. Print the corrected creep test again, or a real book, trim it and measure the margins with a ruler.'),
      this.downloadCreep(),
      h('h3', {}, 'Margins you measure (mm)'),
      r(`Fore-edge (target ${GRID_X_MM})`, 'calibrate-check-fore', 'fore'),
      r(`Top (target ${GRID_Y_MM})`, 'calibrate-check-top', 'top'),
      r(`Bottom (target ${GRID_Y_MM})`, 'calibrate-check-bottom', 'bottom'),
      result,
      h('h3', {}, 'Tones'),
      h('p', { class: 'hint' }, 'On page 1 of the alignment sheet, find the lightest gray ramp step you can still tell from the paper for each tone (for gray text, still read comfortably) and enter its percent.'),
      this.field('shade_light_pct'), this.field('shade_medium_pct'), this.field('shade_dark_pct'), this.field('gray_text_pct'),
    ];
  }
}
