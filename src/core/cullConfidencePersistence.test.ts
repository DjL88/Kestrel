import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCullConfidence, createDemoShootState, sortFrames } from './cullingEngine';

test('malformed scan scores cannot poison persisted confidence or sorting', () => {
  const state = createDemoShootState(5);
  const ids = state.frames.map((frame) => frame.id);
  const original = state.frames.map((frame) => ({ ...frame }));
  const next = applyCullConfidence(state, [
    { frameId: ids[0], confidence: 'high', score: Number.NaN },
    { frameId: ids[1], confidence: 'high', score: Infinity },
    { frameId: ids[2], confidence: 'high', score: -1 },
    { frameId: ids[3], confidence: 'high', score: 101 },
    { frameId: ids[4], confidence: 'high', score: 92 },
  ]);
  assert.equal(next.frames.filter((frame) => frame.cullConfidence).length, 1);
  assert.equal(next.frames[4].cullScore, 92);
  assert.deepEqual(state.frames, original, 'input catalogue must remain untouched');
  assert.equal(sortFrames(next.frames, 'confidence-desc')[0].id, ids[4]);
});

test('duplicate scan IDs cannot overwrite a stored review signal by ordering', () => {
  const state = createDemoShootState(3);
  const id = state.frames[0].id;
  const next = applyCullConfidence(state, [
    { frameId: id, confidence: 'high', score: 99 },
    { frameId: id, confidence: 'low', score: 10 },
    { frameId: state.frames[1].id, confidence: 'medium', score: 60 },
  ]);
  assert.equal(next.frames[0].cullConfidence, undefined);
  assert.equal(next.frames[1].cullScore, 60);
  assert.equal(next.frames[0].decision, 'unreviewed');
});

test('unknown confidence from a runtime boundary is ignored', () => {
  const state = createDemoShootState(2);
  const next = applyCullConfidence(state, [
    { frameId: state.frames[0].id, confidence: 'certain' as 'high', score: 90 },
  ]);
  assert.equal(next.frames[0].cullScore, undefined);
});
