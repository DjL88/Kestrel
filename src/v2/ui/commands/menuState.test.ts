import test from 'node:test';
import assert from 'node:assert/strict';
import { menuState, menuStateChanges, type MenuContext } from './menuState';
import { menuActionForV2 } from './menuMap';

const editing: MenuContext = {
  inEditor: true, collage: false, photoCount: 10, selectedCount: 0, hasActivePhoto: true, gridOpen: false,
  canUndo: false, canRedo: false, hasCopiedEdits: false, editLocked: false,
};

test('on the projects list only project-free items are available', () => {
  const state = menuState({ ...editing, inEditor: false, photoCount: 0, hasActivePhoto: false });
  for (const [id, enabled] of Object.entries(state)) {
    if (id === 'view-fullscreen') assert.equal(enabled, true, id);
    else assert.equal(enabled, false, id);
  }
});

test('Paste edits needs something copied, a photo to paste onto, and the photo not locked by someone else', () => {
  assert.equal(menuState(editing)['edit-paste-adjustments'], false);
  assert.equal(menuState({ ...editing, hasCopiedEdits: true })['edit-paste-adjustments'], true);
  assert.equal(menuState({ ...editing, hasCopiedEdits: true, editLocked: true })['edit-paste-adjustments'], false);
  assert.equal(menuState({ ...editing, hasCopiedEdits: true, hasActivePhoto: false })['edit-paste-adjustments'], false);
  assert.equal(menuState({ ...editing, hasCopiedEdits: true, hasActivePhoto: false, selectedCount: 3 })['edit-paste-adjustments'], true);
});

test('Undo and Redo follow what can be undone', () => {
  assert.equal(menuState(editing)['photo-undo'], false);
  assert.equal(menuState(editing)['photo-redo'], false);
  const state = menuState({ ...editing, canUndo: true, canRedo: true });
  assert.equal(state['photo-undo'], true);
  assert.equal(state['photo-redo'], true);
});

test('an empty project offers adding photos, not acting on them', () => {
  const state = menuState({ ...editing, photoCount: 0, hasActivePhoto: false });
  for (const id of ['export', 'export-again', 'photo-keep', 'photo-rate', 'edit-copy-adjustments', 'reset-photo', 'photos-select-all', 'view-grid']) {
    assert.equal(state[id], false, id);
  }
  assert.equal(state['back-to-projects'], true);
  assert.equal(state['backup-now'], true);
});

test('Deselect needs a selection, and Single photo needs the grid open', () => {
  assert.equal(menuState(editing)['photos-deselect-all'], false);
  assert.equal(menuState({ ...editing, selectedCount: 2 })['photos-deselect-all'], true);
  assert.equal(menuState(editing)['view-loupe'], false);
  assert.equal(menuState({ ...editing, gridOpen: true })['view-loupe'], true);
});

test('a collage keeps Export but greys out the photo-only items', () => {
  const state = menuState({ ...editing, collage: true });
  assert.equal(state.export, true);
  for (const id of ['xmp-save', 'photo-keep', 'edit-copy-adjustments', 'backup-now', 'view-grid']) assert.equal(state[id], false, id);
});

test('every controlled id is a real menu choice (except the Rate submenu itself)', () => {
  for (const id of Object.keys(menuState(editing))) {
    if (id === 'photo-rate') continue;
    assert.notEqual(menuActionForV2(id), null, id);
  }
});

test('only changed items are sent to the menu', () => {
  const first = menuState(editing);
  assert.equal(menuStateChanges(null, first).length, Object.keys(first).length);
  assert.deepEqual(menuStateChanges(first, first), []);
  assert.deepEqual(menuStateChanges(first, menuState({ ...editing, canUndo: true })), [['photo-undo', true]]);
});
