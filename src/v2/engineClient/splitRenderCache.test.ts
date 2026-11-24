import assert from 'node:assert/strict';
import test from 'node:test';
import { createSplitRenderCache } from './splitRenderCache.ts';

test('five scheduled panels share the exact same render across pause and resume', async () => {
  const cache = createSplitRenderCache<string>();
  let renders = 0;
  const render = async () => { renders++; return Array.from({ length: 5 }, (_, i) => `${renders}:${i}`); };
  const panels = [];
  for (let i = 0; i < 5; i++) panels.push(await cache.get('photo:edit', 5, i, render));
  assert.deepEqual(panels, ['1:0','1:1','1:2','1:3','1:4']);
  assert.equal(renders, 1);
  assert.equal(await cache.get('photo:edit', 5, 0, render), '2:0', 'completed composition was released');
});

test('different format or edit group never receives a cached panel from another recipe', async () => {
  const cache = createSplitRenderCache<string>();
  assert.equal(await cache.get('a:1', 2, 0, async () => ['a0','a1']), 'a0');
  assert.equal(await cache.get('a:2', 2, 0, async () => ['b0','b1']), 'b0');
  assert.equal(await cache.get('a:2', 2, 1, async () => { throw Error('unexpected render'); }), 'b1');
});

test('failed or incomplete render is not cached; explicit clear drops partial composition', async () => {
  const cache = createSplitRenderCache<string>();
  await assert.rejects(cache.get('a', 3, 0, async () => ['only']), /not rendered/);
  await assert.rejects(cache.get('a', 3, 0, async () => { throw Error('cancelled'); }), /cancelled/);
  assert.equal(await cache.get('a', 3, 0, async () => ['one','two','three']), 'one');
  cache.clear();
  assert.equal(await cache.get('a', 3, 1, async () => ['new one','new two','new three']), 'new two');
  await assert.rejects(cache.get('a', 3, 3, async () => ['x','y','z']), /Invalid/);
});
