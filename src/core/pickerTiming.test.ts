import assert from 'node:assert/strict';
import test from 'node:test';
import { pickerDurations } from './pickerTiming';

test('the app\'s share and the picker\'s share are told apart, in tenths of a second', () => {
  assert.deepEqual(pickerDurations({ clickedAt: 1000, askedAt: 1240, answeredAt: 62_300 }), { appSeconds: 0.2, pickerSeconds: 61.1 });
  assert.deepEqual(pickerDurations({ clickedAt: 0, askedAt: 60_400, answeredAt: 64_000 }), { appSeconds: 60.4, pickerSeconds: 3.6 });
});

test('times out of order or missing give no record rather than a wrong one', () => {
  assert.equal(pickerDurations({ clickedAt: 5000, askedAt: 4000, answeredAt: 6000 }), null);
  assert.equal(pickerDurations({ clickedAt: 0, askedAt: Number.NaN, answeredAt: 1 }), null);
});
