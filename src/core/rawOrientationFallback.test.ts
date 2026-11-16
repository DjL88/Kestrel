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

test('an unreadable embedded Nikon preview keeps the validated full-size result', async () => {
  let closed = 0;
  await mockBitmapDecoder(async (input) => {
    if (input === preview) throw new Error('Camera JPEG could not be decoded');
    assert.strictEqual(input, developed);
    return { close: () => { closed++; } } as ImageBitmap;
  }, async () => {
    assert.strictEqual(await matchPreviewOrientation(developed, preview), developed);
  });
  assert.equal(closed, 1);
});

test('a corrupt native result is refused even with a missing or unreadable camera preview', async () => {
  const inputs: unknown[] = [];
  await mockBitmapDecoder(async (input) => {
    inputs.push(input);
    throw new Error('Unreadable JPEG');
  }, async () => {
    for (const guide of [null, preview]) {
      await assert.rejects(matchPreviewOrientation(developed, guide), /developed RAW picture could not be opened/);
    }
  });
  assert.deepEqual(inputs, [developed, developed]);
});

test('without a camera preview, validate and release the native bitmap', async () => {
  let closed = 0;
  await mockBitmapDecoder(async (input) => {
    assert.strictEqual(input, developed);
    return { close: () => { closed++; } } as ImageBitmap;
  }, async () => {
    assert.strictEqual(await matchPreviewOrientation(developed, null), developed);
  });
  assert.equal(closed, 1);
});

test('when rotation encoding fails, retain the validated native result and release both bitmaps', async (t) => {
  let closed = 0;
  let encodes = 0;
  const pixels = (left: number, top: number) => {
    const rgba = new Uint8ClampedArray(32 * 32 * 4);
    for (let y = top; y < top + 8; y += 1) {
      for (let x = left; x < left + 8; x += 1) rgba[(y * 32 + x) * 4] = 255;
    }
    return rgba;
  };
  let drawn: ImageBitmap;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage(image: ImageBitmap) { drawn = image; },
      translate() {}, rotate() {},
      getImageData: () => ({ data: drawn.width === 600 ? pixels(0, 0) : pixels(0, 24) }),
    }),
    toBlob(callback: (blob: Blob | null) => void) { encodes++; callback(null); },
  };
  const property = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
  t.after(() => {
    if (property) Object.defineProperty(globalThis, 'document', property);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  await mockBitmapDecoder(async (input) => ({
    width: input === preview ? 600 : 400,
    height: input === preview ? 400 : 600,
    close: () => { closed++; },
  }) as ImageBitmap, async () => {
    assert.strictEqual(await matchPreviewOrientation(developed, preview), developed);
  });
  assert.equal(encodes, 1, 'the optional rotation reached the encoder');
  assert.equal(closed, 2);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});
