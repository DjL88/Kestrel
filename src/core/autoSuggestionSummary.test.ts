import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedAutoChanges, visibleAutoChanges } from './autoSuggestionSummary';
import type { PhotoEdit } from './photoEdits';

const original: PhotoEdit = { exposure: 0, warmth: 0, colour: 0 };

test('auto summary describes only adjustments in the accepted recipe', () => {
  const proposed = { ...original, exposure: 0.6, shadows: 0.4, warmth: 0.2, highlights: -0.2 };
  const final = { ...original, exposure: 0.3, highlights: -0.1 };
  assert.deepEqual(acceptedAutoChanges(original, final), [
    { key: 'exposure', direction: 'up' }, { key: 'highlights', direction: 'down' },
  ], 'do not describe rejected shadow and warmth proposals');
  assert.equal(acceptedAutoChanges(original, proposed).length, 4);
});

test('when safety rejects all edits there is no misleading explanation', () => {
  assert.deepEqual(acceptedAutoChanges(original, original), []);
  assert.deepEqual(acceptedAutoChanges(original, { ...original }, false), []);
});

test('existing manual edits are described relative to the current edit, not neutral', () => {
  const edited: PhotoEdit = { ...original, exposure: 0.5, warmth: 0.2, vibrance: 0.4 };
  const after: PhotoEdit = { ...edited, exposure: 0.2, warmth: 0.1, vibrance: 0.6 };
  assert.deepEqual(acceptedAutoChanges(edited, after), [
    { key: 'exposure', direction: 'down' },
    { key: 'warmth', direction: 'down' },
    { key: 'vibrance', direction: 'up' },
  ]);
});

test('mask explanation appears only when a real subject mask survived the quality gate', () => {
  assert.deepEqual(acceptedAutoChanges(original, original, true), [{ key: 'subjectMask' }]);
  assert.deepEqual(visibleAutoChanges(acceptedAutoChanges(original, {
    ...original, exposure: 0.2, highlights: -0.1, shadows: 0.1,
  }, true)), [{ key: 'exposure', direction: 'up' }, { key: 'highlights', direction: 'down' }]);
});

test('invalid/stale numeric values do not create nonsense advice', () => {
  assert.deepEqual(acceptedAutoChanges(original, { ...original, warmth: Number.NaN }), []);
  assert.deepEqual(acceptedAutoChanges(original, { ...original, exposure: 1e-7 }), []);
});
