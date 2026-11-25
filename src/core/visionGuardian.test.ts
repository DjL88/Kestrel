import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDIAN_QUESTIONS, guardResult, readGuardianAnswer } from './visionGuardian.ts';

test('a plain yes agrees, a plain no disagrees, and anything hedged or empty is unsure', () => {
  assert.equal(readGuardianAnswer('Yes.'), 'agrees');
  assert.equal(readGuardianAnswer('yes, the colours look natural'), 'agrees');
  assert.equal(readGuardianAnswer('No, the sky has a halo.'), 'disagrees');
  assert.equal(readGuardianAnswer('Yes, but the sky looks a little too blue.'), 'unsure');
  assert.equal(readGuardianAnswer('Not sure.'), 'unsure');
  assert.equal(readGuardianAnswer('Nobody can tell'), 'unsure');
  assert.equal(readGuardianAnswer(''), 'unsure');
  assert.equal(readGuardianAnswer(undefined), 'unsure');
});

test('the guardian can hold a result for review but never upgrades one', () => {
  const disagree = { source: 'on-device' as const, verdict: 'disagrees' as const, question: 'editNatural' as const };
  const agree = { ...disagree, verdict: 'agrees' as const };
  const unsure = { ...disagree, verdict: 'unsure' as const };
  assert.deepEqual(guardResult('apply', [disagree]).status, 'needs-review');
  assert.equal(guardResult('suggest', [disagree]).status, 'needs-review');
  assert.equal(guardResult('apply', [agree]).status, 'apply');
  assert.equal(guardResult('apply', [unsure]).status, 'apply', 'silence or doubt changes nothing');
  assert.equal(guardResult('needs-review', [agree, agree]).status, 'needs-review', 'agreement never upgrades');
  assert.equal(guardResult('suggest', [agree]).status, 'suggest');
  assert.equal(guardResult('apply', []).status, 'apply');
  const held = guardResult('apply', [agree, disagree]);
  assert.equal(held.status, 'needs-review', 'one disagreement is enough');
  assert.equal(held.heldBy.length, 1);
});

test('questions are short, plain ASCII so the on-device model accepts them', () => {
  for (const question of Object.values(GUARDIAN_QUESTIONS)) assert.match(question, /^[\x20-\x7e]{1,400}$/);
  assert.match(GUARDIAN_QUESTIONS.editNatural, /yes or no/i);
});
