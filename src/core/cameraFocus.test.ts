import assert from 'node:assert/strict';
import { test } from 'node:test';
import exifr from 'exifr';
import { readCameraFocus } from './cameraFocus';
import { jpegWithMakerNote, nikonAfInfo2Bytes, nikonMakerNote, type NikonAfInfo2Fixture } from './cameraFocusFixture';

const Z8: NikonAfInfo2Fixture = {
  version: '0400', areaMode: 193, coordinatesAvailable: true, afImage: [8256, 5504], centre: [2064, 1376], size: [400, 300], focusResult: 1,
};

/** The maker note as the app gets it: exifr's `makerNote` segment of a real EXIF block. */
async function focusOf(order: 'MM' | 'II', fixture: NikonAfInfo2Fixture, make = 'NIKON CORPORATION') {
  const jpeg = jpegWithMakerNote(make, 'NIKON Z 8', nikonMakerNote(order, nikonAfInfo2Bytes(order, fixture)), order);
  const segments = await exifr.parse(jpeg, { mergeOutput: false, makerNote: true });
  return readCameraFocus(segments?.makerNote, segments?.ifd0?.Make);
}

test('a Z 8 single-point frame gives its AF mode, the camera verdict and the AF box (ExifTool reads the same bytes alike)', async () => {
  // Cross-checked once with ExifTool 13: AFAreaMode Single, FocusResult Focus, AFAreaX/YPosition 2064/1376, 400 x 300.
  const focus = await focusOf('MM', Z8);
  assert.equal(focus?.source, 'nikon-afinfo2');
  assert.equal(focus?.areaMode, 'single');
  assert.equal(focus?.focusConfirmed, true);
  const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 0.0002, `${a} vs ${b}`);
  near(focus?.area?.x, (2064 - 200) / 8256);
  near(focus?.area?.y, (1376 - 150) / 5504);
  near(focus?.area?.width, 400 / 8256);
  near(focus?.area?.height, 300 / 5504);
});

test('little-endian maker notes read the same', async () => {
  assert.deepEqual(await focusOf('II', Z8), await focusOf('MM', Z8));
});

test('the camera saying "out of focus" is kept as such, not dropped', async () => {
  const focus = await focusOf('MM', { ...Z8, focusResult: 0 });
  assert.equal(focus?.focusConfirmed, false);
});

test('auto-area without a recorded position keeps the mode but invents no box', async () => {
  const focus = await focusOf('MM', { ...Z8, areaMode: 197, coordinatesAvailable: false });
  assert.equal(focus?.areaMode, 'auto');
  assert.equal(focus?.area, undefined);
});

test('Expeed 6 bodies (Z 6II, Z 7II) are read from their own offsets, with no focus verdict', async () => {
  const focus = await focusOf('MM', { version: '0300', areaMode: 195, coordinatesAvailable: true, afImage: [8256, 5504], centre: [4128, 2752], size: [800, 800] });
  assert.equal(focus?.areaMode, 'wide-s');
  assert.equal(focus?.focusConfirmed, undefined);
  assert.ok(focus?.area && Math.abs(focus.area.x + focus.area.width / 2 - 0.5) < 0.001);
});

test('unknown versions, other makers, and boxes outside the frame give nothing rather than a guess', async () => {
  assert.equal(await focusOf('MM', { ...Z8, version: '0101' as never }), null);
  assert.equal(await focusOf('MM', Z8, 'Canon'), null);
  const outside = await focusOf('MM', { ...Z8, centre: [9000, 1376] });
  assert.equal(outside?.area, undefined);
  assert.equal(readCameraFocus(undefined, 'NIKON CORPORATION'), null);
  assert.equal(readCameraFocus(new Uint8Array([0x4e, 0x69, 0x6b]), 'NIKON CORPORATION'), null);
});

test('damaged or random maker notes never throw', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed & 0xff; };
  const good = nikonMakerNote('MM', nikonAfInfo2Bytes('MM', Z8));
  for (let round = 0; round < 500; round++) {
    const bytes = Uint8Array.from(good);
    for (let i = 0; i < 6; i++) bytes[10 + (random() * 7) % (bytes.length - 10)] = random();
    assert.doesNotThrow(() => readCameraFocus(bytes, 'NIKON CORPORATION'));
    assert.doesNotThrow(() => readCameraFocus(bytes.subarray(0, random() % bytes.length), 'NIKON CORPORATION'));
  }
});
