import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankPhoto, rankPhotos } from './decisionMaker.ts';
import type { CullSuggestion } from '../core/autoCull';

function suggestion(patch: Partial<CullSuggestion> = {}): CullSuggestion {
  return { frameId: 'f1', decision: 'keep', confidence: 'high', score: 90, reason: 'subjectSharp', ...patch };
}

describe('rankPhoto', () => {
  it('returns null for anything that is not a keep', () => {
    assert.equal(rankPhoto(suggestion({ decision: null })), null);
    assert.equal(rankPhoto(suggestion({ decision: 'reject' })), null);
  });

  it('ranks a high-confidence, high-score, uncontested photo as best', () => {
    assert.equal(rankPhoto(suggestion({ confidence: 'high', score: 90 })), 'best');
  });

  it('a disputed subject (vision vs. detector conflict) caps an otherwise-best photo to better', () => {
    const conflict = { state: 'conflict', reading: 'bird', detector: 'aircraft' } as const;
    assert.equal(rankPhoto(suggestion({ confidence: 'high', score: 95 }), conflict), 'better');
  });

  it('agreement does not cap the tier', () => {
    const agreed = { state: 'agreed', subject: 'bird' } as const;
    assert.equal(rankPhoto(suggestion({ confidence: 'high', score: 95 }), agreed), 'best');
  });

  it('a mid score is better, and a low score keeper is still good, never null', () => {
    assert.equal(rankPhoto(suggestion({ confidence: 'medium', score: 65 })), 'better');
    assert.equal(rankPhoto(suggestion({ confidence: 'medium', score: 50 })), 'good');
  });
});

describe('rankPhotos', () => {
  it('only includes frames with a usable tier, keyed by frame id', () => {
    const result = rankPhotos([
      suggestion({ frameId: 'a', decision: 'keep', score: 90, confidence: 'high' }),
      suggestion({ frameId: 'b', decision: null }),
      suggestion({ frameId: 'c', decision: 'keep', score: 40, confidence: 'low' }),
    ]);
    assert.deepEqual([...result.keys()], ['a', 'c']);
    assert.equal(result.get('a'), 'best');
    assert.equal(result.get('c'), 'good');
  });

  it('looks up corroboration per frame id', () => {
    const result = rankPhotos(
      [suggestion({ frameId: 'a', score: 95, confidence: 'high' })],
      (id) => (id === 'a' ? { state: 'conflict', reading: 'bird', detector: 'aircraft' } : undefined),
    );
    assert.equal(result.get('a'), 'better');
  });
});
