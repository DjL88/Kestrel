import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoShootFrames, createDemoShootState, applyAutoCullDecisions, undoDecision, redoDecision } from './cullingEngine';
import { limitAutoKeepers, scorePreview, type CullSuggestion } from './autoCull';

test('a flat dark preview is advisory and unavailable images receive no decision', () => {
  const result = scorePreview('dark', new Uint8ClampedArray(96 * 96 * 4), 96, 96);
  assert.equal(result.confidence, 'medium');
  assert.equal(result.decision, 'reject');
  assert.equal(scorePreview('small', new Uint8ClampedArray(4), 1, 1).decision, null);
});

test('confidence limit preserves keeper headroom and one automatic pick per burst', () => {
  const photos = generateDemoShootFrames(3).map((frame) => ({ ...frame, burstGroupId: 'one' }));
  const suggestions: CullSuggestion[] = photos.map((frame, index) => ({
    frameId: frame.id, decision: 'keep', confidence: 'high', reason: 'clearDetail', score: 90 + index,
  }));
  const result = limitAutoKeepers(suggestions, photos, 2);
  assert.deepEqual(result.filter((item) => item.confidence === 'high').map((item) => item.frameId), [photos[2].id]);
});

test('auto-cull only changes undecided originals and supports grouped undo and redo', () => {
  const state = createDemoShootState(3);
  state.frames = state.frames.map((frame, index) => ({ ...frame, isDemo: false, decision: index === 2 ? 'keep' : 'unreviewed' }));
  const moved = applyAutoCullDecisions(state, [
    { frameId: state.frames[0].id, decision: 'keep' },
    { frameId: state.frames[1].id, decision: 'reject' },
    { frameId: state.frames[2].id, decision: 'reject' },
  ]);
  assert.deepEqual(moved.frames.map((frame) => frame.decision), ['keep', 'reject', 'keep']);
  assert.equal(moved.undoStack.length, 1);
  const restored = undoDecision(moved);
  assert.deepEqual(restored.frames.map((frame) => frame.decision), ['unreviewed', 'unreviewed', 'keep']);
  assert.deepEqual(redoDecision(restored).frames, moved.frames);
});
