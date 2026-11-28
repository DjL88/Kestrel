import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sameShape } from './FrameImage';

describe('live draft shape', () => {
  it('accepts a draft with the picture\'s own shape at another size', () => {
    assert.equal(sameShape({ width: 1200, height: 800 }, { width: 8280, height: 5520 }), true);
  });
  it('rejects a draft that would be stretched', () => {
    assert.equal(sameShape({ width: 1200, height: 1200 }, { width: 8280, height: 5520 }), false);
  });
  it('accepts when the picture size is not known yet', () => {
    assert.equal(sameShape({ width: 1200, height: 800 }, null), true);
  });
});
