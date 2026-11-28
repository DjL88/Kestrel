import assert from 'node:assert/strict';
import test from 'node:test';
import { OverlayBack } from './overlayBack';

test('an opening dialog adds one history entry and Back asks that dialog to close', () => {
  const back = new OverlayBack<string>();
  assert.deepEqual(back.sync(['settings']), { push: 1, pop: 0 });
  assert.deepEqual(back.sync(['settings']), { push: 0, pop: 0 }, 'no new entry while it stays open');
  assert.equal(back.back(), 'settings');
  assert.deepEqual(back.sync([]), { push: 0, pop: 0 }, 'Back already removed the entry, so nothing is dropped again');
  assert.equal(back.back(), null, 'with nothing open Back is left to the app (it leaves)');
});

test('a dialog closed by its own button gives its entry back', () => {
  const back = new OverlayBack<string>();
  back.sync(['export']);
  assert.deepEqual(back.sync([]), { push: 0, pop: 1 });
  assert.equal(back.back(), null);
});

test('stacked dialogs close one at a time, topmost first', () => {
  const back = new OverlayBack<string>();
  assert.deepEqual(back.sync(['settings', 'keyboard']), { push: 2, pop: 0 });
  assert.equal(back.back(), 'keyboard');
  back.sync(['settings']);
  assert.equal(back.back(), 'settings');
  assert.equal(back.back(), null);
});

test('a dialog that ignores Back is not given another entry, so the next Back leaves', () => {
  const back = new OverlayBack<string>();
  back.sync(['busy']);
  assert.equal(back.back(), 'busy');
  assert.deepEqual(back.sync(['busy']), { push: 0, pop: 0 });
  assert.equal(back.back(), null);
  // Once it has gone, a later dialog of the same kind is a new one.
  back.sync([]);
  assert.deepEqual(back.sync(['busy']), { push: 1, pop: 0 });
});

test('dialogs that close together drop one entry each', () => {
  const back = new OverlayBack<string>();
  back.sync(['a', 'b']);
  assert.deepEqual(back.sync([]), { push: 0, pop: 2 });
});
