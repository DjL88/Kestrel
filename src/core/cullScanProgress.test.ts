import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceCullScan, beginCullScan, endCullScan } from './cullScanProgress';

test('individual photos are queued and advance independently', () => {
  const first = beginCullScan('birds', 3, ['bird', 'jet', 'unknown']);
  assert.deepEqual({ ...first.stages }, { bird: 'queued', jet: 'queued', unknown: 'queued' });
  const checking = advanceCullScan(first, 'birds', 3, 'jet', 'analysing')!;
  assert.equal(checking.stages.jet, 'analysing');
  assert.equal(checking.stages.bird, 'queued');
  const done = advanceCullScan(checking, 'birds', 3, 'jet', 'analysed')!;
  assert.equal(done.stages.jet, 'analysed');
  assert.equal(done.stages.unknown, 'queued');
  assert.equal(first.stages.jet, 'queued', 'the previous state is unchanged');
});

test('a damaged preview records unavailable without inventing a cull score', () => {
  const state = beginCullScan('birds', 1, ['bad']);
  const opened = advanceCullScan(state, 'birds', 1, 'bad', 'analysing')!;
  const unavailable = advanceCullScan(opened, 'birds', 1, 'bad', 'unavailable')!;
  assert.equal(unavailable.stages.bad, 'unavailable');
  assert.deepEqual(Object.keys(unavailable.stages), ['bad']);
  assert.strictEqual(advanceCullScan(unavailable, 'birds', 1, 'bad', 'analysed'), unavailable);
});

test('stale project and older run callbacks cannot paint a reopened photo', () => {
  const next = beginCullScan('birds', 22, ['same-id']);
  assert.strictEqual(advanceCullScan(next, 'birds', 21, 'same-id', 'analysing'), next);
  assert.strictEqual(advanceCullScan(next, 'other', 22, 'same-id', 'analysing'), next);
  assert.strictEqual(endCullScan(next, 'birds', 21), next);
  assert.strictEqual(endCullScan(next, 'other', 22), next);
  assert.strictEqual(endCullScan(next, 'birds', 22), null);
});

test('unknown photos and out-of-order callbacks cannot overwrite recorded stages', () => {
  const initial = beginCullScan('birds', 5, ['a', 'b']);
  assert.strictEqual(advanceCullScan(initial, 'birds', 5, 'missing', 'analysing'), initial);
  assert.strictEqual(advanceCullScan(initial, 'birds', 5, 'a', 'analysed'), initial);
  const running = advanceCullScan(initial, 'birds', 5, 'a', 'analysing')!;
  assert.strictEqual(advanceCullScan(running, 'birds', 5, 'a', 'analysing'), running);
  const finished = advanceCullScan(running, 'birds', 5, 'a', 'analysed')!;
  assert.strictEqual(advanceCullScan(finished, 'birds', 5, 'a', 'analysing'), finished);
});

test('prototype-pollution-like file IDs remain plain photo keys', () => {
  const scan = beginCullScan('birds', 1, ['__proto__', 'constructor']);
  const next = advanceCullScan(scan, 'birds', 1, '__proto__', 'analysing')!;
  assert.equal(next.stages.__proto__, 'analysing');
  assert.equal(Object.getPrototypeOf(scan.stages), null);
  assert.strictEqual(advanceCullScan(next, 'birds', 1, 'toString', 'analysing'), next);
});
