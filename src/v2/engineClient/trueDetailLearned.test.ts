import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { learnedTooLargeNote } from './trueDetailLearned';

describe('learned denoise size note', () => {
  it('states the real size, the limit, and that nothing was shrunk', () => {
    const note = learnedTooLargeNote(4140, 2640);
    assert.match(note, /4140 × 2640/);
    assert.match(note, /10\.9 MP/);
    assert.match(note, /3 MP/);
    assert.match(note, /Nothing was shrunk/);
  });
});
