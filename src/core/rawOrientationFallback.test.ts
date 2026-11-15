import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPreviewOrientation } from '../providers/rawDevelop';

const developed = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
const preview = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

function mockBitmapDecoder(decode: typeof createImageBitmap, run: () => Promise<void>): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true, value: decode });
  return run().finally(() => {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  });
}

test('a damaged embedded Nikon preview cannot discard an already developed RAW photograph', async () => {
  let calls = 0;
  await mockBitmapDecoder((async () => {
    calls++;
    throw new Error('Camera JPEG could not be decoded');
  }) as typeof createImageBitmap, async () => {
    assert.strictEqual(await matchPreviewOrientation(developed, preview), developed);
  });
  assert.equal(calls, 1, 'Do not attempt orientation work when the preview is unavailable');
});

test('if the developed picture cannot decode, close the temporary preview bitmap and report the failure', async () => {
  let calls = 0;
  let closed = 0;
  await mockBitmapDecoder((async () => {
    if (++calls === 1) return { close: () => { closed++; } } as ImageBitmap;
    throw new Error('Developed JPEG cannot be decoded');
  }) as typeof createImageBitmap, async () => {
    await assert.rejects(matchPreviewOrientation(developed, preview), /Developed JPEG cannot be decoded/);
  });
  assert.equal(calls, 2);
  assert.equal(closed, 1);
});

test('without any camera preview, use the developed picture without decoding an image again', async () => {
  await mockBitmapDecoder((async () => { throw new Error('Unexpected bitmap call'); }) as typeof createImageBitmap, async () => {
    assert.strictEqual(await matchPreviewOrientation(developed, null), developed);
  });
});
