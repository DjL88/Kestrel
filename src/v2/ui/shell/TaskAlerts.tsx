import { useEffect, useRef, useState } from 'react';
import { alertText, alreadyFinished, groupAlerts, newlyFinished, releaseHeld, TASK_ALERT_GROUP_MS, type TaskAlert } from '../../../core/taskAlerts';
import { tasks } from '../../../core/taskStore';
import { askNotifyPermission, notifyPermission, notifySystem, type NotifyPermission } from '../../../providers/systemNotify';
import { STRINGS } from '../strings';

/**
 * Task-done alerts (G20): when long work finishes (export, import, Auto-cull, develop), say so once, calmly. Offline and
 * account-free: it reads the local task list only.
 *
 * In the foreground: a quiet message here. In the background: held and told together on return ("While you were away"),
 * and also as a system notification if the person allowed it (asked only from the button here, never on load). In a
 * browser that is the Notification API; in the installed Windows, macOS and phone apps, the Tauri notification plugin
 * (src/providers/systemNotify.ts).
 */

export function TaskAlerts() {
  const t = STRINGS.taskAlerts;
  const seen = useRef<Set<number> | null>(null);
  const held = useRef<TaskAlert[]>([]);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<{ text: string; away: boolean; failed: boolean } | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>('denied');
  useEffect(() => { void notifyPermission().then(setPermission); }, []);
  const words = { oneDone: t.oneDone, oneFailed: t.oneFailed, manyDone: t.manyDone, manyWithFailures: t.manyWithFailures };

  useEffect(() => {
    seen.current = alreadyFinished(tasks.list());
    const visible = () => document.visibilityState === 'visible' && document.hasFocus();
    const flush = () => {
      pending.current = null;
      const finished = newlyFinished(tasks.list(), seen.current!);
      const alerts = groupAlerts(finished);
      if (!alerts.length) return;
      if (visible()) { setShown({ text: alerts.map((a) => alertText(a, words)).join(' '), away: false, failed: alerts.some((a) => a.failed > 0) }); return; }
      held.current.push(...alerts);
      for (const alert of alerts) void notifySystem(alertText(alert, words));
    };
    // Tasks that end close together are told as one: wait a moment after a change before looking.
    const stop = tasks.subscribe(() => { if (!pending.current) pending.current = setTimeout(flush, TASK_ALERT_GROUP_MS); });
    const back = () => {
      if (!visible()) return;
      const { show, keep } = releaseHeld(held.current, true);
      held.current = keep;
      if (show) setShown({ text: alertText(show, words), away: true, failed: show.failed > 0 });
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => { stop(); if (pending.current) clearTimeout(pending.current); window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // It goes away by itself after a while; a failure stays until dismissed so it is never missed.
  useEffect(() => {
    if (!shown || shown.failed) return;
    const timer = setTimeout(() => setShown(null), 12_000);
    return () => clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;
  return (
    <div role="status" aria-live="polite" data-testid="task-alert"
      className="pointer-events-none fixed right-4 top-14 z-50 flex max-w-[min(26rem,calc(100vw-2rem))] items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-2 pl-3.5 pr-1.5 text-xs font-medium text-[var(--text-primary)] shadow-[var(--shadow-popover)]">
      <span aria-hidden="true">{shown.failed ? '⚠' : '✓'}</span>
      <p className="flex-1">{shown.away && <span className="font-semibold">{t.whileAway} </span>}{shown.text}</p>
      {permission === 'default' && (
        <button type="button" data-testid="task-alert-allow" onClick={() => { void askNotifyPermission().then(setPermission); }}
          className="pointer-events-auto min-h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 hover:bg-[var(--bg-surface-hover)]">{t.allowSystem}</button>
      )}
      <button type="button" onClick={() => setShown(null)} className="pointer-events-auto min-h-7 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-surface-hover)]">{t.dismiss}</button>
    </div>
  );
}
