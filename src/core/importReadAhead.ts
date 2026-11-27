import type { MemoryBudget } from './memoryBudget';

/**
 * Reading photos ahead during an import, so several are read at once while each is still added in its own turn.
 *
 * The task scheduler runs one photo of a job at a time, and that stays: progress, pause, stop and "retry failed items
 * only" all count whole photos. But an import's work is waiting (reading the file, decoding its preview), so one at a
 * time left 15 of 16 cores idle and a 2,000-RAW folder took hours. Each photo's turn now also starts the reads of the
 * next few photos; when their turns come, their reads are done or nearly done. A photo is read once: its turn uses the
 * read already started. A retried photo is read again, and only it.
 */
export interface ReadAhead<T> {
  /** This photo's read (started now if it was not already), after starting the next photos' reads. */
  take(index: number): Promise<T>;
}

export function createReadAhead<T>(count: number, lanes: number, read: (index: number) => Promise<T>): ReadAhead<T> {
  const width = Math.max(1, Math.floor(lanes));
  const started = new Map<number, Promise<T>>();
  const taken = new Set<number>();
  const start = (index: number) => {
    if (index < 0 || index >= count || started.has(index) || taken.has(index)) return;
    const pending = read(index);
    pending.catch(() => undefined); // Its own turn reports the failure.
    started.set(index, pending);
  };
  return {
    async take(index) {
      taken.delete(index); // A retried photo is read again.
      start(index);
      taken.add(index);
      for (let next = index + 1; next < index + width; next += 1) start(next);
      const own = started.get(index)!;
      try { return await own; } finally { started.delete(index); }
    },
  };
}

/**
 * How many photos an import reads at once: one fewer than the cores (the screen keeps one), and no more than the
 * device's memory tier allows, since each decodes its camera preview (a Nikon Z 8's is 45 MP, about 180 MB while
 * decoded). Low: 2, standard: 4, high: 6.
 */
export function importLanes(budget: Pick<MemoryBudget, 'tier'>, cores: number | undefined): number {
  const byMemory = budget.tier === 'low' ? 2 : budget.tier === 'standard' ? 4 : 6;
  const byCores = Number.isFinite(cores) && cores! > 1 ? Math.floor(cores!) - 1 : 1;
  return Math.max(1, Math.min(byMemory, byCores));
}
