import assert from 'node:assert/strict';
import test from 'node:test';
import { applySelectedLook, previewSelectedLook } from './selectedLooks';
import { DEFAULT_EDIT } from './photoEdits';
import { stepEdit } from './editHistory';
import type { PhotoFrame } from './types';

const frame = (id: string): PhotoFrame => ({
  id, stableKey: id, filename: id + '.jpg', sequenceIndex: 1, decision: 'unreviewed',
  burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
});

test('look targets exactly selected live photos, including review photos', () => {
  const frames = [frame('a'), frame('b'), { ...frame('removed'), removedAt: 10 }];
  const ids = new Set(['a', 'removed']);
  assert.deepEqual(previewSelectedLook(frames, ids), { total: 1, eligible: 1, skipped: 0 });
  const next = applySelectedLook(frames, ids, { ...DEFAULT_EDIT, colour: -2 }, false, 500);
  assert.equal(next[0].edit?.colour, -2);
  assert.strictEqual(next[1], frames[1]);
  assert.strictEqual(next[2], frames[2]);
  assert.equal(stepEdit(next[0], -1).edit, undefined);
});

test('already edited photos remain unchanged unless explicitly included; masks and crops stay', () => {
  const edit = { ...DEFAULT_EDIT, exposure: 0.7, masks: [{ id: 'mask' }] } as PhotoFrame['edit'];
  const framing = { turns: 1 } as PhotoFrame['framing'];
  const current = { ...frame('a'), edit, framing };
  const ids = new Set(['a']);
  assert.deepEqual(previewSelectedLook([current], ids), { total: 1, eligible: 0, skipped: 1 });
  assert.strictEqual(applySelectedLook([current], ids, { ...DEFAULT_EDIT, warmth: 1 })[0], current);
  const changed = applySelectedLook([current], ids, { ...DEFAULT_EDIT, warmth: 1 }, true, 600)[0];
  assert.equal(changed.edit?.warmth, 1);
  assert.strictEqual(changed.edit?.masks, edit?.masks);
  assert.strictEqual(changed.framing, framing);
  assert.equal(stepEdit(changed, -1).edit?.exposure, 0.7);
});

test('epoch-zero removed selections never receive looks or new undo history, even with includeEdited', () => {
  const removed = {
    ...frame('removed-zero'),
    removedAt: 0,
    edit: { ...DEFAULT_EDIT, exposure: 0.6 },
  };
  const live = frame('live');
  const frames = [removed, live];
  const ids = new Set(['removed-zero', 'live']);
  const before = JSON.stringify(frames);

  assert.deepEqual(previewSelectedLook(frames, ids), { total: 1, eligible: 1, skipped: 0 });
  assert.deepEqual(previewSelectedLook(frames, ids, true), { total: 1, eligible: 1, skipped: 0 });
  for (const includeEdited of [false, true]) {
    const next = applySelectedLook(frames, ids, { ...DEFAULT_EDIT, warmth: 0.3 }, includeEdited, 700);
    assert.strictEqual(next[0], removed);
    assert.equal(next[0].editHistory, undefined);
    assert.equal(next[0].edit?.exposure, 0.6);
    assert.equal(next[1].edit?.warmth, 0.3);
  }
  assert.equal(JSON.stringify(frames), before);
});
