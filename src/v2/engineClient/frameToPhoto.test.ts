import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types.ts';
import { recordEdit } from '../../core/editHistory.ts';
import { forkEditCheckpoint, ROOT_VERSION_ID, switchEditVersion } from '../../core/editBranches.ts';
import { BLANK_IMAGE, frameToPhoto, shootToProject, styleNoteFor, taskToInfo, tileStateFor } from './frameToPhoto.ts';

const frame = (patch: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id: 'f1', stableKey: 'k1', filename: 'IMG_0001.NEF', sequenceIndex: 1, decision: 'unreviewed',
  burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', ...patch,
});

test('a photo with no recorded metadata says so rather than inventing values', () => {
  const photo = frameToPhoto(frame(), undefined);
  assert.equal(photo.exif.camera, 'Not recorded');
  assert.equal(photo.exif.aperture, 'Not recorded');
  assert.equal(photo.exif.dimensions, 'Not recorded');
  assert.equal(photo.exif.fileFormat, 'NEF RAW', 'the format of the file itself, not of the picture on screen');
  assert.equal(photo.speciesLabel, undefined, 'unknown species stays unknown');
  assert.equal(photo.title, 'IMG_0001');
  assert.equal(photo.thumbUrl, BLANK_IMAGE);
});

test('the colour profile names the InFlight RAW develop only when it is known to have run; otherwise it stays unknown', () => {
  const developed = frameToPhoto(frame({ asShotWhite: { kelvin: 5480, duv: 0.002 } as never }), undefined);
  assert.match(developed.exif.colourProfile, /colour matrix/);
  assert.match(developed.exif.colourProfile, /not the maker's picture style/);
  assert.equal(frameToPhoto(frame(), undefined).exif.colourProfile, 'Not recorded', 'an undeveloped RAW (embedded preview) is not claimed');
  assert.equal(frameToPhoto(frame({ filename: 'a.jpg', asShotWhite: { kelvin: 5480, duv: 0 } as never }), undefined).exif.colourProfile, 'Not recorded');
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

test('a photo in a reopened project whose thumbnail is still on its way never says Importing', () => {
  assert.equal(tileStateFor(undefined, false), 'ready');
  assert.equal(frameToPhoto(frame(), undefined, { beingImported: false }).state, 'ready');
  assert.equal(frameToPhoto(frame(), undefined, { beingImported: true }).state, 'importing', 'only the import now running says it');
  assert.equal(tileStateFor({ failed: true }, false), 'unavailable', 'a failed thumbnail still says so');
});

test('a photo whose compression cannot be read yet says so, and is not called missing or offered a develop', () => {
  assert.equal(tileStateFor({ unsupported: 'jpeg-xl' }), 'unsupported');
  assert.equal(tileStateFor({ thumb: 'blob:t', unsupported: 'jpeg-xl', failed: true }), 'unsupported');
  const photo = frameToPhoto(frame(), { thumb: 'blob:t', unsupported: 'jpeg-xl' }, { fullDevelop: 'possible' });
  assert.equal(photo.state, 'unsupported');
  assert.equal(photo.originalConnected, true);
  assert.equal(photo.fullDevelop, undefined);
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
  assert.equal(shown.kelvinEstimate, '', 'no colour-temperature claim from the analysis; frameToPhoto adds the as-shot white when known');
  assert.deepEqual(assistCritiqueFor({ run: run(candidates), dismissed: [] }, plan.proposal).suggestions.map(s => [s.id, s.applied]), [['natural', true]]);
  assert.deepEqual(assistCritiqueFor({ run: run(candidates), dismissed: ['balanced'] }).suggestions.map(s => s.id), ['natural']);
  assert.deepEqual(assistCritiqueFor({ run: run(candidates), dismissed: [] }, { ...plan.base, exposure: -1 }).suggestions, []);
  assert.deepEqual(assistCritiqueFor({ run: run([]), dismissed: [] }).suggestions, []);
  assert.deepEqual(recipeDelta(undefined, undefined), {});
  // The vision guardian advises: a doubted suggestion keeps its values and its Apply, and carries one plain line.
  const guarded = assistCritiqueFor({ run: run(candidates), dismissed: [], guardian: { pending: [],
    opinions: { balanced: { source: 'on-device', verdict: 'disagrees', question: 'editNatural' }, natural: { source: 'on-device', verdict: 'agrees', question: 'editNatural' } } } });
  assert.equal(guarded.suggestions.length, 2);
  assert.equal(guarded.suggestions[0].secondOpinion, undefined);
  assert.equal(guarded.suggestions[1].secondOpinion?.kept, false);
  assert.match(guarded.suggestions[1].secondOpinion?.text ?? '', /not convinced/);
  assert.deepEqual(guarded.suggestions[1].recipeDelta, shown.suggestions[1].recipeDelta);
  assert.equal(shown.suggestions[1].secondOpinion, undefined);
});

test('a subject name the app suggested is marked as a suggestion, a chosen one is not, and unknown stays unknown', async () => {
  const { speciesLabelOf } = await import('./frameToPhoto.ts');
  assert.equal(speciesLabelOf({}), undefined);
  assert.equal(speciesLabelOf({ tags: ['Red kite'], autoTags: ['Red kite'] }), 'Red kite');
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

test('Auto that could not read a RAW says so in Co-pilot instead of "nothing to report yet" forever', async () => {
  const { autoUnavailableSentence } = await import('./autoUnavailable.ts');
  const raw = frame({ filename: 'DSC_0042.NEF', originalSha256: 'sha-a' });
  const unavailable = { unavailable: 'raw-not-developed' as const, source: { stableKey: raw.stableKey, originalSha256: raw.originalSha256, framing: raw.framing } };
  const note = frameToPhoto(raw, undefined, { autoUnavailable: unavailable }).assistCritique.subjectNote;
  assert.equal(note, autoUnavailableSentence('raw-not-developed', 'DSC_0042.NEF'));
  assert.match(note, /RAW/);
  assert.match(note, /embedded preview/, 'says the camera JPEG was not used in place of the RAW');
  assert.match(note, /Nothing was changed/);
  assert.doesNotMatch(note, /export/i, 'an Auto check never talks about exporting');
  assert.equal(frameToPhoto(raw, undefined, {}).assistCritique.subjectNote, '', 'no check yet: nothing is claimed');
  // A result for a different original (relinked, changed bytes) is not shown for this one.
  assert.equal(frameToPhoto({ ...raw, originalSha256: 'sha-b' }, undefined, { autoUnavailable: unavailable }).assistCritique.subjectNote, '');
  for (const cause of ['no-preview', 'too-small', 'failed'] as const) {
    assert.match(autoUnavailableSentence(cause, 'IMG_1.JPG'), /IMG_1\.JPG.*Nothing was changed/);
  }
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

test('a vehicle reading shows as the subject in words and makes the photo findable by kind, family and type', async () => {
  const { filterPhotos } = await import('../ui/utils/studioMath');
  // Search goes through the shared tag store, which the workspace keeps in line with the reading.
  const { syncVehicleTags } = await import('../../core/vehicleTags');
  const { VEHICLE_LABELS } = await import('../../core/vehicleLabels');
  const photo = frameToPhoto(syncVehicleTags(frame({ vehicle: { schema: 1, family: 'air', kind: 'military-jet', type: 'typhoon', source: 'clip', labelsVersion: 1 } }), VEHICLE_LABELS), undefined);
  assert.equal(photo.vehicleLabel, 'Military jet: Eurofighter Typhoon (probably)');
  for (const query of ['typhoon', 'military jet', 'aircraft']) assert.equal(filterPhotos([photo], 'all', query).length, 1, query);
  assert.equal(filterPhotos([photo], 'all', 'helicopter').length, 0);
  // A kind without a clear type says so; a malformed reading is never shown.
  assert.equal(frameToPhoto(frame({ vehicle: { schema: 1, family: 'air', source: 'clip', labelsVersion: 1 } }), undefined).vehicleLabel, 'Aircraft, type unknown');
  assert.equal(frameToPhoto(frame({ vehicle: { schema: 1, family: 'air', kind: 'spaceship', source: 'clip', labelsVersion: 1 } as never }), undefined).vehicleLabel, undefined);
});

test('each view says which picture of a RAW it shows, from what the provider recorded, HE named from the headers', () => {
  const urls = { thumb: 'blob:t', preview: 'blob:p' };
  const developed = frameToPhoto(frame({ rawCodec: 'nikon-he-star' }), urls, { sources: { preview: 'raw-full', thumb: 'raw-review' } });
  assert.deepEqual(developed.picture, {
    preview: { kind: 'raw', size: 'full', codec: 'nikon-he-star' },
    thumb: { kind: 'raw', size: 'screen', codec: 'nikon-he-star' },
  });
  // Before the large preview exists, the canvas shows the thumbnail, so it carries the thumbnail's source.
  const early = frameToPhoto(frame(), { thumb: 'blob:t' }, { sources: { thumb: 'camera-preview' } });
  assert.deepEqual(early.picture, { preview: { kind: 'camera' }, thumb: { kind: 'camera' } });
  assert.equal(frameToPhoto(frame({ filename: 'bird.jpg' }), urls, { sources: { preview: 'original', thumb: 'original' } }).picture, undefined);
  assert.equal(frameToPhoto(frame(), urls).picture, undefined, 'no recorded source, no label');
});

test('personal style says in plain words how Auto was leaned, and nothing when it was not', () => {
  assert.equal(styleNoteFor(undefined), undefined);
  assert.equal(styleNoteFor([]), undefined);
  const note = styleNoteFor([{ key: 'exposure', multiplier: 0.75, examples: 6, outliers: 0 }, { key: 'shadows', multiplier: 1.2, examples: 9, outliers: 1 }]);
  assert.equal(note, 'Leaned towards your own edits: Exposure 25% less (from 6 photos), Shadows 20% more (from 9 photos). Learnt on this device from what you kept, undid or corrected. Nothing is sent anywhere.');
});

test('a project is a Tethered shoot when its saved shoot says so; older projects stay photo shoots', () => {
  const shoot = { id: 'p1', title: 'Studio', sourceKind: 'local-files' as const, totalFrames: 0, createdAt: 0, lastUpdatedAt: 0 };
  assert.equal(shootToProject({ ...shoot, projectType: 'tethered' as const }, []).kind, 'tethered');
  assert.equal(shootToProject(shoot, []).kind, 'photography');
});

test('Info: a RAW\'s Format is its own format, also for older catalogues that stored "Embedded Preview"', async () => {
  const { shownFileFormat } = await import('../../core/rawFormats');
  assert.equal(shownFileFormat('_DJL0733.NEF', 'NEF Embedded Preview'), 'NEF RAW');
  assert.equal(shownFileFormat('_DJL0733.NEF', undefined), 'NEF RAW');
  assert.equal(shownFileFormat('bird.jpg', 'JPEG'), 'JPEG');
  assert.equal(shownFileFormat('bird.heic', 'HEIC (iPhone)'), 'HEIC (iPhone)');
});

test('Info: beside the histogram, the as-shot white when known, otherwise nothing (never "Not measured")', async () => {
  const { asShotWords } = await import('./frameToPhoto');
  assert.equal(asShotWords({ asShotWhite: { kelvin: 5612.4, duv: 0.001 } } as never), 'As shot about 5,612 K (estimated)');
  assert.equal(asShotWords({}), '');
  assert.equal(asShotWords({ asShotWhite: { kelvin: Number.NaN, duv: 0 } } as never), '');
});

test('the Look again action is offered only on an automatic species name, never on the person\'s own or a kind word', async () => {
  const { speciesAutoOf } = await import('./frameToPhoto');
  assert.equal(speciesAutoOf({ tags: ['Bird', 'Atlantic Puffin'], autoTags: ['Atlantic Puffin'] }), true);
  assert.equal(speciesAutoOf({ tags: ['Atlantic Puffin'], autoTags: ['Atlantic Puffin'], subjectNames: ['Atlantic Puffin'] }), false);
  assert.equal(speciesAutoOf({ tags: ['Atlantic Puffin'], autoTags: [] }), false);
  assert.equal(speciesAutoOf({ tags: ['Bird'], autoTags: ['Bird'] }), false);
  assert.equal(speciesAutoOf({ tags: [] }), false);
});
