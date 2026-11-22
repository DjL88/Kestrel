import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types.ts';
import { BLANK_IMAGE, frameToPhoto, shootToProject, taskToInfo, tileStateFor } from './frameToPhoto.ts';

const frame = (patch: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id: 'f1', stableKey: 'k1', filename: 'IMG_0001.NEF', sequenceIndex: 1, decision: 'unreviewed',
  burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', ...patch,
});

test('a photo with no recorded metadata says so rather than inventing values', () => {
  const photo = frameToPhoto(frame(), undefined);
  assert.equal(photo.exif.camera, 'Not recorded');
  assert.equal(photo.exif.aperture, 'Not recorded');
  assert.equal(photo.exif.dimensions, 'Not recorded');
  assert.equal(photo.exif.fileFormat, 'NEF');
  assert.equal(photo.speciesLabel, undefined, 'unknown species stays unknown');
  assert.equal(photo.title, 'IMG_0001');
  assert.equal(photo.thumbUrl, BLANK_IMAGE);
});

test('recorded metadata, rating and the keep decision carry over', () => {
  const photo = frameToPhoto(frame({ decision: 'keep', rating: 4, exif: { camera: 'Nikon Z8', apertureF: 5.6, iso: 640, focalLengthMm: 400, width: 8256, height: 5504 } }), { thumb: 'blob:t', preview: 'blob:p' });
  assert.equal(photo.decision, 'keep');
  assert.equal(photo.rating, 4);
  assert.equal(photo.exif.aperture, 'f/5.6');
  assert.equal(photo.exif.focalLength, '400mm');
  assert.equal(photo.exif.dimensions, '8256 × 5504');
  assert.equal(photo.previewUrl, 'blob:p');
  assert.equal(photo.state, 'ready');
});

test('the camera rating is used when the catalogue has none, and is kept within 0 to 5', () => {
  assert.equal(frameToPhoto(frame({ exif: { rating: 3 } }), undefined).rating, 3);
  assert.equal(frameToPhoto(frame({ rating: 9 }), undefined).rating, 5);
  assert.equal(frameToPhoto(frame(), undefined).rating, 0);
});

test('tile state follows the picture: importing until a thumbnail exists, unavailable if it failed', () => {
  assert.equal(tileStateFor(undefined), 'importing');
  assert.equal(tileStateFor({ thumb: 'blob:t' }), 'ready');
  assert.equal(tileStateFor({ failed: true }), 'unavailable');
  assert.equal(frameToPhoto(frame(), { failed: true }).originalConnected, false);
});

test('a project counts live photos and flagged photos, and ignores removed ones', () => {
  const shoot = { id: 'p1', title: 'Moor', sourceKind: 'local-files' as const, totalFrames: 0, createdAt: 0, lastUpdatedAt: Date.UTC(2026, 10, 22) };
  const project = shootToProject(shoot, [frame({ decision: 'keep' }), frame({ id: 'f2', decision: 'keep', removedAt: 5 }), frame({ id: 'f3' })]);
  assert.equal(project.photoCount, 2);
  assert.equal(project.flaggedCount, 1);
  assert.equal(project.name, 'Moor');
});

test('tasks keep their progress and a failure is shown as failed, not as cancelled', () => {
  const base = { id: 7, title: 'Adding 10 photos', done: 4, total: 10, startedAt: 0, updatedAt: 0 };
  assert.deepEqual(taskToInfo({ ...base, state: 'running' }), { id: '7', label: 'Adding 10 photos', detail: '4 of 10', progress: 40, status: 'running' });
  assert.equal(taskToInfo({ ...base, state: 'done' }).progress, 100);
  assert.equal(taskToInfo({ ...base, state: 'failed', detail: 'Disk full' }).status, 'failed');
  assert.equal(taskToInfo({ ...base, state: 'cancelled' }).status, 'cancelled');
});
