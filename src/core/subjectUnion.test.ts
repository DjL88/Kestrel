import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unionSubjectGrid, distinctSubjectIndices } from './subjectUnion';
import { createSubjectMask } from './maskTypes';
import { maskAlpha, fullContext } from './masks';

const make = (id: string, lo: number, hi: number) => createSubjectMask(id,
  { w: 32, h: 32, data: btoa(String.fromCharCode(...Array.from({ length: 1024 }, (_, i) => i % 32 >= lo && i % 32 <= hi ? 255 : 0))) },
  'frame', 'high');

describe('all-subject union', () => {
  it('protects three separate subjects and leaves gaps as background', () => {
    const grid = unionSubjectGrid([make('a', 1, 6), make('b', 13, 18), make('c', 25, 30)], 1);
    const alpha = maskAlpha(createSubjectMask('all', grid, 'frame', 'high'), 128, 128, fullContext(128, 128));
    for (const x of [14, 62, 110]) assert.ok(alpha[64 * 128 + x] > 0.99);
    for (const x of [40, 88]) assert.ok(alpha[64 * 128 + x] < 0.01);
  });
  it('does not accumulate duplicate subject coverage', () => {
    const a = make('a', 8, 20);
    assert.deepEqual(unionSubjectGrid([a, a], 1), unionSubjectGrid([a], 1));
  });
  it('is independent of subject order', () => {
    const a = make('a', 3, 18), b = make('b', 12, 27);
    assert.deepEqual(unionSubjectGrid([a, b], 1), unionSubjectGrid([b, a], 1));
  });
  it('rejects empty subject input', () => {
    assert.throws(() => unionSubjectGrid([], 1), RangeError);
  });
});

describe('one animal found twice', () => {
  it('keeps one subject when a second detection sits inside the first', () => {
    assert.deepEqual(distinctSubjectIndices([make('whole', 4, 24), make('part', 8, 18)], [0.9, 0.7], 1), [0]);
  });
  it('keeps the higher-scoring duplicate', () => {
    assert.deepEqual(distinctSubjectIndices([make('a', 4, 24), make('b', 5, 24)], [0.6, 0.9], 1), [1]);
  });
  it('keeps two separate birds', () => {
    assert.deepEqual(distinctSubjectIndices([make('a', 1, 10), make('b', 20, 30)], [0.9, 0.8], 1), [0, 1]);
  });
});
