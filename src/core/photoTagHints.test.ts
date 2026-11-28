import assert from 'node:assert/strict';
import test from 'node:test';
import { naturalAuto } from './naturalAuto.ts';
import { sceneHintsFromPhotoTags } from './photoTagHints.ts';
import type { PhotoFrame } from './types.ts';

const W = 96, H = 64;
const make = (f: (x: number, y: number) => [number, number, number]) => {
  const p = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = f(x, y); const i = (y * W + x) * 4; p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = 255; }
  return p;
};
// A bright, textured frame: unguided, Auto darkens it and adds vibrance.
const bright = make((x, y) => { const v = 232 + ((x * 7 + y * 13) % 22); return [v, v, Math.min(255, v + 3)]; });
const tagged = (...ids: string[]) => ({
  stableKey: 'k', photoTags: { schema: 1, sourceStableKey: 'k', tags: ids.map((id) => ({ id, facet: id.split('.')[0], source: 'clip' })), byLane: {} },
}) as unknown as Pick<PhotoFrame, 'stableKey' | 'photoTags'>;

test('scene tags become preservation hints only', () => {
  assert.deepEqual(sceneHintsFromPhotoTags(tagged()), {});
  assert.deepEqual(sceneHintsFromPhotoTags(tagged('light.golden-hour')), { preserveLight: true });
  assert.deepEqual(sceneHintsFromPhotoTags(tagged('light.blue-hour')), { preserveLight: true });
  for (const id of ['style.low-key', 'light.night', 'genre.astro', 'light.milky-way']) assert.deepEqual(sceneHintsFromPhotoTags(tagged(id)), { preserveDark: true }, id);
  assert.deepEqual(sceneHintsFromPhotoTags(tagged('weather.fog')), { preserveSoft: true });
  assert.deepEqual(sceneHintsFromPhotoTags(tagged('weather.snow')), { preserveBright: true });
  assert.deepEqual(sceneHintsFromPhotoTags(tagged('style.high-key')), { preserveBright: true });
  assert.deepEqual(sceneHintsFromPhotoTags(tagged('style.black-and-white')), { monochrome: true });
  assert.deepEqual(sceneHintsFromPhotoTags(tagged('weather.overcast')), { overcast: true });
  // Tags for another file are ignored.
  assert.deepEqual(sceneHintsFromPhotoTags({ ...tagged('weather.snow'), stableKey: 'other' }), {});
});

test('snow and high-key keep a bright frame bright; black and white gets no colour-only change', () => {
  const plain = naturalAuto({ pixels: bright, width: W, height: H }).edit;
  assert.ok(plain.exposure < 0 && plain.vibrance > 0, 'unguided Auto darkens it and adds vibrance (the case being guarded)');
  const snow = naturalAuto({ pixels: bright, width: W, height: H, sceneHints: { preserveBright: true } }).edit;
  assert.ok(snow.exposure >= 0, 'not darkened');
  assert.ok(snow.highlights >= 0, 'highlights not pulled grey');
  const mono = naturalAuto({ pixels: bright, width: W, height: H, sceneHints: { monochrome: true } }).edit;
  assert.equal(mono.vibrance, 0);
  assert.equal(mono.warmth ?? 0, 0);
  assert.equal(mono.exposure, plain.exposure, 'a hint only removes what it is about');
  // Hints never add an adjustment.
  for (const hints of [{ preserveBright: true }, { monochrome: true }, { preserveDark: true }, { preserveLight: true }, { preserveSoft: true }]) {
    const out = naturalAuto({ pixels: bright, width: W, height: H, sceneHints: hints }).edit;
    for (const key of ['exposure', 'warmth', 'shadows', 'highlights', 'contrast', 'vibrance'] as const) {
      assert.ok(Math.abs(out[key] ?? 0) <= Math.abs(plain[key] ?? 0), `${JSON.stringify(hints)} never strengthens ${key}`);
    }
  }
});

test('overcast keeps contrast gentle and adds no warming', () => {
  // A dull, slightly flat frame: unguided Auto adds contrast.
  const dull = make((x, y) => { const v = 100 + ((x * 3 + y * 5) % 40); return [v + 8, v, v - 6]; });
  const plain = naturalAuto({ pixels: dull, width: W, height: H }).edit;
  assert.ok(plain.contrast > 0.1, 'unguided Auto adds more than gentle contrast (the case being guarded)');
  const grey = naturalAuto({ pixels: dull, width: W, height: H, sceneHints: { overcast: true } }).edit;
  assert.ok(grey.contrast <= 0.1 && grey.contrast >= 0, 'contrast kept gentle, never reversed');
  assert.ok((grey.warmth ?? 0) <= 0, 'no warming');
});

test('a low-key tag InFlight measured itself is told apart from one the person, the clock or the image model gave', () => {
  const withSource = (id: string, source: string) => ({
    stableKey: 'k', photoTags: { schema: 1, sourceStableKey: 'k', tags: [{ id, facet: id.split('.')[0], source }], byLane: {} },
  }) as unknown as Pick<PhotoFrame, 'stableKey' | 'photoTags'>;
  assert.deepEqual(sceneHintsFromPhotoTags(withSource('style.low-key', 'computed')), { preserveDark: true, darkMeasuredOnly: true });
  assert.deepEqual(sceneHintsFromPhotoTags(withSource('style.low-key', 'user')), { preserveDark: true });
  assert.deepEqual(sceneHintsFromPhotoTags(withSource('style.low-key', 'clip')), { preserveDark: true });
  assert.deepEqual(sceneHintsFromPhotoTags(withSource('light.night', 'computed')), { preserveDark: true }, 'night is from the clock: a hard hold');
  const both = {
    stableKey: 'k', photoTags: { schema: 1, sourceStableKey: 'k', byLane: {}, tags: [
      { id: 'style.low-key', facet: 'style', source: 'computed' }, { id: 'light.night', facet: 'light', source: 'computed' }] },
  } as unknown as Pick<PhotoFrame, 'stableKey' | 'photoTags'>;
  assert.deepEqual(sceneHintsFromPhotoTags(both), { preserveDark: true }, 'any other dark tag keeps the hold');
});
