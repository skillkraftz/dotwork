import { h } from './panel';
import { errorProblem, problemView } from './problems';
import { zip } from './print/zip';
import { withBookJson } from './print/bundle';
import type { ExportedFile } from './print/export';
import { loadFontBytes } from './print/fonts';
import { creepSheets, thicknessFromCreepTest } from './book/creep';
import { printField } from './settings';
import { slug } from './slug';
import type { Book } from './book/book';

/** What the Calibrate page needs from the editor around it. */
export interface CalibrateHost {
  book(): Book;
  editBook(change: (book: Book) => void): void;
  download(blob: Blob, filename: string): void;
}

const step = (n: number, title: string, ...body: (HTMLElement | null)[]) =>
  h('section', { class: 'cal-step' }, h('h3', {}, `${n}. ${title}`), ...body);
const what = (text: string) => h('p', { class: 'export-what' }, text);
const how = (...items: (string | HTMLElement)[]) => h('ol', { class: 'cal-how' }, ...items.map((i) => h('li', {}, i)));

/**
 * The Calibrate page: plain steps for getting the back offset, the tones and the paper thickness right with a few sheets
 * of paper, the fields for each right where the step needs them, and the download of the calibration set (a zip).
 */
export class CalibrateDialog {
  private dialog: HTMLDialogElement;
  private body = h('div', { class: 'export-body calibrate-body' });
  private status = h('p', { class: 'lib-msg', role: 'status', hidden: true });
  private sheets = h('strong', {});
  private per = h('strong', {});

  /** `done` runs when the page is closed (the export window reopens). */
  constructor(private host: CalibrateHost, private done: () => void) {
    this.dialog = h('dialog', { class: 'library calibrate', 'aria-label': 'Calibrate your printer' },
      h('header', {}, h('h2', {}, 'Calibrate your printer'), h('button', { type: 'button', 'data-help': 'calibrate-close', onclick: () => this.dialog.close() }, 'Done')),
      this.status,
      this.body) as HTMLDialogElement;
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    this.dialog.addEventListener('close', () => this.done());
    // A change to the thickness or signatures changes the numbers quoted in step 3.
    this.body.addEventListener('change', () => this.refresh());
    document.body.append(this.dialog);
  }

  get isOpen() { return this.dialog.open; }

