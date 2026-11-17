import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoShootFrames, stepSelection } from './cullingEngine';

const frames = generateDemoShootFrames(500);

test('500-frame keyboard navigation stays within boundaries', () => {
  assert.equal(stepSelection(frames, frames[0].id, -1), frames[0].id);
  assert.equal(stepSelection(frames, frames[0].id, 1), frames[1].id);
  assert.equal(stepSelection(frames, frames[0].id, 500), frames[499].id);
  assert.equal(stepSelection(frames, frames[499].id, 1), frames[499].id);
  assert.equal(stepSelection(frames, frames[499].id, -499), frames[0].id);
});

test('NaN and infinite keyboard deltas never produce an undefined selection', () => {
  for (const delta of [NaN, Infinity, -Infinity]) {
    assert.equal(stepSelection(frames, frames[250].id, delta), frames[250].id);
  }
});

test('fractional deltas are truncated to stable whole-photo movements', () => {
  assert.equal(stepSelection(frames, frames[250].id, 1.9), frames[251].id);
  assert.equal(stepSelection(frames, frames[250].id, -1.9), frames[249].id);
  assert.equal(stepSelection(frames, frames[250].id, 0.5), frames[250].id);
});

test('removed photos are never selected, even when a stale view still contains them', () => {
  const stale = frames.slice(0, 4).map((frame, index) => index === 1
    ? { ...frame, removedAt: Date.now() } : frame);
  assert.equal(stepSelection(stale, stale[0].id, 1), stale[2].id);
  assert.equal(stepSelection(stale, stale[1].id, 1), stale[0].id);
  assert.equal(stepSelection(stale, stale[2].id, -1), stale[0].id);
});

test('empty and fully removed views produce null without mutating source', () => {
  assert.equal(stepSelection([], null, 1), null);
  const removed = frames.slice(0, 2).map((frame) => ({ ...frame, removedAt: Date.now() }));
  assert.equal(stepSelection(removed, removed[0].id, 1), null);
  assert.equal(frames[0].removedAt, undefined);
});

test('unknown selections recover to first active photo without changing decisions', () => {
  const original = frames[0].decision;
  assert.equal(stepSelection(frames, 'not-in-shoot', 1), frames[0].id);
  assert.equal(stepSelection(frames, null, 1), frames[0].id);
  assert.equal(frames[0].decision, original);
});
