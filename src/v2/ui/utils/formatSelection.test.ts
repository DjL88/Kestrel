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
test('Ctrl/Cmd selection drops deleted formats and repeated persisted IDs', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['deleted', 'original', 'original', 'wide'], active: 'original', target: 'story', ctrl: true }),
    { active: 'story', selected: ['original', 'wide', 'story'] });
  assert.deepEqual(chooseFormatSelection({ available, selected: ['deleted', 'wide', 'wide'], active: 'wide', target: 'wide', ctrl: true }),
    { active: 'wide', selected: [] });
});
test('Ctrl/Cmd+Shift deduplicates IDs in board and saved selection', () => {
  assert.deepEqual(chooseFormatSelection({ available: ['original', 'portrait', 'portrait', 'wide'], selected: ['deleted', 'wide', 'wide'], active: 'original', target: 'portrait', ctrl: true, shift: true }),
    { active: 'portrait', selected: ['wide', 'original', 'portrait'] });
});
test('missing shift anchor selects target only, never an unrelated range', () => {
  assert.deepEqual(chooseFormatSelection({ available, selected: ['deleted', 'story'], active: 'deleted', target: 'portrait', shift: true }),
    { active: 'portrait', selected: ['portrait'] });
  assert.deepEqual(chooseFormatSelection({ available, selected: ['deleted', 'story'], active: 'deleted', target: 'portrait', shift: true, ctrl: true }),
    { active: 'portrait', selected: ['story', 'portrait'] });
});

test('unavailable target cleans stale persisted IDs without resurrecting a deleted format', () => {
  assert.deepEqual(chooseFormatSelection({
    available, selected: ['deleted', 'portrait', 'portrait', 'gone', 'story'],
    active: 'deleted', target: 'missing', ctrl: true,
  }), { active: 'portrait', selected: ['portrait', 'story'] });
});

test('blank IDs and duplicate catalogue entries do not become active or selected', () => {
  assert.deepEqual(chooseFormatSelection({
    available: ['', '  ', 'original'], selected: ['', '  ', 'original'],
    active: '', target: '', ctrl: true,
  }), { active: 'original', selected: ['original'] });
  assert.deepEqual(chooseFormatSelection({
    available: ['original', 'portrait', 'portrait', 'wide'],
    selected: ['original'], active: 'original', target: 'wide', shift: true,
  }), { active: 'wide', selected: ['original', 'portrait', 'wide'] });
  assert.deepEqual(chooseFormatSelection({
    available: ['', '  '], selected: [''], active: '', target: '  ', shift: true,
  }), { active: '', selected: [] });
});

test('selection does not mutate arrays supplied by caller', () => {
  const board = ['original', 'portrait', 'portrait', 'wide'];
  const chosen = ['gone', 'portrait', 'portrait'];
  const originalBoard = [...board];
  const originalChosen = [...chosen];
  chooseFormatSelection({ available: board, selected: chosen, active: 'gone', target: 'wide', shift: true, ctrl: true });
  assert.deepEqual(board, originalBoard);
  assert.deepEqual(chosen, originalChosen);
});

test('gesture matrix always returns unique live selections and an available active ID', () => {
  for (const board of [[], ['original', 'portrait', 'wide'], ['', 'original', 'original', 'portrait', '  ']]) {
    const valid = new Set(board.filter((id) => id.trim().length > 0));
    for (const active of ['original', 'portrait', 'deleted', '']) {
      for (const target of ['original', 'portrait', 'deleted', '', '  ']) {
        for (const shift of [false, true]) {
          for (const ctrl of [false, true]) {
            const result = chooseFormatSelection({
              available: board, selected: ['deleted', 'portrait', 'portrait', ''],
              active, target, shift, ctrl,
            });
            assert.equal(new Set(result.selected).size, result.selected.length);
            assert.ok(result.selected.every((id) => valid.has(id)));
            assert.ok(result.active === '' || valid.has(result.active));
            if (valid.has(target)) assert.equal(result.active, target);
          }
        }
      }
    }
  }
});
