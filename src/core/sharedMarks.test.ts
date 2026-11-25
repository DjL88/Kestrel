import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MARKS, marksOf, mergeShared, readSharedMarks, sharedPayloadHash } from './sharedMarks';
import { recipeFingerprint } from './sharedSync';

const e0 = { exposure: 0 };
const e1 = { exposure: 0.5 };
const e2 = { exposure: -0.5 };
const base = { editHash: recipeFingerprint(e0), marks: { rating: 2, decision: 'unreviewed' as const } };

test('marks from another member are read strictly; anything odd is ignored', () => {
  assert.deepEqual(readSharedMarks({ rating: 4, decision: 'keep' }), { rating: 4, decision: 'keep' });
  for (const bad of [null, [], { rating: 6, decision: 'keep' }, { rating: 2.5, decision: 'keep' }, { rating: 1, decision: 'delete' }, { rating: '3', decision: 'keep' }]) assert.equal(readSharedMarks(bad), undefined);
  assert.deepEqual(marksOf({}), DEFAULT_MARKS);
  assert.deepEqual(marksOf({ rating: 9, decision: 'reject' }), { rating: 5, decision: 'reject' });
});

test('a photo shared before marks existed still matches, so it is not sent again', () => {
  assert.equal(sharedPayloadHash(e1, DEFAULT_MARKS), recipeFingerprint(e1));
  assert.equal(sharedPayloadHash(e1, undefined), recipeFingerprint(e1));
  assert.notEqual(sharedPayloadHash(e1, { rating: 3, decision: 'unreviewed' }), recipeFingerprint(e1));
});

test('changes to different things are combined', () => {
  // I rated it 5, they edited it: their edit, my rating.
  assert.deepEqual(mergeShared(base, { edit: e0, marks: { rating: 5, decision: 'unreviewed' } }, { edit: e1, marks: base.marks }),
    { kind: 'merged', edit: e1, marks: { rating: 5, decision: 'unreviewed' }, takesTheirEdit: true });
  // I edited it, they flagged it: my edit, their flag.
  assert.deepEqual(mergeShared(base, { edit: e2, marks: base.marks }, { edit: e0, marks: { rating: 2, decision: 'keep' } }),
    { kind: 'merged', edit: e2, marks: { rating: 2, decision: 'keep' }, takesTheirEdit: false });
  // I rated, they flagged.
  assert.deepEqual(mergeShared(base, { edit: e0, marks: { rating: 4, decision: 'unreviewed' } }, { edit: e0, marks: { rating: 2, decision: 'reject' } }),
    { kind: 'merged', edit: e0, marks: { rating: 4, decision: 'reject' }, takesTheirEdit: false });
  // Both made the same change.
  assert.equal(mergeShared(base, { edit: e1, marks: { rating: 3, decision: 'keep' } }, { edit: e1, marks: { rating: 3, decision: 'keep' } }).kind, 'merged');
});

test('the same thing changed differently on both sides is a clash, never a silent overwrite', () => {
  assert.deepEqual(mergeShared(base, { edit: e0, marks: { rating: 5, decision: 'unreviewed' } }, { edit: e0, marks: { rating: 1, decision: 'unreviewed' } }), { kind: 'conflict', fields: ['rating'] });
  assert.deepEqual(mergeShared(base, { edit: e0, marks: { rating: 2, decision: 'keep' } }, { edit: e0, marks: { rating: 2, decision: 'reject' } }), { kind: 'conflict', fields: ['decision'] });
  assert.deepEqual(mergeShared(base, { edit: e1, marks: base.marks }, { edit: e2, marks: base.marks }), { kind: 'conflict', fields: ['edit'] });
  // Without knowing what this device last matched, any difference is a clash.
  assert.deepEqual(mergeShared(null, { edit: e1, marks: { rating: 4, decision: 'keep' } }, { edit: e0, marks: { rating: 4, decision: 'reject' } }), { kind: 'conflict', fields: ['edit', 'decision'] });
});

test('a revision from an older app without marks never clears a rating or flag', () => {
  assert.deepEqual(mergeShared(base, { edit: e0, marks: { rating: 5, decision: 'keep' } }, { edit: e1, marks: undefined }),
    { kind: 'merged', edit: e1, marks: { rating: 5, decision: 'keep' }, takesTheirEdit: true });
  assert.deepEqual(mergeShared(null, { edit: e1, marks: { rating: 5, decision: 'keep' } }, { edit: e1, marks: undefined }),
    { kind: 'merged', edit: e1, marks: { rating: 5, decision: 'keep' }, takesTheirEdit: false });
});
