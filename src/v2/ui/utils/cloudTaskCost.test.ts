import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudTaskCost } from './cloudTaskCost.ts';

const usage = { plan: 'plus' as const, photosUsed: 1840, storedBytes: 0, downloadedBytes: 0, balancePence: 500, nowMs: 0 };

test('a queued cloud task says how many monthly cloud photos it uses', () => {
  assert.equal(cloudTaskCost({ location: 'cloud', status: 'queued', total: 120 }, usage), 'Uses 120 of your monthly cloud photos (3,040 left after this)');
});

test('a running task counts only the photos still to do', () => {
  assert.equal(cloudTaskCost({ location: 'cloud', status: 'running', total: 120, done: 100 }, usage), 'Uses 20 of your monthly cloud photos (3,140 left after this)');
});

test('beyond the allowance it shows the charge, or that the device will do it', () => {
  assert.equal(cloudTaskCost({ location: 'cloud', status: 'queued', total: 4000 }, usage), '840 photos beyond your monthly allowance: £2.52 from your cloud balance');
  assert.equal(cloudTaskCost({ location: 'cloud', status: 'queued', total: 4000 }, { ...usage, balancePence: 100 }), 'Not enough cloud balance: this task will run on this device');
});

test('nothing for device tasks, finished tasks, unknown totals or when signed out', () => {
  assert.equal(cloudTaskCost({ location: 'local', status: 'queued', total: 10 }, usage), null);
  assert.equal(cloudTaskCost({ location: 'cloud', status: 'done', total: 10 }, usage), null);
  assert.equal(cloudTaskCost({ location: 'cloud', status: 'queued', total: null }, usage), null);
  assert.equal(cloudTaskCost({ location: 'cloud', status: 'queued', total: 10 }, undefined), null);
});
