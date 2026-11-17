import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRUEDETAIL, trueDetailAvailable, trueDetailCopy, trueDetailReleased,
  type TrueDetailCapability,
} from './trueDetail.ts';

test('TrueDetail is part of Paid, not a separate licence', () => {
  assert.equal(TRUEDETAIL.tier, 'paid');
  assert.equal(TRUEDETAIL.tagline, 'See the detail. Keep it real.');
});

test('unfinished TrueDetail capability never appears available, even to Paid users', () => {
  for (const feature of Object.keys(TRUEDETAIL.capabilities) as TrueDetailCapability[]) {
    assert.equal(trueDetailReleased(feature), false, feature);
    assert.equal(trueDetailAvailable(feature, true), false, feature);
    assert.equal(trueDetailAvailable(feature, false), false, feature);
    assert.match(trueDetailCopy(feature), /in development/);
  }
});

test('catalogue provides stable named RAW, AI, Select and Batch capabilities', () => {
  assert.deepEqual(Object.keys(TRUEDETAIL.capabilities), ['raw', 'ai', 'select', 'batch']);
  assert.equal(TRUEDETAIL.capabilities.raw.name, 'TrueDetail RAW');
  assert.equal(TRUEDETAIL.capabilities.ai.name, 'TrueDetail AI');
});
