import { h } from '../panel';
import type { Book } from '../book/book';
import type { BookTemplate, TemplateField } from '../builtin/templates';

/**
 * Asks a book template its few questions, with a stepper for each number, and hands back the book it builds. The
 * answers always stay inside each field's range, so the book can always be built.
 */
export class TemplateDialog {
  private dialog: HTMLDialogElement;
  private title = h('h2', {});
  private about = h('p', { class: 'hint' });
  private body = h('div', { class: 'ask-body template-fields' });
  private template: BookTemplate | null = null;
  private answers: Record<string, number> = {};
  private onBuild: (book: Book) => void = () => {};

  constructor() {
    this.dialog = h('dialog', { class: 'library ask template', 'aria-label': 'Build a book' },
      h('header', {}, this.title),
      h('div', { class: 'ask-body' }, this.about),
      this.body,
      h('footer', {},
        h('button', { type: 'button', 'data-help': 'template-cancel', onclick: () => this.dialog.close() }, 'Cancel'),
        h('button', { type: 'button', class: 'primary', 'data-key': 'template-build', 'data-help': 'template-build', onclick: () => this.build() }, 'Build book'))) as HTMLDialogElement;
    document.body.append(this.dialog);
  }

  open(template: BookTemplate, onBuild: (book: Book) => void) {
    this.template = template;
    this.onBuild = onBuild;
    this.answers = Object.fromEntries(template.fields.map((f) => [f.key, f.value]));
    this.title.textContent = template.name;
    this.about.textContent = template.description;
    this.body.replaceChildren(...template.fields.map((f) => this.field(f)));
    this.body.hidden = template.fields.length === 0;
    this.dialog.showModal();
  }

  private build() {
    if (!this.template) return;
    const book = this.template.build(this.answers);
    this.dialog.close();
    this.onBuild(book);
  }

  private field(f: TemplateField): HTMLElement {
    const input = h('input', {
      type: 'text', inputmode: 'numeric', id: `template-${f.key}`, 'data-key': `template-${f.key}`, 'data-help': 'template-field',
      autocomplete: 'off', value: String(f.value),
    }) as HTMLInputElement;
    const hint = h('span', { class: 'hint' });
    const clamp = (v: number) => Math.min(f.max, Math.max(f.min, Math.round(v)));
    const set = (v: number) => {
      this.answers[f.key] = clamp(v);
      hint.textContent = f.hint ? f.hint(this.answers[f.key]) : `${f.min} to ${f.max}`;
    };
    // Typing is taken as it comes; leaving the field puts a number in range back in it.
    input.oninput = () => { const v = parseInt(input.value, 10); if (Number.isFinite(v)) set(v); };
    input.onblur = () => { input.value = String(this.answers[f.key]); };
    const step = (dir: 1 | -1) => h('button', {
      type: 'button', class: 'step', 'data-help': dir > 0 ? 'step-inc' : 'step-dec', 'data-key': `template-${f.key}-${dir > 0 ? 'inc' : 'dec'}`,
      'aria-label': `${dir > 0 ? 'Increase' : 'Decrease'} ${f.label}`,
      onmousedown: (e: Event) => e.preventDefault(),
      onclick: () => { set(this.answers[f.key] + dir); input.value = String(this.answers[f.key]); },
    }, dir > 0 ? '+' : '−');
    set(f.value);
    return h('div', { class: 'field num' }, h('label', { for: `template-${f.key}` }, f.label), h('div', { class: 'stepper' }, step(-1), input, step(1)), hint);
  }
}
