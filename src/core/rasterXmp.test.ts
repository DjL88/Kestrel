import assert from 'node:assert/strict';
import test from 'node:test';
import { embedRasterXmp } from './rasterXmp';

const png = new Blob([Uint8Array.from([
  137,80,78,71,13,10,26,10,
  0,0,0,0,73,69,78,68,174,66,96,130,
])], { type: 'image/png' });
const jpeg = new Blob([Uint8Array.from([255,216,255,224,0,4,0,0,255,217])], { type: 'image/jpeg' });

test('XMP is off by default and never rewrites photo bytes', async () => {
  assert.equal(await embedRasterXmp(jpeg, 'jpeg', null), jpeg);
  assert.equal(await embedRasterXmp(png, 'png', undefined), png);
  assert.equal(await embedRasterXmp(jpeg, 'jpeg', {}), jpeg);
});

test('JPEG APP1 adds only selected XMP after JFIF, preserves SOI/EOI and photo bytes', async () => {
  const result = await embedRasterXmp(jpeg, 'jpeg', { title: 'A kingfisher', creator: 'The photographer' });
  const bytes = new Uint8Array(await result.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [255,216,255,224,0,4,0,0]);
  assert.deepEqual([...bytes.slice(8, 10)], [255,225]);
  assert.deepEqual([...bytes.slice(-2)], [255,217]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /http:\/\/ns.adobe.com\/xap\/1.0\//);
  assert.match(text, /A kingfisher/);
  assert.match(text, /The photographer/);
  assert.doesNotMatch(text, /GPSLatitude|SerialNumber|<script>/);
  assert.equal(result.type, 'image/jpeg');
});

test('PNG iTXt inserts correctly sized CRC-protected XMP before IEND', async () => {
  const result = await embedRasterXmp(png, 'png', { caption: 'Dipper & dunnock', keywords: ['Wildlife', '<script>'] });
  const bytes = new Uint8Array(await result.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [...new Uint8Array(await png.slice(0, 8).arrayBuffer())]);
  const block = bytes.subarray(8, bytes.length - 12);
  const length = new DataView(block.buffer, block.byteOffset, 4).getUint32(0);
  assert.equal(length, block.length - 12);
  assert.equal(new TextDecoder().decode(block.subarray(4, 8)), 'iTXt');
  const text = new TextDecoder().decode(block);
  assert.match(text, /Dipper &amp; dunnock/);
  assert.match(text, /&lt;script&gt;/);
  assert.deepEqual([...bytes.slice(-12)], [...new Uint8Array(await png.slice(-12).arrayBuffer())]);
  assert.equal(result.type, 'image/png');
});

test('invalid JPEG/PNG is rejected before an exported file is offered', async () => {
  await assert.rejects(embedRasterXmp(new Blob([new Uint8Array(12)]), 'jpeg', { title: 'X' }), /invalid/i);
  await assert.rejects(embedRasterXmp(new Blob([new Uint8Array(20)]), 'png', { title: 'X' }), /invalid/i);
});
