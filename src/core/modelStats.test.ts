import assert from 'node:assert/strict';
import test from 'node:test';
import { medianRunMs, modelStat, modelStatsVersion, recordModelLoad, recordModelRun, resetModelStats, subscribeModelStats } from './modelStats';

test('load and run times are kept per model; the speed is the median run; bad numbers are ignored', () => {
  resetModelStats();
  recordModelLoad('m', 120);
  for (const ms of [30, 10, 20, 1000]) recordModelRun('m', ms);
  recordModelRun('m', Number.NaN);
  recordModelRun('m', -5);
  const stat = modelStat('m')!;
  assert.equal(stat.loadMs, 120);
  assert.deepEqual(stat.runsMs, [30, 10, 20, 1000]);
  assert.equal(medianRunMs(stat), 25);
  assert.equal(medianRunMs(modelStat('never-run')), null);
});

test('only the last 20 runs are kept, and listeners hear every change', () => {
  resetModelStats();
  let heard = 0;
  const stop = subscribeModelStats(() => { heard += 1; });
  const before = modelStatsVersion();
  for (let i = 1; i <= 25; i += 1) recordModelRun('m', i);
  stop();
  recordModelRun('m', 99);
  assert.equal(modelStat('m')!.runsMs.length, 20);
  assert.equal(modelStat('m')!.runsMs[0], 7);
  assert.equal(heard, 25);
  assert.ok(modelStatsVersion() > before);
});
