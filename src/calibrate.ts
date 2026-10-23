import { h } from './panel';
import { errorProblem, problemView, type Problem } from './problems';
import { zip } from './print/zip';
import { withBookJson } from './print/bundle';
import type { ExportedFile } from './print/export';
import { loadFontBytes } from './print/fonts';
import { SPINE_WARN_MM, creepResult, creepSheets, innermostSpineMargin, predictedMargins, type Printed } from './book/creep';
import { offsetsFromReadings, scaleFromReading, type Offsets, type SideReadings } from './book/alignment';
import { GRID_Y_MM } from './format/types';
import { PRINT_LIMITS, type Book } from './book/book';
import { LAYOUT_NAMES, PAPER_SETTINGS, profileOf, type PrintSettings } from './book/impose';
import { layoutPicker, printField, type PrintFieldKey } from './settings';
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

const STEPS = ['Size', 'Alignment', 'Creep and cover', 'Check'] as const;
const OFFSETS = ['front_offset_x_mm', 'front_offset_y_mm', 'back_offset_x_mm', 'back_offset_y_mm'] as const;
const OFFSET_NAMES: Record<(typeof OFFSETS)[number], string> = { front_offset_x_mm: 'Front x', front_offset_y_mm: 'Front y', back_offset_x_mm: 'Back x', back_offset_y_mm: 'Back y' };

