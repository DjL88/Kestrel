import assert from 'node:assert/strict';
import test from 'node:test';
import type { GuardianOpinion } from '../../core/visionGuardian';
import { v2Text } from '../../i18n/areas/v2';
import { guardianHolds, guardianNote, guardianOrder, guardianSettled, startGuardian, withOpinion } from './assistGuardian';

const preferred = { exposure: 0.3 };
const candidates = [
  { id: 'natural', edit: { exposure: 0.1 } },
  { id: 'balanced', edit: preferred },
  { id: 'subject', edit: { exposure: 0.5 } },
];
const says = (verdict: GuardianOpinion['verdict']): GuardianOpinion => ({ source: 'on-device', verdict, question: 'editNatural' });

test('Auto\'s own pick is asked first, then the others in Co-pilot order', () => {
  assert.deepEqual(guardianOrder(candidates, preferred).map((c) => c.id), ['balanced', 'natural', 'subject']);
  assert.deepEqual(guardianOrder(candidates, { exposure: 9 }).map((c) => c.id), ['natural', 'balanced', 'subject']);
});

test('with no model nothing waits and nothing is held', () => {
  const guardian = startGuardian(candidates, false);
  assert.deepEqual(guardian.pending, []);
  for (const { id } of candidates) {
    assert.equal(guardianSettled(guardian, id), true);
    assert.equal(guardianHolds(guardian, id), false);
    assert.equal(guardianNote(guardian, id), undefined);
  }
});

test('a suggestion waits for its answer, and no answer settles it without holding', () => {
  let guardian = startGuardian(guardianOrder(candidates, preferred), true);
  assert.equal(guardianSettled(guardian, 'balanced'), false);
  guardian = withOpinion(guardian, 'balanced', null);
  assert.equal(guardianSettled(guardian, 'balanced'), true);
  assert.equal(guardianHolds(guardian, 'balanced'), false);
  assert.equal(guardianSettled(guardian, 'natural'), false);
});

test('only a clear "no" holds an automatic apply and adds a line; yes and unsure add nothing', () => {
  let guardian = startGuardian(candidates, true);
  guardian = withOpinion(guardian, 'natural', says('agrees'));
  guardian = withOpinion(guardian, 'balanced', says('disagrees'));
  guardian = withOpinion(guardian, 'subject', says('unsure'));
  assert.deepEqual(guardian.pending, []);
  assert.equal(guardianHolds(guardian, 'natural'), false);
  assert.equal(guardianHolds(guardian, 'subject'), false);
  assert.equal(guardianHolds(guardian, 'balanced'), true);
  assert.equal(guardianNote(guardian, 'natural'), undefined);
  assert.equal(guardianNote(guardian, 'subject'), undefined);
  // Not a colour-only cue: a label and a sentence, shown with the ▲ marker by ColourSenseLine.
  assert.deepEqual(guardianNote(guardian, 'balanced'), { kept: false, label: v2Text.guardian.secondOpinion, text: v2Text.guardian.suggestionDoubted });
});

test('assists from before the guardian count as settled and are never held', () => {
  assert.equal(guardianSettled(undefined, 'natural'), true);
  assert.equal(guardianHolds(undefined, 'natural'), false);
});
