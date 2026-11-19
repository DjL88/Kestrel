import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCompareKey } from './compareKeyboard';

test('Compare: keyboard keeps, rejects and clears B reversibly', () => {
  assert.deepEqual(resolveCompareKey({ key: 'k' }, 'unreviewed', true, true), { kind: 'decision', decision: 'keep' });
  assert.deepEqual(resolveCompareKey({ key: 'K' }, 'keep', true, true), { kind: 'decision', decision: 'unreviewed' });
  assert.deepEqual(resolveCompareKey({ key: 'x' }, 'keep', true, true), { kind: 'decision', decision: 'reject' });
  assert.deepEqual(resolveCompareKey({ key: 'x' }, 'reject', true, true), { kind: 'decision', decision: 'unreviewed' });
  assert.deepEqual(resolveCompareKey({ key: 'u' }, 'reject', true, true), { kind: 'decision', decision: 'unreviewed' });
});

test('Compare: absent or same-as-A photo B never receives a keyboard decision', () => {
  for (const key of ['k', 'x', 'u']) assert.equal(resolveCompareKey({ key }, null, true, true), null);
});

test('Compare: navigation respects visible candidates and end boundaries', () => {
  assert.deepEqual(resolveCompareKey({ key: 'ArrowLeft' }, 'keep', true, false), { kind: 'previous' });
  assert.deepEqual(resolveCompareKey({ key: 'ArrowRight' }, 'keep', false, true), { kind: 'next' });
  assert.equal(resolveCompareKey({ key: 'ArrowLeft' }, 'keep', false, true), null);
  assert.equal(resolveCompareKey({ key: 'ArrowRight' }, 'keep', true, false), null);
});

test('Compare: typing, modifiers, repeats and IME never decide or navigate', () => {
  const blocked = [
    { key: 'k', ctrlKey: true }, { key: 'x', metaKey: true }, { key: 'u', altKey: true },
    { key: 'k', shiftKey: true }, { key: 'x', repeat: true }, { key: 'k', isComposing: true },
    { key: 'k', keyCode: 229 }, { key: 'Process' }, { key: 'Dead' },
    { key: 'Enter' }, { key: 'Tab' }, { key: 'f' },
  ];
  for (const key of blocked) assert.equal(resolveCompareKey(key, 'unreviewed', true, true), null, JSON.stringify(key));
});

test('Compare: 500-photo deterministic shortcut stream only changes the intended B decision', () => {
  const decisions = new Array<'keep' | 'reject' | 'unreviewed'>(500).fill('unreviewed');
  let right = 1;
  for (let i = 0; i < 499; i++) {
    const action = resolveCompareKey({ key: 'k' }, decisions[right], right > 1, right < 499);
    assert.deepEqual(action, { kind: 'decision', decision: 'keep' });
    if (action?.kind === 'decision') decisions[right] = action.decision;
    if (right < 499) right++;
  }
  assert.equal(decisions[0], 'unreviewed', 'reference A never receives B decisions');
  assert.equal(decisions[499], 'keep');
  assert.equal(decisions.filter(d => d === 'keep').length, 499);
  assert.equal(resolveCompareKey({ key: 'ArrowRight' }, decisions[right], true, false), null);
});
