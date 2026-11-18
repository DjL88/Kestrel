/**
 * Bounded offline source reads for large contact sheets.
 *
 * A clicked photo must not wait behind RAW thumbnails for a previous scroll
 * position. New viewport work precedes old viewport work at the same priority.
 * Already-running I/O is never interrupted and originals are never modified.
 */
export type ReadPriority = 'background' | 'visible' | 'selected';

const LEVEL: Record<ReadPriority, number> = {
  background: 0,
  visible: 1,
  selected: 2,
};

type PendingRead = {
  key?: string;
  priority: number;
  order: number;
  start: () => void;
};

export class PriorityReadQueue {
  private readonly waiting: PendingRead[] = [];
  private active = 0;
  private nextOrder = 0;

  constructor(private readonly concurrent: number = 3) {
    if (!Number.isSafeInteger(concurrent) || concurrent < 1 || concurrent > 16) {
      throw new RangeError('Read concurrency must be between 1 and 16.');
    }
  }

  run<T>(read: () => Promise<T>, priority: ReadPriority = 'background', key?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        key,
        priority: LEVEL[priority],
        order: this.nextOrder++,
        start: () => {
          void Promise.resolve().then(read).then(resolve, reject).finally(() => {
            this.active -= 1;
            this.drain();
          });
        },
      });
      this.drain();
    });
  }

  /** Upgrade an existing queued read when its photo becomes selected or visible. */
  promote(key: string, priority: ReadPriority): void {
    if (!key) return;
    for (const item of this.waiting) {
      if (item.key === key) item.priority = Math.max(item.priority, LEVEL[priority]);
    }
  }

  private drain(): void {
    while (this.active < this.concurrent && this.waiting.length > 0) {
      let best = 0;
      for (let i = 1; i < this.waiting.length; i += 1) {
        const candidate = this.waiting[i];
        const current = this.waiting[best];
        if (candidate.priority > current.priority ||
            (candidate.priority === current.priority && candidate.order > current.order)) best = i;
      }
      const [next] = this.waiting.splice(best, 1);
      this.active += 1;
      next.start();
    }
  }
}
