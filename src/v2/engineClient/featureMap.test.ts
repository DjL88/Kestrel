import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_NAMES } from '../../core/features.ts';
import { featureAccess, featurePlan, V2_FEATURES } from './featureMap.ts';

test('every feature the V2 UI asks about is in the core feature table', () => {
  for (const key of V2_FEATURES) assert.ok((FEATURE_NAMES as string[]).includes(key), key);
});

test('text overlays and custom watermarks are Basic; advanced intelligence remains Pro', () => {
  const plan = featurePlan();
  for (const key of ['smartCulling', 'speciesId', 'onlineAi', 'cloudAssist'] as const)
    assert.equal(plan[key], 'pro', key);
  for (const key of ['watermarkCustom', 'overlayText', 'zoomVideo', 'splitFrames'] as const)
    assert.equal(plan[key], 'basic', key);
});

test('every V2 feature follows the verified can() flag gate: no hidden Pro preview override', () => {
  const allowed = featureAccess((feature) => feature === 'overlayText' || feature === 'watermarkCustom');
  assert.equal(allowed.overlayText, true);
  assert.equal(allowed.watermarkCustom, true);
  assert.equal(allowed.smartCulling, false);
  assert.equal(allowed.cloudAssist, false);
  assert.deepEqual(Object.keys(allowed).sort(), [...V2_FEATURES].sort());
  assert.equal(featureAccess(() => false).smartCulling, false);
  assert.equal(featureAccess((key) => key === 'smartCulling').smartCulling, true);
});
