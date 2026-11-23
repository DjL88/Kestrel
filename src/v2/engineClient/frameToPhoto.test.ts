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

test('a photo with no stored video zoom gets the neutral default, switched off', () => {
  const photo = frameToPhoto(frame(), undefined);
  assert.deepEqual(photo.videoZoom, { enabled: false, focalX: 50, focalY: 50, direction: 'in', durationSec: 6 });
});

test('a photo\'s stored video zoom is read and made valid', () => {
  const photo = frameToPhoto(frame({ videoZoom: { enabled: true, focalX: 20, focalY: 80, direction: 'out', durationSec: 12 } }), undefined);
  assert.deepEqual(photo.videoZoom, { enabled: true, focalX: 20, focalY: 80, direction: 'out', durationSec: 12 });
  const damaged = frameToPhoto(frame({ videoZoom: { enabled: true, focalX: 500, direction: 'sideways' } }), undefined);
  assert.equal(damaged.videoZoom.focalX, 100);
  assert.equal(damaged.videoZoom.direction, 'in');
});

test('a photo\'s stored linked overrides change only the formats they name', () => {
  const linked = frameToPhoto(frame(), undefined).sizes[0];
  const unlinked = frameToPhoto(frame({ sizeLinked: { [linked.id]: false } }), undefined).sizes[0];
  assert.equal(unlinked.id, linked.id);
  assert.equal(unlinked.linked, false);
});

test('a photo with no stored split state starts as one pane, centred', () => {
  const group = frameToPhoto(frame(), undefined).editGroups[0];
  assert.equal(group.splitFrames, false);
  assert.equal(group.splitPanOffset, 0);
});

test('a photo\'s stored split state is read through and kept in range', () => {
  const group = frameToPhoto(frame({ splitFrames: true, splitPanOffset: 15 }), undefined).editGroups[0];
  assert.equal(group.splitFrames, true);
  assert.equal(group.splitPanOffset, 15);
  const damaged = frameToPhoto(frame({ splitFrames: 'yes', splitPanOffset: 999 }), undefined).editGroups[0];
  assert.equal(damaged.splitFrames, false);
  assert.equal(damaged.splitPanOffset, 25);
});

test('tasks keep their progress and a failure is shown as failed, not as cancelled', () => {
  const base = { id: 7, title: 'Adding 10 photos', done: 4, total: 10, startedAt: 0, updatedAt: 0 };
  assert.deepEqual(taskToInfo({ ...base, state: 'running' }), { id: '7', label: 'Adding 10 photos', detail: '4 of 10', progress: 40, status: 'running' });
  assert.equal(taskToInfo({ ...base, state: 'done' }).progress, 100);
  assert.equal(taskToInfo({ ...base, state: 'failed', detail: 'Disk full' }).status, 'failed');
  assert.equal(taskToInfo({ ...base, state: 'cancelled' }).status, 'cancelled');
});

test('a photo starts with a neutral recipe and its own edit is what the sliders show', () => {
  const neutral = frameToPhoto(frame(), undefined).editGroups[0].recipe;
  assert.equal(neutral.exposure, 0);
  assert.equal(neutral.sharpen, 0);
  assert.equal(frameToPhoto(frame(), undefined).editGroups[0].name, 'Edit group 1');
  const edited = frameToPhoto(frame({ edit: { exposure: 1, warmth: 1, colour: 0 } }), undefined).editGroups[0].recipe;
  assert.equal(edited.exposure, 0.4);
  assert.equal(edited.temperature, 50);
});

test('Co-pilot shows only rendered alternatives and marks only the matching edit as applied', async () => {
  const { assistCritiqueFor, recipeDelta } = await import('./frameToPhoto.ts');
  assert.deepEqual(assistCritiqueFor(undefined).suggestions, []);
  const plan = { base: { exposure: 0, warmth: 0, colour: 0 }, proposal: { exposure: 1, warmth: 0, colour: 0 }, measured: { colourWarnings: ['Colour looks strong.'] }, species: { reason: 'Species colour not used.' } };
  const candidates = [{ id: 'natural', edit: plan.proposal, summary: 'Raised exposure.', after: 'rendered-natural' },
    { id: 'balanced', edit: { ...plan.proposal, exposure: 0.5 }, summary: 'Softened contrast.', after: 'rendered-balanced' }];
  const run = (rendered: typeof candidates) => ({ plan, headline: 'Auto found a change.', detail: ['Subject lightness 20%.', 'Species colour not used.'],
    before: 'rendered-current', candidates: rendered }) as never;
  const shown = assistCritiqueFor({ run: run(candidates), dismissed: [] });
  assert.equal(shown.suggestions.length, 2);
  assert.equal(shown.suggestions[0].summary, 'Raised exposure.');
  assert.deepEqual(shown.suggestions[0].recipeDelta, { exposure: 0.4 });
  assert.deepEqual(shown.suggestions[0].comparison, { before: 'rendered-current', after: 'rendered-natural' });
  assert.equal(shown.colourConfidence, 'Species colour not used. Colour looks strong.');
  assert.equal(shown.kelvinEstimate, 'Not measured');
  assert.deepEqual(assistCritiqueFor({ run: run(candidates), dismissed: [] }, plan.proposal).suggestions.map(s => [s.id, s.applied]), [['natural', true]]);
  assert.deepEqual(assistCritiqueFor({ run: run(candidates), dismissed: ['balanced'] }).suggestions.map(s => s.id), ['natural']);
  assert.deepEqual(assistCritiqueFor({ run: run(candidates), dismissed: [] }, { ...plan.base, exposure: -1 }).suggestions, []);
  assert.deepEqual(assistCritiqueFor({ run: run([]), dismissed: [] }).suggestions, []);
  assert.deepEqual(recipeDelta(undefined, undefined), {});
});

