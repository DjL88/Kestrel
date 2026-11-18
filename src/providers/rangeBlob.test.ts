import test from 'node:test';
import assert from 'node:assert/strict';
import { RangeBlob, headBlob, materialize } from './rangeBlob';
import { extractRawPreview } from '../core/nefPreview';

function source(bytes: Uint8Array) {
  const reads: Array<[number, number]> = [];
  const read = async (offset: number, length: number) => {
    reads.push([offset, length]);
    return bytes.slice(offset, offset + length);
  };
  return { blob: RangeBlob.of(read, bytes.length), reads };
}

test('slicing behaves like Blob.slice, including negative and out-of-range offsets', async () => {
  const bytes = Uint8Array.from({ length: 20 }, (_, i) => i);
  const { blob } = source(bytes);
  const real = new Blob([bytes]);
  for (const [a, b] of [[0, 5], [5, 2], [-4, undefined], [3, -3], [-100, 100], [18, 50]] as Array<[number, number | undefined]>) {
    const ours = new Uint8Array(await blob.slice(a, b).arrayBuffer());
    const theirs = new Uint8Array(await real.slice(a, b).arrayBuffer());
    assert.deepEqual([...ours], [...theirs], `slice(${a}, ${b})`);
  }
  assert.equal(blob.slice(2, 10).slice(3, 5).size, 2);
  assert.deepEqual([...new Uint8Array(await blob.slice(2, 10).slice(3, 5).arrayBuffer())], [5, 6]);
});

test('only the requested bytes are read', async () => {
  const { blob, reads } = source(new Uint8Array(10_000_000));
  await blob.slice(1000, 1010).arrayBuffer();
  await headBlob(blob, 4096);
  assert.deepEqual(reads, [[1000, 10], [0, 4096]]);
});

test('a short read is an error, never silently truncated pixels', async () => {
  const blob = RangeBlob.of(async () => new Uint8Array(3), 10);
  await assert.rejects(() => blob.arrayBuffer(), /ended before/);
});

test('materialize returns a real Blob with the bytes and type', async () => {
  const { blob } = source(Uint8Array.from([1, 2, 3, 4]));
  const real = await materialize(blob.slice(1, 3, 'image/jpeg'));
  assert.ok(real instanceof Blob);
  assert.equal(real.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await real.arrayBuffer())], [2, 3]);
  const already = new Blob(['x']);
  assert.equal(await materialize(already), already);
});

test('the RAW preview reader finds an embedded JPEG through ranged reads without reading the whole file', async () => {
  // A minimal little-endian TIFF: one directory pointing at a 5,000-byte "JPEG" (SOI ... EOI) far from the end.
  const size = 2_000_000;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 42, 0]);
  view.setUint32(4, 8, true);
  view.setUint16(8, 2, true);
  const entry = (index: number, tag: number, value: number) => {
    const at = 10 + index * 12;
    view.setUint16(at, tag, true); view.setUint16(at + 2, 4, true); view.setUint32(at + 4, 1, true); view.setUint32(at + 8, value, true);
  };
  const jpegAt = 1000, jpegLength = 5000;
  entry(0, 0x0201, jpegAt);
  entry(1, 0x0202, jpegLength);
  view.setUint32(10 + 2 * 12, 0, true);
  // SOI, then a baseline SOF0 for 1600 x 1200 with 3 components, then EOI at the end.
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1], jpegAt);
  bytes.set([0xff, 0xd9], jpegAt + jpegLength - 2);
  const { blob, reads } = source(bytes);
  const preview = await extractRawPreview(blob as unknown as Blob);
  assert.ok(preview, 'preview found');
  assert.equal(preview!.size, jpegLength);
  const total = reads.reduce((sum, [, length]) => sum + length, 0);
  assert.ok(total < 300_000, `read ${total} bytes of ${size}`);
});
