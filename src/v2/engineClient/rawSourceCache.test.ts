import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Rgb16Image } from '../../core/master16';
import { createRawSourceCache, rawSourceBudget } from './rawSourceCache';

const picture = (pixels: number): Rgb16Image => ({ width: pixels, height: 1, data: new Uint16Array(pixels * 3) });

test('a photo exported in several formats is decoded once, and a different photo replaces it', async () => {
  const cache = createRawSourceCache(1024 * 1024);
  let opens = 0;
  const open = (pixels: number) => async () => { opens += 1; return picture(pixels); };
  const first = await cache.get('a', open(100));
  const again = await cache.get('a', open(100));
  assert.equal(opens, 1);
  assert.equal(again.image, first.image);
  assert.equal(first.shared, true);
  await cache.get('b', open(100));
  await cache.get('a', open(100));
  assert.equal(opens, 3, 'only one photo is held at a time');
  cache.clear();
  await cache.get('a', open(100));
  assert.equal(opens, 4);
});

test('a picture too big to hold beside its working copy is not kept, and the caller may edit it in place', async () => {
  const cache = createRawSourceCache(1000);
  let opens = 0;
  const open = async () => { opens += 1; return picture(100); }; // 600 bytes; held + copy would be 1200
  const first = await cache.get('big', open);
  assert.equal(first.shared, false);
  await cache.get('big', open);
  assert.equal(opens, 2);
});

test('a failed decode is not remembered', async () => {
  const cache = createRawSourceCache(1024 * 1024);
  await assert.rejects(cache.get('a', async () => { throw new Error('decoder failed'); }), /decoder failed/);
  const ok = await cache.get('a', async () => picture(4));
  assert.equal(ok.image.width, 4);
});

test('the memory budget is cautious unless the device says otherwise', () => {
  const MB = 1024 * 1024;
  assert.equal(rawSourceBudget({ nativeDesktop: true }), 2048 * MB);
  assert.equal(rawSourceBudget({ nativeDesktop: false, deviceMemoryGb: 8 }), 2048 * MB);
  assert.equal(rawSourceBudget({ nativeDesktop: false, deviceMemoryGb: 4 }), 1024 * MB);
  assert.equal(rawSourceBudget({ nativeDesktop: false }), 384 * MB);
  // A 45 MP RGB16 picture (about 270 MB) is held on desktop, not on an unknown phone browser.
  const z8 = 8256 * 5504 * 6;
  assert.ok(z8 * 2 <= rawSourceBudget({ nativeDesktop: true }));
  assert.ok(z8 * 2 > rawSourceBudget({ nativeDesktop: false }));
});


test('a decode completing after clear does not retain the full-size image', async () => {
  const cache = createRawSourceCache(1024 * 1024);
  let finish!: (image: Rgb16Image) => void;
  const old = cache.get('a', () => new Promise(resolve => { finish = resolve; }));
  cache.clear();
  finish(picture(100));
  assert.equal((await old).shared, false);
  let opens = 0;
  await cache.get('a', async () => { opens++; return picture(101); });
  assert.equal(opens, 1);
});

test('a late old decode cannot replace the newer cached picture', async () => {
  const cache = createRawSourceCache(1024 * 1024);
  let finish!: (image: Rgb16Image) => void;
  const old = cache.get('old', () => new Promise(resolve => { finish = resolve; }));
  const newer = await cache.get('new', async () => picture(50));
  finish(picture(100));
  assert.equal((await old).shared, false);
  const reused = await cache.get('new', async () => { throw Error('new picture was evicted'); });
  assert.equal(reused.image, newer.image);
});

test('a rejected superseded decode does not invalidate a newer cache entry', async () => {
  const cache = createRawSourceCache(1024 * 1024);
  let fail!: (reason: Error) => void;
  const old = cache.get('old', () => new Promise((_resolve, reject) => { fail = reject; }));
  const newer = await cache.get('new', async () => picture(50));
  fail(new Error('old decode failed'));
  await assert.rejects(old, /old decode failed/);
  assert.equal((await cache.get('new', async () => { throw Error('new picture was evicted'); })).image, newer.image);
});
