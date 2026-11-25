import assert from 'node:assert/strict';
import test from 'node:test';
import { describeGuardianReport, prepareGuardianCases, scoreGuardian, type GuardianLabel } from './guardianBenchmark.ts';
import { guardianQuestionText } from './visionGuardian.ts';

// Synthetic labels only: no photos are read here.
const labels: GuardianLabel[] = [
  { id: 'a', image: 'a.jpg', subject: 'bird', species: 'Robin', mask: 'a-mask.png' },
  { id: 'b', image: 'b.jpg', subject: 'aircraft', mask: 'b-mask.png' },
  { id: 'c', image: 'c.jpg', subject: 'bird', species: 'Wren' },
  { id: 'd', image: 'd.jpg', natural: false },
];

test('every check gets a right claim and a wrong claim, in the words the app asks', () => {
  const cases = prepareGuardianCases(labels);
  const ids = cases.map((item) => item.id);
  assert.deepEqual(ids, ['a:subject-right', 'a:subject-wrong', 'a:mask-whole', 'a:mask-cut', 'a:species-right', 'a:species-wrong',
    'b:subject-right', 'b:subject-wrong', 'b:mask-whole', 'b:mask-cut', 'c:species-right', 'c:species-wrong', 'd:edit']);
  const byId = Object.fromEntries(cases.map((item) => [item.id, item]));
  assert.equal(byId['a:subject-wrong'].question, guardianQuestionText('subjectFound', 'aircraft'));
  assert.equal(byId['a:subject-wrong'].claimRight, false);
  assert.equal(byId['a:mask-cut'].maskVariant, 'cut');
  assert.equal(byId['a:mask-cut'].claimRight, false);
  assert.equal(byId['a:species-wrong'].question, guardianQuestionText('speciesPlausible', 'Wren'));
  assert.equal(byId['d:edit'].claimRight, false);
  assert.equal(byId['c:species-right'].mask, undefined);
});

test('bad labels are refused rather than measured', () => {
  assert.throws(() => prepareGuardianCases([{ id: 'x', image: 'x.jpg' }, { id: 'x', image: 'y.jpg' }]), /own id/);
  assert.throws(() => prepareGuardianCases([{ id: 'x', image: '' }]), /image/);
  assert.throws(() => prepareGuardianCases([{ id: 'x', image: 'x.jpg', mask: 'm.png' }]), /subject word/);
});

test('scores catches, needless holds and doubt the way the app reads answers', () => {
  const cases = prepareGuardianCases(labels);
  const answers = [
    { id: 'a:mask-whole', text: 'Yes.', ms: 900 }, { id: 'a:mask-cut', text: 'No, the head is dark.', ms: 1100 },
    { id: 'b:mask-whole', text: 'No.', ms: 1000 }, { id: 'b:mask-cut', text: 'Yes', ms: 1200 },
    { id: 'a:species-right', text: 'yes' }, { id: 'a:species-wrong', text: 'Yes, but it is small' },
    { id: 'c:species-right', text: 'yes' }, { id: 'c:species-wrong', text: 'no' },
    { id: 'd:edit', text: 'no' }, { id: 'd:edit', text: 'yes' }, { id: 'zzz', text: 'yes' },
  ];
  const report = scoreGuardian(cases, answers);
  assert.equal(report.neverUpgraded, true);
  assert.equal(report.unexpectedAnswers, 1);
  const mask = report.checks.find((item) => item.check === 'maskComplete')!;
  assert.deepEqual([mask.heldWrong, mask.passedWrong, mask.heldRight, mask.catchRate, mask.needlessHoldRate], [1, 1, 1, 0.5, 0.5]);
  assert.equal(mask.tooFewToJudge, true);
  const species = report.checks.find((item) => item.check === 'speciesPlausible')!;
  assert.deepEqual([species.heldWrong, species.unsure, species.catchRate, species.needlessHoldRate], [1, 1, 1, 0]);
  const edit = report.checks.find((item) => item.check === 'editNatural')!;
  assert.equal(edit.missing, 1, 'a duplicated answer counts as no answer');
  const subject = report.checks.find((item) => item.check === 'subjectFound')!;
  assert.equal(subject.missing, 4);
  assert.equal(subject.catchRate, null);
  assert.equal(report.medianMs, 1000);
  assert.match(describeGuardianReport(report), /Never upgraded a result: PASS/);
});
