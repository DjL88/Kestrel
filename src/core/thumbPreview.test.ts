import assert from 'node:assert/strict';
import test from 'node:test';
import { THUMB_HEAD_BYTES, completeJpegsIn, extractThumbRawPreview, shownJpegSize } from './nefPreview';

/** A minimal baseline JPEG of the given size: start, a frame header, a scan header, a little data, the end. */
function jpeg(width: number, height: number, filler = 64): Uint8Array {
  const sof = [0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  return Uint8Array.from([0xff, 0xd8, ...sof, ...sos, ...new Array(filler).fill(0x55), 0xff, 0xd9]);
}

/** A little-endian TIFF-style RAW: an empty first directory, then the camera's JPEGs where a Nikon Z8 keeps them. */
function syntheticRaw(): Uint8Array<ArrayBuffer> {
  const file = new Uint8Array(2 * 1024 * 1024);
  file.set([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  file.set(jpeg(640, 424, 4000), 98 * 1024);
  file.set(jpeg(160, 120), 243 * 1024);
  file.set(jpeg(1620, 1080, 9000), 350 * 1024);
  return file;
}

test('a thumbnail is the smallest camera JPEG that fills a tile, read from the first quarter megabyte only', async () => {
  const raw = new Blob([syntheticRaw()]);
  let furthest = 0;
  const watched = new Proxy(raw, {
    get(target, prop) {
      if (prop === 'slice') return (start = 0, end = target.size, type?: string) => { furthest = Math.max(furthest, end); return target.slice(start, end, type); };
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Blob;
  const thumb = await extractThumbRawPreview(watched);
  assert.ok(thumb);
  assert.deepEqual(await shownJpegSize(thumb!), { width: 640, height: 424 }, 'not the 160 px one (too small for a tile), not the 1620 px one');
  assert.ok(furthest <= THUMB_HEAD_BYTES, `read no further than ${THUMB_HEAD_BYTES} bytes (read to ${furthest})`);
});

test('a JPEG that runs past the bytes read, or a broken one, is not taken', () => {
  const bytes = new Uint8Array(4096);
  const whole = jpeg(640, 424, 100);
  bytes.set(whole, 100);
  bytes.set(jpeg(1620, 1080, 8000).subarray(0, 2000), 2000); // cut off by the read
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 1], 3900); // a segment length below 2
  const found = completeJpegsIn(bytes);
  assert.equal(found.length, 1);
  assert.equal(found[0].byteLength, whole.byteLength);
});
