import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_NAMES } from '../../core/features.ts';
import { featureAccess, featurePlan, V2_FEATURES } from './featureMap.ts';

test('every feature the V2 UI asks about is a real feature in the core table', () => {
  for (const key of V2_FEATURES) assert.ok((FEATURE_NAMES as string[]).includes(key), key);
});

test('Pro is what enhances the photo or costs money to run; zoom video and split frames are Basic for now', () => {
  const plan = featurePlan();
  for (const key of ['smartCulling', 'speciesId', 'onlineAi', 'cloudAssist', 'watermarkCustom', 'overlayText'] as const) assert.equal(plan[key], 'pro', key);
  for (const key of ['zoomVideo', 'splitFrames'] as const) assert.equal(plan[key], 'basic', key);
});

test('access follows the single can() gate for every feature', () => {
  const basic = featureAccess((feature) => feature === 'zoomVideo' || feature === 'splitFrames', false);
  assert.equal(basic.zoomVideo, true);
  assert.equal(basic.smartCulling, false);
  assert.deepEqual(Object.keys(basic).sort(), [...V2_FEATURES].sort());
});

test('the developer-only Pro preview opens every feature, and is off unless asked for', () => {
  assert.equal(featureAccess(() => false, true).smartCulling, true);
  assert.equal(featureAccess(() => false, false).smartCulling, false);
});
