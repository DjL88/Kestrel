import assert from 'node:assert/strict';
import test from 'node:test';
import { unsupportedRawCompression } from './rawCompression';
import { extractRawPreview, extractSmallRawPreview } from './nefPreview';
import { jpegStream, syntheticDng as dng } from './syntheticDngFixture';

for (const little of [true, false]) {
  test(`a ${little ? 'little' : 'big'}-endian DNG whose main image is JPEG XL is recognised from its directories`, async () => {
    assert.equal(await unsupportedRawCompression(dng({ main: 52546, others: [[4, 52546], [1, 52546]], little })), 'jpeg-xl');
  });
}

test('an ordinary DNG is readable, even when only a secondary image (an enhanced copy) is JPEG XL', async () => {
  assert.equal(await unsupportedRawCompression(dng({ main: 7 })), null);
  assert.equal(await unsupportedRawCompression(dng({ main: 7, others: [[16, 52546], [1, 52546]] })), null);
});

test('not a TIFF, too short or cut off: never called unsupported', async () => {
  assert.equal(await unsupportedRawCompression(new Blob([new Uint8Array(4000)])), null);
  assert.equal(await unsupportedRawCompression(new Blob([new Uint8Array([0x49, 0x49, 42, 0])])), null);
  const whole = new Uint8Array(await dng({ main: 52546 }).arrayBuffer());
  assert.equal(await unsupportedRawCompression(new Blob([whole.slice(0, 40)])), null);
});

test('its 256 px thumbnail is only the last-resort preview, never the normal one', async () => {
  const file = dng({ main: 52546, others: [[1, 52546]] });
  assert.equal(await extractRawPreview(file), null, 'below the 640 px a normal preview needs');
  const small = await extractSmallRawPreview(file);
  assert.equal(small?.type, 'image/jpeg');
  assert.equal(small?.size, 6000);
  // A thumbnail too small to show anything useful is still refused.
  assert.equal(await extractSmallRawPreview(dng({ main: 52546, thumb: jpegStream(120, 80) })), null);
});
