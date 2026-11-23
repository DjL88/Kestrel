import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseFormatSelection } from './formatSelection.ts';

const available = ['original', 'portrait', 'wide', 'story'];
test('plain click selects a single format', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['original', 'story'], active: 'original', target: 'wide' }),
    { active: 'wide', selected: ['wide'] });
});
test('shift-click selects the ordered range in either direction', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['original'], active: 'original', target: 'wide', shift: true }).selected,
    ['original', 'portrait', 'wide']);
  assert.deepEqual(chooseFormatSelection({ available, selected: ['story'], active: 'story', target: 'portrait', shift: true }).selected,
    ['portrait', 'wide', 'story']);
});
test('Ctrl/Cmd-click toggles without forcing one format to remain selected', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['portrait'], active: 'portrait', target: 'portrait', ctrl: true }).selected, []);
  assert.deepEqual(chooseFormatSelection({ available, selected: ['original'], active: 'original', target: 'story', ctrl: true }).selected, ['original', 'story']);
});
test('Ctrl/Cmd+Shift adds a range without discarding independent selections', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['story'], active: 'original', target: 'wide', shift: true, ctrl: true }).selected,
    ['story', 'original', 'portrait', 'wide']);
});
test('an unavailable format never changes a valid current selection', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['portrait'], active: 'portrait', target: 'missing', shift: true }),
    { active: 'portrait', selected: ['portrait'] });
});
test('stale and duplicate selected IDs are removed even on an unavailable target', () => {
  assert.deepEqual(chooseFormatSelection({
    available, selected: ['deleted', 'portrait', 'portrait', 'gone', 'story'], active: 'deleted', target: 'missing', ctrl: true,
  }), { active: 'portrait', selected: ['portrait', 'story'] });
});
test('deleted Shift anchor selects target only rather than an unrelated range', () => {
  assert.deepEqual(chooseFormatSelection({
    available, selected: ['deleted', 'portrait'], active: 'deleted', target: 'story', shift: true,
  }), { active: 'story', selected: ['story'] });
});
test('Ctrl+Shift preserves existing order, excludes stale IDs and adds each range member once', () => {
  assert.deepEqual(chooseFormatSelection({
    available, selected: ['story', 'deleted', 'story', 'portrait'], active: 'original', target: 'wide', shift: true, ctrl: true,
  }), { active: 'wide', selected: ['story', 'portrait', 'original', 'wide'] });
});
test('empty available list cannot create a phantom selection', () => {
  assert.deepEqual(chooseFormatSelection({
    available: [], selected: ['removed'], active: 'removed', target: 'removed', shift: true,
  }), { active: '', selected: [] });
});

test('blank catalogue IDs never become active or selected', () => {
  assert.deepEqual(chooseFormatSelection({
    available: ['', '  ', 'original'], selected: ['', '  ', 'original'], active: '', target: '', ctrl: true,
  }), { active: 'original', selected: ['original'] });
  assert.deepEqual(chooseFormatSelection({
    available: ['', '  '], selected: [''], active: '', target: '  ', shift: true,
  }), { active: '', selected: [] });
});
test('duplicate catalogue IDs do not distort shift selection ranges', () => {
  assert.deepEqual(chooseFormatSelection({
    available: ['original', 'portrait', 'portrait', 'wide'], selected: ['original'], active: 'original', target: 'wide', shift: true,
  }), { active: 'wide', selected: ['original', 'portrait', 'wide'] });
});

test('deleted anchor with Ctrl+Shift preserves independent live picks without phantom range', () => {
  assert.deepEqual(chooseFormatSelection({
    available, selected: ['deleted', 'story', 'story'], active: 'deleted', target: 'portrait', shift: true, ctrl: true,
  }), { active: 'portrait', selected: ['story', 'portrait'] });
});
test('valid Shift anchor retains the contiguous range after cleaning stale selected IDs', () => {
  assert.deepEqual(chooseFormatSelection({
    available, selected: ['deleted', 'story'], active: 'original', target: 'wide', shift: true,
  }), { active: 'wide', selected: ['original', 'portrait', 'wide'] });
});
