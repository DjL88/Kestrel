import { useEffect, useSyncExternalStore, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import { taskHealth, tasks, type Health, type Task } from '../core/taskStore';

/** How long the button stays after the last piece of work finishes. */
const SHOW_AFTER_MS = 10_000;

/** Each level has its own word and icon as well as a colour, so it never depends on telling colours apart. */
const HEALTH: Record<Health, { word: string; classes: string; Icon: typeof Clock }> = {
  idle: { word: 'Tasks', classes: 'border-white/15 bg-kestrel-raised text-zinc-100', Icon: CheckCircle2 },
  ok: { word: 'Working', classes: 'border-sky-300/60 bg-sky-400/15 text-sky-50', Icon: Loader2 },
  busy: { word: 'Busy', classes: 'border-amber-300/70 bg-amber-400/20 text-amber-50', Icon: Clock },
  stalled: { word: 'Stuck?', classes: 'border-red-300/80 bg-red-500/25 text-red-50', Icon: AlertTriangle },
  problem: { word: 'Problem', classes: 'border-red-300/80 bg-red-500/25 text-red-50', Icon: AlertTriangle },
};

const label = (task: Task) => {
  if (task.state === 'running') return task.total ? `${task.done} of ${task.total}` : task.done ? `${task.done} done` : 'Working…';
  return { done: 'Finished', failed: 'Stopped by a problem', cancelled: 'Cancelled' }[task.state];
};

/** Every heavy job in one place, each with its progress and a Cancel. Hidden when there is nothing to show. */
export function TaskManager() {
  const list = useSyncExternalStore(tasks.subscribe, tasks.list, tasks.list);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(() => Date.now());
  const anyRunning = list.some((task) => task.state === 'running');
  // Work that finished a moment ago stays in view briefly, then the button goes away so it never sits over other controls.
  const recent = anyRunning || list.some((task) => task.endedAt !== undefined && at - task.endedAt < SHOW_AFTER_MS);
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
  return (
    // A slim strip at the top of the page, in the flow, so it never sits over a control. The list drops down from it.
    <div className="relative z-40 flex shrink-0 justify-end border-b border-white/10 bg-kestrel-panel px-2 py-0.5">
      {open && (
        <section aria-label="Tasks" className="absolute right-2 top-full mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-white/15 bg-kestrel-raised p-3 text-sm text-zinc-100 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-medium">Tasks</h2>
            <button type="button" onClick={() => tasks.clearFinished()} disabled={running === list.length} className="min-h-11 rounded-md px-2 text-xs text-zinc-300 underline hover:bg-white/8 disabled:opacity-40">Clear finished</button>
          </div>
          <ul className="space-y-3">
            {list.map((task) => (
              <li key={task.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{task.title}</span>
                  {task.state === 'running' && (
                    <button type="button" onClick={() => tasks.cancel(task.id)} aria-label={`Cancel ${task.title}`} title="Cancel"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-4 w-4" aria-hidden="true" /></button>
                  )}
                </div>
                {task.state === 'running' && task.total ? <progress aria-label={task.title} className="block w-full" value={task.done} max={task.total} /> : null}
                <p className="text-xs text-zinc-400">{label(task)}{task.detail ? ` · ${task.detail}` : ''}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium hover:brightness-125 focus-visible:outline-2 focus-visible:outline-sky-300 ${classes}`}>
        <Icon className={`h-4 w-4 ${health === 'ok' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
        {running > 0 ? `${word} · ${running} task${running === 1 ? '' : 's'}` : word}
      </button>
    </div>
  );
}
