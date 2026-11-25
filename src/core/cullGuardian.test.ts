import assert from 'node:assert/strict';
import test from 'node:test';
import type { CullSuggestion } from './autoCull.ts';
import { holdDoubtedKeeps, keepsToGuard } from './cullGuardian.ts';
import { GUARDIAN_QUESTIONS, type GuardianOpinion } from './visionGuardian.ts';

const r = (frameId: string, decision: CullSuggestion['decision'], confidence: CullSuggestion['confidence'], score: number): CullSuggestion =>
  ({ frameId, decision, confidence, score, reason: decision === 'keep' ? 'subjectSharp' : 'subjectSoft' });
const say = (verdict: GuardianOpinion['verdict']): GuardianOpinion => ({ source: 'on-device', verdict, question: 'subjectClear' });

test('only confident keeps are asked about, strongest first, and never more than the limit', () => {
  const results = [r('a', 'keep', 'high', 80), r('b', 'keep', 'medium', 90), r('c', null, 'low', 30), r('d', 'keep', 'high', 95), r('e', 'keep', 'high', 70)];
  assert.deepEqual(keepsToGuard(results, 10), ['d', 'a', 'e']);
  assert.deepEqual(keepsToGuard(results, 2), ['d', 'a']);
  assert.deepEqual(keepsToGuard(results, 0), []);
});

test('a clear "no" holds a confident keep for review; agreement, doubt and silence change nothing; nothing is ever rejected', () => {
  const results = [r('a', 'keep', 'high', 95), r('b', 'keep', 'high', 90), r('c', 'keep', 'high', 85), r('d', 'keep', 'high', 80), r('e', null, 'low', 30)];
  const opinions = new Map([['a', say('disagrees')], ['b', say('agrees')], ['c', say('unsure')], ['e', say('disagrees')]]);
  const { results: guarded, held } = holdDoubtedKeeps(results, opinions);
  assert.deepEqual(held, ['a']);
  assert.equal(guarded[0].confidence, 'medium', 'no longer applied automatically');
  assert.equal(guarded[0].decision, 'keep', 'still suggested as a keeper for the person to confirm');
  assert.deepEqual(guarded.slice(1), results.slice(1), 'agreement, doubt, no answer and non-keeps are untouched');
  assert.ok(guarded.every((result) => result.decision !== 'reject'));
});

test('the subject question is short plain ASCII the on-device model accepts', () => {
  assert.match(GUARDIAN_QUESTIONS.subjectClear, /^[\x20-\x7e]{1,400}$/);
  assert.match(GUARDIAN_QUESTIONS.subjectClear, /yes or no/i);
});
