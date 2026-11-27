import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import type { PhotoFrame } from './types';
import { batchAllowedIn, batchMayEdit, COPILOT_MAX_EXPOSURE_EV, flightPolicy, planAutoBatch, reasonsForSafeChange, safeSubset } from './flightModes';

const frame = (id: string, extra: Partial<PhotoFrame> = {}, exif: Partial<PhotoFrame['exif']> = {}): PhotoFrame =>
  ({ id, filename: `${id}.jpg`, sequenceIndex: Number(id.replace(/\D/g, '')) || 0, decision: 'undecided', exif, ...extra }) as unknown as PhotoFrame;

test('the three modes differ: Solo never applies, Co-pilot applies a safe subset, Auto-pilot applies the checked edit', () => {
  assert.deepEqual(flightPolicy('solo'), { looksByItself: false, applies: 'none' });
  assert.deepEqual(flightPolicy('copilot'), { looksByItself: true, applies: 'safe' });
  assert.deepEqual(flightPolicy('autopilot'), { looksByItself: true, applies: 'all' });
});

test('Co-pilot applies an exposure change of 0.3 EV or less and nothing else from the proposal', () => {
  // 0.7 steps is 0.28 EV.
  const proposal: PhotoEdit = { ...DEFAULT_EDIT, exposure: 0.7, warmth: 0.4, colour: 0.2, tint: 0.3, contrast: 0.2 };
  const safe = safeSubset(DEFAULT_EDIT, proposal);
  assert.ok(safe);
  assert.deepEqual(safe.kinds, ['exposure']);
  assert.equal(safe.edit.exposure, 0.7);
  assert.equal(safe.edit.warmth, 0);
  assert.equal(safe.edit.colour, 0);
  assert.equal(safe.edit.tint, undefined);
  assert.equal(safe.edit.contrast, undefined);
  assert.equal(safe.edit.masks, undefined);
});

test('Co-pilot leaves a larger exposure change whole as a suggestion, and is exact at the limit', () => {
  assert.equal(safeSubset(DEFAULT_EDIT, { ...DEFAULT_EDIT, exposure: 1.2 }), null, '0.48 EV is not applied or clamped');
  assert.equal(safeSubset(DEFAULT_EDIT, { ...DEFAULT_EDIT, exposure: -0.9 }), null);
  const edge = safeSubset(DEFAULT_EDIT, { ...DEFAULT_EDIT, exposure: COPILOT_MAX_EXPOSURE_EV / 0.4 });
  assert.ok(edge, '0.3 EV exactly is within the limit');
  assert.ok(safeSubset(DEFAULT_EDIT, { ...DEFAULT_EDIT, exposure: -0.7 }), 'a darker change counts too');
});

test('Co-pilot measures the exposure change from the photo as it is, not from zero', () => {
  const base: PhotoEdit = { ...DEFAULT_EDIT, exposure: 1 };
  assert.ok(safeSubset(base, { ...base, exposure: 1.5 }), '0.2 EV on top of an earlier edit is small');
  assert.equal(safeSubset(base, { ...base, exposure: 2 }), null, '0.4 EV is not');
});

test('a proposal with no exposure change or only colour and masks gives Co-pilot nothing to apply', () => {
  assert.equal(safeSubset(DEFAULT_EDIT, { ...DEFAULT_EDIT, warmth: 1, colour: 0.5 }), null);
  assert.equal(safeSubset(DEFAULT_EDIT, DEFAULT_EDIT), null);
});

test('Co-pilot straightens by 2 degrees or less and not more', () => {
  assert.deepEqual(safeSubset(DEFAULT_EDIT, DEFAULT_EDIT, { current: 0, proposed: 1.4 })?.straighten, 1.4);
  assert.equal(safeSubset(DEFAULT_EDIT, DEFAULT_EDIT, { current: 0, proposed: 2.5 }), null);
  assert.deepEqual(safeSubset(DEFAULT_EDIT, DEFAULT_EDIT, { current: 1, proposed: 3 })?.kinds, ['straighten']);
});

test('the Auto-pilot batch goes best first and skips edited, edited-elsewhere, rejected, removed and hidden photos', () => {
  const frames = [
    frame('p1'), frame('p2', { rating: 5 }), frame('p3', { edit: { ...DEFAULT_EDIT, exposure: 1 } }),
    frame('p4', {}, { editStatus: { kind: 'edited-elsewhere', evidence: [] } } as never), frame('p5', { decision: 'reject' }),
    frame('p6', { removedAt: 5 }), frame('p7', { editHistory: { steps: [{}], cursor: 1 } } as never), frame('p8', { decision: 'keep' }),
    frame('p9'), frame('p10', { rating: 3 }), frame('p11'),
  ];
  const plan = planAutoBatch(frames, new Set(frames.map((entry) => entry.id)), (entry) => entry.id === 'p11');
  assert.deepEqual(plan.todo.slice(0, 3).map((entry) => entry.id), ['p2', 'p10', 'p8'], 'rated, then picked');
  assert.deepEqual(new Set(plan.todo.map((entry) => entry.id)), new Set(['p1', 'p2', 'p8', 'p9', 'p10']));
  assert.equal(plan.editedElsewhere, 1);
});

test('the batch re-checks a photo on the live frame: rejected since the plan, or edited, hidden or removed, is not edited', () => {
  const live = frame('p1');
  assert.equal(batchMayEdit(live), true);
  assert.equal(batchMayEdit({ ...live, decision: 'reject' }), false, 'rejected by Auto-cull or the person after the plan was made');
  assert.equal(batchMayEdit(frame('p1', {}, { rejectedByMetadata: true } as never)), false);
  assert.equal(batchMayEdit({ ...live, edit: { ...DEFAULT_EDIT, exposure: 1 } }), false);
  assert.equal(batchMayEdit({ ...live, removedAt: 5 }), false);
  assert.equal(batchMayEdit(live, () => true), false, 'a hidden RAW+JPEG partner');
  assert.equal(batchMayEdit(undefined), false);
});

test('only Auto-pilot runs the background batch, so switching to Solo or Co-pilot stops it', () => {
  assert.equal(batchAllowedIn('autopilot'), true);
  assert.equal(batchAllowedIn('copilot'), false);
  assert.equal(batchAllowedIn('solo'), false);
});

test('the Auto-pilot batch only takes photos from this import', () => {
  const frames = [frame('p1'), frame('p2')];
  assert.deepEqual(planAutoBatch(frames, new Set(['p2'])).todo.map((entry) => entry.id), ['p2']);
});

test('the reason recorded for a Co-pilot change is only the reason for what Co-pilot changed', () => {
  const detail = ['The photo is on the dark side, so exposure goes up a little.', 'The light is cool, so warmth goes up a little.', 'Contrast comes down slightly.'];
  assert.deepEqual(reasonsForSafeChange(detail, ['exposure']), [detail[0]]);
  assert.deepEqual(reasonsForSafeChange(['Nothing about it.'], ['exposure']), []);
});
