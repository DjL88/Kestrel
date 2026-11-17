import assert from 'node:assert/strict';
import test from 'node:test';
import { fitScale } from './exportLimits';

test('Nikon Z8-class preview dimensions stay inside mobile canvas limit', () => {
  const limit = 16_777_216;
  const scale = fitScale(8256, 5504, limit);
  assert.ok(scale > 0 && scale < 1);
  assert.ok(Math.round(8256 * scale) * Math.round(5504 * scale) <= limit);
  assert.equal(fitScale(4000, 3000, limit), 1);
});

test('invalid decoder dimensions never bypass preview canvas limits', () => {
  for (const dimensions of [
    [0, 5504, 16_777_216], [-1, 5504, 16_777_216],
    [Number.NaN, 5504, 16_777_216], [Infinity, 5504, 16_777_216],
    [8256, Number.NaN, 16_777_216], [8256, Infinity, 16_777_216],
    [8256, 5504, 0], [8256, 5504, Infinity],
    [Number.MAX_SAFE_INTEGER, 5504, 16_777_216],
  ]) {
    assert.throws(() => fitScale(...dimensions as [number, number, number]), RangeError);
  }
});
