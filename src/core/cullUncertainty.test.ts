import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryUncertainty, wilson95, type CategorySample } from './cullUncertainty';

test('no trials means unavailable, not zero or perfect confidence', () => {
  assert.deepEqual(wilson95(0, 0), {
    successes: 0, trials: 0, estimate: null, lower: null, upper: null, confidenceLevel: 0.95,
  });
});
test('one favourite retained is not evidence of certain recall', () => {
  const interval = wilson95(1, 1);
  assert.equal(interval.estimate, 1);
  assert.ok(interval.lower! < 0.3);
  assert.equal(interval.upper, 1);
});
test('zero successes are not proof of zero true performance', () => {
  const interval = wilson95(0, 10);
  assert.equal(interval.estimate, 0);
  assert.equal(interval.lower, 0);
  assert.ok(interval.upper! > 0.2);
});
test('symmetric 50/100 interval is centred and bounded', () => {
  const interval = wilson95(50, 100);
  assert.ok(Math.abs(interval.lower! - 0.4038) < 0.002);
  assert.ok(Math.abs(interval.upper! - 0.5962) < 0.002);
});
test('500 independent trials narrow the uncertainty versus 10', () => {
  const small = wilson95(9, 10);
  const large = wilson95(450, 500);
  assert.ok(large.upper! - large.lower! < small.upper! - small.lower!);
});
test('invalid and non-finite counts fail closed', () => {
  for (const [s, n] of [[-1, 10], [11, 10], [1.2, 10], [1, NaN], [Infinity, Infinity], [1, -1]]) {
    assert.throws(() => wilson95(s, n), /Invalid binomial sample counts/);
  }
});
const categories = ['birds', 'aircraft', 'people', 'mammals', 'landscapes'] as const;
const samples: CategorySample[] = categories.map((category) => ({
  category, favourites: 20, retainedFavourites: 19, autoKeeps: 20, correctAutoKeeps: 16,
}));
test('all five subject categories have independent confidence intervals', () => {
  const report = categoryUncertainty(samples);
  assert.equal(report.length, 5);
  for (const category of report) {
    assert.equal(category.recall.estimate, 0.95);
    assert.equal(category.autoKeepPrecision.estimate, 0.8);
    assert.ok(category.recall.lower! < 0.95);
  }
});
test('missing auto-Keep evidence is unavailable rather than perfect precision', () => {
  const report = categoryUncertainty([{ ...samples[0], autoKeeps: 0, correctAutoKeeps: 0 }]);
  assert.equal(report[0].autoKeepPrecision.estimate, null);
});
test('duplicate and invalid categories cannot silently double-count', () => {
  assert.throws(() => categoryUncertainty([samples[0], samples[0]]), /Duplicate/);
  assert.throws(() => categoryUncertainty([{ ...samples[0], category: 'unknown' as CategorySample['category'] }]), /Invalid subject/);
});
test('invalid category numerators fail independently', () => {
  assert.throws(() => categoryUncertainty([{ ...samples[0], retainedFavourites: 21 }]), /Invalid binomial/);
  assert.throws(() => categoryUncertainty([{ ...samples[0], correctAutoKeeps: 21 }]), /Invalid binomial/);
});
