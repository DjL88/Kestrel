import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEmbeddedJpegFromRawBuffer } from './exifParser.ts';

test('truncated embedded JPEG does not swallow a later valid preview', () => {
  const bytes = new Uint8Array(12_000);
  // The first apparent JPEG has no EOI and is not a usable preview.
  bytes.set([0xff, 0xd8, 0xff, 0xe1], 100);
  // A separate JPEG follows. Only this preview should be returned.
  bytes.set([0xff, 0xd8, 0xff, 0xe1], 3000);
  bytes.set([0xff, 0xd9], 9000);
  const result = extractEmbeddedJpegFromRawBuffer(bytes.buffer);
  assert.ok(result);
  assert.equal(result.bytes.length, 6002);
  assert.deepEqual([...result.bytes.slice(0, 4)], [0xff, 0xd8, 0xff, 0xe1]);
});

test('normal embedded JPEG still extracts unchanged', () => {
  const bytes = new Uint8Array(6000);
  bytes.set([0xff, 0xd8, 0xff, 0xe1], 100);
  bytes.set([0xff, 0xd9], 5100);
  assert.equal(extractEmbeddedJpegFromRawBuffer(bytes.buffer)?.bytes.length, 5002);
});
