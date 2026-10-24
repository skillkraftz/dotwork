import { h } from './panel';
import { errorProblem, problemView, type Problem } from './problems';
import { zip } from './print/zip';
import { withBookJson } from './print/bundle';
import type { ExportedFile } from './print/export';
import { loadFontBytes } from './print/fonts';
import { SPINE_WARN_MM, creepPages, creepResult, innermostSpineMargin, predictedMargins, validPages, type Printed } from './book/creep';
import { FOLD_HOW, NO_READINGS, foldTwist, scaleCaptions, sheetResult, twistText, type SheetReadings } from './book/alignment';
import { GRID_Y_MM } from './format/types';
import { PRINT_LIMITS, type Book } from './book/book';
import { EDGE_NAMES, LAYOUT_NAMES, PAPER_SETTINGS, profileOf, type LayoutProfile, type PrintSettings, type SheetLayout } from './book/impose';
import { printField, type PrintFieldKey } from './settings';
import { slug } from './slug';

/** What the Calibrate wizard needs from the editor around it. */
export interface CalibrateHost {
  book(): Book;
  download(blob: Blob, filename: string): void;
  /** The printer profile (see printer.ts), which is where everything entered here goes. `edit` changes and keeps it, and returns why the browser refused, if it did. */
  printer: { get(): PrintSettings; edit(change: (print: PrintSettings) => void): Problem | null };
}

/** The tip for step 1, and for summary.txt: a printer's own quality setting decides how well the lines line up. */
export const QUALITY_TIP = 'Print at your printer’s best quality. Firefox may not use the quality set in the printer’s own defaults, and normal quality feeds the paper too fast and misaligns lines. Check the quality in the print dialog’s printer options, or set the default in CUPS (localhost:631) on Linux.';

const STEPS = ['Sheet', 'Creep and cover', 'Check'] as const;
/** What the sheet step changes, by name. */
const RESULTS: [keyof LayoutProfile, string, string][] = [
  ['front_offset_x_mm', 'Front offset x', 'mm'], ['front_offset_y_mm', 'Front offset y', 'mm'], ['back_offset_x_mm', 'Back offset x', 'mm'], ['back_offset_y_mm', 'Back offset y', 'mm'],
  ['back_rotation_deg', 'Back rotation', '°'], ['scale_x_pct', 'Scale along the first edge', '%'], ['scale_y_pct', 'Scale along the second edge', '%'],
];

/** The sheet step's readings, as typed. */
type SheetFields = { [K in keyof SheetReadings]: string };
const EMPTY_SHEET: SheetFields = { topX: '', bottomX: '', leftY: '', rightY: '', hFoldLeft: '', hFoldRight: '', vFoldTop: '', vFoldBottom: '', longX: '', longY: '' };