test('a subject name the app suggested is marked as a suggestion, a chosen one is not, and unknown stays unknown', async () => {
  const { speciesLabelOf } = await import('./frameToPhoto.ts');
  assert.equal(speciesLabelOf({}), undefined);
  assert.equal(speciesLabelOf({ tags: ['Red kite'], autoTags: ['Red kite'] }), 'Red kite (suggested)');
  assert.equal(speciesLabelOf({ tags: ['Red kite'], autoTags: [] }), 'Red kite');
  assert.equal(speciesLabelOf({ subjectNames: ['Common kestrel'], tags: ['Red kite'], autoTags: ['Red kite'] }), 'Common kestrel');
});

test('finished tasks stay for 4 hours and are then dropped, newest first, with running tasks on top', async () => {
  const { visibleTasks, COMPLETED_KEEP_MS } = await import('./frameToPhoto.ts');
  const now = 10_000_000_000;
  const running = [{ id: '1', label: 'a', detail: '', progress: 10, status: 'running' as const }];
  const done = (id: string, ago: number) => ({ id, label: id, detail: '', progress: 100, status: 'done' as const, endedAt: now - ago });
  const shown = visibleTasks(running, [done('old', COMPLETED_KEEP_MS + 1), done('older-new', 5_000), done('newest', 1_000)], now);
  assert.deepEqual(shown.map((task) => task.id), ['1', 'newest', 'older-new']);
  assert.deepEqual(visibleTasks([], [done('x', COMPLETED_KEEP_MS - 1)], now).map((task) => task.id), ['x']);
});

test('verified connected JPEG Original replaces the demo 3000x2000 format and its aspect', () => {
  const photo = frameToPhoto(frame({ filename: 'Robin.JPG', exif: { width: 1200, height: 800 } }), undefined, {
    verifiedOriginalSize: { width: 8256, height: 5504 },
  });
  const original = photo.sizes.find((size) => size.id === 'orig-3x2')!;
  assert.deepEqual({ width: original.width, height: original.height, label: original.label, ratioLabel: original.ratioLabel },
    { width: 8256, height: 5504, label: 'Original', ratioLabel: '3:2' });
  assert.deepEqual(photo.pixelSize, { width: 8256, height: 5504 });
  assert.equal(photo.sizes.find((size) => size.id === 'ig-portrait')?.width, 1080);
});

test('verified PNG portrait aspect comes from decoded pixels, not the fixed 3:2 placeholder', () => {
  const photo = frameToPhoto(frame({ filename: 'Bird.png' }), undefined, {
    verifiedOriginalSize: { width: 3000, height: 4000 },
  });
  const original = photo.sizes.find((size) => size.id === 'orig-3x2')!;
  assert.equal(original.width, 3000);
  assert.equal(original.height, 4000);
  assert.equal(original.ratioLabel, '3:4');
});

test('Original uses the recorded shape but RAW previews are not proof of export pixel fidelity', () => {
  const unverified = frameToPhoto(frame({ filename: 'Robin.jpg', exif: { width: 1200, height: 800 } }), undefined);
  const raw = frameToPhoto(frame({ filename: 'Z8.NEF', exif: { width: 8256, height: 5504 } }), undefined, {
    verifiedOriginalSize: { width: 8256, height: 5504 },
  });
  assert.equal(unverified.sizes.find((size) => size.id === 'orig-3x2')?.width, 1200);
  assert.equal(raw.sizes.find((size) => size.id === 'orig-3x2')?.width, 8256);
});

test('invalid raster dimensions are never accepted for the Original frame', () => {
  const photo = frameToPhoto(frame({ filename: 'Robin.jpg' }), undefined, {
    verifiedOriginalSize: { width: Number.NaN, height: 0 },
  });
  assert.equal(photo.sizes.find((size) => size.id === 'orig-3x2')?.enabled, false);
});

test('a saved split belongs only to its selected output format, not the whole photograph', () => {
  const photo = frameToPhoto(frame({ formatSplits: { 'ig-portrait': { enabled: true, offset: 12 } } }), undefined);
  assert.equal(photo.formatSplits?.['ig-portrait']?.enabled, true);
  assert.equal(photo.formatSplits?.['ig-portrait']?.offset, 12);
  assert.equal(photo.formatSplits?.['orig-3x2'], undefined);
});

test('older photo-wide split is migrated visually to Original only, preserving the offset', () => {
  const photo = frameToPhoto(frame({ splitFrames: true, splitPanOffset: -8 }), undefined);
  assert.equal(photo.formatSplits?.['ig-portrait'], undefined);
  assert.deepEqual(photo.formatSplits, { 'orig-3x2': { enabled: true, offset: -8 } });
});

test('an explicitly empty per-format split selection disables the legacy photo-wide split', () => {
  const photo = frameToPhoto(frame({ splitFrames: true, splitPanOffset: 12, formatSplits: {} }), undefined);
  assert.deepEqual(photo.formatSplits, {});
});
