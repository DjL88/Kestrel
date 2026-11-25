import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notice } from '../../../core/collabNotices';
import type { CollabClient } from '../../../providers/collabClient';
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
  const reload = useCallback(async () => {
    try { const inbox = await client.notices(); setNotices(inbox.notices); setUnread(inbox.unread); setFailed(false); setEnabled(true); } catch { setFailed(true); }
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

export function NoticesButton({ notices, onGoToPhoto }: { notices: ReturnType<typeof useNotices>; onGoToPhoto: (projectId: string, photoId: string) => boolean }) {
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
        </div>
      )}
    </div>
  );
}
