import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types';
import { developFullSizeOf, fullDevelopPossible } from './fullDevelop';

const nef = { id: 'f', stableKey: 'k', filename: 'DSC_0001.NEF', isDemo: false } as PhotoFrame;

test('a full-size develop is offered only for a reachable RAW with a decoder', () => {
  assert.equal(fullDevelopPossible(nef, true, true), true);
  assert.equal(fullDevelopPossible(nef, false, true), false);
  assert.equal(fullDevelopPossible(nef, true, false), false);
  assert.equal(fullDevelopPossible({ ...nef, filename: 'bird.jpg' }, true, true), false);
  assert.equal(fullDevelopPossible({ ...nef, isDemo: true }, true, true), false);
});

test('the develop counts only when the provider then holds a full develop', async () => {
  let developed = false;
  const provider = { isDeveloped: () => developed, getFullPreviewUrl: async () => '', hasBlob: () => true };
  await assert.rejects(developFullSizeOf(nef, provider, (async () => ({}) as HTMLImageElement) as never), /not developed at full size/);
  await developFullSizeOf(nef, provider, (async () => { developed = true; return {} as HTMLImageElement; }) as never);
});
