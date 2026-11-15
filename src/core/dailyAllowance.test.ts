import assert from 'node:assert/strict';
import test from 'node:test';
import { dayKey, parseUsage, recordUse, remainingToday } from './dailyAllowance.ts';

const morning = new Date(2026, 10, 15, 9, 0), night = new Date(2026, 10, 15, 23, 59), nextDay = new Date(2026, 10, 16, 0, 1);

test('the full allowance is there until something is used', () => {
  assert.equal(remainingToday(null, morning, 10), 10);
});

test('use is counted within the local day and resets on the next', () => {
  const used = recordUse(recordUse(null, morning, 4), night, 3);
  assert.equal(used.count, 7);
  assert.equal(remainingToday(used, night, 10), 3);
  assert.equal(remainingToday(used, nextDay, 10), 10);
  assert.equal(recordUse(used, nextDay, 2).count, 2);
});

test('the allowance never goes below zero', () => {
  assert.equal(remainingToday({ day: dayKey(morning), count: 25 }, morning, 10), 0);
});

test('damaged saved data is treated as nothing used', () => {
  assert.equal(parseUsage('{bad'), null);
  assert.equal(parseUsage(JSON.stringify({ day: 'today', count: 1 })), null);
  assert.equal(parseUsage(JSON.stringify({ day: '2026-11-15', count: -3 })), null);
  assert.deepEqual(parseUsage(JSON.stringify({ day: '2026-11-15', count: 3 })), { day: '2026-11-15', count: 3 });
});
