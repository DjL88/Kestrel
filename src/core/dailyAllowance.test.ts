import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailyAllowance, dayKey, parseUsage, recordUse, remainingToday, type DailyUsage } from './dailyAllowance.ts';

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

test('overlapping exports reserve capacity and only committed files consume it', () => {
  let usage: DailyUsage | null = null;
  const allowance = createDailyAllowance(10, () => usage, value => { usage = value; }, () => morning);
  const first = allowance.reserve(7);
  assert.ok('settle' in first);
  assert.deepEqual(allowance.reserve(4), { left: 3 });
  const second = allowance.reserve(3);
  assert.ok('settle' in second);
  first.settle(2);
  first.settle(5);
  second.settle(0);
  assert.deepEqual(usage, { day: dayKey(morning), count: 2 });
  assert.deepEqual(allowance.reserve(9), { left: 8 });
  assert.ok('settle' in allowance.reserve(8));
});

test('a batch from yesterday does not consume the new local day allowance', () => {
  let date = night;
  let usage: DailyUsage | null = null;
  const allowance = createDailyAllowance(10, () => usage, value => { usage = value; }, () => date);
  const first = allowance.reserve(10);
  assert.ok('settle' in first);
  date = nextDay;
  const second = allowance.reserve(10);
  assert.ok('settle' in second);
  second.settle(3);
  first.settle(10);
  assert.deepEqual(usage, { day: dayKey(nextDay), count: 3 });
});
