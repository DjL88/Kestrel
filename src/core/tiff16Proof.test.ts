import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeTiff16 } from './master16';
import { proveTiff16 } from './tiff16Proof';

async function fixture(): Promise<ArrayBuffer> {
  const data = Uint16Array.from({ length: 18 }, (_, i) => i * 3217 + 19);
  return encodeTiff16({ width: 3, height: 2, data }).arrayBuffer();
}
function tag(view: DataView, id: number): number {
  const ifd = view.getUint32(4, true);
  for (let i = 0; i < view.getUint16(ifd, true); i++) {
    const at = ifd + 2 + i * 12;
    if (view.getUint16(at, true) === id) return at;
  }
  throw new Error('missing fixture tag ' + id);
}
test('synthetic RGB16 TIFF with genuine >8-bit samples and RGB ICC passes structural proof', async () => {
  const buffer = await fixture();
  assert.deepEqual(proveTiff16(buffer), { width: 3, height: 2, iccBytes: 588 });
});
test('truncated TIFF, invalid dimensions, sample precision and pixel length fail closed', async () => {
  const valid = await fixture();
  assert.throws(() => proveTiff16(valid.slice(0, 10)), /out-of-bounds TIFF data/);
  for (const mutate of [
    (v: DataView) => v.setUint32(tag(v, 256) + 8, 80_000_001, true),
    (v: DataView) => v.setUint32(tag(v, 279) + 8, 2, true),
    (v: DataView) => v.setUint16(v.getUint32(tag(v, 258) + 8, true), 8, true),
    (v: DataView) => v.setUint32(tag(v, 273) + 8, 0xfffffff0, true),
    (v: DataView) => v.setUint16(tag(v, 259) + 8, 5, true),
  ]) {
    const bytes = valid.slice(0);
    mutate(new DataView(bytes));
    assert.throws(() => proveTiff16(bytes));
  }
});
test('missing, truncated, false RGB and overlapping ICC fail closed', async () => {
  const valid = await fixture();
  for (const mutate of [
    (v: DataView) => v.setUint16(tag(v, 34675), 1234, true),
    (v: DataView) => v.setUint32(tag(v, 34675) + 4, 900, true),
    (v: DataView) => { const p = v.getUint32(tag(v, 34675) + 8, true); v.setUint8(p + 16, 0); },
    (v: DataView) => v.setUint32(tag(v, 34675) + 8, v.getUint32(tag(v, 273) + 8, true), true),
  ]) {
    const bytes = valid.slice(0);
    mutate(new DataView(bytes));
    assert.throws(() => proveTiff16(bytes));
  }
});
test('duplicate tags cannot replace trusted dimensions', async () => {
  const bytes = await fixture();
  const v = new DataView(bytes);
  v.setUint16(tag(v, 257), 256, true);
  assert.throws(() => proveTiff16(bytes), /duplicate/);
});

test('pixel data cannot alias TIFF directory or sample-precision metadata', async () => {
  const valid = await fixture();
  for (const offset of [
    (v: DataView) => v.getUint32(4, true),
    (v: DataView) => v.getUint32(tag(v, 258) + 8, true),
  ]) {
    const bytes = valid.slice(0);
    const view = new DataView(bytes);
    view.setUint32(tag(view, 273) + 8, offset(view), true);
    assert.throws(() => proveTiff16(bytes), /metadata overlaps/);
  }
});
