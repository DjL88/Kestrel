import { useEffect, useState } from 'react';
import { tasks, type Task } from '../../core/taskStore';

/** How often the workspace takes a fresh task list: progress shows four times a second, which reads as live. */
export const TASK_LIST_EVERY_MS = 250;

interface Store { subscribe(listener: () => void): () => void; list(): readonly Task[] }
interface Timers { set(run: () => void, ms: number): unknown; clear(handle: unknown): void; now(): number }
const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => Date.now() };

/**
 * Hand the task list on at most once per `everyMs`, the newest each time (never a stale one, never dropped): a busy
 * job reports progress many times a second, and each report used to redraw the whole workspace at once, holding the
 * page for about 100 ms each time on a busy laptop (owner, 27 Nov). The first change after a quiet spell goes at once.
 */
export function feedTaskList(store: Store, deliver: (list: readonly Task[]) => void, everyMs = TASK_LIST_EVERY_MS, timers: Timers = realTimers): () => void {
  let pending: unknown = null;
  let last = -Infinity;
  const flush = () => { pending = null; last = timers.now(); deliver(store.list()); };
  const stop = store.subscribe(() => {
    if (pending !== null) return;
    const wait = last + everyMs - timers.now();
    if (wait <= 0) flush(); else pending = timers.set(flush, wait);
  });
  return () => { stop(); if (pending !== null) timers.clear(pending); };
}

/**
 * The task list for the workspace, fed at most four times a second. An ordinary update, not a transition: a transition
 * render can start from older state and be thrown away, yet the workspace and filmstrip write refs while they render
 * (the photo the arrow keys step from), so a discarded render could put an older photo back and lose a key press.
 */
export function useTaskList(store: Store = tasks): readonly Task[] {
  const [list, setList] = useState<readonly Task[]>(() => store.list());
  useEffect(() => {
    setList(store.list());
    return feedTaskList(store, setList);
  }, [store]);
  return list;
}
