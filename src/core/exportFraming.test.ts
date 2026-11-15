import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExportFraming } from './exportFraming';
import { EXPORT_PROFILES } from './exportProfiles';

test('focus crop centres a reachable point and clamps near the edge', () => {
  const profile = EXPORT_PROFILES[1];
  const plan = planExportFraming(4000, 2000, profile, 'focus', { x: 0.7, y: 0.5 });
  assert.deepEqual(plan.region, { x: 2050, y: 0, width: 1500, height: 2000 });
  assert.equal(planExportFraming(4000, 2000, profile, 'focus', { x: 0.99, y: 0.5 }).region.x, 2500);
});

test('white borders preserve source framing and long edge never upscales', () => {
  const profile = EXPORT_PROFILES[1];
  const bordered = planExportFraming(4000, 2000, profile, 'border');
  assert.deepEqual(bordered.border, { width: 1080, height: 1440 });
  assert.equal(bordered.region.width, 4000);
  assert.equal(planExportFraming(4000, 2000, profile, 'long', undefined, 1200).scale, 0.3);
  assert.equal(planExportFraming(400, 200, profile, 'long', undefined, 1200).scale, 1);
});
