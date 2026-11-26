import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notice } from '../../../core/collabNotices';
import type { CollabClient, EmailSettings } from '../../../providers/collabClient';
import type { PushPreferences, PushState } from '../../../core/pushNotices';
import { currentPushState, turnOffPush, turnOnPush } from '../../../providers/webPush';
import { STRINGS } from '../strings';

/**
 * Team notifications for shared projects (G20, owner decision 11): the in-app inbox comes first. Shown only to a
 * signed-in person on a build with sharing; read on open and on a calm two-minute poll while the window is visible.
 * Reading the inbox also tells the server the app is open, so nothing is emailed meanwhile.
 */
export function useNotices(client: CollabClient, signedIn: () => Promise<string | null>) {
  const [enabled, setEnabled] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);
  const languageSent = useRef(false);
  const reload = useCallback(async () => {
    try { const inbox = await client.notices(); setNotices(inbox.notices); setUnread(inbox.unread); setFailed(false); setEnabled(true); } catch { setFailed(true); return; }
    // Once a session: the app's language, so an email that has to stand in for an alert uses the person's words.
    if (!languageSent.current) { languageSent.current = true; void client.setEmailSettings({}).catch(() => undefined); }
  }, [client]);
  useEffect(() => {
    if (!client.configured) return;
    let stopped = false;
    void signedIn().then((name) => { if (name && !stopped) void reload(); }, () => undefined);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void signedIn().then((name) => { if (name) void reload(); }, () => undefined); }, 120_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [client, signedIn, reload]);
  const markAllRead = useCallback(async () => {
    try { await client.readNotices('all'); await reload(); } catch { setFailed(true); }
  }, [client, reload]);
  return { enabled, notices, unread, failed, reload, markAllRead };
}

function line(n: Notice): string {
  const t = STRINGS.notices;
  const who = n.actors.length === 0 ? t.someone : n.actors.length === 1 ? n.actors[0] : t.andMore(n.actors[0], n.actors.length - 1);
  const what = n.kind === 'comment' ? t.comment(who) : n.kind === 'reply' ? t.reply(who) : n.kind === 'resolve' ? t.resolve(who)
    : n.kind === 'reopen' ? t.reopen(who) : t.clientFeedback(n.galleryName ?? '');
  return n.count > 1 ? `${what} (${n.count})` : what;
}

/**
 * Alerts on this device (G20 push): shown under the inbox when the server sends push. Turning on asks the browser from
 * this click only; the kinds chosen apply to all the person's devices. The installed apps say the inbox is where to look.
 */
function PushAlerts({ client, signedIn }: { client: CollabClient; signedIn: () => Promise<string | null> }) {
  const t = STRINGS.notices;
  const [server, setServer] = useState<{ preferences: PushPreferences } | null>(null);
  const [state, setState] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const settings = await client.pushSettings();
        const name = await signedIn().catch(() => null);
        if (!live || !settings.available) return;
        setServer({ preferences: settings.preferences });
        setState(currentPushState(Boolean(name)));
      } catch { /* push not set up on this server: nothing to show */ }
    })();
    return () => { live = false; };
  }, [client, signedIn]);
  if (!server || state === 'not-configured' || state === 'signed-out') return null;
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setFailed(false);
    try { await work(); } catch { setFailed(true); } finally { setBusy(false); }
  };
  const setKind = (key: keyof PushPreferences, on: boolean) => run(async () => { setServer({ preferences: await client.setPushPreferences({ [key]: on }) }); });
  return (
    <div data-testid="push-alerts" className="mt-2 border-t border-[var(--border-default)] pt-2">
      <h3 className="mb-1 text-[12px] font-semibold">{t.pushHeading}</h3>
      {state === 'unsupported' && <p className="text-[var(--text-secondary)]">{t.pushAppOnly}</p>}
      {state === 'blocked' && <p className="text-[var(--text-secondary)]">⚠ {t.pushBlocked}</p>}
      {(state === 'on' || state === 'off') && (
        <label className="flex min-h-7 items-center gap-2">
          <input type="checkbox" data-testid="push-this-device" checked={state === 'on'} disabled={busy}
            onChange={(event) => { const on = event.target.checked; void run(async () => { if (on) setState(await turnOnPush(client)); else { await turnOffPush(client); setState('off'); } }); }} />
          {t.pushThisDevice}
        </label>
      )}
      <fieldset className="mt-1" disabled={busy}>
        <legend className="text-[11px] text-[var(--text-secondary)]">{t.pushKinds}</legend>
        <label className="flex min-h-7 items-center gap-2"><input type="checkbox" checked={server.preferences.comments} onChange={(event) => void setKind('comments', event.target.checked)} />{t.pushComments}</label>
        <label className="flex min-h-7 items-center gap-2"><input type="checkbox" checked={server.preferences.clientFeedback} onChange={(event) => void setKind('clientFeedback', event.target.checked)} />{t.pushClientFeedback}</label>
        <label className="flex min-h-7 items-center gap-2"><input type="checkbox" data-testid="push-news" checked={server.preferences.news} onChange={(event) => void setKind('news', event.target.checked)} />{t.pushNews}</label>
      </fieldset>
      {failed && <p role="status" className="text-[var(--text-secondary)]">⚠ {t.pushFailed}</p>}
    </div>
  );
}

