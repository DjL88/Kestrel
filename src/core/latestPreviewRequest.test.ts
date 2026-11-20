import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLatestPreviewRequest } from './latestPreviewRequest';

test('new crop or overlay request aborts the prior proof', () => {
  const gate = createLatestPreviewRequest();
  const first = gate.begin();
  assert.equal(gate.isCurrent(first), true);
  const next = gate.begin();
  assert.equal(first.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(next), true);
});
test('stale cleanup must not abort the newer request', () => {
  const gate = createLatestPreviewRequest();
  const before = gate.begin();
  const current = gate.begin();
  gate.cancel(before);
  assert.equal(current.aborted, false);
  assert.equal(gate.isCurrent(current), true);
});
test('unmounted renderer cannot publish a late proof', () => {
  const gate = createLatestPreviewRequest();
  const current = gate.begin();
  gate.cancel(current);
  assert.equal(current.aborted, true);
  assert.equal(gate.isCurrent(current), false);
});
test('late async completion from the previous recipe never becomes current', async () => {
  const gate = createLatestPreviewRequest();
  let publish: (() => void) | undefined;
  const first = gate.begin();
  const priorRender = new Promise<void>(resolve => { publish = resolve; }).then(() => gate.isCurrent(first));
  const latest = gate.begin();
  publish?.();
  assert.equal(await priorRender, false);
  assert.equal(gate.isCurrent(latest), true);
});
test('many fast slider updates retain only the most recent proof', () => {
  const gate = createLatestPreviewRequest();
  const signals = Array.from({ length: 500 }, () => gate.begin());
  assert.equal(signals.filter(signal => gate.isCurrent(signal)).length, 1);
  assert.equal(signals.filter(signal => signal.aborted).length, 499);
});
