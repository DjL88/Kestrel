import test from 'node:test';
import assert from 'node:assert/strict';
import { canDockPhotoInfo, PHOTO_INFO_DOCK_QUERY, FLOATING_PANE_Z } from './photoInfoLayout';

test('Photo Info preserves photo width on small desktop and tablet/foldable landscape layouts', () => {
  for (const [width, height] of [
    [320, 700], [420, 900], [840, 440], [900, 600], [1023, 700],
    [1024, 439], [1180, 500], [1279, 549], [2560, 399],
  ]) {
    assert.equal(canDockPhotoInfo(width, height), false, `${width}x${height} should not automatically dock`);
  }
});

test('Photo Info docks only when a photographic canvas remains viable', () => {
  for (const [width, height] of [[1024, 550], [1100, 768], [1280, 440], [1920, 1080], [2560, 480]]) {
    assert.equal(canDockPhotoInfo(width, height), true, `${width}x${height} should support an Info dock`);
  }
});

test('invalid viewport dimensions do not accidentally dock photo info', () => {
  assert.equal(canDockPhotoInfo(NaN, 900), false);
  assert.equal(canDockPhotoInfo(1440, Infinity), false);
  assert.equal(canDockPhotoInfo(-1, 800), false);
});

test('CSS media query and visible window ordering share the same policy', () => {
  assert.match(PHOTO_INFO_DOCK_QUERY, /min-width: 1024px/);
  assert.match(PHOTO_INFO_DOCK_QUERY, /min-width: 1280px/);
  assert.ok(FLOATING_PANE_Z.background < FLOATING_PANE_Z.foreground);
  // Owner decision: panels stay in front of dialogs (z-100) so their title bars are always reachable.
  assert.ok(FLOATING_PANE_Z.background > 100, 'floating panes must sit above dialogs');
});
