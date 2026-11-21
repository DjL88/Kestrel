import test from 'node:test';
import assert from 'node:assert/strict';
import { applyKeeperLook, previewKeeperLook } from './batchLooks';
import { DEFAULT_EDIT } from './photoEdits';
import type { PhotoFrame } from './types';

const frame = (id: string, decision: PhotoFrame['decision'], edit?: PhotoFrame['edit']): PhotoFrame => ({
  id, stableKey: id, filename: id + '.jpg', sequenceIndex: 1, decision,
  burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
  ...(edit ? { edit } : {}),
});

test('batch look targets keepers only and never touches rejected, unreviewed or removed frames', () => {
  const inputs = [frame('new', 'keep'), frame('reject', 'reject'), frame('undecided', 'unreviewed'),
    { ...frame('removed', 'keep'), removedAt: Date.now() }, { ...frame('virtual', 'keep'), virtualCopy: { originalFrameId: 'new', number: 1 } }];
  assert.deepEqual(previewKeeperLook(inputs), { total: 1, eligible: 1, skipped: 0 });
  const next = applyKeeperLook(inputs, { ...DEFAULT_EDIT, contrast: 0.6 }, false, 10000);
  assert.equal(next[0].edit?.contrast, 0.6);
  assert.equal(next[0].editHistory?.steps.length, 1);
  for (let i = 1; i < inputs.length; i++) assert.strictEqual(next[i], inputs[i]);
});

test('existing edits are protected by default and an explicit override preserves masks and undo', () => {
  const painted = { ...DEFAULT_EDIT, warmth: 0.2, masks: [{ id: 'mask', kind: 'brush' }] } as unknown as PhotoFrame['edit'];
  const existing = frame('edited', 'keep', painted);
  const history = applyKeeperLook([existing], { ...DEFAULT_EDIT, colour: -2 });
  assert.strictEqual(history[0], existing);
  assert.deepEqual(previewKeeperLook([existing]), { total: 1, eligible: 0, skipped: 1 });
  const replaced = applyKeeperLook([existing], { ...DEFAULT_EDIT, colour: -2 }, true, 10)[0];
  assert.equal(replaced.edit?.colour, -2);
  assert.strictEqual(replaced.edit?.masks, painted?.masks);
  assert.equal(replaced.editHistory?.steps[0].before.edit?.warmth, 0.2);
  assert.equal(replaced.editHistory?.steps[0].after.edit?.colour, -2);
});

test('history steps protect manually reviewed neutral edits', () => {
  const previouslyEdited = applyKeeperLook([frame('one', 'keep')], { ...DEFAULT_EDIT, exposure: 0.3 }, true, 0)[0];
  const reset = { ...previouslyEdited, edit: undefined };
  assert.equal(previewKeeperLook([reset]).eligible, 0);
  assert.strictEqual(applyKeeperLook([reset], { ...DEFAULT_EDIT, warmth: 0.3 })[0], reset);
});

test('epoch-zero removed keeper is excluded from preview and batch application', () => {
  const live = frame('live', 'keep');
  const removedAtEpoch = { ...frame('removed-zero', 'keep'), removedAt: 0 };
  const removedLater = { ...frame('removed-later', 'keep'), removedAt: 123 };
  const inputs = [live, removedAtEpoch, removedLater];
  assert.deepEqual(previewKeeperLook(inputs), { total: 1, eligible: 1, skipped: 0 });
  const result = applyKeeperLook(inputs, { ...DEFAULT_EDIT, contrast: 0.4 }, true, 1234);
  assert.equal(result[0].edit?.contrast, 0.4);
  assert.strictEqual(result[1], removedAtEpoch);
  assert.strictEqual(result[2], removedLater);
  assert.equal(removedAtEpoch.editHistory, undefined);
  assert.equal(removedLater.editHistory, undefined);
});

test('removed keeper remains untouched with default batch settings and existing history', () => {
  const edited = applyKeeperLook([frame('history', 'keep')], { ...DEFAULT_EDIT, exposure: 0.2 }, true, 10)[0];
  const removed = { ...edited, removedAt: 0 };
  const history = removed.editHistory;
  const edit = removed.edit;
  const inputs = [removed, frame('active', 'keep')];
  assert.deepEqual(previewKeeperLook(inputs), { total: 1, eligible: 1, skipped: 0 });
  const result = applyKeeperLook(inputs, { ...DEFAULT_EDIT, contrast: 0.8 }, false, 20);
  assert.strictEqual(result[0], removed);
  assert.strictEqual(result[0].editHistory, history);
  assert.strictEqual(result[0].edit, edit);
  assert.equal(result[1].edit?.contrast, 0.8);
  assert.strictEqual(inputs[0], removed);
});
