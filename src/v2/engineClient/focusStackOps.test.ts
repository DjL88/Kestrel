import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types.ts';
import { FOCUS_STACK_PREVIEW_KEY, focusStackPreviewOn, refusalText, rgbaToRgb16, stackDoneNotice, stackedFilename, stackSelection } from './focusStackOps.ts';
import { readFocusStackRecipe, focusStackRecipe } from '../../core/focusStackRecipe.ts';
import type { StackSuccess } from '../../core/focusStack.ts';

const frame = (id: string, filename: string, sequenceIndex: number, extra: Partial<PhotoFrame> = {}) =>
  ({ id, filename, sequenceIndex, stableKey: `key-${id}`, decision: 'unreviewed', ...extra }) as unknown as PhotoFrame;

test('the preview switch is off unless this device turned it on', () => {
  assert.equal(focusStackPreviewOn(null), false);
  assert.equal(focusStackPreviewOn({ getItem: () => null }), false);
  assert.equal(focusStackPreviewOn({ getItem: (k) => (k === FOCUS_STACK_PREVIEW_KEY ? '1' : null) }), true);
  assert.equal(focusStackPreviewOn({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('a selection is stacked in shooting order and needs two to thirty readable photos', () => {
  const frames = [frame('c', 'c.jpg', 3), frame('a', 'a.jpg', 1), frame('b', 'b.png', 2), frame('x', 'x.heic', 4), frame('gone', 'g.jpg', 5, { removedAt: 1 })];
  const ok = stackSelection(frames, ['c', 'a', 'b']);
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.frames.map((f) => f.id), ['a', 'b', 'c']);
  const one = stackSelection(frames, ['a', 'gone']);
  assert.ok(!one.ok && /at least two/.test(one.message) && /untouched/.test(one.message));
  const heif = stackSelection(frames, ['a', 'x']);
  assert.ok(!heif.ok && /x\.heic/.test(heif.message) && /No smaller picture/.test(heif.message));
  const many = stackSelection(Array.from({ length: 31 }, (_, i) => frame(`f${i}`, `f${i}.jpg`, i)), Array.from({ length: 31 }, (_, i) => `f${i}`));
  assert.ok(!many.ok && /30/.test(many.message));
});

test('the stacked photo gets a new name, never a source name', () => {
  assert.equal(stackedFilename('heron_0012.NEF', 5), 'heron_0012-stack5.png');
  assert.equal(stackedFilename('heron.jpg', 3, new Set(['heron-stack3.png'])), 'heron-stack3-2.png');
});

test('refusals and notices say what happened and that the originals are untouched', () => {
  assert.match(refusalText({ ok: false, reason: 'unrelated', frameNumber: 3 }), /Photo 3 .*untouched/);
  assert.match(refusalText({ ok: false, reason: 'ambiguous', frameNumber: 2 }), /rather than guessing/);
  const notice = stackDoneNotice('a-stack2.png', { warnings: [{ code: 'one-frame-dominates' }, { code: 'local-fallback', frameIndex: 0 }] }, 2);
  assert.match(notice, /^Added a-stack2\.png, stacked from 2 photos\. Your original photos are untouched\. One photo supplied/);
  assert.doesNotMatch(notice, /lined up as a whole/);
});

test('RGBA16 becomes the RGB16 the PNG writer takes', () => {
  const out = rgbaToRgb16({ width: 2, height: 1, data: Uint16Array.from([1, 2, 3, 65535, 4, 5, 6, 65535]) });
  assert.deepEqual([...out.data], [1, 2, 3, 4, 5, 6]);
});

test('the recipe records every source and survives a round trip; a damaged one is refused', () => {
  const result = {
    ok: true, width: 10, height: 8, data: new Uint16Array(320), sourceBits: 8, contribution: [0.6, 0.4], referenceIndex: 0, bands: 1,
    alignment: [{ dx: 0, dy: 0, scale: 1, rotationDegrees: 0, score: 1, localTiles: { matched: 0, total: 0, maxShift: 0 } },
      { dx: 1.23456, dy: -0.5, scale: 1.001, rotationDegrees: 0.01, score: 0.8, localTiles: { matched: 30, total: 48, maxShift: 1.5 } }],
    affines: [], warnings: [], settings: { power: 4, feather: 3, alignEdge: 1024, localAlign: true },
  } as unknown as StackSuccess;
  const recipe = focusStackRecipe(result, [{ frameId: 'a', stableKey: 'ka', filename: 'a.jpg', originalSha256: 'abc' }, { frameId: 'b', stableKey: 'kb', filename: 'b.jpg' }], 'original', 1);
  assert.equal(recipe.generatedPixels, false);
  assert.equal(recipe.alignment[1].dx, 1.23);
  const back = readFocusStackRecipe(JSON.parse(JSON.stringify(recipe)));
  assert.deepEqual(back, recipe);
  assert.equal(readFocusStackRecipe({ ...recipe, generatedPixels: true }), null);
  assert.equal(readFocusStackRecipe({ ...recipe, sources: recipe.sources.slice(0, 1) }), null);
  assert.equal(readFocusStackRecipe({ ...recipe, contribution: [2, 0] }), null);
});
