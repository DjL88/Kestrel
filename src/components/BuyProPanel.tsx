import { useEffect, useRef, useState } from 'react';
import { CHECKOUT_POLL_MS, keepPolling, priceText } from '../core/proCheckout';
import { firebaseAuth } from '../providers/firebaseAuth';
import { proCheckoutStatus, startProCheckout } from '../providers/licenceStore';
import { isDesktopApp } from '../providers/desktopShell';

const action = 'min-h-11 rounded-md border border-[var(--account-border,#ffffff26)] px-3 text-sm text-[var(--account-foreground,#f4f4f5)] hover:bg-white/8 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-sky-300';

type Waiting = { checkoutId: string; url: string; price: string | null; startedMs: number; opened: boolean };

/**
 * Buy Pro for the signed-in account. The server opens the order for this account; the payment itself happens in
 * Paddle's checkout on our website. Paddle is the merchant of record: it asks for the country and adds the right tax.
 * This panel waits for the server to confirm the payment
 * (checking every 10 seconds, for up to 20 minutes), then hands over to `onPaid`, which activates this device.
 */
export function BuyProPanel({ offline, onPaid }: { offline: boolean; onPaid: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  async function openPage(url: string, preopened: Window | null): Promise<boolean> {
    if (isDesktopApp()) {
      try { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); return true; } catch { return false; }
    }
    if (preopened && !preopened.closed) { try { preopened.location.href = url; return true; } catch { /* fall through */ } }
    return window.open(url, '_blank', 'noopener') !== null;
  }

  async function buy() {
    if (busy || offline) return;
    // A browser only allows a new tab straight from the click, so open it now and point it at the checkout once the server answers.
    const preopened = isDesktopApp() ? null : window.open('', '_blank');
    if (preopened) { try { preopened.opener = null; } catch { /* already separate */ } }
    setBusy(true);
    setNote(null);
    try {
      const token = await firebaseAuth.idToken(true).catch(() => null);
      if (!token) { preopened?.close(); setNote({ text: 'Sign in again to buy Pro.', good: false }); return; }
      const started = await startProCheckout(token);
      if (!live.current) return;
      if (!started.ok) { preopened?.close(); setNote({ text: started.message, good: false }); return; }
      const opened = await openPage(started.url, preopened);
      setWaiting({ checkoutId: started.checkoutId, url: started.url, price: priceText(started.totalPence, started.currency), startedMs: Date.now(), opened });
    } finally {
      if (live.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!waiting || offline) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (stopped) return;
      if (!keepPolling(waiting.startedMs, Date.now())) {
        setWaiting(null);
        setNote({ text: 'Stopped checking after 20 minutes. If you paid, choose Check Pro online; the payment is still confirmed on our side.', good: false });
        return;
      }
      const token = await firebaseAuth.idToken().catch(() => null);
      const answer = token ? await proCheckoutStatus(token, waiting.checkoutId) : 'retry';
      if (stopped) return;
      if (answer === 'paid') {
        setWaiting(null);
        setNote({ text: 'Payment confirmed. Thank you. Turning on Pro on this device…', good: true });
        await onPaid();
        return;
      }
      if (answer === 'gone') {
        setWaiting(null);
        setNote({ text: 'That checkout is no longer open. Nothing more will be charged. You can start again.', good: false });
        return;
      }
      timer = setTimeout(() => void check(), CHECKOUT_POLL_MS);
    };
    timer = setTimeout(() => void check(), CHECKOUT_POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [waiting, offline, onPaid]);

  return (
    <section aria-labelledby="buy-pro-h" className="space-y-2 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3">
      <h4 id="buy-pro-h" className="font-medium">Buy InFlight Pro</h4>
      {waiting ? (
        <>
          <p role="status">{waiting.opened ? 'Finish paying in the checkout in your browser.' : 'Open the checkout to pay.'}{waiting.price ? ` Total ${waiting.price}.` : ''} This updates by itself once the payment is confirmed.</p>
          <div className="flex flex-wrap gap-2">
            <a className={`${action} inline-flex items-center`} href={waiting.url} target="_blank" rel="noopener noreferrer"
              onClick={(event) => { if (!isDesktopApp()) return; event.preventDefault(); void openPage(waiting.url, null).then((ok) => { if (!ok) setNote({ text: 'This version could not open your browser. Copy the address below into your browser to pay.', good: false }); }); }}>
              Open the payment page
            </a>
            <button type="button" className={action} onClick={() => { setWaiting(null); setNote({ text: 'Stopped waiting. If you paid, choose Check Pro online.', good: false }); }}>Stop waiting</button>
          </div>
          {!waiting.opened && <p className="break-all text-xs text-[var(--account-muted,#a1a1aa)]">{waiting.url}</p>}
        </>
      ) : (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void buy(); }}>
          <p>Pro adds assisted culling, species suggestions and the online helper. You pay in a secure checkout run by Paddle, our reseller, which adds any sales tax or VAT for your country; InFlight never sees your card.</p>
          <button type="submit" className={action} disabled={offline || busy}>{busy ? 'Opening the payment page…' : 'Buy Pro'}</button>
        </form>
      )}
      {note && <p role={note.good ? 'status' : 'alert'} className={note.good ? 'text-[var(--account-foreground,#a7f3d0)]' : 'text-[var(--account-warning,#fde68a)]'}>{note.text}</p>}
    </section>
  );
}
