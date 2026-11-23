import assert from 'node:assert/strict';
import test from 'node:test';
import type { CullSuggestion } from '../../core/autoCull';
import { undoDecision } from '../../core/cullingEngine';
import { createEmptyProject } from '../../core/projects';
import type { PhotoFrame } from '../../core/types';
import { commitAutoCull } from './commitAutoCull';

const frame = (id: string, patch?: Partial<PhotoFrame>): PhotoFrame => ({
  id, filename: `${id}.NEF`, stableKey: id, exif: {}, sequenceIndex: 0, decision: 'unreviewed',
  burstGroupId: null, burstIndex: 0, burstCount: 1, isDemo: false, sourceKind: 'file', ...patch,
});
const pick = (frameId: string, score = 90): CullSuggestion => ({
  frameId, score, confidence: 'high', decision: 'keep', reason: 'subjectSharp',
});
const project = (...frames: PhotoFrame[]) => ({ ...createEmptyProject('p', 'Shoot'), frames, keeperTarget: 2 });

test('camera stars break the selection order among safe picks; undo restores the whole pass', () => {
  const frames = [frame('a', { burstGroupId: 'birds' }), frame('b', { burstGroupId: 'birds', exif: { rating: 4 } }), frame('c')];
  const state = project(...frames);
  const reviewed = commitAutoCull(state, frames, [pick('a', 98), pick('b', 86), pick('c')]);
  assert.deepEqual(reviewed.frames.map(f => f.decision), ['unreviewed', 'keep', 'keep']);
  assert.equal(reviewed.undoStack.length, 1);
  assert.deepEqual(undoDecision(reviewed).frames.map(f => f.decision), state.frames.map(f => f.decision));
});

test('refuses disputed, malformed, replaced, and removed photos and honours the live keeper budget', () => {
  const originals = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => frame(id));
  const original = project(...originals);
  const latest = project(frame('a', { decision: 'keep' }), frame('b', { stableKey: 'moved' }),
    frame('c', { removedAt: 0 }), originals[3], originals[4], originals[5]);
  const reviewed = commitAutoCull(latest, original.frames, [
    pick('a'), pick('b'), pick('c'), pick('d'),
    { ...pick('d'), decision: 'reject', reason: 'duplicate' }, pick('e', NaN), pick('f'),
  ]);
  assert.deepEqual(reviewed.frames.filter(f => f.decision === 'keep').map(f => f.id), ['a', 'f']);
  assert.deepEqual(undoDecision(reviewed).frames.filter(f => f.decision === 'keep').map(f => f.id), ['a']);
  assert.equal(reviewed.frames[2].removedAt, 0);
});

test('a manual decision during a scan frees the burst slot for the next eligible photo', () => {
  const first = frame('a', { burstGroupId: 'birds' });
  const second = frame('b', { burstGroupId: 'birds' });
  const latest = project({ ...first, decision: 'reject' }, second);
  const reviewed = commitAutoCull(latest, [first, second], [pick('a', 98), pick('b', 89)]);
  assert.deepEqual(reviewed.frames.map(f => f.decision), ['reject', 'keep']);
});
