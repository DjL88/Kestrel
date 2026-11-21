import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTiff16, type Rgb16Image } from './master16';
import { proveTiff16 } from './tiff16Proof';
import { sampleTiff16Precision } from './tiff16PrecisionEvidence';

async function output(values: number[]) {
  const image: Rgb16Image = { width: values.length / 3, height: 1, data: Uint16Array.from(values) };
  const blob = encodeTiff16(image);
  const bytes = await blob.arrayBuffer();
  const verified = proveTiff16(bytes);
  assert.equal(verified.width, image.width);
  assert.ok(verified.iccBytes > 128);
  const v = new DataView(bytes), ifd = v.getUint32(4, true), count = v.getUint16(ifd, true);
  let offset = -1;
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    if (v.getUint16(at, true) === 273) offset = v.getUint32(at + 8, true);
  }
  assert.ok(offset > 0);
  return { blob, offset, image };
}

test('real TIFF16 writer preserves sub-8-bit sample steps and ICC structure', async () => {
  const { blob, offset, image } = await output([32769, 41235, 60001, 32770, 41236, 60002]);
  const proof = await sampleTiff16Precision(blob, offset, image.width, image.height);
  assert.equal(proof.status, 'observed-sub8-bit-steps');
  assert.equal(proof.sampledPixels, 2);
  assert.ok(proof.nonEightBitAligned > 0);
});

test('8-bit expanded TIFF16 is inconclusive, never labelled real sensor precision', async () => {
  const { blob, offset, image } = await output([257, 128 * 257, 200 * 257, 0, 255 * 257, 64 * 257]);
  const proof = await sampleTiff16Precision(blob, offset, image.width, image.height);
  assert.equal(proof.status, 'inconclusive');
  assert.equal(proof.nonEightBitAligned, 0);
});

test('sampling rejects malformed geometry without reading pixels', async () => {
  const { blob, offset } = await output([123, 456, 789]);
  await assert.rejects(sampleTiff16Precision(blob, offset, 80_000_001, 1), /Invalid validated/);
  await assert.rejects(sampleTiff16Precision(blob, offset, 1, 1, 5000), /Invalid validated/);
  await assert.rejects(sampleTiff16Precision(blob, blob.size - 2, 1, 1), /Invalid validated/);
});
