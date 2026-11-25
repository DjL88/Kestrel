/** A scheduled split export consists of independently saved panels, but
 * their pixels must come from the same completed composition. Retain only
 * the latest composition's encoded outputs, never its full-size canvas.
 * The GPU scheduler executes these requests serially within a batch.
 */
export function createSplitRenderCache<T>() {
  let current: { key: string; panels: readonly T[] } | undefined;
  return {
    async get(key: string, count: number, index: number, render: () => Promise<readonly T[]>): Promise<T> {
      if (!Number.isInteger(count) || count < 1 || count > 5 ||
          !Number.isInteger(index) || index < 0 || index >= count) {
        throw new RangeError('Invalid split export panel.');
      }
      if (current?.key !== key || current.panels.length !== count) {
        current = undefined;
        const panels = await render();
        if (panels.length !== count || Array.from(panels).some(panel => panel == null)) {
          throw new Error('A requested split panel was not rendered.');
        }
        current = { key, panels };
      }
      const panel = current.panels[index];
      // Consecutive panels reuse one composition; release after the last.
      // Failed delivery can still be retried using the immutable job snapshot.
      if (index === count - 1) current = undefined;
      return panel;
    },
    clear() { current = undefined; },
  };
}
