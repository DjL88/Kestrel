import assert from 'node:assert/strict';
import test from 'node:test';
import { readFormatSplits, toggleFormatSplit, isFormatSplit, setFormatSplitOffset, formatSplitOffset } from './formatSplitOps.ts';

test('split selected A4 only, not Original or Instagram', () => {
  const splits = toggleFormatSplit(undefined, 'custom-a4p');
  assert.equal(isFormatSplit(splits, 'custom-a4p'), true);
  assert.equal(isFormatSplit(splits, 'orig-3x2'), false);
  assert.equal(isFormatSplit(splits, 'ig-portrait'), false);
});
test('two chosen formats may split independently and rejoin one without touching another', () => {
  const both = toggleFormatSplit(toggleFormatSplit(null, 'orig-3x2'), 'custom-a4p');
  const one = toggleFormatSplit(both, 'orig-3x2');
  assert.equal(isFormatSplit(one, 'orig-3x2'), false);
  assert.equal(isFormatSplit(one, 'custom-a4p'), true);
});
test('split offset is saved only for that format', () => {
  const original = toggleFormatSplit(toggleFormatSplit(null, 'orig-3x2'), 'custom-a4p');
  const moved = setFormatSplitOffset(original, 'custom-a4p', 10);
  assert.equal(formatSplitOffset(moved, 'custom-a4p'), 10);
  assert.equal(formatSplitOffset(moved, 'orig-3x2'), 0);
  assert.equal(formatSplitOffset(JSON.parse(JSON.stringify(moved)), 'custom-a4p'), 10);
});
test('malformed state cannot create hidden splits or runaway offsets', () => {
  assert.deepEqual(readFormatSplits({ foo: { enabled: 'true' }, '../invalid': {enabled:true}, good: { enabled: true, offset: 999 } }), {good: {enabled:true,offset:25}});
  assert.equal(formatSplitOffset(setFormatSplitOffset({good: {enabled: true,offset:0}}, 'good', Infinity), 'good'), 0);
});
