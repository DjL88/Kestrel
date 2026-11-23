import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectTiff16Structure } from './tiff16Evidence';

/** Synthetic classic TIFF: tests structural refusals, never Nikon RAW provenance. */
function tiff(): Uint8Array {
  const b = new Uint8Array(640);
  const v = new DataView(b.buffer);
  b.set([73, 73]); v.setUint16(2, 42, true); v.setUint32(4, 8, true);
  const entries: Array<[number, number, number, number]> = [
    [256, 4, 1, 2], [257, 4, 1, 2], [258, 3, 3, 220],
    [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 440],
    [277, 3, 1, 3], [278, 4, 1, 2], [279, 4, 1, 24],
    [284, 3, 1, 1], [34675, 7, 128, 280],
  ];
  v.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 10 + 12 * i;
    v.setUint16(at, tag, true); v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true); v.setUint32(at + 8, value, true);
  });
  for (let i = 0; i < 3; i++) v.setUint16(220 + 2 * i, 16, true);
  v.setUint32(280, 128, false); b.set([97, 99, 115, 112], 316);
  return b;
}

describe('TIFF16 trust-boundary negative regression', () => {
  it('accepts a synthetic complete RGB16 strip only as structural evidence', () => {
    assert.deepEqual(inspectTiff16Structure(tiff()), { ok: true, width: 2, height: 2, samples: 3 });
  });
  it('rejects a strip extending beyond its actual byte buffer', () => {
    const b = tiff(); new DataView(b.buffer).setUint32(10 + 5 * 12 + 8, 630, true);
    assert.equal(inspectTiff16Structure(b).ok, false);
  });
  it('rejects a strip whose declared byte count is smaller than its raster', () => {
    const b = tiff(); new DataView(b.buffer).setUint32(10 + 8 * 12 + 8, 12, true);
    assert.equal(inspectTiff16Structure(b).ok, false);
  });
  it('rejects a forged 8-bit channel in an otherwise valid RGB16 raster', () => {
    const b = tiff(); new DataView(b.buffer).setUint16(222, 8, true);
    assert.equal(inspectTiff16Structure(b).ok, false);
  });
  it('rejects an ICC pointer outside the buffer', () => {
    const b = tiff(); new DataView(b.buffer).setUint32(10 + 10 * 12 + 8, 600, true);
    assert.equal(inspectTiff16Structure(b).ok, false);
  });
  it('rejects an ICC payload with an invalid acsp signature', () => {
    const b = tiff(); b[316] = 0;
    assert.equal(inspectTiff16Structure(b).ok, false);
  });
  it('rejects BigTIFF and JPEG instead of treating them as RGB16 evidence', () => {
    const big = tiff(); new DataView(big.buffer).setUint16(2, 43, true);
    assert.equal(inspectTiff16Structure(big).ok, false);
    assert.equal(inspectTiff16Structure(new Uint8Array([255, 216, 255, 217])).ok, false);
  });
});
