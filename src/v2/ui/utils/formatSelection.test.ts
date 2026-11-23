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
test('an unavailable format never changes the current selection', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['portrait'], active: 'portrait', target: 'missing', shift: true }),
    { active: 'portrait', selected: ['portrait'] });
});