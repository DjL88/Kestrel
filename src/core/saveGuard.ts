/**
 * Autosave that never quietly drops a change (G07).
 *
 * Every project's latest state is kept until a save of exactly that state succeeds. A failed save (storage full, the
 * browser refusing the write, a crash of the storage process) is retried with backoff and whenever the caller asks
 * (the tab comes back, the device comes online), and `hasUnsaved()` lets the app warn before it is closed. Switching to
 * another project never replaces the first one's pending change: pending states are kept per project.
 *
 * Pure apart from the injected timer, so it is unit tested without a browser.
 */
export type SaveStatus = 'saved' | 'saving' | 'failed';

export interface SaveGuardOptions<T> {
  save: (state: T) => Promise<void>;
  /** Waits before each retry after a failure; the last one repeats. */
  retryDelaysMs?: readonly number[];
  onStatus?: (status: SaveStatus, detail: { key: string; failures: number; error?: unknown }) => void;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SaveGuard<T> {
  /** Record the latest state of one project and save it. */
  submit: (key: string, state: T) => void;
  /** Retry every failed project now. */
  retryNow: () => void;
  /** True while any project has a change that is not yet stored. */
  hasUnsaved: () => boolean;
  /** True when a change is unsaved because a save failed (not merely in flight): the moment to warn before closing. */
  hasFailedUnsaved: () => boolean;
  /** Resolves when nothing is pending or saving (failed saves still count as pending). */
  idle: () => Promise<void>;
  dispose: () => void;
}

interface Slot<T> { latest: T; stored: T | undefined; saving: boolean; failures: number; timer: unknown }

export function createSaveGuard<T>(options: SaveGuardOptions<T>): SaveGuard<T> {
  const delays = options.retryDelaysMs?.length ? options.retryDelaysMs : [2_000, 5_000, 15_000, 30_000];
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const slots = new Map<string, Slot<T>>();
  let waiters: Array<() => void> = [];
  let disposed = false;

  const settled = () => [...slots.values()].every((slot) => !slot.saving && slot.timer == null);
  const wake = () => {
    if (!settled()) return;
    const ready = waiters;
    waiters = [];
    ready.forEach((resolve) => resolve());
  };

  const run = (key: string) => {
    const slot = slots.get(key);
    if (!slot || slot.saving || disposed) return;
    if (slot.timer != null) { clearTimer(slot.timer); slot.timer = null; }
    if (Object.is(slot.latest, slot.stored)) { wake(); return; }
    const attempt = slot.latest;
    slot.saving = true;
    options.onStatus?.('saving', { key, failures: slot.failures });
    options.save(attempt).then(() => {
      slot.saving = false;
      slot.stored = attempt;
      const recovered = slot.failures;
      slot.failures = 0;
      if (!Object.is(slot.latest, attempt)) { run(key); return; }
      options.onStatus?.('saved', { key, failures: recovered });
      wake();
    }, (error: unknown) => {
      slot.saving = false;
      slot.failures += 1;
      options.onStatus?.('failed', { key, failures: slot.failures, error });
      if (disposed) return;
      const ms = delays[Math.min(slot.failures - 1, delays.length - 1)];
      slot.timer = setTimer(() => { slot.timer = null; run(key); }, ms);
    });
  };

  return {
    submit(key, state) {
      const slot = slots.get(key);
      if (slot) slot.latest = state;
      else slots.set(key, { latest: state, stored: undefined, saving: false, failures: 0, timer: null });
      run(key);
    },
    retryNow() {
      for (const [key, slot] of slots) if (slot.failures > 0 && !slot.saving) run(key);
    },
    hasUnsaved() {
      return [...slots.values()].some((slot) => !Object.is(slot.latest, slot.stored));
    },
    hasFailedUnsaved() {
      return [...slots.values()].some((slot) => slot.failures > 0 && !Object.is(slot.latest, slot.stored));
    },
    idle() {
      return settled() ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve));
    },
    dispose() {
      disposed = true;
      for (const slot of slots.values()) if (slot.timer != null) clearTimer(slot.timer);
    },
  };
}
