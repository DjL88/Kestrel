import assert from 'node:assert/strict';
import test from 'node:test';
import { rawSensorSize } from './rawSensorSize';

type Entry = [tag: number, type: number, count: number, value: number];

/** A little-endian TIFF: IFD0 (with orientation and SubIFDs) and the given SubIFDs, laid out back to back. */
function tiff(orientation: number | null, subs: Entry[][], extra: Entry[] = []): Uint8Array {
  const bytes = new Uint8Array(4096);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]); view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0Entries: Entry[] = [[254, 4, 1, 1], [256, 3, 1, 160], [257, 3, 1, 120], ...extra];
  if (orientation !== null) ifd0Entries.push([274, 3, 1, orientation]);
  const subArrayAt = 8 + ifdSize(ifd0Entries.length + 1);
  let next = subArrayAt + subs.length * 4;
  const subOffsets = subs.map((entries) => { const at = next; next += ifdSize(entries.length); return at; });
  ifd0Entries.push([330, 4, subs.length, subs.length === 1 ? subOffsets[0] : subArrayAt]);
  const write = (at: number, entries: Entry[]) => {
    view.setUint16(at, entries.length, true);
    entries.forEach(([tag, type, count, value], i) => {
      const e = at + 2 + i * 12;
      view.setUint16(e, tag, true); view.setUint16(e + 2, type, true); view.setUint32(e + 4, count, true);
      if (type === 3 && count === 1) view.setUint16(e + 8, value, true); else view.setUint32(e + 8, value, true);
    });
  };
  write(8, ifd0Entries);
  subOffsets.forEach((at, i) => view.setUint32(subArrayAt + i * 4, at, true));
  subs.forEach((entries, i) => write(subOffsets[i], entries));
  return bytes;
}

const raw = (w: number, h: number): Entry[] => [[254, 4, 1, 0], [256, 4, 1, w], [257, 4, 1, h], [259, 3, 1, 34713]];
const preview = (w: number, h: number): Entry[] => [[254, 4, 1, 1], [256, 4, 1, w], [257, 4, 1, h]];

test('a NEF-style file gives the full-resolution raw image size, not the thumbnail or a preview', () => {
  assert.deepEqual(rawSensorSize(tiff(1, [preview(9000, 6000), raw(6048, 4032), preview(448, 276)])), { width: 6048, height: 4032 });
});

test('a DX crop frame reports the size the sensor actually recorded', () => {
  assert.deepEqual(rawSensorSize(tiff(1, [raw(4000, 2672)])), { width: 4000, height: 2672 });
});

test('orientation 5-8 turns the shape to portrait; 1-4 leaves it', () => {
  assert.deepEqual(rawSensorSize(tiff(6, [raw(6048, 4032)])), { width: 4032, height: 6048 });
  assert.deepEqual(rawSensorSize(tiff(8, [raw(6048, 4032)])), { width: 4032, height: 6048 });
  assert.deepEqual(rawSensorSize(tiff(3, [raw(6048, 4032)])), { width: 6048, height: 4032 });
});

test('malformed, non-TIFF, thumbnail-only or absurd sizes give null rather than a guess', () => {
  assert.equal(rawSensorSize(new Uint8Array(8)), null);
  assert.equal(rawSensorSize(new TextEncoder().encode('not a tiff file at all, just text')), null);
  assert.equal(rawSensorSize(tiff(1, [preview(448, 276)])), null);
  assert.equal(rawSensorSize(tiff(1, [raw(320, 200)])), null);
  assert.equal(rawSensorSize(tiff(1, [raw(50000, 4000)])), null);
  const truncated = tiff(1, [raw(6048, 4032)]).subarray(0, 40);
  assert.equal(rawSensorSize(truncated), null);
});
