import assert from 'node:assert/strict';
import test from 'node:test';
import { canHidePro, hiddenProFeatures, lockedProFeatures, panelsHiddenByPro } from './proVisibility.ts';

const plan = { smartCulling: 'pro', overlayText: 'basic', watermarkCustom: 'basic', zoomVideo: 'basic' } as const;

test('Basic overlays never appear in the list of locked Pro features', () => {
  const access = { smartCulling: false, overlayText: true, watermarkCustom: true, zoomVideo: true };
  assert.deepEqual(lockedProFeatures(plan, access), ['smartCulling']);
  assert.equal(canHidePro(plan, access), true);
  assert.deepEqual(hiddenProFeatures(plan, access, true), ['smartCulling']);
});

test('hide Pro does not hide text overlays, watermarks or the entire Overlays panel', () => {
  const access = { smartCulling: false, overlayText: false, watermarkCustom: false, zoomVideo: true };
  assert.deepEqual(hiddenProFeatures(plan, access, false), []);
  assert.deepEqual(hiddenProFeatures(plan, access, true), ['smartCulling']);
  assert.deepEqual(panelsHiddenByPro(['overlayText', 'watermarkCustom']), []);
  assert.deepEqual(panelsHiddenByPro(['smartCulling', 'onlineAi']), []);
});

test('when Admin enables the Pro feature nothing is hidden', () => {
  const access = { smartCulling: true, overlayText: true, watermarkCustom: true, zoomVideo: true };
  assert.equal(canHidePro(plan, access), false);
  assert.deepEqual(hiddenProFeatures(plan, access, true), []);
});
