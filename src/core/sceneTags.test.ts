import test from 'node:test';
import assert from 'node:assert/strict';
import labels from '../assets/scene/labels.json' with { type: 'json' };
import vectors from '../assets/scene/vectors.json' with { type: 'json' };
import thresholds from '../assets/scene/thresholds.json' with { type: 'json' };
import { captureInstantUtc, readGpsPosition } from './exifParser';
import { mergePhotoTags } from './photoTags';
import { PLACES_REVISION, clipSceneTags, pixelStyleTags, sceneModel, sceneRevision, sceneTagCandidates, sceneTagWork, sceneTags, sunTags, type SceneModel } from './sceneTags';
import type { PhotoFrame } from './types';

const ids = (tags: { id: string }[]) => tags.map((tag) => tag.id);
const MACH_LOOP = { latitude: 52.661, longitude: -3.822 };

test('golden hour, blue hour and night are calculated from GPS and the true capture time, never without them', () => {
  // 25 November 2026 at the Mach Loop: sunset about 16:05 UTC.
  assert.deepEqual(ids(sunTags({ gps: MACH_LOOP, capturedAtUtcMs: Date.UTC(2026, 10, 25, 15, 50) })), ['light.golden-hour']);
  assert.deepEqual(ids(sunTags({ gps: MACH_LOOP, capturedAtUtcMs: Date.UTC(2026, 10, 25, 16, 40) })), ['light.blue-hour']);
  assert.deepEqual(ids(sunTags({ gps: MACH_LOOP, capturedAtUtcMs: Date.UTC(2026, 10, 25, 21, 0) })), ['light.night']);
  assert.deepEqual(ids(sunTags({ gps: MACH_LOOP, capturedAtUtcMs: Date.UTC(2026, 10, 25, 12, 0) })), []);
  assert.deepEqual(sunTags({ gps: MACH_LOOP }), [], 'no true capture time: no light tag');
  assert.deepEqual(sunTags({ capturedAtUtcMs: Date.UTC(2026, 10, 25, 15, 50) }), [], 'no GPS: no light tag');
});

test('the capture instant comes from GPS time or a recorded offset, never from a bare camera clock', () => {
  assert.equal(captureInstantUtc(undefined, undefined, { GPSDateStamp: '2026:11:25', GPSTimeStamp: [15, 50, 30] }), Date.UTC(2026, 10, 25, 15, 50, 30));
  const wall = new Date(2026, 6, 1, 20, 30, 0); // exifr builds the camera's wall clock in this computer's zone
  assert.equal(captureInstantUtc(wall, '+01:00', undefined), Date.UTC(2026, 6, 1, 19, 30, 0));
  assert.equal(captureInstantUtc(wall, '-05:30', undefined), Date.UTC(2026, 7 - 1, 2, 2, 0, 0));
  assert.equal(captureInstantUtc(wall, undefined, undefined), undefined);
  assert.equal(captureInstantUtc(wall, '+25:00', undefined), undefined);
});

test('a GPS position is kept only when it is a real one', () => {
  assert.deepEqual(readGpsPosition({ latitude: 52.6610004, longitude: -3.8221 }), { latitude: 52.661, longitude: -3.8221 });
  assert.equal(readGpsPosition({ latitude: 0, longitude: 0 }), undefined);
  assert.equal(readGpsPosition({ latitude: 95, longitude: 0 }), undefined);
  assert.equal(readGpsPosition({ latitude: '52', longitude: 1 }), undefined);
  assert.equal(readGpsPosition(undefined), undefined);
});

function pixels(count: number, at: (i: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) { const [r, g, b] = at(i); out.set([r, g, b, 255], i * 4); }
  return out;
}

test('black and white, high-key and low-key are measured on the pixels', () => {
  const grey = pixels(10_000, (i) => { const v = i % 256; return [v, v, v]; });
  assert.deepEqual(ids(pixelStyleTags(grey)), ['style.black-and-white']);
  const colour = pixels(10_000, (i) => (i % 2 ? [200, 40, 40] : [40, 40, 200]));
  assert.deepEqual(ids(pixelStyleTags(colour)), []);
  const bright = pixels(10_000, (i) => (i % 3 ? [235, 230, 228] : [190, 200, 205]));
  assert.deepEqual(ids(pixelStyleTags(bright)), ['style.high-key']);
  const dark = pixels(10_000, (i) => (i % 20 === 0 ? [140, 120, 90] : [6, 6, 8]));
  assert.deepEqual(ids(pixelStyleTags(dark)), ['style.low-key']);
});

