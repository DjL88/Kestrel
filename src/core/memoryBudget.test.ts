import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceTier, memoryBudget, TIER_LIMITS } from './memoryBudget';

test('the tier follows reported memory; a phone is never "high"', () => {
  assert.equal(deviceTier({ memoryGB: 2, phone: false }).tier, 'low');
  assert.equal(deviceTier({ memoryGB: 4, phone: false }).tier, 'standard');
  assert.equal(deviceTier({ memoryGB: 8, phone: false }).tier, 'high');
  assert.equal(deviceTier({ memoryGB: 8, phone: true }).tier, 'standard');
  assert.equal(deviceTier({ memoryGB: 0.5, phone: true }).tier, 'low');
});

test('unknown memory: a phone is "low", anything else keeps the old numbers ("standard"), never "high"', () => {
  assert.deepEqual(deviceTier({ phone: true }), { tier: 'low', basis: 'unknown memory, phone' });
  assert.deepEqual(deviceTier({ phone: false }), { tier: 'standard', basis: 'unknown memory' });
  assert.equal(deviceTier({ memoryGB: Number.NaN, phone: false }).tier, 'standard');
  assert.equal(deviceTier({ memoryGB: 0, phone: false }).tier, 'standard');
  const standard = memoryBudget({ phone: false, cores: 16 });
  assert.equal(standard.fullPreviews, 24);
  assert.equal(standard.developedRaws, 8);
  assert.equal(standard.readAheadReach, 1);
  assert.equal(standard.readAheadHeld, 4);
});

test('culling workers: every core but one, held to the tier and to 4 on phones', () => {
  assert.equal(memoryBudget({ memoryGB: 8, cores: 16, phone: false }).cullWorkers, TIER_LIMITS.high.cullWorkers);
  assert.equal(memoryBudget({ memoryGB: 8, cores: 4, phone: false }).cullWorkers, 3);
  assert.equal(memoryBudget({ memoryGB: 8, cores: 8, phone: true }).cullWorkers, 4);
  assert.equal(memoryBudget({ cores: 8, phone: true }).cullWorkers, 2);
  assert.equal(memoryBudget({ memoryGB: 1, cores: 2, phone: true }).cullWorkers, 1);
});

test('every part shrinks or grows together: a smaller tier never gets more of anything', () => {
  const tiers = (['low', 'standard', 'high'] as const).map((tier) => TIER_LIMITS[tier]);
  for (const key of Object.keys(tiers[0]) as Array<keyof typeof tiers[0]>) {
    assert.ok(tiers[0][key] <= tiers[1][key] && tiers[1][key] <= tiers[2][key], key);
  }
});
