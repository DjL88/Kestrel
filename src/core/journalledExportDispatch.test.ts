import { describe, expect, it } from 'vitest';
import { createJournalledExportDispatch, type DurableExportAdapter, type DurableExportQueue } from './journalledExportDispatch';
import type { ExportBatchTicket } from './exportBatchQueue';

const hash = (letter: string) => letter.repeat(64);
const item = (filename: string) => ({ sourceId: filename, sourceSha256: hash('a'), filename, subfolder: 'Social' });
function harness() {
  const data = new Map<string, string>();
  const storage = {
    read: (key: string) => data.get(key) ?? null,
    write: (key: string, value: string) => { data.set(key, value); },
    remove: (key: string) => { data.delete(key); },
  };
  const published: string[] = [];
  let sourceValid = true;
  let outputValid = true;
  let renderCount = 0;
  let failPublish = false;
  let cancelAfterRender = false;
  const queue: DurableExportQueue = {
    enqueue: (plan, adapter) => {
      const controller = new AbortController();
      const done = (async () => {
        try {
          for (const source of plan.items) {
            if (controller.signal.aborted) return 'cancelled' as const;
            const output = await adapter.render(source, plan.recipe, controller.signal);
            if (cancelAfterRender) controller.abort();
            if (controller.signal.aborted) return 'cancelled' as const;
            await adapter.save(source, output, controller.signal);
          }
          return 'completed' as const;
        } catch {
          return controller.signal.aborted ? 'cancelled' as const : 'failed' as const;
        }
      })();
      return { id: 1, done, cancel: () => { controller.abort(); return true; } } satisfies ExportBatchTicket;
    },
  };
  const adapter: DurableExportAdapter<{ quality: number }, string> = {
    verifySource: async () => sourceValid,
    verifyOutput: async () => outputValid,
    render: async (source, recipe) => { renderCount++; return source.filename + recipe.quality; },
    publishAtomic: async (source) => {
      if (failPublish || published.includes(source.filename)) throw new Error('Exclusive output collision');
      published.push(source.filename);
      return hash('b');
    },
  };
  return {
    storage, data, published, queue, adapter,
    setSource: (v: boolean) => { sourceValid = v; },
    setOutput: (v: boolean) => { outputValid = v; },
    setFailPublish: (v: boolean) => { failPublish = v; },
    setCancelAfterRender: (v: boolean) => { cancelAfterRender = v; },
    renders: () => renderCount,
  };
}
const plan = (id: string, names = ['one.jpg', 'two.jpg']) => ({
  id, title: 'Export photos', items: names.map(item), recipe: { quality: 92 },
});
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('journalled export dispatch', () => {
  it('writes an immutable plan before queueing, then records each verified output', async () => {
    const h = harness();
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    const original = plan('job1');
    const ticket = dispatch.submit(original, h.adapter);
    original.recipe.quality = 1;
    expect(await ticket.done).toBe('completed');
    await settled();
    expect(h.published).toEqual(['one.jpg', 'two.jpg']);
    expect(dispatch.load<{ quality: number }>('job1')?.recipe.quality).toBe(92);
    expect(dispatch.load('job1')?.receipts).toHaveLength(2);
  });
  it('refuses duplicate job IDs and duplicate case-insensitive output names', () => {
    const h = harness();
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    expect(() => dispatch.submit(plan('dup', ['A.jpg', 'a.jpg']), h.adapter)).toThrow();
    dispatch.submit(plan('valid', ['one.jpg']), h.adapter);
    expect(() => dispatch.submit(plan('valid', ['two.jpg']), h.adapter)).toThrow();
  });
  it('fails closed when original changes before rendering', async () => {
    const h = harness();
    h.setSource(false);
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    expect(await dispatch.submit(plan('changed'), h.adapter).done).toBe('failed');
    expect(h.renders()).toBe(0);
    expect(h.published).toHaveLength(0);
  });
  it('does not publish when cancellation occurs during rendering', async () => {
    const h = harness();
    h.setCancelAfterRender(true);
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    expect(await dispatch.submit(plan('cancel'), h.adapter).done).toBe('cancelled');
    expect(h.published).toHaveLength(0);
  });
  it('requires verified original and receipts before explicitly resuming', async () => {
    const h = harness();
    h.setFailPublish(true);
    const first = createJournalledExportDispatch(h.storage, h.queue);
    expect(await first.submit(plan('resume'), h.adapter).done).toBe('failed');
    await settled();
    const restarted = createJournalledExportDispatch(h.storage, h.queue);
    h.setSource(false);
    await expect(restarted.resume('resume', h.adapter)).rejects.toThrow('Original identity');
    h.setSource(true);
    h.setFailPublish(false);
    expect(await (await restarted.resume('resume', h.adapter))?.done).toBe('completed');
    await settled();
    expect(restarted.load('resume')?.receipts).toHaveLength(2);
    expect(await restarted.resume('resume', h.adapter)).toBeNull();
  });
  it('rejects an output collision instead of overwriting an unreceipted file', async () => {
    const h = harness();
    h.published.push('one.jpg'); // e.g. crash after publication but before receipt
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    expect(await dispatch.submit(plan('collision'), h.adapter).done).toBe('failed');
    expect(h.published).toEqual(['one.jpg']);
    expect(dispatch.load('collision')?.receipts).toHaveLength(0);
  });
  it('never resumes if a previously receipted output is no longer verifiable', async () => {
    const h = harness();
    h.setFailPublish(false);
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    expect(await dispatch.submit(plan('receipts'), h.adapter).done).toBe('completed');
    await settled();
    // Simulate an interrupted checkpoint whose first output was committed.
    const key = 'kestrel.export.v1.receipts';
    const saved = JSON.parse(h.data.get(key)!);
    saved.state = 'paused';
    saved.receipts = saved.receipts.slice(0, 1);
    h.data.set(key, JSON.stringify(saved));
    h.setOutput(false);
    await expect(createJournalledExportDispatch(h.storage, h.queue).resume('receipts', h.adapter))
      .rejects.toThrow('Previously exported file');
  });
});
