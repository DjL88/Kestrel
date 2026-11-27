import test from 'node:test';
import assert from 'node:assert/strict';
import { TIP_TIMES, readTips, tipDue, tipShown, tipsAgain, writeTips } from './canvasTips.ts';

const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };

test('a tip shows the first few times, then stays away; Show canvas tips brings it back', () => {
  let state = readTips(memory());
  for (let i = 0; i < TIP_TIMES; i += 1) { assert.equal(tipDue(state, 'view'), true); state = tipShown(state, 'view'); }
  assert.equal(tipDue(state, 'view'), false);
  assert.equal(tipDue(state, 'crop'), true, 'each tip counts on its own');
  state = tipsAgain();
  assert.equal(tipDue(state, 'view'), true);
});

test('tips are kept on this device, and a damaged entry starts fresh', () => {
  const store = memory();
  writeTips(store, tipShown(tipShown(readTips(store), 'crop'), 'crop'));
  assert.deepEqual(readTips(store).seen, { crop: 2 });
  store.setItem('inflight.v2.canvasTips', '{not json');
  assert.deepEqual(readTips(store), { on: true, seen: {} });
  store.setItem('inflight.v2.canvasTips', JSON.stringify({ on: false, seen: { view: -4, crop: 'x' } }));
  assert.deepEqual(readTips(store), { on: false, seen: {} });
  assert.equal(readTips(null).on, true);
});
