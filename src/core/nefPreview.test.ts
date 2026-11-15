import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractNefPreview } from './nefPreview';

const jpeg = new Uint8Array(await readFile(new URL('../assets/images/demo_red_kite_flight_1794721996053.jpg', import.meta.url)));
const offset = 15 * 1024 * 1024;
function container(little: boolean, start = offset) {
  const header = new Uint8Array(64);
  const view = new DataView(header.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x014a, little);
  view.setUint16(12, 4, little);
  view.setUint32(14, 1, little);
  view.setUint32(18, 26, little);
  view.setUint16(26, 2, little);
  for (const [i, tag, value] of [[28, 0x0201, start], [40, 0x0202, jpeg.length]]) {
    view.setUint16(i, tag, little);
    view.setUint16(i + 2, 4, little);
    view.setUint32(i + 4, 1, little);
    view.setUint32(i + 8, value, little);
  }
  view.setUint32(52, 8, little); // cyclic next-directory link
  return header;
}

for (const little of [true, false]) {
  test(`follows a ${little ? 'little' : 'big'}-endian SubIFD to an embedded preview after 14 MiB`, async () => {
    const header = container(little);
    const file = new Blob([header, new Uint8Array(offset - header.length), jpeg]);
    const preview = await extractNefPreview(file);
    assert.equal(preview?.type, 'image/jpeg');
    assert.deepEqual(new Uint8Array(await preview!.arrayBuffer()), jpeg);
  });
}

test('invalid offsets fall back to early embedded JPEGs and truncated files fail safely', async () => {
  const header = container(true, 0xfffffff0);
  assert.equal((await extractNefPreview(new Blob([header, jpeg])))?.size, jpeg.length);
  assert.equal(await extractNefPreview(new Blob([header])), null);
});
