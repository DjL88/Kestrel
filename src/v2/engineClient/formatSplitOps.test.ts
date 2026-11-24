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

test('a format can be split across four or five frames, and the count survives saving', () => {
  const five = setSplitFrameCount(undefined, 'orig-3x2', 5);
  assert.equal(splitFrameCount(JSON.parse(JSON.stringify(five)), 'orig-3x2'), 5);
  assert.equal(splitFrameCount(setSplitFrameCount(five, 'orig-3x2', 4), 'orig-3x2'), 4);
  // Six or more is refused rather than silently clamped.
  assert.deepEqual(setSplitFrameCount(five, 'orig-3x2', 6 as never), five);
  assert.equal(splitFrameCount({ 'orig-3x2': { enabled: true, offset: 0, count: 9 } }, 'orig-3x2'), 2);
});

test('removing a frame keeps the saved offset, and removing one of two rejoins the format', () => {
  let splits = setFormatSplitOffset(setSplitFrameCount(undefined, 'ig-portrait', 5), 'ig-portrait', -8);
  splits = setSplitFrameCount(splits, 'ig-portrait', 4);
  assert.equal(splitFrameCount(splits, 'ig-portrait'), 4);
  assert.equal(formatSplitOffset(splits, 'ig-portrait'), -8);
  assert.deepEqual(setSplitFrameCount(setSplitFrameCount(splits, 'ig-portrait', 2), 'ig-portrait', 1), {});
});

test('all 40 format layouts survive persistence, including the last selected split', () => {
  let raw = {};
  for (let i = 0; i < 40; i++) raw = setSplitFrameCount(raw, 'format-' + i, 5);
  const reopened = readFormatSplits(JSON.parse(JSON.stringify(raw)));
  assert.equal(Object.keys(reopened).length, 40);
  assert.equal(splitFrameCount(reopened, 'format-39'), 5);
});
test('inherited object property names cannot appear as saved split formats', () => {
  for (const id of ['__proto__', 'constructor', 'toString']) {
    assert.equal(splitFrameCount({}, id), 1);
    assert.deepEqual(setSplitFrameCount({}, id, 3), {});
    assert.deepEqual(setFormatSplitOffset({}, id, 10), {});
  }
});
