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

test('subject, mask and species questions are plain ASCII yes/no questions about the claim', async () => {
  const { guardianQuestionText, GUARDIAN_CHECKS } = await import('./visionGuardian.ts');
  assert.equal(guardianQuestionText('subjectFound', 'Aircraft'), 'Is the bright area of this photograph an aircraft? Answer yes or no.');
  assert.equal(guardianQuestionText('maskComplete', 'bird'), 'Is the whole bird inside the bright area, with no part of it darkened? Answer yes or no.');
  assert.equal(guardianQuestionText('speciesPlausible', 'Grey Heron'), 'Is the animal in this photograph a grey heron? Answer yes or no.');
  assert.match(guardianQuestionText('speciesPlausible', 'Škoda "?"') ?? '', /a skoda\?/);
  assert.equal(guardianQuestionText('subjectFound', '  '), null, 'no claim, no question');
  for (const check of GUARDIAN_CHECKS) assert.match(guardianQuestionText(check, 'owl') ?? '', /^[\x20-\x7e]{1,400}$/);
});

test('the mask picture keeps the subject and darkens the rest, blended by the mask', async () => {
  const { darkenOutsideMask, MASK_OUTSIDE_BRIGHTNESS } = await import('./visionGuardian.ts');
  const rgba = new Uint8ClampedArray([200, 100, 40, 255, 200, 100, 40, 255, 200, 100, 40, 255]);
  darkenOutsideMask(rgba, new Float32Array([1, 0, 0.5]));
  assert.deepEqual([...rgba.slice(0, 4)], [200, 100, 40, 255], 'inside unchanged');
  assert.deepEqual([...rgba.slice(4, 7)], [200 * MASK_OUTSIDE_BRIGHTNESS, 100 * MASK_OUTSIDE_BRIGHTNESS, 40 * MASK_OUTSIDE_BRIGHTNESS]);
  assert.equal(rgba[7], 255, 'alpha untouched');
  assert.equal(rgba[8], Math.round(200 * (MASK_OUTSIDE_BRIGHTNESS + (1 - MASK_OUTSIDE_BRIGHTNESS) * 0.5)));
  assert.throws(() => darkenOutsideMask(new Uint8ClampedArray(8), new Float32Array(1)));
});
