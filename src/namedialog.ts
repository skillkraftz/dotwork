import { h } from './panel';

/**
 * A small window that asks for a name (saving a widget, renaming one) and answers with it, or null if it was
 * cancelled. It is a page element rather than the browser's prompt(), which phones show poorly.
 */
export class NameDialog {
  private dialog: HTMLDialogElement;
  private title = h('h2', {});
  private input = h('input', { type: 'text', 'data-key': 'ask-name', 'data-help': 'ask-name', maxlength: 60, autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', enterkeyhint: 'done' });
  private done: ((name: string | null) => void) | null = null;

  constructor() {
    const finish = (name: string | null) => {
      const resolve = this.done;
      this.done = null;
      if (this.dialog.open) this.dialog.close();
      resolve?.(name);
    };
    const save = () => finish(this.input.value.trim() || null);
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    this.dialog = h('dialog', { class: 'library ask', 'aria-label': 'Name' },
      h('header', {}, this.title),
      h('div', { class: 'ask-body' }, this.input),
      h('footer', {},
        h('button', { type: 'button', 'data-help': 'ask-cancel', onclick: () => finish(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'primary', 'data-help': 'ask-save', onclick: save }, 'Save'))) as HTMLDialogElement;
    this.dialog.addEventListener('cancel', () => finish(null)); // Escape
    document.body.append(this.dialog);
  }

  ask(title: string, initial = ''): Promise<string | null> {
    this.done?.(null);
    this.title.textContent = title;
    this.input.value = initial;
    this.dialog.showModal();
    this.input.focus();
    this.input.select();
    return new Promise((resolve) => { this.done = resolve; });
  }
}
