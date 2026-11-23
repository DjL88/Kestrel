import assert from 'node:assert/strict';
import test from 'node:test';
import { canHidePro, hiddenProFeatures, lockedProFeatures, panelsHiddenByPro } from './proVisibility.ts';

const plan = { smartCulling: 'pro', overlayText: 'pro', zoomVideo: 'basic' } as const;

test('on a Basic account the locked Pro features are listed and the choice is offered; Basic features never are', () => {
  const access = { smartCulling: false, overlayText: false, zoomVideo: true };
  assert.deepEqual(lockedProFeatures(plan, access).sort(), ['overlayText', 'smartCulling']);
  assert.equal(canHidePro(plan, access), true);
});

test('a Pro account has nothing locked, so the choice is not offered and nothing is hidden', () => {
  const access = { smartCulling: true, overlayText: true, zoomVideo: true };
  assert.equal(canHidePro(plan, access), false);
  assert.deepEqual(hiddenProFeatures(plan, access, true), []);
});

test('nothing is hidden unless the person asked; a Pro feature they do have (a trial) is never hidden', () => {
  const mixed = { smartCulling: true, overlayText: false, zoomVideo: true };
  assert.deepEqual(hiddenProFeatures(plan, mixed, false), []);
  assert.deepEqual(hiddenProFeatures(plan, mixed, true), ['overlayText']);
});

test('a tool made only of hidden Pro features leaves the rail; a tool with something left stays', () => {
  assert.deepEqual(panelsHiddenByPro(['overlayText', 'watermarkCustom']), ['overlays']);
  assert.deepEqual(panelsHiddenByPro(['overlayText']), []);
  assert.deepEqual(panelsHiddenByPro([]), []);
  assert.deepEqual(panelsHiddenByPro(['smartCulling', 'onlineAi']), []);
});
