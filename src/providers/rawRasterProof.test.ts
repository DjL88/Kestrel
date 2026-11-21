import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSensorRgb16 } from './rawWorkingRaster';
import { sensorRasterProof, sensorDisplayTile, verifySensorTiff } from './rawRasterProof';

function raster(values: number[]) {
  const bytes = new ArrayBuffer(8 + values.length * 2);
  const v = new DataView(bytes);
  v.setUint32(0, 2, true); v.setUint32(4, 1, true);
  values.forEach((value, i) => v.setUint16(8 + i * 2, value, true));
  return acceptSensorRgb16(bytes);
}
test('one sensor raster yields correctly bounded display samples and ICC-tagged RGB16 TIFF', async () => {
  const source = raster([1, 256, 32769, 65534, 42, 8193]);
  const proof = sensorRasterProof(source);
  assert.deepEqual(proof.displayPixel(0, 0), [0, 1, 128]);
  assert.deepEqual(proof.displayPixel(1, 0), [255, 0, 32]);
  assert.ok((await verifySensorTiff(proof.tiff, 2, 1)).iccBytes >= 128);
  assert.deepEqual([...source.image.data], [1, 256, 32769, 65534, 42, 8193]);
});
test('rejects wrong output dimensions and out-of-bounds display access', async () => {
  const proof = sensorRasterProof(raster([1, 2, 3, 4, 5, 6]));
  assert.throws(() => proof.displayPixel(2, 0));
  assert.throws(() => proof.displayPixel(-1, 0));
  await assert.rejects(verifySensorTiff(proof.tiff, 1, 2));
});

test('sensor tile exactly matches TIFF proof display samples, including 16-bit midpoints', async () => {
  const source = raster([1, 256, 32769, 65534, 42, 8193]);
  const proof = sensorRasterProof(source);
  const tile = sensorDisplayTile(source, 0, 0, 2, 1);
  assert.deepEqual([...tile], [0, 1, 128, 255, 255, 0, 32, 255]);
  for (let x = 0; x < 2; x++)
    assert.deepEqual([...tile.slice(x * 4, x * 4 + 3)], [...proof.displayPixel(x, 0)]);
  assert.ok((await verifySensorTiff(proof.tiff, 2, 1)).iccBytes >= 128);
});
test('preview tile rejects overflow, invalid geometry and excessive allocation', () => {
  const source = raster([1, 2, 3, 4, 5, 6]);
  assert.throws(() => sensorDisplayTile(source, 0, 0, 2, 1, 7));
  assert.throws(() => sensorDisplayTile(source, 0, 0, 3, 1));
  assert.throws(() => sensorDisplayTile(source, 0, -1, 1, 1));
  assert.throws(() => sensorDisplayTile(source, 0, 0, 1.5, 1));
  assert.throws(() => sensorDisplayTile(source, 0, 0, 1, 1, Number.MAX_SAFE_INTEGER));
});
