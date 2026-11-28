// Golden path checks GP-04 and GP-05: pure logic on the synthetic 500-frame demo shoot (src/core/cullingEngine.ts), run
// with Node, no browser. `npm run golden-path` runs this file with `node --import tsx --test`; it is not a Playwright spec.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { judgePreview, judgeSubject, limitAutoKeepers, type CullSuggestion, type SubjectFinding } from '../src/core/autoCull';

test('[GP-04] the 500-frame demo shoot is deterministic, and best 10% is capped at the target with one per burst, best first', () => {
  const a = createDemoShootState(500);
  const b = createDemoShootState(500);
  assert.equal(a.frames.length, 500);
  assert.deepEqual(a.frames.map((f) => f.id), b.frames.map((f) => f.id), 'same ids on every load');
  assert.deepEqual(a.frames.map((f) => f.burstGroupId), b.frames.map((f) => f.burstGroupId), 'same bursts on every load');
  assert.ok(a.frames.some((f) => f.burstGroupId), 'the demo shoot has bursts');
  assert.equal(a.keeperTarget, 50, 'the target is 10% of 500');

  // The demo frames are sample data (isDemo), which the culler rightly never decides. Treat them as originals here.
  const frames = a.frames.map((f) => ({ ...f, isDemo: false }));
  const score = (i: number) => 70 + ((i * 37) % 29) + i / 1000; // distinct, spread through the shoot
  const suggestions: CullSuggestion[] = frames.map((f, i) => ({ frameId: f.id, decision: 'keep', confidence: 'high', score: score(i), reason: 'clearDetail' }));
  const out = limitAutoKeepers(suggestions, frames, a.keeperTarget);
  const accepted = out.filter((r) => r.decision === 'keep' && r.confidence === 'high');
  assert.equal(accepted.length, 50, 'exactly the target when there are enough bursts');
  const burstOf = new Map(frames.map((f) => [f.id, f.burstGroupId ?? f.id]));
  const bursts = accepted.map((r) => burstOf.get(r.frameId));
  assert.equal(new Set(bursts).size, accepted.length, 'at most one keeper per burst');

  // Best first: nothing left out beats the weakest pick, once each burst is counted by its best frame.
  const bestPerBurst = new Map<string, number>();
  suggestions.forEach((r) => bestPerBurst.set(String(burstOf.get(r.frameId)), Math.max(bestPerBurst.get(String(burstOf.get(r.frameId))) ?? 0, r.score)));
  const fiftieth = [...bestPerBurst.values()].sort((x, y) => y - x)[49];
  assert.ok(Math.min(...accepted.map((r) => r.score)) >= fiftieth, 'the picks are the 50 best bursts');

  // Demoted, not dropped: every other photo is still in the list for review.
  assert.equal(out.length, suggestions.length);
  assert.ok(out.filter((r) => !accepted.includes(r)).every((r) => r.decision !== 'reject'));
});

test('[GP-05] Auto-cull never auto-rejects: uncertain, flat, soft, dark and malformed photos stay for review', () => {
  const certain = new Set(['keep']);
  const results: { label: string; r: Pick<CullSuggestion, 'decision' | 'confidence'> }[] = [];
  const shares = [0, 0.02, 0.2, 0.5, 0.97, 0.99, 1];
  for (const detail of [0, 0.5, 1.9, 2, 3.9, 4, 8, 11.9, 12, 40, 5000]) {
    for (const dark of shares) for (const bright of shares) {
      if (dark + bright > 1.000001) continue;
      results.push({ label: `preview detail=${detail} dark=${dark} bright=${bright}`, r: judgePreview('f', { detail, dark, bright }) });
    }
  }
  const malformed = [null, { detail: NaN, dark: 0, bright: 0 }, { detail: -1, dark: 0, bright: 0 }, { detail: 5, dark: 2, bright: 0 }, { detail: 5, dark: 0.7, bright: 0.7 }, { detail: Infinity, dark: 0, bright: 0 }];
  for (const m of malformed) results.push({ label: `preview ${JSON.stringify(m)}`, r: judgePreview('f', m as never) });

  const subjects: (SubjectFinding | null)[] = [null];
  for (const score of [0, 0.3, 0.45, 0.5, 0.7, 1]) for (const size of [10, 119, 120, 4000]) for (const sharpness of [0, 3, 8, 13.9, 14, 30]) subjects.push({ label: 'bird', score, size, sharpness });
  subjects.push({ label: '', score: 0.9, size: 500, sharpness: 20 }, { label: 'unknown', score: 0.9, size: 500, sharpness: 20 }, { label: 'bird', score: NaN, size: 500, sharpness: 20 }, { label: 'bird', score: 0.9, size: 0.5, sharpness: 20 });
  for (const s of subjects) results.push({ label: `subject ${JSON.stringify(s)}`, r: judgeSubject(s) });

  assert.ok(results.length > 400);
  for (const { label, r } of results) {
    assert.ok(r.decision === 'keep' || r.decision === null, `${label} gave ${String(r.decision)}: Auto-cull may keep or ask, never reject`);
    if (r.decision === null) assert.equal(r.confidence, 'low', `${label}: an undecided photo is low confidence, for review`);
    if (certain.has(String(r.decision))) assert.ok(r.confidence === 'high' || r.confidence === 'medium', label);
  }
  // A blurry, flat or unreadable photo specifically is undecided, not rejected.
  assert.equal(judgePreview('f', { detail: 0.5, dark: 0.1, bright: 0.1 }).decision, null);
  assert.equal(judgePreview('f', null).decision, null);
});
