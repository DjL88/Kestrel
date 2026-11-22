import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadSeconds, cloudSeconds, jobCostGbp, parseRuns } from './model.mjs';

test('upload time scales with size and falls with speed', () => {
  assert.ok(Math.abs(uploadSeconds(25e6, 20) - 11) < 0.01); // 25 MB, 20 Mbit/s, +10%
  assert.ok(uploadSeconds(50e6, 20) > uploadSeconds(25e6, 20));
  assert.ok(uploadSeconds(25e6, 100) < uploadSeconds(25e6, 20));
});
test('cloud time is upload + queue + compute + download', () => {
  const t = cloudSeconds({ bytes: 25e6, resultBytes: 0, upMbit: 20, downMbit: 100, queueS: 3, computeS: 6 });
  assert.ok(Math.abs(t - (11 + 3 + 6)) < 0.01);
});
test('cost is compute plus egress', () => {
  assert.equal(jobCostGbp({ computeS: 10, resultBytes: 1e9, gbpPerComputeS: 0.001, gbpPerGbEgress: 0.1 }), 0.11);
});
test('parseRuns drops error rows', () => {
  assert.equal(parseRuns('{"file":"a","bytes":1}\n{"file":"b","error":"x"}\n').length, 1);
});
