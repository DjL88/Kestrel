import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DOUBLE_TAP_ACTION, DOUBLE_TAP_ACTION_KEY, readDoubleTapAction, writeDoubleTapAction } from './gestureSettings';

const memory = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; };

test('a double-tap zooms by default, as in the photo apps people already use', () => {
  assert.equal(DEFAULT_DOUBLE_TAP_ACTION, 'zoom');
  assert.equal(readDoubleTapAction(memory()), 'zoom');
});
test('a chosen action is remembered and read back; choosing the default clears the stored value', () => {
  const store = memory();
  writeDoubleTapAction('crop', store);
  assert.equal(readDoubleTapAction(store), 'crop');
  writeDoubleTapAction('off', store);
  assert.equal(readDoubleTapAction(store), 'off');
  writeDoubleTapAction('zoom', store);
  assert.equal(store.data.has(DOUBLE_TAP_ACTION_KEY), false);
});
test('an unknown stored value, or storage that throws, falls back to the default', () => {
  const store = memory();
  store.data.set(DOUBLE_TAP_ACTION_KEY, 'spin');
  assert.equal(readDoubleTapAction(store), 'zoom');
  assert.equal(readDoubleTapAction({ getItem: () => { throw new Error('blocked'); } }), 'zoom');
  assert.doesNotThrow(() => writeDoubleTapAction('crop', { setItem: () => { throw new Error('blocked'); }, removeItem: () => {} }));
});
