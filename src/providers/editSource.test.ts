import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FRAMING } from '../core/photoFraming';
import type { PhotoFrame } from '../core/types';
import { screenDevelopEnough, storedEditSource, type EditSourceProvider } from './editSource';

const raw = { id: 'f1', stableKey: 'k1', filename: 'DSC_0001.NEF', originalSha256: 'a'.repeat(64) } as PhotoFrame;
const picture = (width: number, height: number) => ({ naturalWidth: width, naturalHeight: height }) as HTMLImageElement;

function provider(review: boolean, developed = false): EditSourceProvider & { asked: number } {
  const state = {
    asked: 0,
    isDeveloped: () => developed,
    developedReview: async () => { state.asked += 1; return review ? { thumbnail: new Blob(['t']), review: new Blob(['r']) } : null; },
  };
  return state as EditSourceProvider & { asked: number };
}

test('a stored screen develop is enough only when, framed, it still fills the 2,200 px edited view', () => {
  assert.equal(screenDevelopEnough(2200, 1467, undefined), true);
  assert.equal(screenDevelopEnough(1467, 2200, DEFAULT_FRAMING), true, 'portrait');
  // Shrunk to fit the preview cache: fewer pixels than the view draws, so the full develop is used.
  assert.equal(screenDevelopEnough(1760, 1173, undefined), false);
  // A square crop of a 3:2 picture keeps only 1,467 px of its long edge.
  assert.equal(screenDevelopEnough(2200, 1467, { ...DEFAULT_FRAMING, ratio: 1 }), false);
  // A wide crop keeps the full width.
  assert.equal(screenDevelopEnough(2200, 1467, { ...DEFAULT_FRAMING, ratio: 16 / 9 }), true);
  assert.equal(screenDevelopEnough(0, 0, undefined), false);
});

test('the edited view uses the stored screen develop, without developing, when it is big enough', async () => {
  const source = provider(true);
  const shown = await storedEditSource(raw, source, async () => picture(2200, 1467));
  assert.deepEqual([shown?.naturalWidth, shown?.naturalHeight], [2200, 1467]);
});

test('otherwise the caller keeps the full develop: too small, none stored, already full, or not a RAW', async () => {
  assert.equal(await storedEditSource(raw, provider(true), async () => picture(1760, 1173)), null);
  assert.equal(await storedEditSource(raw, provider(false), async () => picture(2200, 1467)), null);
  const full = provider(true, true);
  assert.equal(await storedEditSource(raw, full, async () => picture(2200, 1467)), null, 'a full develop held is used instead');
  assert.equal(full.asked, 0);
  const jpeg = provider(true);
  assert.equal(await storedEditSource({ ...raw, filename: 'photo.jpg' } as PhotoFrame, jpeg, async () => picture(2200, 1467)), null);
  assert.equal(await storedEditSource({ ...raw, isDemo: true } as PhotoFrame, jpeg, async () => picture(2200, 1467)), null);
  assert.equal(jpeg.asked, 0);
  assert.equal(await storedEditSource(raw, provider(true), async () => { throw new Error('broken'); }), null);
});
