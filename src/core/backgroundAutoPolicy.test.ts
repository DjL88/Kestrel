import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FRAMING } from './photoFraming';
import { DEFAULT_EDIT } from './photoEdits';
import { backgroundCullCandidates, backgroundCullMoves, backgroundDevelopTargets, planBackgroundCull } from './backgroundAutoPolicy';
import type { CullSuggestion } from './autoCull';
import type { PhotoFrame } from './types';

const make = (id: string, decision: PhotoFrame['decision'] = 'unreviewed'): PhotoFrame => ({
  id, stableKey: id, filename: id + '.jpg', sequenceIndex: 1, decision,
  burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
});
const suggestion = (frameId: string, decision: 'keep' | 'reject', reason: CullSuggestion['reason'] = 'subjectSharp'): CullSuggestion => ({
  frameId, decision, reason, confidence: 'high', score: 91,
});

test('only new untouched pictures are considered by background culling', () => {
  const frames = [
    make('bird'),
    { ...make('manual'), edit: { ...DEFAULT_EDIT, exposure: 0.4 } },
    { ...make('history'), editHistory: { steps: [], cursor: 0 } },
    { ...make('cropped'), framing: DEFAULT_FRAMING },
    { ...make('removed'), removedAt: 1 },
    make('already-kept', 'keep'),
    make('old'),
  ];
  const ids = new Set(['bird', 'manual', 'history', 'cropped', 'removed', 'already-kept']);
  assert.deepEqual(backgroundCullCandidates(frames, ids).map((frame) => frame.id), ['bird', 'history']);
});

test('background culling accepts high confidence keeps and exact-duplicate rejects only', () => {
  const frames = [make('bird'), make('duplicate'), make('blurry'), { ...make('cropped'), framing: DEFAULT_FRAMING }, make('already', 'keep')];
  const ids = new Set(frames.map((frame) => frame.id));
  const suggestions = [
    suggestion('bird', 'keep'),
    suggestion('duplicate', 'reject', 'duplicate'),
    suggestion('blurry', 'reject', 'subjectSoft'),
    suggestion('cropped', 'keep'),
    suggestion('already', 'keep'),
  ];
  assert.deepEqual(backgroundCullMoves(frames, suggestions, ids), [
    { frameId: 'bird', decision: 'keep' },
    { frameId: 'duplicate', decision: 'reject' },
  ]);
});

test('background jobs keep photographs edited or cropped while scans were running untouched', () => {
  const frames = [make('safe', 'keep'), { ...make('manual', 'keep'), edit: { ...DEFAULT_EDIT, warmth: 0.5 } },
    { ...make('framed', 'keep'), framing: DEFAULT_FRAMING }, make('old', 'keep'),
    { ...make('removed', 'keep'), removedAt: 3 }];
  assert.deepEqual([...backgroundDevelopTargets(frames, new Set(['safe', 'manual', 'framed', 'removed']))], ['safe']);
});

test('ambiguous duplicate catalogue IDs cannot receive background work', () => {
  const frames = [make('duplicated'), make('duplicated')];
  assert.deepEqual(backgroundCullMoves(frames, [suggestion('duplicated', 'keep')], new Set(['duplicated'])), []);
  assert.deepEqual([...backgroundDevelopTargets(frames.map((frame) => ({ ...frame, decision: 'keep' })), new Set(['duplicated']))], []);
});

test('epoch-zero removed photos never receive unattended culling or development', () => {
  const removed = { ...make('removed'), removedAt: 0 };
  const removedKeeper = { ...make('removed-keeper', 'keep'), removedAt: 0 };
  const active = make('active');
  const activeKeeper = make('active-keeper', 'keep');
  const frames = [removed, removedKeeper, active, activeKeeper];
  const imported = new Set(frames.map((frame) => frame.id));

  assert.deepEqual(backgroundCullCandidates(frames, imported).map((frame) => frame.id), ['active']);
  assert.deepEqual(backgroundCullMoves(frames, [
    suggestion('removed', 'keep'),
    suggestion('active', 'keep'),
  ], imported), [{ frameId: 'active', decision: 'keep' }]);
  assert.deepEqual([...backgroundDevelopTargets(frames, imported)], ['active-keeper']);
  assert.equal(removed.removedAt, 0);
  assert.equal(removedKeeper.removedAt, 0);
});


test('live import quota ignores virtual keepers and allocates after filtering stale or edited photos', () => {
  const examined = ['edited', 'editing-now', 'changed', 'removed', 'safe', 'lower'].map(id => make(id));
  const live = [
    make('original-kept', 'keep'),
    { ...make('variant', 'keep'), virtualCopy: { originalFrameId: 'original-kept', number: 1 } },
    { ...examined[0], edit: { ...DEFAULT_EDIT, exposure: 0.4 } },
    examined[1],
    { ...examined[2], originalSha256: 'a'.repeat(64) },
    { ...examined[3], removedAt: 0 },
    examined[4], examined[5],
  ];
  const results = examined.map((frame, index) => ({ ...suggestion(frame.id, 'keep'), score: 100 - index }));
  const plan = planBackgroundCull(live, examined, results, new Set(examined.map(frame => frame.id)), 2, 'editing-now');
  assert.deepEqual(plan.moves, [{ frameId: 'safe', decision: 'keep' }]);
  assert.deepEqual(plan.limited.map(result => [result.frameId, result.confidence]), [['safe', 'high'], ['lower', 'medium']]);
  assert.deepEqual(planBackgroundCull(live, examined, results, new Set(examined.map(frame => frame.id)), 1).moves, []);
});
