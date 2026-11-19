import assert from 'node:assert/strict';
import test from 'node:test';
import { frameImageIdentity, visibleFrameUrl } from './frameImageIdentity';

test('the same photograph keeps its preview during a reversible slider edit', () => {
  const frame = { id: 'frame-1', stableKey: 'original-on-disk' };
  const key = frameImageIdentity(frame, 'full');
  assert.equal(visibleFrameUrl({ identity: key, url: 'blob:preview-before-edit' }, key), 'blob:preview-before-edit');
});

test('different photos, replaced originals and resolutions never borrow a rendered URL', () => {
  const before = frameImageIdentity({ id: '1', stableKey: 'disk-key' }, 'full');
  for (const after of [
    frameImageIdentity({ id: '2', stableKey: 'disk-key' }, 'full'),
    frameImageIdentity({ id: '1', stableKey: 'different-original' }, 'full'),
    frameImageIdentity({ id: '1', stableKey: 'disk-key' }, 'thumb'),
  ]) assert.equal(visibleFrameUrl({ identity: before, url: 'blob:stale-photo' }, after), '');
});

test('fast 500-photo navigation never associates a stale photo with a new selection', () => {
  const keys = Array.from({ length: 500 }, (_, i) =>
    frameImageIdentity({ id: `photo-${i}`, stableKey: `original-${i}` }, 'full'));
  for (let i = 0; i < 500; i++) {
    const current = keys[i];
    const previous = keys[(i + 499) % 500];
    const next = keys[(i + 1) % 500];
    assert.equal(visibleFrameUrl({ identity: previous, url: 'blob:previous' }, current), '');
    assert.equal(visibleFrameUrl({ identity: next, url: 'blob:next' }, current), '');
    assert.equal(visibleFrameUrl({ identity: current, url: 'blob:correct' }, current), 'blob:correct');
  }
});
