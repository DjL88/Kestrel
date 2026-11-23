import assert from 'node:assert/strict';
import test from 'node:test';
import { readFormatSplits, toggleFormatSplit, isFormatSplit, setFormatSplitOffset, formatSplitOffset, splitFrameCount, setSplitFrameCount } from './formatSplitOps.ts';

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

test('three-frame selection survives serialisation and keeps existing format offsets', () => {
  const split = setSplitFrameCount(toggleFormatSplit(undefined, 'custom-a4p'), 'custom-a4p', 3);
  assert.equal(splitFrameCount(split, 'custom-a4p'), 3);
  const moved = setFormatSplitOffset(split, 'custom-a4p', 12);
  assert.equal(splitFrameCount(JSON.parse(JSON.stringify(moved)), 'custom-a4p'), 3);
  assert.equal(formatSplitOffset(moved, 'custom-a4p'), 12);
  assert.equal(splitFrameCount(moved, 'orig-3x2'), 1);
  const two = setSplitFrameCount(moved, 'custom-a4p', 2);
  assert.equal(splitFrameCount(two, 'custom-a4p'), 2);
  assert.equal('count' in two['custom-a4p'], false);
  assert.equal(splitFrameCount(setSplitFrameCount(two, 'custom-a4p', 1), 'custom-a4p'), 1);
});
test('legacy splits stay two-frame and malformed counts cannot create extra frames', () => {
  assert.equal(splitFrameCount({ print: { enabled: true, offset: 0 } }, 'print'), 2);
  assert.equal(splitFrameCount({ print: { enabled: true, count: 99, offset: 0 } }, 'print'), 2);
  assert.equal(splitFrameCount({ print: { enabled: true, count: '3', offset: 0 } }, 'print'), 2);
  assert.deepEqual(setSplitFrameCount({ print: { enabled: true, offset: 0 } }, '../bad', 3), { print: { enabled: true, offset: 0 } });
});
