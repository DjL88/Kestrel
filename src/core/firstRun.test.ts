import assert from 'node:assert/strict';
import test from 'node:test';
import { markWelcomeSeen, welcomeSeen, WELCOME_SEEN_KEY } from './firstRun';

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

test('the welcome shows until it has been dismissed once, then never again', () => {
  const storage = memory();
  assert.equal(welcomeSeen(storage), false);
  assert.equal(markWelcomeSeen(storage), true);
  assert.equal(storage.getItem(WELCOME_SEEN_KEY), '1');
  assert.equal(welcomeSeen(storage), true);
});

test('storage that refuses (a private window) still shows the welcome and does not throw', () => {
  const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(welcomeSeen(refusing), false);
  assert.equal(markWelcomeSeen(refusing), false);
  assert.equal(welcomeSeen(null), false);
  assert.equal(markWelcomeSeen(undefined), false);
});
