// What went wrong, in words an owner can read and paste into a chat: the real reason (validation issues with their
// paths, or the browser's own storage error), a Copy details button for the whole text, and optional extra actions.
import { h } from './panel';
import { formatIssue, type ValidationIssue } from './format/validate';

export interface ProblemAction { label: string; help: string; run(): void }
export interface Problem {
  title: string;
  /** The short version, shown on screen. */
  lines: string[];
  /** Everything, for Copy details. */
  details: string;
  actions?: ProblemAction[];
}

/** How many issues to list on screen; Copy details has them all. */
export const SHOWN_ISSUES = 5;

/** The browser says "quota" in different ways (Chrome/Safari: QuotaExceededError, Firefox: NS_ERROR_DOM_QUOTA_REACHED). */
export function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null;
  return e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22 || e?.code === 1014;
}

/** An error as text: its name, message and stack. */
export function errorText(err: unknown): string {
  if (err instanceof Error || (typeof err === 'object' && err !== null && 'message' in err)) {
    const e = err as { name?: string; message?: string; stack?: string };
    return [`${e.name ?? 'Error'}: ${e.message ?? ''}`, e.stack].filter(Boolean).join('\n');
  }
  return String(err);
}

const where = () => {
  const nav = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return [`When: ${new Date().toISOString()}`, nav && `Browser: ${nav}`].filter(Boolean).join('\n');
};

/** A list of validation issues: the first few on screen, all of them in the details. */
export function issuesProblem(title: string, issues: ValidationIssue[], actions?: ProblemAction[]): Problem {
  const lines = issues.slice(0, SHOWN_ISSUES).map(formatIssue);
  if (issues.length > SHOWN_ISSUES) lines.push(`…and ${issues.length - SHOWN_ISSUES} more (Copy details has them all).`);
  return { title, lines, details: [title, where(), '', ...issues.map(formatIssue)].join('\n'), actions };
}

/** A failed save or load: says "storage is full" only for a real quota error, otherwise the browser's own message. */
export function errorProblem(title: string, err: unknown, actions?: ProblemAction[]): Problem {
  const quota = isQuotaError(err);
  const message = (err as { message?: string } | null)?.message || String(err);
  return {
    title,
    lines: [quota ? 'The browser’s storage is full.' : message],
    details: [title, where(), quota ? 'Reason: storage is full (quota exceeded).' : '', errorText(err)].filter(Boolean).join('\n'),
    actions,
  };
}

/** Put text on the clipboard; falls back to selecting it in a hidden box where the Clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0' });
    box.value = text;
    document.body.append(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* blocked */ }
    box.remove();
    return ok;
  }
}

/** The on-screen form of a problem: its title and lines, then Copy details and any other actions. */
export function problemView(p: Problem): HTMLElement {
  const copy = h('button', { type: 'button', 'data-key': 'copy-details', 'data-help': 'copy-details' }, 'Copy details');
  copy.onclick = async () => {
    copy.textContent = (await copyText(p.details)) ? 'Copied' : 'Couldn’t copy';
    setTimeout(() => { copy.textContent = 'Copy details'; }, 2000);
  };
  const extra = (p.actions ?? []).map((a) => h('button', { type: 'button', 'data-key': a.help, 'data-help': a.help, onclick: () => a.run() }, a.label));
  return h('div', { class: 'problem', role: 'group', 'aria-label': p.title },
    h('p', { class: 'problem-title' }, p.title),
    p.lines.length > 1 ? h('ul', {}, ...p.lines.map((l) => h('li', {}, l))) : p.lines.length ? h('p', {}, p.lines[0]) : null,
    h('div', { class: 'problem-actions' }, ...extra, copy));
}
