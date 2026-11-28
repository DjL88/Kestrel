/**
 * Phone Back button and the open dialog. Android's Back (and an iOS edge swipe) pops a browser history entry, and a screen
 * that never added one lets Back close the whole app, even with a dialog open on top. This keeps one history entry per
 * open dialog, in step with what is on screen, and says which dialog a Back press should close.
 *
 * Pure bookkeeping, so it can be tested without a browser: the caller reports which dialogs are open (`sync`), pushes or
 * drops history entries as told, and asks what to close on a Back press (`back`).
 */
export interface OverlaySync {
  /** History entries to add (dialogs that just opened). */
  push: number;
  /** History entries to drop (dialogs that closed by their own button, not by Back). */
  pop: number;
}

export class OverlayBack<T> {
  /** Dialogs that own a history entry, oldest first. */
  private stack: T[] = [];
  /** Dialogs Back has already been used on. A dialog that ignores it is not given another entry, so the next Back leaves. */
  private consumed = new Set<T>();

  /** The dialogs open now, in document order. */
  sync(open: readonly T[]): OverlaySync {
    const present = new Set(open);
    let push = 0;
    for (const dialog of open) {
      if (this.stack.includes(dialog) || this.consumed.has(dialog)) continue;
      this.stack.push(dialog);
      push += 1;
    }
    const before = this.stack.length;
    this.stack = this.stack.filter((dialog) => present.has(dialog));
    const pop = before - this.stack.length;
    for (const dialog of this.consumed) if (!present.has(dialog)) this.consumed.delete(dialog);
    return { push, pop };
  }

  /** A Back press. The topmost dialog to ask to close, or null when no dialog owns an entry (Back then behaves as before). */
  back(): T | null {
    const dialog = this.stack.pop();
    if (dialog === undefined) return null;
    this.consumed.add(dialog);
    return dialog;
  }

  get depth(): number { return this.stack.length; }
}