/** The creep, shifts and target a creep test was printed with, as typed. */
type TestPrinted = { creep: string; shift: string; coverShift: string; target: string };

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
  /** The layout picker, shown on every step: what is measured belongs to the layout it is printed on. */
  private layoutRow = h('div', { class: 'cal-layout' });
  // What was typed. Kept as text so a half-typed number isn't lost when a result is redrawn.
  private read = { sizeH: '', sizeV: '', front: { fold: '', top: '', bottom: '' }, back: { fold: '', top: '', bottom: '' }, cover: '', outermost: '', innermost: '', fore: '', top: '', bottom: '' };
  /** The offsets the alignment sheet was printed with (they are in its footer): a reading is relative to them. */
  private printed: Offsets | null = null;
  /** The scale (% across, % down) the size sheet was printed with (it is in its footer): a measured line is relative to it. */
  private printedScale: { x: number; y: number } | null = null;
  /** The creep, shifts and target the creep test was printed with, as text (null until it is downloaded; then the book's settings are shown). */
  private testPrinted: TestPrinted | null = null;
  /** True once the test is downloaded: then the typed values are the printed ones, and edits to the book's settings no longer change them. */
  private testDownloaded = false;
  private printedInputs: Partial<Record<keyof TestPrinted, HTMLInputElement>> = {};

  /** `done` runs when the wizard is closed (the export window reopens). */
  constructor(private host: CalibrateHost, private done: () => void) {
    this.back.onclick = () => this.go(this.step - 1);
    this.next.onclick = () => this.go(this.step + 1);
    this.dialog = h('dialog', { class: 'library calibrate', 'aria-label': 'Calibrate your printer' },
      h('header', {}, h('h2', {}, 'Calibrate your printer'), h('button', { type: 'button', 'data-help': 'calibrate-close', onclick: () => this.dialog.close() }, 'Done')),
      this.status,
      this.progress,
      this.layoutRow,
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
    this.layoutRow.replaceChildren(layoutPicker(() => this.host.book(), (c) => this.change(c), () => this.layoutChanged()));
    this.body.replaceChildren(...[() => this.size(), () => this.alignment(), () => this.creep(), () => this.check()][this.step]());
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

  /** A different layout has its own offsets and scale, so what was printed or typed for the last one no longer applies. */
  private layoutChanged() {
    this.printed = null;
    this.printedScale = null;
    this.read.sizeH = this.read.sizeV = '';
    for (const w of ['front', 'back'] as const) this.read[w] = { fold: '', top: '', bottom: '' };
    this.go(this.step);
  }

  private field(key: PrintFieldKey) {
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
    const o = profileOf(this.host.book().print);
    this.printed = { front_offset_x_mm: o.front_offset_x_mm, front_offset_y_mm: o.front_offset_y_mm, back_offset_x_mm: o.back_offset_x_mm, back_offset_y_mm: o.back_offset_y_mm };
    await this.download('calibration-alignment', async (book, fontBytes) => [await (await import('./print/calibrate')).alignmentFile(book, fontBytes)]);
  });

  private downloadSize = () => this.button('Download calibration-size.pdf', 'calibrate-download-size', async () => {
    const o = profileOf(this.host.book().print);
    this.printedScale = { x: o.scale_x_pct, y: o.scale_y_pct };
    await this.download('calibration-size', async (book, fontBytes) => [await (await import('./print/calibrate')).sizeFile(book, fontBytes)]);
  });

  private downloadCreep = () => this.button('Download the creep test', 'calibrate-download-creep', () => {
    const p = this.host.book().print;
    this.testPrinted = { creep: String(p.creep_per_sheet_mm), shift: String(p.fore_edge_shift_mm), coverShift: String(p.cover_fore_edge_shift_mm), target: String(p.target_fore_edge_margin_mm) };
    this.testDownloaded = true;
    this.showPrinted();
    return this.download('creep-test', async (book, fontBytes) => (await import('./print/calibrate')).creepFiles(book, fontBytes));
  });

  // ---- step 1: size ---------------------------------------------------------

  private size(): HTMLElement[] {
    const twoUp = this.host.book().print.sheet_layout === 'letter_two_up';
    const result = h('div', { class: 'cal-result', role: 'status', 'data-key': 'calibrate-size-result' });
    const redraw = () => {
      const now = profileOf(this.host.book().print), printed = this.printedScale ?? { x: now.scale_x_pct, y: now.scale_y_pct };
      const [h_, v] = [num(this.read.sizeH), num(this.read.sizeV)];
      if (h_ === null && v === null) { result.replaceChildren(h('p', { class: 'hint' }, 'Enter what you measure to see the new scale.')); return; }
      const next = { x: scaleFromReading(now.scale_x_pct, printed.x, h_), y: scaleFromReading(now.scale_y_pct, printed.y, v) };
      const use = this.button('Use these values', 'calibrate-use-scale', () => {
        const problem = this.change((bk) => { const p = profileOf(bk.print); p.scale_x_pct = next.x; p.scale_y_pct = next.y; });
        this.printedScale = null;
        this.read.sizeH = this.read.sizeV = '';
        this.go(0);
        this.say(problem ?? 'Saved as your printer’s settings. Print the sheet again to check: both lines should now measure 100.0 mm.');
      });
      result.replaceChildren(h('ul', { class: 'cal-values' },
        h('li', {}, `Width scale: ${mm(now.scale_x_pct)} → `, h('strong', {}, `${mm(next.x)} %`)),
        h('li', {}, `Height scale: ${mm(now.scale_y_pct)} → `, h('strong', {}, `${mm(next.y)} %`))), use);
    };
    const r = (key: 'sizeH' | 'sizeV', label: string, help: string) => this.reading(label, help, this.read[key], (t) => { this.read[key] = t; }, redraw);
    redraw();
    return [
      h('p', { class: 'hint' }, `Print settings for ${LAYOUT_NAMES[this.host.book().print.sheet_layout]}: ${PAPER_SETTINGS[this.host.book().print.sheet_layout]}. A printer that enlarges or shrinks the page (borderless modes enlarge it a little) gives lines that are not 100 mm.`),
      h('ol', { class: 'cal-how' },
        h('li', {}, `Print the sheet${twoUp ? ' (the same in both halves, labelled Book 1 and Book 2)' : ''}.`),
        h('li', {}, 'With a ruler, measure the horizontal line between its end ticks, and the vertical line the same way, in mm (it should read 100.0).'),
        h('li', {}, 'The dots are counted for you: 28 across span 81.0 mm and 44 down span 129.0 mm, centre of the outermost dots to centre of the outermost dots.')),
      this.downloadSize(),
      h('h3', {}, 'Lines you measure (mm)'),
      r('sizeH', 'Horizontal line', 'calibrate-read-size-h'),
      r('sizeV', 'Vertical line', 'calibrate-read-size-v'),
      h('h3', {}, 'New scale'),
      result,
    ];
  }

  // ---- step 2: alignment ----------------------------------------------------

  private alignment(): HTMLElement[] {
    const result = h('div', { class: 'cal-result', role: 'status', 'data-key': 'calibrate-alignment-result' });
    const side = (which: 'front' | 'back'): SideReadings => ({ fold: num(this.read[which].fold), top: num(this.read[which].top), bottom: num(this.read[which].bottom) });
    const redraw = () => {
      const book = this.host.book(), printed = this.printed ?? profileOf(book.print);
      const f = side('front'), b = side('back');
      const any = [f, b].some((s) => s.fold !== null || s.top !== null || s.bottom !== null);
      if (!any) { result.replaceChildren(h('p', { class: 'hint' }, 'Enter what you read to see the new offsets.')); return; }
      const next = offsetsFromReadings(printed, f, b);
      const rows = OFFSETS.map((k) => h('li', {}, `${OFFSET_NAMES[k]}: ${mm(printed[k])} → `, h('strong', {}, `${mm(next[k])} mm`)));
      const use = this.button('Use these values', 'calibrate-use-offsets', () => {
        const problem = this.change((bk) => Object.assign(profileOf(bk.print), next));
        this.printed = null;
        for (const w of ['front', 'back'] as const) this.read[w] = { fold: '', top: '', bottom: '' };
        this.go(1);
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
        h('li', {}, 'Print page 1, put the sheet back in the tray as for print-second, then print page 2. (A duplex printer can print both.)'),
        h('li', {}, 'Fold the sheet in half edge to edge, crease it hard, open it. On each side, read where the crease crosses the fold scale (+ is right).'),
        h('li', {}, 'On each side, read the margin where the paper ends on the top and bottom rulers (3.85 is right). Past the last tick? Measure the extra and add it to 3.85.')),
      this.downloadAlignment(),
      h('h3', {}, 'Front (page 1)'),
      r('front', 'fold', 'Crease on the fold scale', 'calibrate-read-front-fold'),
      r('front', 'top', 'Margin at the top edge', 'calibrate-read-front-top'),
      r('front', 'bottom', 'Margin at the bottom edge', 'calibrate-read-front-bottom'),
      h('h3', {}, 'Back (page 2)'),
      r('back', 'fold', 'Crease on the fold scale', 'calibrate-read-back-fold'),
      r('back', 'top', 'Margin at the top edge', 'calibrate-read-back-top'),
      r('back', 'bottom', 'Margin at the bottom edge', 'calibrate-read-back-bottom'),
      h('h3', {}, 'New offsets'),
      result,
    ];
  }

  // ---- step 3: creep and cover ----------------------------------------------

  /** A number box for one of the values the test was printed with. */
  private printedField(label: string, help: string, key: keyof TestPrinted, result: () => void): HTMLElement {
    const input = h('input', { type: 'number', value: this.printedText()[key], step: 0.01, inputmode: 'decimal', 'aria-label': label, 'data-key': help, 'data-help': help });
    input.oninput = () => { this.printedText()[key] = input.value; result(); };
    this.printedInputs[key] = input;
    return h('label', { class: 'compact' }, label, input);
  }

  /** Shows the printed values in their boxes. */
  private showPrinted() {
    for (const [k, input] of Object.entries(this.printedInputs) as [keyof TestPrinted, HTMLInputElement][]) input.value = this.printedText()[k];
  }

  /** One of the settings the test will print with. Until the test is downloaded, the printed values follow it. */
  private testField(key: PrintFieldKey) {
    return printField(() => this.host.book(), (c) => {
      this.change(c);
      if (!this.testDownloaded) { this.testPrinted = null; this.showPrinted(); }
    }, key);
  }

  /** The values the creep test was printed with, as text: the download's, or until there is one, the book's settings now. */
  private printedText() {
    if (!this.testPrinted) {
      const p = this.host.book().print;
      this.testPrinted = { creep: String(p.creep_per_sheet_mm), shift: String(p.fore_edge_shift_mm), coverShift: String(p.cover_fore_edge_shift_mm), target: String(p.target_fore_edge_margin_mm) };
    }
    return this.testPrinted;
  }

  private creep(): HTMLElement[] {
    const n = creepSheets(this.host.book());
    this.printedInputs = {};
    const result = h('div', { class: 'cal-result', role: 'status', 'data-key': 'calibrate-creep-result' });
    const redraw = () => {
      const [cover, outermost, innermost] = [num(this.read.cover), num(this.read.outermost), num(this.read.innermost)];
      if (n < 2) { result.replaceChildren(h('p', { class: 'hint' }, 'The book has one sheet, so there is no creep to measure.')); return; }
      if (outermost === null || innermost === null) { result.replaceChildren(h('p', { class: 'hint' }, 'Enter the outermost and the innermost sheet’s margins to see the new settings.')); return; }
      const t = this.printedText(), printed = { creep: num(t.creep), foreEdgeShift: num(t.shift), coverShift: num(t.coverShift), target: num(t.target) };
      if (printed.creep === null || printed.foreEdgeShift === null || printed.coverShift === null || printed.target === null) {
        result.replaceChildren(h('p', { class: 'hint' }, 'Fill in the values the test was printed with.'));
        return;
      }
      const p = printed as Printed, readings = { cover, outermost, innermost };
      const raw = creepResult(p, n, readings);
      // Kept inside the book file's limits, so what is shown is what is saved.
      const fit = (key: keyof typeof PRINT_LIMITS, v: number) => Math.min(PRINT_LIMITS[key].max, Math.max(PRINT_LIMITS[key].min, Math.round(v * 1000) / 1000));
      const next = { creep: fit('creep_per_sheet_mm', raw.creep), foreEdgeShift: fit('fore_edge_shift_mm', raw.foreEdgeShift), coverShift: fit('cover_fore_edge_shift_mm', raw.coverShift) };
      const now = this.host.book().print;
      const predicted = predictedMargins(p, n, readings, next), spine = innermostSpineMargin(n, next);
      const margins = [...(predicted.cover === null ? [] : [`cover ${mm(predicted.cover)}`]), `sheet 1 ${mm(predicted.outermost)}`, `sheet ${n} ${mm(predicted.innermost)}`].join(', ');
      const use = this.button('Use these settings', 'calibrate-use-creep', () => {
        const problem = this.change((bk) => {
          bk.print.creep_per_sheet_mm = next.creep; bk.print.fore_edge_shift_mm = next.foreEdgeShift; bk.print.cover_fore_edge_shift_mm = next.coverShift;
          bk.print.target_fore_edge_margin_mm = p.target;
        });
        this.read.cover = this.read.outermost = this.read.innermost = '';
        this.testPrinted = null;
        this.testDownloaded = false;
        this.go(2);
        this.say(problem ?? 'Saved as your printer’s settings. Print the creep test again to check.');
      });
      result.replaceChildren(
        h('ul', { class: 'cal-values' },
          h('li', {}, 'Creep per sheet: ', h('strong', {}, `${mm(now.creep_per_sheet_mm)} → ${mm(next.creep)} mm`)),
          h('li', {}, 'Fore-edge shift: ', h('strong', {}, `${mm(now.fore_edge_shift_mm)} → ${mm(next.foreEdgeShift)} mm`)),
          h('li', {}, 'Cover shift: ', h('strong', {}, `${mm(now.cover_fore_edge_shift_mm)} → ${mm(next.coverShift)} mm`))),
        h('p', {}, `Fore-edge margins with these (target ${mm(p.target)}): ${margins} mm.`),
        h('p', { class: spine < SPINE_WARN_MM ? 'warn' : 'hint', 'data-key': 'calibrate-spine' },
          `Spine-side margin of the innermost page on the paper: ${mm(spine)} mm.`, spine < SPINE_WARN_MM ? ' That is small: writing close to the fold is hard to read. Use more signatures, or a smaller target margin.' : ''),
        use);
    };
    const r = (label: string, help: string, key: 'cover' | 'outermost' | 'innermost') => this.reading(label, help, this.read[key], (t) => { this.read[key] = t; }, redraw);
    redraw();
    return [
      h('p', { class: 'hint' }, `The test prints with these values (your biggest signature has ${n} sheet${n > 1 ? 's' : ''}). Set creep per sheet before you print, for example the paper’s thickness.`),
      this.testField('creep_per_sheet_mm'), this.testField('fore_edge_shift_mm'), this.testField('cover_fore_edge_shift_mm'), this.testField('target_fore_edge_margin_mm'),
      h('ol', { class: 'cal-how' },
        h('li', {}, 'Print calibration-cover.pdf on your cover stock: page 1 (the outside), put the sheet back the same way, then page 2 (the inside).'),
        h('li', {}, `Print creep-test.pdf on your real paper: pages 1 to ${n}, put the stack back in the tray the same way, then pages ${n + 1} to ${2 * n}.`),
        h('li', {}, 'Hold a sheet to a light: the boxes should line up through the paper. Fold, bind and trim as you do a book.'),
        h('li', {}, `Read the fore-edge margin on the cover’s right-hand page, and on the right-hand page of the front of sheet 1 and of sheet ${n}: the number where the paper ends.`)),
      this.downloadCreep(),
      h('h3', {}, 'Margins you read (mm)'),
      r('Cover', 'calibrate-read-cover', 'cover'),
      r(`Sheet 1 (outermost)`, 'calibrate-read-outermost', 'outermost'),
      r(`Sheet ${n} (innermost)`, 'calibrate-read-innermost', 'innermost'),
      h('h3', {}, 'The test was printed with'),
      h('p', { class: 'hint' }, 'Filled in when you download the test (they are in its footer). Change them if you printed with something else.'),
      this.printedField('Creep per sheet', 'calibrate-printed-creep', 'creep', redraw),
      this.printedField('Fore-edge shift', 'calibrate-printed-shift', 'shift', redraw),
      this.printedField('Cover shift', 'calibrate-printed-cover-shift', 'coverShift', redraw),
      this.printedField('Target margin', 'calibrate-printed-target', 'target', redraw),
      h('h3', {}, 'New settings'),
      result,
    ];
  }

  // ---- step 4: check, and tones ---------------------------------------------

  private check(): HTMLElement[] {
    const result = h('ul', { class: 'cal-values', 'data-key': 'calibrate-check-result', role: 'status' });
    const redraw = () => {
      const rows: [string, string, number][] = [['Fore-edge', this.read.fore, this.host.book().print.target_fore_edge_margin_mm], ['Top', this.read.top, GRID_Y_MM], ['Bottom', this.read.bottom, GRID_Y_MM]];
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
      r(`Fore-edge (target ${this.host.book().print.target_fore_edge_margin_mm})`, 'calibrate-check-fore', 'fore'),
      r(`Top (target ${GRID_Y_MM})`, 'calibrate-check-top', 'top'),
      r(`Bottom (target ${GRID_Y_MM})`, 'calibrate-check-bottom', 'bottom'),
      result,
      h('h3', {}, 'Tones'),
      h('p', { class: 'hint' }, 'On page 1 of the alignment sheet, find the lightest gray ramp step you can still tell from the paper for each tone (for gray text, still read comfortably) and enter its percent.'),
      this.field('shade_light_pct'), this.field('shade_medium_pct'), this.field('shade_dark_pct'), this.field('gray_text_pct'),
    ];
  }
}
