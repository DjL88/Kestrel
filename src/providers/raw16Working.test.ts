import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoFrame } from '../core/types';
import { measuringCopy, raw16Possible, raw16SharpEnough, Raw16WorkingCache } from './raw16Working';
import { rgb16ToRgba } from '../core/master16';

const SHA = 'a'.repeat(64);
const nef = { filename: 'bird.nef', originalSha256: SHA } as PhotoFrame;

test('16-bit only for our own RAW develop with a known fingerprint, on a device that can develop', () => {
  assert.equal(raw16Possible(nef, 'raw-review', true), true);
  assert.equal(raw16Possible(nef, 'raw-full', true), true);
  assert.equal(raw16Possible(nef, 'camera-preview', true), false, 'the camera preview is a different picture');
  assert.equal(raw16Possible(nef, undefined, true), false);
  assert.equal(raw16Possible(nef, 'raw-review', false), false);
  assert.equal(raw16Possible({ ...nef, originalSha256: undefined } as PhotoFrame, 'raw-review', true), false);
  assert.equal(raw16Possible({ ...nef, filename: 'bird.jpg' } as PhotoFrame, 'raw-review', true), false);
  assert.equal(raw16Possible({ ...nef, isDemo: true } as PhotoFrame, 'raw-review', true), false);
});

test('the cache develops each photo once, says when a copy is ready, forgets the oldest, and remembers a failure', async () => {
  const cache = new Raw16WorkingCache(2);
  let opens = 0;
  const working = { picture: { width: 1, height: 1, data: new Uint16Array(3) }, turn: 0 };
  const open = async () => { opens += 1; return working; };
  const pending = cache.get('a', open);
  assert.equal(cache.ready('a'), undefined, 'not ready while it is being made');
  assert.equal(await pending, working);
  assert.equal(cache.ready('a'), working);
  await cache.get('a', open);
  assert.equal(opens, 1);
  await cache.get('b', open);
  await cache.get('c', open);
  assert.equal(cache.ready('a'), undefined, 'a was dropped as the oldest');
  await cache.get('a', open);
  assert.equal(opens, 4);
  let failures = 0;
  const fail = async () => { failures += 1; throw new Error('no decoder'); };
  assert.equal(await cache.get('x', fail), null);
  assert.equal(await cache.get('x', fail), null);
  assert.equal(failures, 1);
  assert.equal(cache.ready('x'), undefined);
});

test('a measuring copy is made once per kept copy', () => {
  const working = { picture: { width: 4, height: 2, data: new Uint16Array(24) }, turn: 90 };
  const small = measuringCopy(working, 2);
  assert.equal(small.picture.width, 2);
  assert.equal(small.turn, 90);
  assert.equal(measuringCopy(working, 2), small);
});

test('a softer 16-bit picture never replaces the 8-bit one', () => {
  assert.equal(raw16SharpEnough({ width: 2200, height: 1467 }, 2200), true);
  assert.equal(raw16SharpEnough({ width: 1200, height: 800 }, 2200), false, 'a tight crop of the kept copy');
  assert.equal(raw16SharpEnough({ width: 64, height: 96 }, 96), true);
});

test('16-bit samples reach the screen with one rounding', () => {
  const rgba = rgb16ToRgba({ width: 2, height: 1, data: new Uint16Array([0, 128, 65535, 257 * 100, 257 * 100 + 128, 257 * 100 + 129]) });
  assert.deepEqual(Array.from(rgba), [0, 0, 255, 255, 100, 100, 101, 255]);
});
