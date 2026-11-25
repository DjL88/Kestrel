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


test('G05: original keeper target remains attainable after making and flagging virtual copies', () => {
  const originals = [frame('manual', { decision: 'keep' }), frame('candidate'), frame('other')];
  const variants = Array.from({ length: 20 }, (_, i) => frame('copy-' + i, {
    decision: 'keep', virtualCopy: { originalFrameId: 'manual', number: i + 1 },
  }));
  const state = project(...originals, ...variants, frame('demo', { isDemo: true, decision: 'keep' }));
  const reviewed = commitAutoCull(state, originals.slice(1), [pick('candidate', 99), pick('other', 90)]);
  assert.deepEqual(reviewed.frames.slice(0, 3).map(f => f.decision), ['keep', 'keep', 'unreviewed']);
  assert.deepEqual(reviewed.frames.slice(3), state.frames.slice(3));
  assert.deepEqual(undoDecision(reviewed).frames.map(f => f.decision), state.frames.map(f => f.decision));
});


test('a duplicated scan identity cannot attach another source result to the live original', () => {
  const a = frame('a', { stableKey: 'current-source' });
  const stale = frame('a', { stableKey: 'different-source' });
  const b = frame('b');
  for (const captured of [[stale, a, b], [a, stale, b]]) {
    const reviewed = commitAutoCull(project(a, b), captured, [pick('a', 99), pick('b', 90)]);
    assert.deepEqual(reviewed.frames.map(f => f.decision), ['unreviewed', 'keep']);
  }
});

test('the Auto-cull summary says when RAWs were judged from the camera preview, and only then', async () => {
  const { autoCullSummary } = await import('./commitAutoCull.ts');
  assert.equal(autoCullSummary(12, 0), 'Photos checked by Auto pick: 12. Review the flags in the filmstrip. You can undo the whole pass in one step.');
  const one = autoCullSummary(1, 1);
  assert.match(one, /^Photos checked by Auto pick: 1./);
  assert.match(one, /RAW photos judged from the camera's embedded preview, not from their sensor data: 1. Check their sharpness by eye./);
  assert.doesNotMatch(autoCullSummary(12, 0), /embedded preview/, 'no RAW caveat when every RAW was judged from a sensor development');
  assert.match(autoCullSummary(30, 4), /sensor data: 4./);
  assert.match(autoCullSummary(30, 4), /You can undo the whole pass in one step.$/);
});

test('only RAWs that were judged, and not from a picture developed from their sensor data, count for the caveat', async () => {
  const { rawsJudgedFromCameraPreview } = await import('./commitAutoCull.ts');
  const frames = [
    { id: 'a', filename: 'A.NEF' }, { id: 'b', filename: 'B.NEF' }, { id: 'c', filename: 'C.NEF' },
    { id: 'd', filename: 'D.NEF' }, { id: 'e', filename: 'E.jpg' }, { id: 'f', filename: 'F.NEF' },
  ];
  const results = frames.map(({ id }) => ({ frameId: id, decision: null, confidence: 'low' as const, score: 40,
    reason: id === 'f' ? 'unavailable' as const : 'limitedDetail' as const }));
  const sources = new Map([['a', 'camera-preview'], ['b', 'raw-review'], ['c', 'raw-full'], ['e', 'original']] as const);
  // a: camera preview; d: unknown source (cached at import) counts as not developed; e is not a RAW; f was not judged.
  assert.equal(rawsJudgedFromCameraPreview(frames, results, sources), 2);
});

test('after an import, Auto-pilot runs Auto-cull, Co-pilot offers it, Solo stays quiet, and a switched-off cull says so', async () => {
  const { cullAfterImport } = await import('./commitAutoCull.ts');
  assert.equal(cullAfterImport('autopilot', true, 2000, 'done'), 'run');
  assert.equal(cullAfterImport('copilot', true, 12, 'done'), 'offer');
  assert.equal(cullAfterImport('solo', true, 12, 'done'), 'none');
  assert.equal(cullAfterImport('autopilot', false, 12, 'done'), 'switched-off');
  assert.equal(cullAfterImport('copilot', false, 12, 'done'), 'switched-off');
  assert.equal(cullAfterImport('solo', false, 12, 'done'), 'none', 'Solo never mentions it');
  // A partly failed import still gets a cull of what arrived; a stopped or empty one does not.
  assert.equal(cullAfterImport('autopilot', true, 5, 'failed'), 'run');
  assert.equal(cullAfterImport('autopilot', true, 5, 'cancelled'), 'none');
  assert.equal(cullAfterImport('autopilot', true, 0, 'done'), 'none');
});
