import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chooseProof, reconcileProofChoice } from './exportProofSelection';

describe('fixed export proof navigation', () => {
  it('shows no proof without a selected photo and destination', () => {
    assert.equal(reconcileProofChoice(null, [], ['master']), null);
    assert.equal(reconcileProofChoice(null, ['photo'], []), null);
  });
  it('defaults to the first selected photo and destination', () => {
    assert.deepEqual(reconcileProofChoice(null, ['a', 'b'], ['master', 'social']), { photoId: 'a', destinationId: 'master' });
  });
  it('keeps a deliberate choice while selections remain available', () => {
    assert.deepEqual(reconcileProofChoice({ photoId: 'b', destinationId: 'social' }, ['a', 'b'], ['master', 'social']), { photoId: 'b', destinationId: 'social' });
  });
  it('does not show a deselected output', () => {
    assert.deepEqual(reconcileProofChoice({ photoId: 'b', destinationId: 'social' }, ['a'], ['master']), { photoId: 'a', destinationId: 'master' });
  });
  it('rejects an unselected photo or output', () => {
    assert.throws(() => chooseProof(null, { photoId: 'other' }, ['a'], ['master']));
    assert.throws(() => chooseProof(null, { destinationId: 'hidden' }, ['a'], ['master']));
  });
  it('switches photo and output independently', () => {
    const initial = reconcileProofChoice(null, ['a', 'b'], ['master', 'social']);
    const second = chooseProof(initial, { destinationId: 'social' }, ['a', 'b'], ['master', 'social']);
    assert.deepEqual(chooseProof(second, { photoId: 'b' }, ['a', 'b'], ['master', 'social']), { photoId: 'b', destinationId: 'social' });
  });
});
