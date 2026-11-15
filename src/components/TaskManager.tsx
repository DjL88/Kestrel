import { useSyncExternalStore, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { tasks, type Task } from '../core/taskStore';

const label = (task: Task) => {
  if (task.state === 'running') return task.total ? `${task.done} of ${task.total}` : task.done ? `${task.done} done` : 'Working…';
  return { done: 'Finished', failed: 'Stopped by a problem', cancelled: 'Cancelled' }[task.state];
};

/** Every heavy job in one place, each with its progress and a Cancel. Hidden when there is nothing to show. */
export function TaskManager() {
  const list = useSyncExternalStore(tasks.subscribe, tasks.list, tasks.list);
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const running = list.filter((task) => task.state === 'running').length;
  return (
    <div className="fixed bottom-3 right-3 z-[70] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2">
      {open && (
        <section aria-label="Tasks" className="w-80 max-w-full rounded-xl border border-white/15 bg-kestrel-raised p-3 text-sm text-zinc-100 shadow-lg">
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
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-kestrel-raised px-4 text-sm text-zinc-100 shadow-lg hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
        {running > 0 && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
        {running > 0 ? `${running} task${running === 1 ? '' : 's'} running` : 'Tasks'}
      </button>
    </div>
  );
}
