import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoFrame } from './types';
import { compareNavigation } from './compareNavigation';

const frame = (id: string, removed = false): PhotoFrame =>
  ({ id, removedAt: removed ? 1 : undefined } as PhotoFrame);

test('Compare: 500 visible frames have 499 unique B candidates and exact end stops', () => {
  const frames = Array.from({ length: 500 }, (_, i) => frame(String(i)));
  const start = compareNavigation(frames, '0', '1');
  assert.deepEqual(start, { previous: null, next: '2', currentValid: true, referenceValid: true, available: 499 });
  const end = compareNavigation(frames, '0', '499');
  assert.deepEqual(end, { previous: '498', next: null, currentValid: true, referenceValid: true, available: 499 });
  for (let i = 1; i < 499; i++) {
    const nav = compareNavigation(frames, '0', String(i));
    assert.equal(nav.next, String(i + 1));
    assert.equal(nav.previous, i === 1 ? null : String(i - 1));
  }
});

test('Compare: removed, duplicated and reference frames never become B', () => {
  const frames = [frame('A'), frame('B', true), frame('C'), frame('C'), frame('A'), frame('D')];
  assert.deepEqual(compareNavigation(frames, 'A', 'C'), {
    previous: null, next: 'D', currentValid: true, referenceValid: true, available: 2,
  });
  assert.deepEqual(compareNavigation(frames, 'A', 'B'), {
    previous: null, next: 'C', currentValid: false, referenceValid: true, available: 2,
  });
  assert.deepEqual(compareNavigation(frames, 'A', 'A'), {
    previous: null, next: 'C', currentValid: false, referenceValid: true, available: 2,
  });
});

test('Compare: no visible alternative cannot navigate or act on stale B', () => {
  assert.deepEqual(compareNavigation([frame('A'), frame('B', true)], 'A', 'B'), {
    previous: null, next: null, currentValid: false, referenceValid: true, available: 0,
  });
  assert.deepEqual(compareNavigation([], null, null), {
    previous: null, next: null, currentValid: false, referenceValid: false, available: 0,
  });
});

test('Compare: filters do not silently substitute an excluded photo B', () => {
  const frames = [frame('A'), frame('D'), frame('F')];
  const nav = compareNavigation(frames, 'A', 'E');
  assert.equal(nav.currentValid, false);
  assert.equal(nav.next, 'D');
  assert.equal(nav.previous, null);
});

test('Compare: removed, filtered or absent A disables B navigation and decisions until reselected', () => {
  for (const reference of [frame('A', true), undefined]) {
    const frames = [frame('B'), frame('C'), ...(reference ? [reference] : [])];
    const nav = compareNavigation(frames, 'A', 'B');
    assert.equal(nav.referenceValid, false);
    assert.equal(nav.currentValid, false);
    assert.equal(nav.previous, null);
    assert.equal(nav.next, null);
    assert.equal(nav.available, 2);
  }
  const recovered = compareNavigation([frame('A'), frame('B'), frame('C')], 'A', 'B');
  assert.equal(recovered.referenceValid, true);
  assert.equal(recovered.currentValid, true);
  assert.equal(recovered.next, 'C');
});