// A small made-up model in two dimensions: tag "for" vector [1, 0], "against" [0, 1].
function toyModel(threshold: number | null, id = 'style.motion-blur', facet: 'style' | 'weather' = 'style'): SceneModel {
  return { labels: [{ id, facet }], for: [Float32Array.from([1, 0])], against: [Float32Array.from([0, 1])], thresholds: [threshold], revision: 'toy' };
}

test('below the measured threshold there is no tag, and a switched-off tag is never given', () => {
  const strong = Float32Array.from([0.8, 0.6]); // cos difference 0.2: score ~1
  const weak = Float32Array.from([0.7, 0.71]);
  assert.deepEqual(ids(clipSceneTags(strong, toyModel(0.9), {})), ['style.motion-blur']);
  assert.deepEqual(ids(clipSceneTags(weak, toyModel(0.9), {})), []);
  assert.deepEqual(ids(clipSceneTags(strong, toyModel(null), {})), []);
});

test('camera data that contradicts a reading removes it', () => {
  const strong = Float32Array.from([0.8, 0.6]);
  assert.deepEqual(ids(clipSceneTags(strong, toyModel(0.9), { exposureSeconds: 1 / 4000 })), [], 'no motion blur at 1/4000 s');
  assert.deepEqual(ids(clipSceneTags(strong, toyModel(0.9), { exposureSeconds: 1 / 15 })), ['style.motion-blur']);
  assert.deepEqual(ids(clipSceneTags(strong, toyModel(0.9, 'light.milky-way'), { gps: MACH_LOOP, capturedAtUtcMs: Date.UTC(2026, 10, 25, 12) })), [], 'no Milky Way at noon');
  assert.deepEqual(ids(clipSceneTags(strong, toyModel(0.9, 'style.shallow-dof'), { apertureF: 11, focalLengthMm: 24 })), []);
  assert.deepEqual(ids(clipSceneTags(strong, toyModel(0.9, 'style.shallow-dof'), { apertureF: 8, focalLengthMm: 600 })), ['style.shallow-dof']);
});

test('a calculated or measured tag outranks the image model for the same thing', () => {
  const model = toyModel(0.5, 'style.black-and-white' as never);
  const grey = pixels(1000, () => [90, 90, 90]);
  const tags = sceneTags({ exif: {}, rgba: grey, embedding: Float32Array.from([0.8, 0.6]), model });
  assert.deepEqual(tags.filter((tag) => tag.id === 'style.black-and-white').map((tag) => tag.source), ['computed']);
});

test('the committed vectors and thresholds match the labels', () => {
  const model = sceneModel(labels, vectors, thresholds);
  assert.equal(model.labels.length, labels.tags.length);
  assert.ok(model.for.every((vector) => vector.length === 512));
  for (const [index, threshold] of model.thresholds.entries()) {
    const measured = thresholds.tags[model.labels[index].id as keyof typeof thresholds.tags];
    assert.ok(measured, `${model.labels[index].id} has a measured entry`);
    if (threshold !== null) assert.ok(threshold >= 0.5 && measured.precision >= 0.9, `${model.labels[index].id} passed its precision target`);
  }
});

const photo = (id: string, extra: Partial<PhotoFrame> = {}) => ({ id, stableKey: `s/${id}`, sequenceIndex: Number(id.slice(1)), exif: {}, ...extra }) as PhotoFrame;

test('a photo is looked at for places only when it has GPS, and for its scene until the image model has seen it', () => {
  assert.deepEqual(sceneTagWork(photo('p1'), false), { places: false, scene: true });
  assert.deepEqual(sceneTagWork(photo('p1', { exif: { gps: MACH_LOOP } }), true), { places: true, scene: true });
  const withoutModel = mergePhotoTags(photo('p1'), 'scene', ['light'], [], sceneRevision(false));
  assert.equal(sceneTagWork(withoutModel, false).scene, false, 'nothing new to learn without the model');
  assert.equal(sceneTagWork(withoutModel, true).scene, true, 'looked at again once the model is available');
  const done = mergePhotoTags(mergePhotoTags(photo('p1', { exif: { gps: MACH_LOOP } }), 'scene', ['light'], [], sceneRevision(true)),
    'places', ['place'], [], PLACES_REVISION);
  assert.deepEqual(sceneTagWork(done, true), { places: false, scene: false });
  assert.deepEqual(sceneTagWork(photo('p1', { removedAt: 1 }), true), { places: false, scene: false });
});

test('the photo on screen goes first, then capture order; skipped photos wait', () => {
  const frames = [photo('p3'), photo('p1'), photo('p2')];
  assert.deepEqual(sceneTagCandidates(frames, 'p2', false, new Set()).map((f) => f.id), ['p2', 'p1', 'p3']);
  assert.deepEqual(sceneTagCandidates(frames, null, false, new Set(['p1'])).map((f) => f.id), ['p2', 'p3']);
});
