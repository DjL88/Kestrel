import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeSnapshot, markExportRequested } from './compareStages';
import { recordEdit, stepEdit } from './editHistory';
import { DEFAULT_EDIT } from './photoEdits';
import type { PhotoFrame } from './types';

const original = (): PhotoFrame => ({
  id: 'one', stableKey: 'one', filename: 'one.jpg', sequenceIndex: 0,
  decision: 'keep', burstGroupId: null, burstIndex: 1, burstCount: 1,
  exif: {}, isDemo: false, sourceKind: 'file',
});

test('Before can select Original, previous edit, or an exact history step without changing history', () => {
  const first = recordEdit(original(), { edit: { ...DEFAULT_EDIT, exposure: 0.8 } }, 1000);
  const now = recordEdit(first, { edit: { ...DEFAULT_EDIT, exposure: 0.8, colour: -2 } }, 2000);
  assert.equal(beforeSnapshot(now, 'original').edit, undefined);
  assert.equal(beforeSnapshot(now, 'previous').edit?.exposure, 0.8);
  assert.equal(beforeSnapshot(now, 'previous').edit?.colour, 0);
  assert.equal(beforeSnapshot(now, 'step:1').edit?.colour, 0);
  assert.equal(beforeSnapshot(now, 'step:2').edit?.colour, -2);
  assert.equal(beforeSnapshot(now, 'step:500').edit, undefined);
  assert.equal(now.editHistory?.cursor, 2, 'choosing a comparison stage never restores history');
  const undone = stepEdit(now, -1);
  assert.equal(beforeSnapshot(undone, 'previous').edit, undefined);
});

test('last export captures an independent snapshot even after later edits', () => {
  const first = recordEdit(original(), { edit: { ...DEFAULT_EDIT, contrast: 0.5 } }, 1000);
  const exported = markExportRequested(first, 1500);
  const modified = recordEdit(exported, { edit: { ...DEFAULT_EDIT, contrast: -0.8 } }, 3000);
  assert.equal(modified.lastExport?.at, 1500);
  assert.equal(beforeSnapshot(modified, 'last-export').edit?.contrast, 0.5);
  assert.equal(modified.edit?.contrast, -0.8);
  assert.notStrictEqual(modified.lastExport?.edit, first.edit);
  assert.equal(beforeSnapshot(original(), 'last-export').label, 'Original');
});
