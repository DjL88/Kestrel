import assert from 'node:assert/strict';
import test from 'node:test';
import type { CullSuggestion } from './autoCull';
import { undoDecision } from './cullingEngine';
import { applyCullRules, normaliseCullRules, proposedKeepers, rankWithRules } from './cullRules';
import { createEmptyProject } from './projects';
import type { PhotoFrame } from './types';

const frame = (id: string, burst: string | null = null, patch?: Partial<PhotoFrame>): PhotoFrame => ({
  id, filename: `${id}.jpg`, stableKey: `key-${id}`, exif: {}, sequenceIndex: 0, decision: 'unreviewed',
  burstGroupId: burst, burstIndex: 0, burstCount: burst ? 4 : 1, isDemo: false, sourceKind: 'file', ...patch,
});
const sharp = (frameId: string, score: number): CullSuggestion => ({ frameId, decision: 'keep', confidence: score >= 85 ? 'high' : 'medium', score, reason: 'subjectSharp' });
const unsure = (frameId: string, score: number): CullSuggestion => ({ frameId, decision: null, confidence: 'low', score, reason: 'noSubject' });

const frames = [frame('b1', 'burst'), frame('b2', 'burst'), frame('b3', 'burst'), frame('b4', 'burst'), frame('s1'), frame('s2'), frame('d')];
const results = [sharp('b1', 95), sharp('b2', 90), sharp('b3', 72), unsure('b4', 99), sharp('s1', 88), sharp('s2', 60),
  { frameId: 'd', decision: 'reject', confidence: 'high', score: 100, reason: 'duplicate' } as CullSuggestion];
const outcome = (ranked: ReturnType<typeof rankWithRules>) => Object.fromEntries(ranked.map((r) => [r.frameId, `${r.outcome}:${r.why}`]));

test('minimum quality and keep at most N per burst; the extras and uncertain frames stay for review', () => {
  const ranked = rankWithRules(frames, results, { minQuality: 80, keepAtLeast: 0, keepAtMost: 1 });
  assert.deepEqual(outcome(ranked), {
    b1: 'keep:meetsQuality', b2: 'review:burstFull', b3: 'review:belowQuality', b4: 'review:uncertain',
    s1: 'keep:meetsQuality', s2: 'review:belowQuality', d: 'copy:copy',
  });
  // Keepers first, then review, then copies; best first within each.
  assert.deepEqual(ranked.map((r) => r.frameId), ['b1', 's1', 'b4', 'b2', 'b3', 's2', 'd']);
});

test('moving a slider re-ranks at once: keep at most 2 lifts the second frame of the burst', () => {
  const ranked = rankWithRules(frames, results, { minQuality: 80, keepAtLeast: 0, keepAtMost: 2 });
  assert.deepEqual(proposedKeepers(ranked).sort(), ['b1', 'b2', 's1']);
  const stricter = rankWithRules(frames, results, { minQuality: 92, keepAtLeast: 0, keepAtMost: 2 });
  assert.deepEqual(proposedKeepers(stricter), ['b1']);
});

test('keep at least N per burst fills from frames with keeper evidence, never from uncertain ones', () => {
  const ranked = rankWithRules(frames, results, { minQuality: 99, keepAtLeast: 2, keepAtMost: 3 });
  assert.equal(outcome(ranked).b1, 'keep:burstMinimum');
  assert.equal(outcome(ranked).b2, 'keep:burstMinimum');
  assert.equal(outcome(ranked).b4, 'review:uncertain', 'a high-scoring uncertain frame is never kept by a rule');
  assert.equal(outcome(ranked).s1, 'review:belowQuality', 'single photos follow the minimum only');
  const onlyUnsure = rankWithRules([frame('x', 'g'), frame('y', 'g')], [unsure('x', 90), unsure('y', 80)], { minQuality: 0, keepAtLeast: 2, keepAtMost: 2 });
  assert.deepEqual(proposedKeepers(onlyUnsure), []);
});

test('nothing is ever rejected, and the person’s own decisions count and stay', () => {
  const decided = frames.map((f) => (f.id === 'b2' ? { ...f, decision: 'keep' as const } : f.id === 's1' ? { ...f, decision: 'reject' as const } : f));
  const ranked = rankWithRules(decided, results, { minQuality: 80, keepAtLeast: 0, keepAtMost: 1 });
  assert.equal(outcome(ranked).b2, 'keep:yourKeep');
  assert.equal(outcome(ranked).b1, 'review:burstFull', 'the person’s keeper fills the burst');
  assert.equal(outcome(ranked).s1, 'review:yourChoice');
  for (const rules of [{ minQuality: 0, keepAtLeast: 10, keepAtMost: 10 }, { minQuality: 100, keepAtLeast: 0, keepAtMost: 1 }]) {
    const state = { ...createEmptyProject('p', 'Shoot'), frames: decided, keeperTarget: 10 };
    const after = applyCullRules(state, rankWithRules(decided, results, rules));
    assert.ok(after.frames.every((f, i) => f.decision === decided[i].decision || f.decision === 'keep'), 'only keeps are added');
    assert.deepEqual(undoDecision(after).frames.map((f) => f.decision), decided.map((f) => f.decision), 'one Undo takes it back');
  }
});

test('rules are clamped, at least never exceeds at most, and broken input is safe', () => {
  assert.deepEqual(normaliseCullRules({ minQuality: 140, keepAtLeast: 9, keepAtMost: 3 }), { minQuality: 100, keepAtLeast: 3, keepAtMost: 3 });
  assert.deepEqual(normaliseCullRules({ minQuality: Number.NaN, keepAtLeast: -4, keepAtMost: 0 }), { minQuality: 80, keepAtLeast: 0, keepAtMost: 1 });
  const ranked = rankWithRules([frame('n'), frame('m')], [{ ...sharp('n', Number.NaN) }, sharp('m', 90), sharp('m', 91)], {});
  assert.deepEqual(outcome(ranked), { n: 'review:uncertain' }, 'a NaN score is not evidence; an ambiguous photo is left out');
});

test('two thousand photos rank in well under a frame', () => {
  const many = Array.from({ length: 2000 }, (_, i) => frame(`p${i}`, i % 3 ? `burst${Math.floor(i / 6)}` : null));
  const scored = many.map((f, i) => (i % 5 ? sharp(f.id, 50 + (i * 37) % 50) : unsure(f.id, 40)));
  const started = performance.now();
  for (let i = 0; i < 10; i += 1) rankWithRules(many, scored, { minQuality: 60 + i, keepAtLeast: 1, keepAtMost: 2 });
  assert.ok((performance.now() - started) / 10 < 16, 'each ranking fits inside one 60 Hz frame');
});
