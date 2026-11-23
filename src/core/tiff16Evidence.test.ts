import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectTiff16Structure } from './tiff16Evidence';

function fixture(bits = [16, 16, 16], icc = true, declaredAlpha = false): Uint8Array {
  const bytes = new Uint8Array(512);
  const v = new DataView(bytes.buffer);
  bytes[0] = 73; bytes[1] = 73;
  v.setUint16(2, 42, true); v.setUint32(4, 8, true);
  const entries: Array<[number, number, number, number]> = [
    [256, 4, 1, 4], [257, 4, 1, 3], [258, 3, bits.length, 200],
    [259, 3, 1, 1], [262, 3, 1, bits.length === 1 ? 1 : 2],
    [273, 4, 1, 400], [277, 3, 1, bits.length], [278, 4, 1, 3],
    [279, 4, 1, 4 * 3 * bits.length * 2], [284, 3, 1, 1],
  ];
  if (icc) entries.push([34675, 7, 128, 256]);
  if (declaredAlpha) entries.push([338, 3, 1, 2]);
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
    assert.deepEqual(inspectTiff16Structure(fixture()), { ok: true, width: 4, height: 3, samples: 3 });
  });
  it('refuses two-channel pseudo-RGB and undeclared four-channel alpha', () => {
    assert.equal(inspectTiff16Structure(fixture([16, 16])).ok, false);
    assert.equal(inspectTiff16Structure(fixture([16, 16, 16, 16])).ok, false);
  });
  it('accepts four-channel RGB16 only with a declared unassociated alpha channel', () => {
    assert.deepEqual(inspectTiff16Structure(fixture([16, 16, 16, 16], true, true)),
      { ok: true, width: 4, height: 3, samples: 4 });
  });
  it('rejects 8-bit channel, absent ICC, JPEG and truncated IFD', () => {
    assert.equal(inspectTiff16Structure(fixture([16, 8, 16])).ok, false);
    assert.equal(inspectTiff16Structure(fixture([16, 16, 16], false)).ok, false);
    assert.equal(inspectTiff16Structure(new Uint8Array([255, 216, 255])).ok, false);
    assert.equal(inspectTiff16Structure(fixture().subarray(0, 20)).ok, false);
  });
  it('refuses metadata-only, truncated or incorrectly sized pixel strips', () => {
    const absent = fixture(); new DataView(absent.buffer).setUint32(4, 8, true);
    // StripOffset tag 273 is the sixth entry, at 10 + 5*12 + 8.
    new DataView(absent.buffer).setUint32(78, 510, true);
    assert.equal(inspectTiff16Structure(absent).ok, false);
    const short = fixture(); new DataView(short.buffer).setUint32(10 + 8 * 12 + 8, 4, true);
    assert.equal(inspectTiff16Structure(short).ok, false);
    const unsupported = fixture(); new DataView(unsupported.buffer).setUint32(10 + 3 * 12 + 8, 5, true);
    assert.equal(inspectTiff16Structure(unsupported).ok, false);
  });
  it('rejects an ICC header without acsp and invalid directory offsets', () => {
    const noSignature = fixture(); noSignature[292] = 0;
    assert.equal(inspectTiff16Structure(noSignature).ok, false);
    const outOfBounds = fixture(); new DataView(outOfBounds.buffer).setUint32(4, 500, true);
    assert.equal(inspectTiff16Structure(outOfBounds).ok, false);
  });
  it('rejects an ICC profile aliased onto raster bytes', () => {
    const aliased = fixture();
    const v = new DataView(aliased.buffer);
    // Move the single strip to overlap the ICC region, retaining its expected byte count.
    v.setUint32(10 + 5 * 12 + 8, 300, true);
    assert.match(inspectTiff16Structure(aliased).ok ? '' : (inspectTiff16Structure(aliased) as { ok: false; reason: string }).reason, /overlap/i);
  });
  it('rejects raster bytes that alias the TIFF header or BitsPerSample metadata', () => {
    const header = fixture();
    new DataView(header.buffer).setUint32(10 + 5 * 12 + 8, 0, true);
    const headerResult = inspectTiff16Structure(header);
    assert.equal(headerResult.ok, false);
    if (!headerResult.ok) assert.match(headerResult.reason, /header/i);

    const bits = fixture();
    new DataView(bits.buffer).setUint32(10 + 5 * 12 + 8, 200, true);
    const bitsResult = inspectTiff16Structure(bits);
    assert.equal(bitsResult.ok, false);
    if (!bitsResult.ok) assert.match(bitsResult.reason, /bit-depth metadata/i);
  });
  it('rejects an ICC payload whose declared span overlaps the image directory', () => {
    const aliased = fixture();
    // The IFD starts at 8 and ends beyond 128; a profile beginning at 100
    // cannot be independent of its directory even if its signature looks valid.
    const view = new DataView(aliased.buffer);
    view.setUint32(10 + 10 * 12 + 8, 100, true);
    view.setUint32(100, 128, false);
    aliased.set([97, 99, 115, 112], 136);
    assert.equal(inspectTiff16Structure(aliased).ok, false);
  });
  it('rejects a strip aliased onto the TIFF directory', () => {
    const aliased = fixture();
    new DataView(aliased.buffer).setUint32(10 + 5 * 12 + 8, 20, true);
    assert.equal(inspectTiff16Structure(aliased).ok, false);
  });
});
