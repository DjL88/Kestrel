import { OverlayBack } from '../core/overlayBack';
import { isMobileShell } from './desktopShell';

/**
 * Phone app: the system Back button closes the open dialog instead of leaving the app. Every V2 dialog already closes on
 * Escape, so a Back press sends the topmost one an Escape and lets it close itself the way it always does (a dialog that
 * must not close yet, such as one that is saving, can still refuse). Does nothing outside the phone and tablet app.
 *
 * A dialog opted out with `data-back-managed` keeps its own history entry (see useBackToClose).
 */
const OPEN_DIALOGS = '[role="dialog"]:not([data-back-managed])';

const visibleDialogs = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(OPEN_DIALOGS)).filter((element) => element.getClientRects().length > 0);

export function installOverlayBack(): void {
  if (typeof window === 'undefined' || !isMobileShell()) return;
  const overlays = new OverlayBack<HTMLElement>();
  // history.go(-n) raises one popstate, which is ours and not a Back press.
  let ignorePop = false;

  const sync = () => {
    const { push, pop } = overlays.sync(visibleDialogs());
    for (let i = 0; i < push; i++) history.pushState({ kestrelOverlay: true }, '');
    if (pop > 0) { ignorePop = true; history.go(-pop); }
  };

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });

  window.addEventListener('popstate', () => {
    if (ignorePop) { ignorePop = false; return; }
    const dialog = overlays.back();
    if (!dialog) return;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  });
}
