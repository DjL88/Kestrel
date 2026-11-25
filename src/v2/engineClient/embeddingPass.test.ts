import assert from 'node:assert/strict';
import test from 'node:test';
import { runEmbeddingPass, visualGroupingUnavailable } from './embeddingPass.ts';
const VISUAL_GROUPING_UNAVAILABLE = visualGroupingUnavailable();

const frames = ['a', 'b', 'c'].map((id) => ({ id }));
const deps = (embed: () => Promise<unknown>) => {
  const seen = { unavailable: [] as string[], embedded: [] as string[], batches: 0 };
  let cursor = 0;
  return {
    seen,
    pass: {
      next: () => frames[cursor++],
      stillCurrent: () => true,
      picture: async () => ({}),
      embed,
      onEmbedded: (id: string) => { seen.embedded.push(id); },
      onBatchDone: () => { seen.batches += 1; },
      onUnavailable: (message: string) => { seen.unavailable.push(message); },
      skip: () => {},
      pause: async () => {},
      batch: 12,
    },
  };
};

test('a missing or failed look-alike model says once that bursts are grouped by capture time, then stops', async () => {
  const { seen, pass } = deps(async () => { throw new Error('model missing'); });
  assert.equal(await runEmbeddingPass(pass), 'halted');
  assert.deepEqual(seen.unavailable, [VISUAL_GROUPING_UNAVAILABLE]);
  assert.deepEqual(seen.embedded, []);
  assert.match(VISUAL_GROUPING_UNAVAILABLE, /capture time/);
  assert.match(VISUAL_GROUPING_UNAVAILABLE, /Nothing about your photos was changed/);
});

test('a working model embeds every photo and says nothing', async () => {
  const { seen, pass } = deps(async () => ({ model: 'm', vector: 'v' }));
  assert.equal(await runEmbeddingPass(pass), 'done');
  assert.deepEqual(seen.embedded, ['a', 'b', 'c']);
  assert.deepEqual(seen.unavailable, []);
  assert.equal(seen.batches, 1, 'the last partial batch still regroups');
});