/**
 * Settings → Account → Communication preferences (UK GDPR / PECR). One place for every message InFlight may send:
 * - Marketing email: InFlight news and new features. Off unless the person turns it on.
 * - Product email: comments and client feedback on their shared projects, only when an alert cannot reach them. On
 *   unless turned off.
 * - Alerts (FCM push): which kinds, for all their devices, and whether this device gets them.
 * Account and security emails (such as a bought licence key) are not optional. Every email has a link that stops it.
 * Shown only to a signed-in person on a server that can send any of these.
 */
export function CommunicationPreferences({ client, signedIn }: { client: CollabClient; signedIn: () => Promise<string | null> }) {
  const t = STRINGS.notices;
  const [state, setState] = useState<EmailSettings | null>(null);
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!client.configured) return;
    let live = true;
    void (async () => {
      if (!(await signedIn().catch(() => null))) return;
      const [email, alerts] = await Promise.all([client.emailSettings().catch(() => null), client.pushSettings().catch(() => null)]);
      if (!live) return;
      if (email && (email.available || email.productEmailAvailable)) setState(email);
      setPush(Boolean(alerts?.available));
    })();
    return () => { live = false; };
  }, [client, signedIn]);
  if (!state && !push) return null;
  const change = async (key: 'productNews' | 'productEmail', on: boolean) => {
    setBusy(true); setFailed(false);
    try { const next = await client.setEmailSettings({ [key]: on }); setState((s) => (s ? { ...s, ...next } : s)); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return (
    <section data-testid="communication-preferences" aria-labelledby="communication-title" className="mt-5 space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4">
      <h3 id="communication-title" className="text-xs font-semibold text-[var(--text-primary)]">{t.communicationHeading}</h3>
      {state && (
        <fieldset className="space-y-1" disabled={busy}>
          <legend className="text-[11px] font-semibold text-[var(--text-secondary)]">{t.newsEmailHeading}</legend>
          {state.available && (
            <>
              <label className="flex min-h-7 items-center gap-2 text-[var(--text-primary)]">
                <input type="checkbox" data-testid="news-email-toggle" checked={state.productNews} aria-describedby="news-email-hint" onChange={(event) => void change('productNews', event.target.checked)} />
                {t.newsEmailLabel}
              </label>
              <p id="news-email-hint" className="text-xs text-[var(--text-secondary)]">{t.newsEmailHint}</p>
            </>
          )}
          {state.productEmailAvailable && (
            <>
              <label className="flex min-h-7 items-center gap-2 text-[var(--text-primary)]">
                <input type="checkbox" data-testid="product-email-toggle" checked={state.productEmail} aria-describedby="product-email-hint" onChange={(event) => void change('productEmail', event.target.checked)} />
                {t.productEmailLabel}
              </label>
              <p id="product-email-hint" className="text-xs text-[var(--text-secondary)]">{t.productEmailHint}</p>
            </>
          )}
          <p className="text-xs text-[var(--text-secondary)]">{t.accountEmailNote}</p>
        </fieldset>
      )}
      {failed && <p role="status" className="text-xs text-[var(--text-secondary)]">⚠ {t.newsEmailFailed}</p>}
      {push && <PushAlerts client={client} signedIn={signedIn} />}
    </section>
  );
}

export function NoticesButton({ notices, client, signedIn, onGoToPhoto }: { notices: ReturnType<typeof useNotices>; client: CollabClient; signedIn: () => Promise<string | null>; onGoToPhoto: (projectId: string, photoId: string) => boolean }) {
  const t = STRINGS.notices;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const click = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key); window.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', click); };
  }, [open]);
  if (!notices.enabled) return null;
  const label = notices.unread ? t.buttonCount(notices.unread) : t.button;
  return (
    <div ref={ref} className="relative">
      <button type="button" data-testid="notices-button" aria-expanded={open} aria-label={label} title={label}
        onClick={() => { setOpen((v) => !v); if (!open) void notices.reload(); }}
        className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        {notices.unread > 0 && <span className="font-semibold">{notices.unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={t.heading} data-testid="notices-panel"
          className="absolute right-0 top-9 z-[70] w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-[12px] text-[var(--text-primary)] shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">{t.heading}</h2>
            {notices.unread > 0 && <button type="button" onClick={() => void notices.markAllRead()} className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] hover:bg-[var(--bg-surface-hover)]">{t.markAllRead}</button>}
          </div>
          {notices.failed && <p role="status" className="text-[var(--text-secondary)]">⚠ {t.failed}</p>}
          {notices.notices.length === 0 && !notices.failed && <p className="text-[var(--text-secondary)]">{t.none}</p>}
          <ul className="max-h-80 overflow-y-auto inflight-scroll">
            {notices.notices.map((n) => (
              <li key={n.id} data-testid="notice" data-unread={n.readAtMs === null}>
                <button type="button" disabled={!n.photoId} onClick={() => { if (n.photoId && onGoToPhoto(n.projectId, n.photoId)) setOpen(false); }}
                  className={`w-full rounded-[var(--radius-sm)] p-1.5 text-left hover:bg-[var(--bg-surface-hover)] ${n.readAtMs === null ? 'font-semibold' : 'text-[var(--text-secondary)]'}`}>
                  {n.readAtMs === null && <span aria-hidden="true">● </span>}<span className="sr-only">{n.readAtMs === null ? t.unread : ''}</span>
                  {line(n)}
                  <span className="block text-[10px] font-normal text-[var(--text-secondary)]">{n.projectName} · <time dateTime={new Date(n.updatedAtMs).toISOString()}>{new Date(n.updatedAtMs).toLocaleString()}</time></span>
                </button>
              </li>
            ))}
          </ul>
          <PushAlerts client={client} signedIn={signedIn} />
        </div>
      )}
    </div>
  );
}
