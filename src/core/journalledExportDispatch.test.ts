import { describe } from 'node:test';
import { expect, it } from './testExpect';
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
          await adapter.finalize?.(plan.recipe, controller.signal);
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
  it('finalizes a verified checkpoint interrupted after the last receipt without rewriting files', async () => {
    const h = harness();
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    expect(await dispatch.submit(plan('final-receipt'), h.adapter).done).toBe('completed');
    await settled();
    const key = 'kestrel.export.v1.final-receipt';
    const saved = JSON.parse(h.data.get(key)!);
    h.data.set(key, JSON.stringify({ ...saved, state: 'pending' }));
    const restarted = createJournalledExportDispatch(h.storage, h.queue);
    h.setOutput(false);
    await expect(restarted.resume('final-receipt', h.adapter)).rejects.toThrow('Previously exported file');
    expect(restarted.load('final-receipt')?.state).toBe('pending');
    h.setOutput(true);
    expect(await restarted.resume('final-receipt', h.adapter)).toBeNull();
    expect(restarted.load('final-receipt')?.state).toBe('completed');
    expect(h.published).toEqual(['one.jpg', 'two.jpg']);
  });

  it('serializes overlapping recovery verification before queue acceptance', async () => {
    const h = harness();
    h.setFailPublish(true);
    const first = createJournalledExportDispatch(h.storage, h.queue);
    expect(await first.submit(plan('race'), h.adapter).done).toBe('failed');
    await settled();

    const restarted = createJournalledExportDispatch(h.storage, h.queue);
    let release!: (valid: boolean) => void;
    const blocked = new Promise<boolean>(resolve => { release = resolve; });
    let checks = 0;
    const adapter = {
      ...h.adapter,
      verifySource: async () => { checks++; return blocked; },
    };
    const firstResume = restarted.resume('race', adapter);
    // The first call has reserved the ID even while awaiting a slow NAS read.
    await expect(restarted.resume('race', adapter)).rejects.toThrow('already running');
    expect(checks).toBe(1);
    release(true);
    h.setFailPublish(false);
    expect(await (await firstResume)?.done).toBe('completed');
    await settled();
    expect(h.published).toEqual(['one.jpg', 'two.jpg']);
    expect(restarted.load('race')?.state).toBe('completed');
  });

  it('releases a failed recovery reservation so the user can retry explicitly', async () => {
    const h = harness();
    h.setFailPublish(true);
    const dispatch = createJournalledExportDispatch(h.storage, h.queue);
    expect(await dispatch.submit(plan('retry'), h.adapter).done).toBe('failed');
    await settled();
    h.setSource(false);
    await expect(dispatch.resume('retry', h.adapter)).rejects.toThrow('Original identity');
    h.setSource(true);
    h.setFailPublish(false);
    expect(await (await dispatch.resume('retry', h.adapter))?.done).toBe('completed');
  });

});

// A renderer's completed promise is not equivalent to a durable completed job.
it('does not claim completed when final checkpoint persistence fails', async () => {
  const h = harness();
  let failFinal = true;
  const storage = {
    ...h.storage,
    write: (key: string, value: string) => {
      if (failFinal && JSON.parse(value).state === 'completed') throw new Error('Disk full');
      h.storage.write(key, value);
    },
  };
  const dispatch = createJournalledExportDispatch(storage, h.queue);
  expect(await dispatch.submit(plan('durability'), h.adapter).done).toBe('failed');
  expect(dispatch.load('durability')?.receipts).toHaveLength(2);
  expect(dispatch.load('durability')?.state).not.toBe('completed');
  failFinal = false;
  const restarted = createJournalledExportDispatch(storage, h.queue);
  expect(await restarted.resume('durability', h.adapter)).toBeNull();
  expect(restarted.load('durability')?.state).toBe('completed');
  expect(h.published).toEqual(['one.jpg', 'two.jpg']);
});

it('refuses to receipt a published file whose bytes cannot be verified', async () => {
  const h = harness();
  h.setOutput(false);
  const dispatch = createJournalledExportDispatch(h.storage, h.queue);
  expect(await dispatch.submit(plan('wrong-bytes', ['one.jpg']), h.adapter).done).toBe('failed');
  expect(h.published).toEqual(['one.jpg']);
  expect(dispatch.load('wrong-bytes')?.receipts).toHaveLength(0);
  // The destination may now contain an unreceipted file; no silent retry may overwrite it.
  h.setOutput(true);
  await expect(createJournalledExportDispatch(h.storage, h.queue)
    .resume('wrong-bytes', h.adapter).then(ticket => ticket?.done)).resolves.toBe('failed');
  expect(h.published).toEqual(['one.jpg']);
});

it('rejects completion when the original changes after publication', async () => {
  const h = harness();
  const adapter = {
    ...h.adapter,
    publishAtomic: async (...args: Parameters<typeof h.adapter.publishAtomic>) => {
      const digest = await h.adapter.publishAtomic(...args);
      h.setSource(false);
      return digest;
    },
  };
  const dispatch = createJournalledExportDispatch(h.storage, h.queue);
  expect(await dispatch.submit(plan('changed-at-finish', ['one.jpg']), adapter).done).toBe('failed');
  expect(dispatch.load('changed-at-finish')?.receipts).toHaveLength(1);
  expect(dispatch.load('changed-at-finish')?.state).not.toBe('completed');
  h.setSource(true);
  expect(await createJournalledExportDispatch(h.storage, h.queue)
    .resume('changed-at-finish', h.adapter)).toBeNull();
  expect(dispatch.load('changed-at-finish')?.state).toBe('completed');
});

it('rejects completion when a previously receipted output changes during the batch', async () => {
  const h = harness();
  const adapter = {
    ...h.adapter,
    publishAtomic: async (...args: Parameters<typeof h.adapter.publishAtomic>) => {
      const digest = await h.adapter.publishAtomic(...args);
      if (args[0].filename === 'two.jpg') h.setOutput(false);
      return digest;
    },
  };
  const dispatch = createJournalledExportDispatch(h.storage, h.queue);
  expect(await dispatch.submit(plan('changed-output'), adapter).done).toBe('failed');
  expect(dispatch.load('changed-output')?.state).not.toBe('completed');
  h.setOutput(true);
  expect(await createJournalledExportDispatch(h.storage, h.queue)
    .resume('changed-output', h.adapter)).toBeNull();
  expect(dispatch.load('changed-output')?.state).toBe('completed');
});
