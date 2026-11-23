import test from 'node:test';
import assert from 'node:assert/strict';
import { menuActionForV2 } from './menuMap';
import { COMMANDS } from './registry';

test('the menu ids that own a keyboard accelerator all do something in V2', () => {
  assert.deepEqual(menuActionForV2('export'), { kind: 'command', id: 'file.export' });
  assert.deepEqual(menuActionForV2('photos-select-all'), { kind: 'command', id: 'edit.selectAll' });
  assert.deepEqual(menuActionForV2('add'), { kind: 'import' });
  assert.deepEqual(menuActionForV2('macro-pad'), { kind: 'settings', tab: 'keyboard' });
});

test('ratings 0 to 5 map to their rating, and every command target exists in the registry', () => {
  for (const rating of [0, 1, 2, 3, 4, 5]) assert.deepEqual(menuActionForV2(`photo-rate-${rating}`), { kind: 'rate', rating });
  const ids = new Set(COMMANDS.map((c) => c.id as string));
  for (const id of ['export', 'photos-select-all', 'edit-copy-adjustments', 'edit-paste-adjustments', 'photo-undo', 'photo-redo', 'photo-compare', 'view-grid', 'view-compare']) {
    const action = menuActionForV2(id);
    assert.equal(action?.kind, 'command', id);
    if (action?.kind === 'command') assert.ok(ids.has(action.id), `${id} -> ${action.id}`);
  }
});

test('ids that belong only to the current app are ignored, not guessed at', () => {
  for (const id of ['edit-photo', 'view-tab-masks', 'view-bursts', 'view-left', 'photo-reject', 'toString', '__proto__']) assert.equal(menuActionForV2(id), null, id);
});