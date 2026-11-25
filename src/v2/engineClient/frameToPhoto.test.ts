import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types.ts';
import { recordEdit } from '../../core/editHistory.ts';
import { forkEditCheckpoint, ROOT_VERSION_ID, switchEditVersion } from '../../core/editBranches.ts';
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
  const running = taskToInfo({ ...base, state: 'running' });
  assert.deepEqual(
    { id: running.id, label: running.label, detail: running.detail, progress: running.progress, status: running.status },
    { id: '7', label: 'Adding 10 photos', detail: '4 of 10', progress: 40, status: 'running' });
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
  // Internal finding codes are never shown; warnings come in words from the colour check.
  assert.equal(shown.colourConfidence, 'Species colour not used.');
  assert.equal(shown.colourCheck, undefined);
  const withColour = assistCritiqueFor({ run: { ...(run(candidates) as object), colour: { palette: [{ family: 'red', share: 0.5, strength: 'strong' }], monochrome: false,
    findings: [{ id: 'clippedColour', severity: 'warning', share: 0.1, families: ['red'] }] } } as never, dismissed: [] });
  assert.equal(withColour.colourConfidence, 'Species colour not used. Some red areas are too strong to show their detail, so they look flat.');
  assert.deepEqual(withColour.colourCheck?.palette, ['red, strong: about half or more']);
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

test('History exposes real version lineage after a fork and switch without duplicating the photo', () => {
  let original = frame({ exif: { width: 4000, height: 3000 } });
  original = recordEdit(original, { edit: { exposure: 0.2, warmth: 0, colour: 0 } }, 1000);
  original = recordEdit(original, { edit: { exposure: 0.4, warmth: 0, colour: 0 } }, 2000);
  const fork = forkEditCheckpoint(original, 1, 'fork-real', 3000);
  const shown = frameToPhoto(fork, undefined);
  assert.equal(shown.editVersions?.activeId, 'fork-real');
  assert.deepEqual(shown.editVersions?.versions.map(v => [v.id, v.parentId]), [
    [ROOT_VERSION_ID, null], ['fork-real', ROOT_VERSION_ID],
  ]);
  assert.equal(shown.editHistory?.cursor, 1);
  assert.equal(shown.id, original.id);
  const back = frameToPhoto(switchEditVersion(fork, ROOT_VERSION_ID), undefined);
  assert.equal(back.id, original.id);
  assert.equal(back.editVersions?.activeId, ROOT_VERSION_ID);
  assert.equal(back.editHistory?.steps.length, 2);
});

test('a fork made at step zero remains visible and can fork again', () => {
  let original = frame();
  original = recordEdit(original, { edit: { exposure: 0.1, warmth: 0, colour: 0 } }, 1000);
  const first = forkEditCheckpoint(original, 0, 'fork-at-start', 2000);
  const firstPhoto = frameToPhoto(first, undefined);
  assert.equal(firstPhoto.editHistory?.steps.length, 0);
  assert.equal(firstPhoto.editHistory?.cursor, 0);
  const second = forkEditCheckpoint(first, 0, 'fork-from-fork', 3000);
  assert.equal(frameToPhoto(second, undefined).editVersions?.versions.length, 3);
});

test('file info reads recorded import byte count and verified raster dimensions, not preview sizes', () => {
  const raster = frame({ filename: 'bird.jpg', stableKey: 'local-file://bird.jpg::22500000::123', exif: { width: 400, height: 300 } });
  const photo = frameToPhoto(raster, undefined, { verifiedOriginalSize: { width: 6000, height: 4000 }, pixelSize: { width: 400, height: 300 } });
  assert.equal(photo.exif.fileSizeMb, 22.5);
  assert.equal(photo.exif.dimensions, '6000 × 4000');
  assert.equal(frameToPhoto(frame({stableKey:'unknown::12300000::456'}), undefined).exif.fileSizeMb, 0);
  assert.equal(frameToPhoto(frame({rating: NaN, exif:{iso:-1, capturedAtMs: Infinity}}), undefined).rating, 0);
  assert.equal(frameToPhoto(frame({exif:{iso:-1, capturedAtMs:Infinity}}), undefined).exif.capturedAt, 'Not recorded');
});

test('a RAW with no recorded size takes its Original shape from the picture shown, never a 1 × 1 square', async () => {
  const { originalFormatSize } = await import('./frameToPhoto.ts');
  const raw = frame({ filename: 'DSC_0001.NEF', exif: {} as PhotoFrame['exif'] });
  assert.equal(originalFormatSize(raw), null);
  assert.deepEqual(originalFormatSize(raw, undefined, { width: 1620, height: 1080 }), { x: 0, y: 0, width: 1620, height: 1080 });
  const photo = frameToPhoto(raw, { thumb: 'blob:t', preview: 'blob:p' }, { pixelSize: { width: 1620, height: 1080 } });
  const original = photo.sizes.find((size) => size.id === 'orig-3x2')!;
  assert.deepEqual([original.width, original.height, original.ratioLabel, original.enabled], [1620, 1080, '3:2', true]);
  // Recorded EXIF dimensions still win over the shown picture.
  assert.deepEqual(originalFormatSize(frame({ exif: { width: 6000, height: 4000 } as PhotoFrame['exif'] }), undefined, { width: 10, height: 10 }), { x: 0, y: 0, width: 6000, height: 4000 });
});
