import React from 'react';
import { CHECKOUT_POLL_MS, keepPolling } from '../../core/proCheckout';
import { formatPence } from '../../core/cloudPlan';
import { firebaseAuth } from '../../providers/firebaseAuth';
import { isDesktopApp } from '../../providers/desktopShell';
import { startTopUpCheckout, topUpCheckoutStatus } from '../../providers/licenceStore';
import { STRINGS } from './strings';

export interface TopUpNote { text: string; good: boolean }

/**
 * Settings → Account → Cloud usage: buy a prepaid top-up (£5, £10 or £20). The server opens a Paddle checkout bound to
 * this account; the payment happens in the browser. This waits for the server to confirm Paddle's payment (every 10
 * seconds, for up to 20 minutes), then `onCredited` reads the new balance. Nothing here touches photos or edits, and a
 * failure here never charges anything.
 */
export function useCloudTopUp(onCredited: () => void): { busy: boolean; note: TopUpNote | null; topUp: (pence: number) => void } {
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<TopUpNote | null>(null);
  const [waiting, setWaiting] = React.useState<{ checkoutId: string; pence: number; startedMs: number } | null>(null);
  const words = STRINGS.cloudUsage;

  const topUp = React.useCallback((pence: number) => {
    if (busy || waiting) return;
    // A browser allows a new tab only straight from the click: open it now, point it at the checkout once the server answers.
    const preopened = isDesktopApp() ? null : window.open('', '_blank');
    if (preopened) { try { preopened.opener = null; } catch { /* already separate */ } }
    setBusy(true);
    setNote(null);
    void (async () => {
      try {
        const token = await firebaseAuth.idToken(true).catch(() => null);
        if (!token) { preopened?.close(); setNote({ text: 'Sign in again to top up.', good: false }); return; }
        const started = await startTopUpCheckout(token, pence);
        if (!started.ok) { preopened?.close(); setNote({ text: started.message, good: false }); return; }
        let opened = false;
        if (isDesktopApp()) {
          try { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(started.url); opened = true; } catch { /* below */ }
        } else if (preopened && !preopened.closed) {
          try { preopened.location.href = started.url; opened = true; } catch { /* below */ }
        }
        if (!opened) opened = window.open(started.url, '_blank', 'noopener') !== null;
        setNote({ text: opened ? words.topUpWaiting : `${words.topUpWaiting} ${started.url}`, good: true });
        setWaiting({ checkoutId: started.checkoutId, pence, startedMs: Date.now() });
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, waiting, words]);

  React.useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (stopped) return;
      if (!keepPolling(waiting.startedMs, Date.now())) { setWaiting(null); setNote({ text: words.topUpStopped, good: false }); return; }
      const token = await firebaseAuth.idToken().catch(() => null);
      const answer = token ? await topUpCheckoutStatus(token, waiting.checkoutId) : 'retry';
      if (stopped) return;
      if (answer === 'paid') { setWaiting(null); setNote({ text: words.topUpDone(formatPence(waiting.pence)), good: true }); onCredited(); return; }
      if (answer === 'gone') { setWaiting(null); setNote(null); return; }
      timer = setTimeout(() => void check(), CHECKOUT_POLL_MS);
    };
    timer = setTimeout(() => void check(), CHECKOUT_POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [waiting, onCredited, words]);

  return { busy: busy || !!waiting, note, topUp };
}
