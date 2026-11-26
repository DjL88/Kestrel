import test from 'node:test';
import assert from 'node:assert/strict';
import { FlatAllowance, MemoryUsageMeter, RolloverAllowance, millicreditsForBytes } from '../src/usageMeter.ts';

const GB = 1_000_000_000;
const oct = Date.UTC(2026, 9, 10), nov = Date.UTC(2026, 10, 3), dec = Date.UTC(2026, 11, 1), feb = Date.UTC(2027, 1, 1);

test("last month's unused free downloads carry over, once, and an overspent month carries nothing", async () => {
  const meter = new MemoryUsageMeter();
  const allowance = new RolloverAllowance(new FlatAllowance(33_000), meter); // 1 GB a month
  assert.equal(await allowance.monthlyMillicredits('a1', oct), 66_000, 'a new account had nothing used last month: the full 1 GB carries');
  assert.equal(await meter.reserve('a1', oct, GB / 4, 66_000), true);
  assert.equal(await allowance.monthlyMillicredits('a1', nov), 33_000 + 33_000 - millicreditsForBytes(GB / 4));
  assert.equal(await meter.reserve('a1', nov, 2 * GB, Number.MAX_SAFE_INTEGER), true, 'November goes over (paid from the balance)');
  assert.equal(await allowance.monthlyMillicredits('a1', dec), 33_000, 'nothing carries from a month that used it all');
  assert.equal(await allowance.monthlyMillicredits('a1', feb), 66_000, 'only one month carries, never more');
});