/** The page count, creep, shifts and target a creep test was printed with, as typed. */
type TestPrinted = { pages: string; creep: string; shift: string; coverShift: string; target: string };

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
  /** Which layout is being calibrated, read-only: it is chosen in the PDF tab, since what is measured belongs to the layout it is printed on. */
  private layoutRow = h('div', { class: 'cal-layout' });
  /** The layout the typed readings belong to. */
  private layoutOf: SheetLayout | null = null;
  // What was typed. Kept as text so a half-typed number isn't lost when a result is redrawn.
  private read = { sheet: { ...EMPTY_SHEET }, cover: '', outermost: '', innermost: '', fore: '', top: '', bottom: '' };
  /** The layout's settings the sheet was printed with (they are in its footer): every reading is relative to them. */
  private printed: LayoutProfile | null = null;
  /** The creep, shifts and target the creep test was printed with, as text (null until it is downloaded; then the book's settings are shown). */
  private testPrinted: TestPrinted | null = null;
  /** True once the test is downloaded: then the typed values are the printed ones, and edits to the book's settings no longer change them. */
  private testDownloaded = false;
  private printedInputs: Partial<Record<keyof TestPrinted, HTMLInputElement>> = {};
  /** The page count the next creep test is made for, as typed; empty is the book's (see creepPages). */
  private pagesText = '';

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
    // Readings belong to the layout they were made on.
    if (this.layoutOf !== this.layout) this.resetSheet();
    this.layoutOf = this.layout;
    this.go(0);
    if (!this.dialog.open) this.dialog.showModal();
  }

  private go(step: number) {
    this.step = Math.min(STEPS.length - 1, Math.max(0, step));
    this.progress.textContent = `Step ${this.step + 1} of ${STEPS.length}: ${STEPS[this.step]}`;
    this.back.disabled = this.step === 0;
    this.next.disabled = this.step === STEPS.length - 1;
    this.layoutRow.replaceChildren(this.layoutLine());
    this.body.replaceChildren(...[() => this.sheet(), () => this.creep(), () => this.check()][this.step]());
    this.body.scrollTop = 0;
  }

  // ---- shared bits ----------------------------------------------------------

  private say(problem: Problem | string | null) {
    this.status.hidden = problem === null;
    this.status.replaceChildren(...(problem === null ? [] : [typeof problem === 'string' ? h('span', {}, problem) : problemView(problem)]));
  }

  private get layout(): SheetLayout { return this.host.printer.get().sheet_layout; }

  /** Which layout is being calibrated, with a way to change it (in the PDF tab, where the layout is chosen). */
  private layoutLine(): HTMLElement {
    const change = h('button', { type: 'button', 'data-key': 'calibrate-change-layout', 'data-help': 'calibrate-change-layout' }, 'Change layout');
    change.onclick = () => this.dialog.close();
    return h('div', { class: 'cal-layout-line' },
      h('p', { class: 'hint', 'data-key': 'calibrate-layout' }, 'Calibrating: ', h('strong', {}, LAYOUT_NAMES[this.layout]), ` (${PAPER_SETTINGS[this.layout]}).`),
      change);
  }

  /** Change the printer profile (it is kept). A browser that won't store it is told, with its reason (returned, and shown). */
  private change(change: (p: PrintSettings) => void): Problem | null {
    const problem = this.host.printer.edit(change);
    this.say(problem);
    return problem;
  }

  private resetSheet() {
    this.printed = null;
    this.read.sheet = { ...EMPTY_SHEET };
  }

  private field(key: PrintFieldKey) {
    return printField(() => this.host.printer.get(), (c) => this.change(c), key);
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
  private async download(name: string, make: (book: Book, print: PrintSettings, fontBytes: Awaited<ReturnType<typeof loadFontBytes>>) => Promise<ExportedFile[]>) {
    const book = this.host.book(), print = this.host.printer.get();
    this.say('Building the files…');
    let files: ExportedFile[] = [];
    let failure: unknown;
    try {
      const fontBytes = await loadFontBytes();
      files = await make(book, print, fontBytes);
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

  private downloadSheet = () => this.button('Download calibration-sheet.pdf', 'calibrate-download-sheet', async () => {
    this.printed = { ...profileOf(this.host.printer.get()) };
    await this.download('calibration-sheet', async (book, print, fontBytes) => [await (await import('./print/calibrate')).sheetFile(book, print, fontBytes)]);
  });

  private downloadCreep = () => this.button('Download the creep test', 'calibrate-download-creep', () => {
    const pages = this.testPages();
    if (!validPages(pages)) { this.say('The page count must be a multiple of 4, at least 4.'); return; }
    this.testPrinted = this.liveTestValues();
    this.testDownloaded = true;
    this.showPrinted();
    return this.download('creep-test', async (book, print, fontBytes) => (await import('./print/calibrate')).creepFiles(book, print, fontBytes, undefined, pages));
  });

  // ---- step 1: the sheet ----------------------------------------------------

  private sheet(): HTMLElement[] {
    const layout = this.layout, twoUp = layout === 'letter_two_up', cap = scaleCaptions(layout);
    const result = h('div', { class: 'cal-result', role: 'status', 'data-key': 'calibrate-sheet-result' });
    const twist = h('p', { class: 'hint', 'data-key': 'calibrate-fold-twist', 'data-help': 'calibrate-fold-twist' });
    const num_ = (k: keyof SheetFields) => num(this.read.sheet[k]);
    const redraw = () => {
      const r: SheetReadings = { ...NO_READINGS };
      for (const k of Object.keys(EMPTY_SHEET) as (keyof SheetFields)[]) r[k] = num_(k);
      // Information only: how far the print is turned against the paper's folds, from each pair read.
      const t = foldTwist(r);
      twist.replaceChildren(...[['Horizontal fold', t.horizontal], ['Vertical fold', t.vertical]].flatMap(([name, v]) => (v ? [h('span', {}, `${name}, ${twistText(v as { mm: number; over: number })}. `)] : [])));
      twist.hidden = !t.horizontal && !t.vertical;
      if ((Object.values(r) as (number | null)[]).every((v) => v === null)) { result.replaceChildren(h('p', { class: 'hint' }, 'Enter what you read to see the new settings.')); return; }
      const now = profileOf(this.host.printer.get()), printed = this.printed ?? now;
      const next = sheetResult(layout, printed, r);
      const edges = EDGE_NAMES[layout];
      const rows = RESULTS.map(([k, name, unit]) => {
        const label = k === 'scale_x_pct' ? `Scale along the ${edges.x} edge` : k === 'scale_y_pct' ? `Scale along the ${edges.y} edge` : name;
        const show = k === 'back_rotation_deg' ? (v: number) => `${Math.round(v * 1000) / 1000}` : mm; // a degree is fine, so the rotation shows its third decimal
        return h('li', {}, `${label}: ${show(now[k])} → `, h('strong', {}, `${show(next[k])} ${unit}`));
      });
      const use = this.button('Use these values', 'calibrate-use-sheet', () => {
        const problem = this.change((p) => { const l = profileOf(p); for (const [k] of RESULTS) if (next[k] !== printed[k]) l[k] = next[k]; });
        this.resetSheet();
        this.go(0);
        this.say(problem ?? 'Saved as your printer’s settings. Print the sheet again to check: every see-through and fold reading should now be 0, and the 100 mm lines exactly 100.0 mm.');
      });
      result.replaceChildren(h('ul', { class: 'cal-values' }, ...rows), use);
    };
    const r = (key: keyof SheetFields, label: string, help: string) => this.reading(label, help, this.read.sheet[key], (t) => { this.read.sheet[key] = t; }, redraw);
    redraw();
    return [
      h('p', { class: 'hint' }, QUALITY_TIP),
      h('ol', { class: 'cal-how' },
        h('li', {}, `Print calibration-sheet.pdf double-sided: page 1, put the sheet back in the tray as for print-second, then page 2. (A duplex printer can print both.)${twoUp ? ' It uses the whole letter sheet.' : ''}`),
        h('li', {}, `Hold the sheet to a light. On side 2, read each see-through scale where side 1’s + shows through: x at the top and bottom, y at the left and right. + is right and up, as seen on side 2. The + in the middle is a quick look-through check: it should sit on side 1’s.`),
        h('li', {}, `${FOLD_HOW} + is up for the horizontal-fold scales and right for the vertical-fold ones, as seen on side 2.`),
        h('li', {}, `Measure the two 100 mm lines with a ruler, from tick to tick: one parallel to the ${EDGE_NAMES[layout].x} edge, one to the ${EDGE_NAMES[layout].y} edge.`),
        h('li', {}, 'Print the sheet twice. If the readings differ much between the two prints, the twist comes from the paper feed, not something a setting can fix.')),
      this.downloadSheet(),
      h('h3', {}, 'See-through (mm)'),
      r('topX', cap.top, 'calibrate-read-top-x'), r('bottomX', cap.bottom, 'calibrate-read-bottom-x'),
      r('leftY', cap.left, 'calibrate-read-left-y'), r('rightY', cap.right, 'calibrate-read-right-y'),
      h('h3', {}, 'Fold, where the crease crosses (mm)'),
      r('hFoldLeft', cap.hFoldLeft, 'calibrate-read-hfold-left'), r('hFoldRight', cap.hFoldRight, 'calibrate-read-hfold-right'),
      r('vFoldTop', cap.vFoldTop, 'calibrate-read-vfold-top'), r('vFoldBottom', cap.vFoldBottom, 'calibrate-read-vfold-bottom'),
      twist,
      h('h3', {}, '100 mm lines, measured (mm)'),
      r('longX', cap.longX, 'calibrate-read-line-x'), r('longY', cap.longY, 'calibrate-read-line-y'),
      h('h3', {}, 'New settings'),
      result,
      h('h3', {}, 'Line weight (optional)'),
      h('p', { class: 'hint' }, `Side 1 has pairs of identical lines, one along each paper edge, and a ladder. The scale only moves things, it never thickens lines, so print the sheet again after setting it. Only set the line weight if the pairs still differ: a printer can draw lines along the ${EDGE_NAMES[layout].x} edge thicker than lines along the ${EDGE_NAMES[layout].y} edge. Then find the ladder step (85 to 100 %) whose line along the ${EDGE_NAMES[layout].x} edge looks as thick as the 0.35 mm line along the ${EDGE_NAMES[layout].y} edge, and enter that percent here. Leave it at 100 if the pairs look the same.`),
      this.field('line_weight_x_pct'),
    ];
  }

  // ---- step 3: creep and cover ----------------------------------------------

  /** A number box for one of the values the test was printed with. */
  private printedField(label: string, help: string, key: keyof TestPrinted, result: () => void, step = 0.01): HTMLElement {
    const input = h('input', { type: 'number', value: this.printedText()[key], step, inputmode: 'decimal', 'aria-label': label, 'data-key': help, 'data-help': help });
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
    return printField(() => this.host.printer.get(), (c) => {
      this.change(c);
      this.followTest();
    }, key);
  }

  private followTest() {
    if (!this.testDownloaded) { this.testPrinted = null; this.showPrinted(); }
  }

  /** The page count the next creep test is made for: what was typed, or the book's. NaN for a box that doesn't hold a number. */
  private testPages(): number | null {
    return this.pagesText.trim() === '' ? creepPages(this.host.book(), this.host.printer.get()) : num(this.pagesText);
  }

  /** The values the next creep test prints with, as text. */
  private liveTestValues(): TestPrinted {
    const p = this.host.printer.get();
    return { pages: String(this.testPages() ?? ''), creep: String(p.creep_per_sheet_mm), shift: String(p.fore_edge_shift_mm), coverShift: String(p.cover_fore_edge_shift_mm), target: String(p.target_fore_edge_margin_mm) };
  }

  /** The values the creep test was printed with, as text: the download's, or until there is one, the ones it will print with now. */
  private printedText() {
    return (this.testPrinted ??= this.liveTestValues());
  }

  /** The page count box for the next creep test, with the sheets it makes and the padding it needs. */
  private pagesField(): HTMLElement {
    const input = h('input', { type: 'number', value: String(this.testPages() ?? ''), step: 4, min: 4, inputmode: 'numeric', 'aria-label': 'Pages in the book', 'data-key': 'calibrate-pages', 'data-help': 'calibrate-pages' });
    input.oninput = () => { this.pagesText = input.value; this.followTest(); this.showPadding(); };
    return h('label', { class: 'compact' }, 'Pages in the book', input);
  }

  private padding = h('p', { class: 'hint', 'data-key': 'calibrate-padding' });
  private foldAround = h('li', { 'data-key': 'calibrate-fold-around' });

  /** The sheets the typed page count makes and the blank sheets of padding around the innermost one; the instruction says it. */
  private showPadding() {
    const pages = this.testPages();
    if (!validPages(pages)) {
      this.padding.textContent = 'The page count must be a multiple of 4, at least 4.';
      this.foldAround.textContent = '';
      return;
    }
    const sheets = pages / 4, blanks = Math.max(0, sheets - 2), s = (n: number) => `${n} blank sheet${n === 1 ? '' : 's'}`;
    this.padding.textContent = sheets < 2 ? `${pages} pages is ${sheets} sheet: there is no creep to measure.` : `${pages} pages is ${sheets} sheets: the test prints the outermost and the innermost, and needs ${s(blanks)} of the same paper as padding.`;
    this.foldAround.textContent = `Fold the outermost sheet around ${s(blanks)} of the same paper, with the innermost sheet in the middle, cover outside. Bind and trim as usual, then read the fore-edge margin on the cover, page 1 and the middle spread.`;
  }

  private creep(): HTMLElement[] {
    this.printedInputs = {};
    const result = h('div', { class: 'cal-result', role: 'status', 'data-key': 'calibrate-creep-result' });
    const redraw = () => {
      const [cover, outermost, innermost] = [num(this.read.cover), num(this.read.outermost), num(this.read.innermost)];
      const pages = num(this.printedText().pages), n = validPages(pages) ? pages / 4 : 0;
      if (n === 0) { result.replaceChildren(h('p', { class: 'hint' }, 'Fill in the page count the test was printed with (a multiple of 4).')); return; }
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
      const now = this.host.printer.get();
      const predicted = predictedMargins(p, n, readings, next), spine = innermostSpineMargin(n, next);
      const margins = [...(predicted.cover === null ? [] : [`cover ${mm(predicted.cover)}`]), `page 1 ${mm(predicted.outermost)}`, `middle spread ${mm(predicted.innermost)}`].join(', ');
      const use = this.button('Use these settings', 'calibrate-use-creep', () => {
        const problem = this.change((pr) => {
          pr.creep_per_sheet_mm = next.creep; pr.fore_edge_shift_mm = next.foreEdgeShift; pr.cover_fore_edge_shift_mm = next.coverShift;
          pr.target_fore_edge_margin_mm = p.target;
        });
        this.read.cover = this.read.outermost = this.read.innermost = '';
        this.testPrinted = null;
        this.testDownloaded = false;
        this.go(1);
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
    this.showPadding();
    return [
      h('p', { class: 'hint' }, 'The test is made for a book of this many pages, and prints with these values. Set creep per sheet before you print, for example the paper’s thickness.'),
      this.pagesField(),
      this.padding,
      this.testField('creep_per_sheet_mm'), this.testField('fore_edge_shift_mm'), this.testField('cover_fore_edge_shift_mm'), this.testField('target_fore_edge_margin_mm'),
      h('ol', { class: 'cal-how' },
        h('li', {}, 'Print calibration-cover.pdf on your cover stock: page 1 (the outside), put the sheet back the same way, then page 2 (the inside).'),
        h('li', {}, 'Print creep-test.pdf on your real paper: pages 1 and 2, put the stack back in the tray the same way, then pages 3 and 4.'),
        h('li', {}, 'Hold a sheet to a light: the boxes should line up through the paper.'),
        this.foldAround),
      this.downloadCreep(),
      h('h3', {}, 'Margins you read (mm)'),
      r('Cover', 'calibrate-read-cover', 'cover'),
      r('Page 1 (outermost sheet)', 'calibrate-read-outermost', 'outermost'),
      r('Middle spread (innermost sheet)', 'calibrate-read-innermost', 'innermost'),
      h('h3', {}, 'The test was printed with'),
      h('p', { class: 'hint' }, 'Filled in when you download the test (they are in its footer). Change them if you printed with something else.'),
      this.printedField('Pages in the book', 'calibrate-printed-pages', 'pages', redraw, 4),
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
      const rows: [string, string, number][] = [['Fore-edge', this.read.fore, this.host.printer.get().target_fore_edge_margin_mm], ['Top', this.read.top, GRID_Y_MM], ['Bottom', this.read.bottom, GRID_Y_MM]];
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
      r(`Fore-edge (target ${this.host.printer.get().target_fore_edge_margin_mm})`, 'calibrate-check-fore', 'fore'),
      r(`Top (target ${GRID_Y_MM})`, 'calibrate-check-top', 'top'),
      r(`Bottom (target ${GRID_Y_MM})`, 'calibrate-check-bottom', 'bottom'),
      result,
      h('h3', {}, 'Tones'),
      h('p', { class: 'hint' }, 'On side 1 of the calibration sheet, find the lightest gray ramp step you can still tell from the paper for each tone (for gray text, still read comfortably) and enter its percent.'),
      this.field('shade_light_pct'), this.field('shade_medium_pct'), this.field('shade_dark_pct'), this.field('gray_text_pct'),
    ];
  }
}
