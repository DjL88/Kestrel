import { useEffect, useRef, useState } from 'react';
import { subscriptionStateText, type SubscriptionManage } from '../core/proCheckout';
import { firebaseAuth } from '../providers/firebaseAuth';
import { manageProSubscription } from '../providers/licenceStore';
import { isDesktopApp } from '../providers/desktopShell';

const action = 'min-h-11 rounded-md border border-[var(--account-border,#ffffff26)] px-3 text-sm text-[var(--account-foreground,#f4f4f5)] hover:bg-white/8 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-sky-300';

/**
 * Manage or cancel Pro. The server finds this account's own subscription and asks Paddle for its customer pages; the
 * cancellation itself happens on Paddle's page, and Paddle's notification then sets when Pro ends. Nothing here, and
 * nothing a cancellation does, ever touches photos, projects, edits or exports.
 */
export function ManageProPanel({ offline }: { offline: boolean }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<SubscriptionManage | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  async function check() {
    if (busy || offline) return;
    setBusy(true);
    setNote(null);
    try {
      const token = await firebaseAuth.idToken(true).catch(() => null);
      const got = token ? await manageProSubscription(token) : { ok: false as const, code: 'NOT_SIGNED_IN', message: 'Sign in again to manage Pro.' };
      if (live.current) setAnswer(got);
    } finally {
      if (live.current) setBusy(false);
    }
  }

  async function open(url: string) {
    let opened = false;
    if (isDesktopApp()) {
      try { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); opened = true; } catch { /* below */ }
    } else {
      opened = window.open(url, '_blank', 'noopener') !== null;
    }
    setNote(opened
      ? 'Paddle’s page is open in your browser. When you have finished there, choose Check again to see the change here.'
      : 'Your browser could not be opened. You can also cancel from the link in your Paddle receipt.');
  }

  return (
    <section aria-labelledby="manage-pro-h" className="space-y-2 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3">
      <h4 id="manage-pro-h" className="font-medium">Manage or cancel Pro</h4>
      <p>You can cancel at any time. Pro lasts until the end of the period you have paid for, then this account goes back to Basic, which is free. Your projects, edits and exports are never locked.</p>
      {answer?.ok && <p role="status">{subscriptionStateText(answer)}</p>}
      {answer && !answer.ok && <p role="alert" className="text-[var(--account-warning,#fde68a)]">{answer.message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} disabled={offline || busy} onClick={() => void check()}>{busy ? 'Checking…' : answer ? 'Check again' : 'Show my subscription'}</button>
        {answer?.ok && answer.cancelUrl && answer.state !== 'ending' && <button type="button" className={action} disabled={offline} onClick={() => void open(answer.cancelUrl!)}>Cancel Pro on Paddle’s page</button>}
        {answer?.ok && answer.paymentUrl && <button type="button" className={action} disabled={offline} onClick={() => void open(answer.paymentUrl!)}>Change card</button>}
        {answer?.ok && answer.manageUrl && <button type="button" className={action} disabled={offline} onClick={() => void open(answer.manageUrl!)}>Receipts and more</button>}
      </div>
      {note && <p role="status" className="text-xs text-[var(--account-muted,#a1a1aa)]">{note}</p>}
    </section>
  );
}
