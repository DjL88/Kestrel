import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORKSPACE_PANES, WORKSPACE_PANES_KEY, parseWorkspacePaneState,
  readWorkspacePaneState, toggleWorkspacePanes, writeWorkspacePaneState, photoInfoDockSide,
} from './workspacePaneState';

test('Section F pane layout defaults to both panels visible', () => {
  assert.deepEqual(parseWorkspacePaneState(null), DEFAULT_WORKSPACE_PANES);
  assert.deepEqual(parseWorkspacePaneState('{broken'), DEFAULT_WORKSPACE_PANES);
  assert.deepEqual(parseWorkspacePaneState('{"folded":"yes"}'), DEFAULT_WORKSPACE_PANES);
  assert.deepEqual(parseWorkspacePaneState('{"folded":true,"secret":"ignored"}'), { folded: true });
});
test('folding and reopening panes is reversible and per-device only', () => {
  const state = { folded: false };
  const folded = toggleWorkspacePanes(state);
  assert.deepEqual(folded, { folded: true });
  assert.deepEqual(toggleWorkspacePanes(folded), state);
  assert.equal(state.folded, false, 'source state is never mutated');
  let saved = '';
  const storage = {
    getItem(key: string) { assert.equal(key, WORKSPACE_PANES_KEY); return saved; },
    setItem(key: string, value: string) { assert.equal(key, WORKSPACE_PANES_KEY); saved = value; },
  };
  writeWorkspacePaneState(folded, storage);
  assert.deepEqual(readWorkspacePaneState(storage), folded);
});
test('Photo Info always docks opposite the preferred hand on every device', () => {
  assert.equal(photoInfoDockSide('left'), 'right');
  assert.equal(photoInfoDockSide('right'), 'left');
});

test('private/incognito storage failures do not interrupt the workspace', () => {
  const failing = {
    getItem(): string { throw new Error('Storage disabled'); },
    setItem(): void { throw new Error('Storage disabled'); },
  };
  assert.deepEqual(readWorkspacePaneState(failing), { folded: false });
  assert.doesNotThrow(() => writeWorkspacePaneState({ folded: true }, failing));
});
