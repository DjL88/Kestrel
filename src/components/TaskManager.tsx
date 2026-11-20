import { useEffect, useSyncExternalStore, useState, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import { taskHealth, tasks, tasksNeedAttention, type Health, type Task } from '../core/taskStore';
import { libraryText as t } from '../i18n/areas/library';

/** Each level has its own word and icon as well as a colour, so it never depends on telling colours apart. */
const HEALTH: Record<Health, { word: string; classes: string; Icon: typeof Clock }> = {
  idle: { word: t.tasks.tasks, classes: 'border-white/15 bg-kestrel-raised text-zinc-100', Icon: CheckCircle2 },
  ok: { word: t.tasks.working, classes: 'border-sky-300/60 bg-sky-400/15 text-sky-50', Icon: Loader2 },
  busy: { word: t.tasks.busy, classes: 'border-amber-300/70 bg-amber-400/20 text-amber-50', Icon: Clock },
  stalled: { word: t.tasks.stalled, classes: 'border-red-300/80 bg-red-500/25 text-red-50', Icon: AlertTriangle },
  problem: { word: t.tasks.problem, classes: 'border-red-300/80 bg-red-500/25 text-red-50', Icon: AlertTriangle },
};

const label = (task: Task) => {
  if (task.state === 'running') return task.total ? t.tasks.progress(task.done, task.total) : task.done ? t.tasks.doneSoFar(task.done) : t.tasks.workingEllipsis;
  return { done: t.tasks.finished, failed: t.tasks.failed, cancelled: t.tasks.cancelled }[task.state];
};

/**
 * Every heavy job in one place, each with its progress and a Cancel. Hidden when there is nothing to show.
 * `inline` sits in a page's own header: the work in hand as a compact progress bar (no separate row), and the full
 * list drops down from it. Otherwise it is a slim strip of its own at the top of the page.
 */
export function TaskManager({ inline = false }: { inline?: boolean } = {}) {
  const list = useSyncExternalStore(tasks.subscribe, tasks.list, tasks.list);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!list.length) setOpen(false); }, [list.length]);
  // Work that finished a moment ago stays in view briefly, then the button goes away so it never sits over other controls.
  const recent = tasksNeedAttention(list, at);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      opener.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  // Look again every second, so a task that stops moving is noticed and a finished one is let go.
  useEffect(() => {
    if (!list.length) return;
    const timer = window.setInterval(() => setAt(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [list.length]);
  if (!list.length || (!recent && !open)) return null;
  const health = taskHealth(list, Math.max(at, ...list.map((task) => task.updatedAt)));
  const { word, classes, Icon } = HEALTH[health];
  const running = list.filter((task) => task.state === 'running').length;
  const first = list.find((task) => task.state === 'running');
  const summary = first ? `${first.title}, ${label(first)}` : word;
  const others = running > 1 ? running - 1 : 0;
  const panel = open && (
    <section aria-label={t.tasks.tasks} className={`absolute right-2 top-full mt-1 max-h-[65dvh] overflow-y-auto overscroll-contain w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-white/15 bg-kestrel-raised p-3 text-sm text-zinc-100 shadow-lg ${inline ? 'z-40 right-0' : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium">{t.tasks.tasks}</h2>
        <button type="button" onClick={() => tasks.clearFinished()} disabled={running === list.length} className="min-h-11 rounded-md px-2 text-xs text-zinc-300 underline hover:bg-white/8 disabled:opacity-40">{t.tasks.clearFinished}</button>
      </div>
      <ul className="space-y-3">
        {list.map((task) => (
          <li key={task.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{task.title}</span>
              {task.state === 'running' && (
                <button type="button" onClick={() => tasks.cancel(task.id)} aria-label={t.tasks.cancelTask(task.title)} title={t.tasks.cancel}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-4 w-4" aria-hidden="true" /></button>
              )}
            </div>
            {task.state === 'running' && task.total ? <progress aria-label={task.title} className="block w-full" value={task.done} max={task.total} /> : null}
            <p className="break-words text-xs text-zinc-400">{label(task)}{task.detail ? ` · ${task.detail}` : ''}</p>
          </li>
        ))}
      </ul>
    </section>
  );
  if (inline) {
    // The work in hand, small: its name, how far it has got as words and as a thin bar, and how many others are running.
    const fraction = first?.total ? Math.min(1, first.done / first.total) : null;
    return (
      <div ref={root} className="relative min-w-0">
        <button ref={opener} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
          aria-label={t.tasks.summary(summary, others)} title={t.tasks.showEvery}
          className={`flex min-h-11 max-w-full min-w-0 flex-col justify-center gap-1 rounded-md border px-2.5 py-1 text-left text-xs hover:brightness-125 focus-visible:outline-2 focus-visible:outline-sky-300 ${first ? 'w-56 max-sm:w-36' : 'w-auto'} ${classes}`}>
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <Icon className={`h-3.5 w-3.5 shrink-0 ${health === 'ok' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{first ? first.title : word}</span>
            <span className="shrink-0 tabular-nums">{first ? (first.total ? `${first.done}/${first.total}` : '') : ''}{others ? ` +${others}` : ''}</span>
          </span>
          {first && <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-full bg-black/40">
            <span className={`block h-full bg-current ${fraction === null ? 'w-1/3 motion-safe:animate-pulse' : ''}`} style={fraction === null ? undefined : { width: `${Math.max(3, fraction * 100)}%` }} />
          </span>}
        </button>
        {panel}
      </div>
    );
  }
  return (
    // A slim strip at the top of the page, in the flow, so it never sits over a control. The list drops down from it.
    <div ref={root} className="relative z-40 flex shrink-0 justify-end border-b border-white/10 bg-kestrel-panel px-2 py-0.5">
      {panel}
      <button ref={opener} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:brightness-125 focus-visible:outline-2 focus-visible:outline-sky-300 ${classes}`}>
        <Icon className={`h-4 w-4 ${health === 'ok' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
        {running > 0 ? `${word} · ${t.tasks.running(running)}` : word}
      </button>
    </div>
  );
}
