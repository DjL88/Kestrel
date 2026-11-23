import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectTiff16Structure } from './tiff16Evidence';

function fixture(bits = [16, 16, 16], icc = true): Uint8Array {
  const bytes = new Uint8Array(512);
  const v = new DataView(bytes.buffer);
  bytes[0] = 73; bytes[1] = 73;
  v.setUint16(2, 42, true); v.setUint32(4, 8, true);
  const entries: Array<[number, number, number, number]> = [
    [256, 4, 1, 100], [257, 4, 1, 80], [258, 3, bits.length, 200],
    [277, 3, 1, bits.length],
  ];
  if (icc) entries.push([34675, 7, 128, 256]);
  v.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    v.setUint16(at, tag, true); v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true);
    v.setUint32(at + 8, value, true);
  });
  bits.forEach((bit, i) => v.setUint16(200 + i * 2, bit, true));
  v.setUint32(256, 128, false);
  bytes.set([97, 99, 115, 112], 256 + 36);
  return bytes;
}
describe('completed TIFF structural evidence', () => {
  it('accepts bounded classic TIFF with 16-bit channels and ICC header', () => {
    assert.deepEqual(inspectTiff16Structure(fixture()), { ok: true, width: 100, height: 80, samples: 3 });
  });
  it('rejects 8-bit channel, absent ICC, JPEG and truncated IFD', () => {
    assert.equal(inspectTiff16Structure(fixture([16, 8, 16])).ok, false);
    assert.equal(inspectTiff16Structure(fixture([16, 16, 16], false)).ok, false);
    assert.equal(inspectTiff16Structure(new Uint8Array([255, 216, 255])).ok, false);
    assert.equal(inspectTiff16Structure(fixture().subarray(0, 20)).ok, false);
  });
  it('rejects an ICC header without acsp and invalid directory offsets', () => {
    const noSignature = fixture(); noSignature[292] = 0;
    assert.equal(inspectTiff16Structure(noSignature).ok, false);
    const outOfBounds = fixture(); new DataView(outOfBounds.buffer).setUint32(4, 500, true);
    assert.equal(inspectTiff16Structure(outOfBounds).ok, false);
  });
});