  show() {
    this.status.hidden = true;
    this.build();
    this.refresh();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private refresh() {
    const book = this.host.book(), sheets = creepSheets(book);
    this.sheets.textContent = String(sheets);
    // What a measured difference of 0.1 mm means for the thickness, from the same formula as the creep test.
    this.per.textContent = sheets > 1 ? (book.print.paper_thickness_mm - thicknessFromCreepTest(book.print.paper_thickness_mm, sheets, 0.1)).toFixed(4) : 'n/a';
  }

  private build() {
    const field = (key: Parameters<typeof printField>[2]) => printField(() => this.host.book(), (change) => this.host.editBook(change), key);
    const download = h('button', { type: 'button', class: 'primary', 'data-key': 'calibrate-download', 'data-help': 'calibrate-download' }, 'Download the calibration set');
    download.onclick = async () => { download.disabled = true; try { await this.build_zip(); } finally { download.disabled = false; } };

    this.body.replaceChildren(
      what('Print a few calibration sheets before the whole book, to find out how your printer places and tones the pages. Download the set, print it the way you print the book, and use the three steps below to set the numbers. The sheets print the settings below on every page, so a sheet always says what made it.'),
      h('div', { class: 'export-actions' }, download),
      h('p', { class: 'hint' }, 'You get a zip with calibration-first.pdf and calibration-second.pdf (steps 1 and 2), creep-test.pdf (step 3), calibration-cover.pdf (the covers’ margins), calibration.txt and book.json. Print at actual size, with no fit-to-page.'),

      step(1, 'Alignment (back offset)',
        what('Printing the second side by hand, the printer never lands exactly where it did on the first. The back offset moves everything on print-second.pdf (and calibration-second.pdf) by a few tenths of a millimetre so the back lines up with the front. Nothing else moves: print-first.pdf and cover.pdf never take it.'),
        how(
          'Print calibration-first.pdf on a sheet. Put that sheet back in the tray the same way you put the printed stack back for print-second.pdf (print-first, put the stack back in the tray the same way, then print-second), and print calibration-second.pdf on its other side.',
          'Hold the sheet up to a light with the back toward you, right way up, so the writing on it reads normally. The front’s two crosshairs (marked x and y, in the gap at the fold) show through. On the back are two scales in millimetres, one for each: ticks every 0.5 mm, from −5 to +5.',
          'Read where the x crosshair’s upright line crosses the x scale (a flat scale): that is x, positive if the line sits to the right of the scale’s 0, negative to the left. Then read where the y crosshair’s flat line crosses the y scale (an upright scale): that is y, positive if above 0, negative below.',
          'Add each reading to the setting below: new x = current x + reading, new y = current y + reading. A crosshair half a millimetre to the right of 0 means the back printed 0.5 mm too far left, so it needs to move right: +0.5. The scale moves with the offset, so after you print again the crosshair should sit on 0.',
        ),
        field('back_offset_x_mm'), field('back_offset_y_mm'),
      ),

      step(2, 'Tones',
        what('The three shade tones (light, medium, dark) and the gray text print as a percent of black, from 0 (white) to 100 (black). Printers differ in how the lightest grays come out, and a tone too pale to see is wasted. The tones change the printed PDFs and the calibration sheets only, not the editor or PNG pictures.'),
        how(
          'Look at the gray ramp on calibration-first.pdf: swatches from 0% to 100% in steps of 5%, each with a line of text in the same gray.',
          'For each of light shade, medium shade, dark shade and gray text, find the lightest step you can still tell apart from the white paper (for the text, still read comfortably). Enter that percentage. Light is usually the faintest, dark the strongest.',
          'Print again: the three tones and the gray text, as they now print, are shown under the ramp.',
        ),
        field('shade_light_pct'), field('shade_medium_pct'), field('shade_dark_pct'), field('gray_text_pct'),
      ),

      step(3, 'Paper thickness (creep)',
        what('When sheets are folded one inside another, the inner ones are pushed out toward the edge. To cancel that, each sheet’s pages are shifted toward the fold by the number of sheets outside it × the paper thickness. A thickness that is too high or too low leaves the margin at the trimmed edge uneven.'),
        how(
          'Start with the paper’s real thickness. Stack 20 sheets, press them flat, measure the stack in millimetres and divide by 20. Or use the paper’s spec sheet, which usually gives microns: divide by 1000 (90 microns is 0.09 mm). Enter it below.',
          h('span', {}, 'Print creep-test.pdf, single-sided: one sheet for each sheet of your biggest signature (', this.sheets, ' sheets with your settings), each marked “sheet 1 of …” (1 is the outermost) with the same box on its pages, shifted by that sheet’s creep.'),
          'Fold the sheets together in order, the way they nest in the book, with sheet 1 on the outside. Trim the edge 3.5 in from the fold, as you do for the book.',
          'Measure from the trimmed edge to the outer line of the box on sheet 1’s front right page (page 1), then the same on the innermost sheet’s front right page (the last right-hand page before the middle). Difference = innermost distance − outermost distance, in millimetres.',
          h('span', {}, 'New thickness = current thickness − difference ÷ (sheets − 1). Each 0.1 mm of difference changes the thickness by ', this.per, ' mm. If the innermost box is farther from the edge, the thickness is too high; if closer, too low. When the difference is zero, it is right.'),
        ),
        field('paper_thickness_mm'), field('signatures'),
        h('p', { class: 'hint' }, 'Signatures split the book into separate folded bundles; the creep test uses the biggest one.'),
      ),
    );
  }

  private async build_zip() {
    const book = this.host.book();
    this.status.hidden = false;
    this.status.replaceChildren(h('span', {}, 'Building the calibration set…'));
    let files: ExportedFile[] = [];
    let failure: unknown;
    try {
      const [{ calibrationFiles }, fontBytes] = await Promise.all([import('./print/calibrate'), loadFontBytes()]);
      files = await calibrationFiles(book, fontBytes);
    } catch (err) {
      failure = err;
    }
    const bundle = withBookJson(book, files, failure);
    try {
      this.host.download(new Blob([zip(bundle) as BlobPart], { type: 'application/zip' }), `${slug(book.name, 'book')}-calibration.zip`);
    } catch (err) {
      this.status.replaceChildren(problemView(errorProblem('The download could not be made.', err)));
      return;
    }
    if (failure !== undefined) this.status.replaceChildren(problemView(errorProblem('The calibration set could not be built. A zip with the book as JSON and an error.txt was downloaded instead.', failure)));
    else this.status.hidden = true;
  }
}
