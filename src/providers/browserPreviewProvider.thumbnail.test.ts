import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BrowserPreviewProvider } from './browserPreviewProvider';
import type { LinkedRange } from './linkedOriginals';
import type { PhotoFrame } from '../core/types';

/** A small TIFF-style RAW whose first directory points at an embedded JPEG (the shape of a Nikon NEF's preview). */
const jpeg = new Uint8Array(await readFile(new URL('../assets/images/demo_red_kite_flight_1794721996053.jpg', import.meta.url)));
function syntheticRaw(): Blob {
  const header = new Uint8Array(64);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0x4949); view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x014a, true); view.setUint16(12, 4, true); view.setUint32(14, 1, true); view.setUint32(18, 26, true);
  view.setUint16(26, 2, true);
  for (const [i, tag, value] of [[28, 0x0201, 4096], [40, 0x0202, jpeg.length]]) {
    view.setUint16(i, tag, true); view.setUint16(i + 2, 4, true); view.setUint32(i + 4, 1, true); view.setUint32(i + 8, value, true);
  }
  view.setUint32(52, 0, true);
  // The sensor data a whole-file read would carry across the bridge.
  return new Blob([header, new Uint8Array(4096 - header.length), jpeg, new Uint8Array(2 * 1024 * 1024)]);
}

const frame = { id: 'p1', stableKey: 'linked-nef', filename: 'DSC_3475.NEF' } as PhotoFrame;

function linkedProvider(verified: boolean | null) {
  const file = syntheticRaw();
  const calls = { wholeReads: 0, ranges: 0, closed: 0, pieceReads: 0, fingerprints: 0 };
  const pieces = { slice: (from?: number, to?: number) => { calls.pieceReads += 1; return file.slice(from, to); }, size: file.size };
  const provider = new BrowserPreviewProvider();
  provider.registerLinked(frame.stableKey, {
    size: file.size, lastModified: 1,
    read: async () => { calls.wholeReads += 1; return file; },
    openRange: async (): Promise<LinkedRange> => {
      calls.ranges += 1;
      return { blob: pieces as unknown as LinkedRange['blob'], verify: async () => verified === true, verifyNatively: async () => { calls.fingerprints += 1; return verified; }, unchanged: async () => verified === true,
        close: async () => { calls.closed += 1; } };
    },
  });
  return { provider, calls };
}

test('a linked RAW’s thumbnail is made from its camera preview alone: the whole file is never read for it', async () => {
  const { provider, calls } = linkedProvider(true);
  try {
    const url = await provider.getThumbnailUrl(frame, 'selected');
    assert.ok(url, 'a thumbnail is shown');
    assert.equal(provider.pictureSourceOf(url), 'camera-preview', 'and says it is the camera’s preview');
    assert.equal(calls.wholeReads, 0, 'no whole-file read (about 50 MB for a 45 MP RAW)');
    assert.equal(calls.ranges, 1);
    assert.equal(calls.closed, 1, 'the ranged read is closed');
    assert.equal(calls.pieceReads > 0, true, 'the camera preview was read from its part of the file');
    assert.equal(calls.fingerprints, 0, 'and the whole file was not fingerprinted for a thumbnail (a full read of every RAW)');
  } finally { provider.clear(); }
});

for (const [why, verified] of [['the file changed while it was read', false]] as const) {
  test(`when ${why}, the thumbnail falls back to the full, checked read, as before`, async () => {
    const { provider, calls } = linkedProvider(verified);
    try {
      const url = await provider.getThumbnailUrl(frame, 'selected');
      assert.ok(url);
      assert.equal(calls.wholeReads, 1, 'the original is read whole, as before');
    } finally { provider.clear(); }
  });
}
