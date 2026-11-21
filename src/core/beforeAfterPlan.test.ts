import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeAfterCanvasSize, beforeAfterPanelProfile } from './beforeAfterPlan';
import { formatById, toProfile } from './exportFormats';
import { exportScale } from './exportProfiles';

test('comparison panels have identical limits and no hidden enlargement', () => {
  const format = formatById('before-after')!;
  assert.ok(format);
  const profile = toProfile(format);
  const panel = beforeAfterPanelProfile(profile);
  assert.equal(profile.width, 1920);
  assert.equal(panel.width, 960);
  assert.equal(panel.height, 1200);
  assert.equal(panel.allowUpscale, false);
  assert.equal(exportScale(400, 250, panel), 1, 'small source is not enlarged');
  assert.equal(exportScale(4000, 3000, panel), 0.24);
  assert.deepEqual(beforeAfterCanvasSize(960, 720, 2_000_000), { width: 1920, height: 720 });
});

test('invalid comparison requests are refused, not silently downscaled', () => {
  const format = toProfile(formatById('before-after')!);
  assert.throws(() => beforeAfterPanelProfile({ ...format, width: 1919 }), /invalid/);
  assert.throws(() => beforeAfterPanelProfile({ ...format, id: 'master' }), /invalid/);
  assert.throws(() => beforeAfterCanvasSize(960, 720, 1_000_000), /too large/);
  assert.throws(() => beforeAfterCanvasSize(Number.NaN, 1200, 2_000_000), /too large/);
  assert.throws(() => beforeAfterCanvasSize(1e18, 1e18, 120_000_000), /too large/);
});
