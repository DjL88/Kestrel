/**
 * Contributor feedback (owner, 26 Nov 2026): when a contributor right-clicks a part of the app and chooses "Feedback on
 * this", describe what they pointed at in plain words, so a translation fix can find the string. Only the element's role,
 * accessible name and the words it shows are read: never page HTML, a photo, file names in hidden attributes or form values.
 */

/** The parts of a DOM element this needs (a real Element satisfies it; tests pass a small stand-in). */
export interface FeedbackNode {
  tagName: string;
  getAttribute(name: string): string | null;
  textContent: string | null;
  parentElement: FeedbackNode | null;
}

export interface FeedbackTarget {
  /** e.g. `button "Export"` or `heading "Language"`. */
  target: string;
  /** The words shown on that part of the app (collapsed, bounded). */
  text: string;
}

const TAG_ROLE: Record<string, string> = {
  BUTTON: 'button', A: 'link', SELECT: 'list box', OPTION: 'option', LABEL: 'label', INPUT: 'field', TEXTAREA: 'text box',
  H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', LI: 'list item', P: 'text',
  SUMMARY: 'section', LEGEND: 'group', TH: 'column', TD: 'cell', DIALOG: 'dialog', NAV: 'navigation',
};
/** Elements worth naming on their own; anything else is described through the nearest one of these. */
const MEANINGFUL = new Set(['BUTTON', 'A', 'SELECT', 'OPTION', 'LABEL', 'INPUT', 'TEXTAREA', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'SUMMARY', 'LEGEND', 'TH', 'TD', 'DIALOG', 'NAV', 'P']);
const MAX_HOPS = 8;

export const collapse = (value: string | null | undefined, max: number) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

function isMeaningful(node: FeedbackNode): boolean {
  return MEANINGFUL.has(node.tagName.toUpperCase()) || Boolean(node.getAttribute('role')) || Boolean(node.getAttribute('aria-label'));
}

function roleOf(node: FeedbackNode): string {
  return node.getAttribute('role')?.trim() || TAG_ROLE[node.tagName.toUpperCase()] || 'area';
}

/** A field's typed value is never read: only its label, title or placeholder. */
function nameOf(node: FeedbackNode): string {
  const tag = node.tagName.toUpperCase();
  const typed = tag === 'INPUT' || tag === 'TEXTAREA';
  return collapse(node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || (typed ? '' : node.textContent), 80);
}

export function describeFeedbackTarget(start: FeedbackNode | null): FeedbackTarget {
  if (!start) return { target: '', text: '' };
  let node: FeedbackNode | null = start;
  let hops = 0;
  while (node && !isMeaningful(node) && hops < MAX_HOPS) { node = node.parentElement; hops += 1; }
  const chosen = node && isMeaningful(node) ? node : start;
  const name = nameOf(chosen);
  const tag = start.tagName.toUpperCase();
  const shown = tag === 'INPUT' || tag === 'TEXTAREA' ? '' : collapse(start.textContent, 500);
  return { target: collapse(name ? `${roleOf(chosen)} "${name}"` : roleOf(chosen), 300), text: shown || name };
}

/** Which screen the contributor was on, in words an admin can follow. */
export function describeFeedbackScreen(view: { screen: string; activePanel?: string | null; settingsOpen?: boolean; settingsTab?: string | null }): string {
  const parts = [view.screen];
  if (view.settingsOpen) parts.push(`settings: ${view.settingsTab ?? 'general'}`);
  else if (view.activePanel) parts.push(`panel: ${view.activePanel}`);
  return collapse(parts.join(' · '), 120);
}
