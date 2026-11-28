import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GESTURES, GESTURES_KEY, defaultAction, findGestureClashes, readGesture, readSavedGestures, resolveGesture, sanitiseGestures, withGesture, writeSavedGestures,
} from './gestureSettings';

const memory = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; };

test('the defaults follow the photo apps: double-tap zooms, a long press opens the menu or shows the original', () => {
  assert.equal(defaultAction('canvas.doubleTap'), 'zoom');
  assert.equal(defaultAction('canvas.longPress'), 'showOriginal');
  assert.equal(defaultAction('crop.doubleTap'), 'resetCrop');
  assert.equal(defaultAction('photoList.longPress'), 'menu');
  assert.equal(defaultAction('photoList.doubleTap'), 'open');
  assert.equal(readGesture('canvas.doubleTap', memory()), 'zoom');
});

test('every gesture offers its default first, and each offers "do nothing" so nothing is forced on anyone', () => {
  for (const gesture of GESTURES) {
    assert.ok(gesture.actions.length >= 2, gesture.id);
    assert.ok(gesture.actions.includes('off'), gesture.id);
    assert.notEqual(gesture.actions[0], 'off', `${gesture.id}: the default is never "do nothing"`);
  }
});

test('a choice is stored per device, read back, and choosing the default clears it', () => {
  const store = memory();
  const saved = withGesture({}, 'canvas.doubleTap', 'openCrop');
  writeSavedGestures(saved, store);
  assert.equal(readGesture('canvas.doubleTap', store), 'openCrop');
  assert.equal(readGesture('photoList.longPress', store), 'menu');
  writeSavedGestures(withGesture(saved, 'canvas.doubleTap', 'zoom'), store);
  assert.equal(store.data.has(GESTURES_KEY), false);
});

test('an action that is not on offer for a gesture is ignored', () => {
  assert.deepEqual(withGesture({}, 'canvas.longPress', 'openCrop'), {});
  assert.deepEqual(sanitiseGestures({ 'canvas.longPress': 'openCrop', 'canvas.doubleTap': 'off', nonsense: 'zoom', 'crop.doubleTap': 7 }), { 'canvas.doubleTap': 'off' });
});

test('damaged or blocked storage falls back to the defaults and never throws', () => {
  const store = memory();
  store.data.set(GESTURES_KEY, '{not json');
  assert.deepEqual(readSavedGestures(store), {});
  store.data.set(GESTURES_KEY, '[1,2]');
  assert.deepEqual(readSavedGestures(store), {});
  assert.equal(readSavedGestures({ getItem: () => { throw new Error('blocked'); } })['canvas.doubleTap'], undefined);
  assert.doesNotThrow(() => writeSavedGestures({ 'canvas.doubleTap': 'off' }, { setItem: () => { throw new Error('blocked'); }, removeItem: () => {} }));
});

test('Reset is an empty set of overrides: every gesture is back to its default', () => {
  const messy = withGesture(withGesture({}, 'canvas.doubleTap', 'off'), 'photoList.longPress', 'select');
  for (const gesture of GESTURES) assert.equal(resolveGesture({}, gesture.id), defaultAction(gesture.id));
  assert.notEqual(resolveGesture(messy, 'canvas.doubleTap'), defaultAction('canvas.doubleTap'));
});

test('two gestures on one photo doing the same thing are reported, in their own context only', () => {
  assert.deepEqual(findGestureClashes({}), []);
  const clash = findGestureClashes({ 'photoList.doubleTap': 'menu' });
  assert.equal(clash.length, 1);
  assert.deepEqual(clash[0], { context: 'photoList', action: 'menu', ids: ['photoList.longPress', 'photoList.doubleTap'] });
  // "Do nothing" twice is not a clash.
  assert.deepEqual(findGestureClashes({ 'photoList.doubleTap': 'off', 'photoList.longPress': 'off' }), []);
  // The same word in another context is not a clash.
  assert.deepEqual(findGestureClashes({ 'canvas.doubleTap': 'off', 'crop.doubleTap': 'off' }), []);
});
