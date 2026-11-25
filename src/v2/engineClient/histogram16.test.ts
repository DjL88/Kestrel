import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoFrame } from '../../core/types';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { histogram16Possible, histogramFromWorking, Raw16WorkingCache } from './histogram16';

const SHA = 'a'.repeat(64);
const nef = { filename: 'bird.nef', originalSha256: SHA } as PhotoFrame;

test('a 16-bit histogram only for our own RAW develop with a known fingerprint, on a device that can develop', () => {
  assert.equal(histogram16Possible(nef, 'raw-review', true), true);
  assert.equal(histogram16Possible(nef, 'raw-full', true), true);
  assert.equal(histogram16Possible(nef, 'camera-preview', true), false, 'the camera preview is a different picture');
  assert.equal(histogram16Possible(nef, undefined, true), false);
  assert.equal(histogram16Possible(nef, 'raw-review', false), false);
  assert.equal(histogram16Possible({ ...nef, originalSha256: undefined } as PhotoFrame, 'raw-review', true), false);
  assert.equal(histogram16Possible({ ...nef, filename: 'bird.jpg' } as PhotoFrame, 'raw-review', true), false);
  assert.equal(histogram16Possible({ ...nef, isDemo: true } as PhotoFrame, 'raw-review', true), false);
});

test('the cache develops each photo once, forgets the oldest, and remembers a failure as null', async () => {
  const cache = new Raw16WorkingCache(2);
  let opens = 0;
  const working = { picture: { width: 1, height: 1, data: new Uint16Array(3) }, turn: 0 };
  const open = async () => { opens += 1; return working; };
  assert.equal(await cache.get('a', open), working);
  await cache.get('a', open);
  assert.equal(opens, 1);
  await cache.get('b', open);
  await cache.get('c', open);
  await cache.get('a', open);
  assert.equal(opens, 4, 'a was dropped as the oldest and developed again');
  let failures = 0;
  const fail = async () => { failures += 1; throw new Error('no decoder'); };
  assert.equal(await cache.get('x', fail), null);
  assert.equal(await cache.get('x', fail), null);
  assert.equal(failures, 1);
});

test('the histogram is measured from the rendered 16-bit samples, or not at all when the edit cannot be carried', () => {
  const working = { picture: { width: 2, height: 1, data: new Uint16Array([0, 0, 0, 65535, 65535, 65535]) }, turn: 0 };
  const shown = histogramFromWorking(working, DEFAULT_EDIT, undefined, (w) => w.picture);
  assert.equal(shown?.precision, 'rgb16');
  assert.equal(shown?.shadowClip, 0.5);
  assert.equal(shown?.highlightClip, 0.5);
  assert.equal(histogramFromWorking(working, DEFAULT_EDIT, undefined, () => null), null);
});
