import assert from 'node:assert/strict';
import test from 'node:test';
import { readModelReady, readModelResult } from './modelSessionProtocol.ts';

test('a ready reply needs its input and output names; a bad load time is not recorded', () => {
  assert.deepEqual(readModelReady({ type: 'ready', loadMs: 12, inputNames: ['in'], outputNames: ['out'] }), { loadMs: 12, inputNames: ['in'], outputNames: ['out'] });
  assert.equal(readModelReady({ type: 'ready', loadMs: -1, inputNames: ['in'], outputNames: ['out'] }).loadMs, null);
  assert.throws(() => readModelReady({ type: 'ready', inputNames: [], outputNames: ['out'] }), /unexpected/);
  assert.throws(() => readModelReady({ type: 'error', message: 'bad model' }), /bad model/);
  assert.throws(() => readModelReady(null), /unexpected/);
});

test('a result needs every expected float32 output at its stated size', () => {
  const good = { type: 'result', runMs: 34, outputs: { out: { data: new Float32Array(6), dims: [1, 2, 3] } } };
  assert.equal(readModelResult(good, ['out']).outputs.out.data.length, 6);
  assert.equal(readModelResult(good, ['out']).runMs, 34);
  assert.equal(readModelResult({ ...good, runMs: Number.NaN }, ['out']).runMs, null, 'a nonsense time is not recorded');
  assert.throws(() => readModelResult(good, ['out', 'missing']), /unexpected/);
  assert.throws(() => readModelResult({ ...good, outputs: { out: { data: new Float32Array(5), dims: [1, 2, 3] } } }, ['out']), /unexpected/);
  assert.throws(() => readModelResult({ ...good, outputs: { out: { data: [0, 0], dims: [2] } } }, ['out']), /unexpected/);
  assert.throws(() => readModelResult({ ...good, outputs: { out: { data: new Float32Array(2), dims: [2.5] } } }, ['out']), /unexpected/);
  assert.throws(() => readModelResult({ type: 'error', id: 1, message: 'run failed' }, ['out']), /run failed/);
  assert.throws(() => readModelResult({ type: 'result' }, ['out']), /unexpected/);
});
