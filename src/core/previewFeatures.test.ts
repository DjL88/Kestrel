import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURES } from './features';
import { PREVIEW_FEATURES, previewKey, previewOn, previewsVersion, setPreview, subscribePreviews } from './previewFeatures';
import { source } from '../i18n/areas/preview/source';
import { hdrPreviewOn, HDR_PREVIEW_KEY } from '../v2/engineClient/hdrMergeOps';
import { WORKFLOW_PREVIEW_KEYS, workflowPreviewOn } from '../v2/engineClient/workflowPreview';
import { CULL_MASK_SHARPNESS_KEY, cullMaskSharpnessOn } from './maskSharpness';
import { ORT_WEBGPU_PREVIEW_KEY } from './ortThreads';
import { CLOUD_RECIPE_PREVIEW_KEY, cloudRecipePreviewOn } from '../providers/cloudRecipeService';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    data,
  };
}

// The keys people may already have set. They must never change.
const KEYS: Record<string, string> = {
  onImageAdvice: 'kestrel.preview.on-image-advice.v1',
  finishBest: 'kestrel.preview.finish-best.v1',
  flightBatch: 'kestrel.preview.flight-batch.v1',
  cullRules: 'kestrel.preview.cull-rules.v1',
  cullMaskSharpness: 'kestrel.preview.cullMaskSharpness.v1',
  cloudRecipe: 'kestrel.preview.cloudRecipe.v1',
  usbTether: 'kestrel.preview.usb-tether.v1',
  verificationChain: 'kestrel.preview.verification-chain.v1',
  ortWebgpu: 'kestrel.preview.ort-webgpu.v1',
  focusStack: 'kestrel.preview.focus-stack.v1',
  panorama: 'kestrel.preview.panorama.v1',
  hdrMerge: 'kestrel.preview.hdr-merge.v1',
  savedViews: 'kestrel.preview.saved-views.v1',
  nextToReview: 'kestrel.preview.next-to-review.v1',
  brandKits: 'kestrel.preview.brand-kits.v1',
  editStyle: 'kestrel.preview.edit-style.v1',
  cullWarmup: 'kestrel.preview.cullWarmup.v1',
};

test('the registry keeps every storage key exactly as devices already have it', () => {
  assert.deepEqual(Object.fromEntries(PREVIEW_FEATURES.map((p) => [p.id, p.storageKey])), KEYS);
  assert.equal(new Set(PREVIEW_FEATURES.map((p) => p.id)).size, PREVIEW_FEATURES.length, 'ids are unique');
  assert.equal(new Set(PREVIEW_FEATURES.map((p) => p.storageKey)).size, PREVIEW_FEATURES.length, 'keys are unique');
});

test('every preview has a plain name and description in the words, and its feature exists', () => {
  const words = source as Record<string, unknown>;
  for (const item of PREVIEW_FEATURES) {
    assert.equal(typeof words[item.nameKey], 'string', `${item.id} name`);
    assert.equal(typeof words[item.descriptionKey], 'string', `${item.id} description`);
    assert.ok((words[item.descriptionKey] as string).length > 20, `${item.id} description says something`);
    if (item.feature) assert.ok(item.feature in FEATURES, `${item.id} feature ${item.feature}`);
  }
});

test('nothing is on by default', () => {
  const empty = memory();
  for (const item of PREVIEW_FEATURES) assert.equal(previewOn(item.id, empty), false, item.id);
  assert.equal(previewOn('hdrMerge', null), false);
  assert.equal(previewOn('hdrMerge', { getItem: () => { throw new Error('blocked'); } }), false, 'unreadable storage is off');
});

test('only the exact value 1 turns a preview on', () => {
  for (const value of ['0', 'true', 'yes', '', '2', ' 1']) assert.equal(previewOn('cullRules', memory({ [KEYS.cullRules]: value })), false, JSON.stringify(value));
  assert.equal(previewOn('cullRules', memory({ [KEYS.cullRules]: '1' })), true);
});

test('setPreview writes 1 for on, removes the key for off, and tells listeners', () => {
  const store = memory();
  let heard = 0;
  const stop = subscribePreviews(() => { heard += 1; });
  const before = previewsVersion();
  assert.equal(setPreview('flightBatch', true, store), true);
  assert.equal(store.data.get(KEYS.flightBatch), '1');
  assert.equal(previewOn('flightBatch', store), true);
  assert.equal(setPreview('flightBatch', false, store), true);
  assert.equal(store.data.has(KEYS.flightBatch), false, 'off removes the key, back to the default');
  assert.equal(heard, 2);
  assert.equal(previewsVersion(), before + 2);
  stop();
  setPreview('flightBatch', true, store);
  assert.equal(heard, 2, 'an unsubscribed listener hears nothing');
});

test('a write that storage refuses reports false and changes nothing', () => {
  const version = previewsVersion();
  assert.equal(setPreview('cloudRecipe', true, null), false);
  const throwing = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('quota'); } };
  assert.equal(setPreview('cloudRecipe', true, throwing), false);
  const ignoring = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  assert.equal(setPreview('cloudRecipe', true, ignoring), false, 'a write that did not stick is not reported as done');
  assert.equal(previewsVersion(), version);
});

test('a failing listener does not stop the others', () => {
  const store = memory();
  let heard = false;
  const stopBad = subscribePreviews(() => { throw new Error('bad listener'); });
  const stopGood = subscribePreviews(() => { heard = true; });
  assert.equal(setPreview('usbTether', true, store), true);
  assert.equal(heard, true);
  stopBad(); stopGood();
});

test('the existing readers answer from the same keys through the registry', () => {
  assert.equal(HDR_PREVIEW_KEY, KEYS.hdrMerge);
  assert.equal(CULL_MASK_SHARPNESS_KEY, KEYS.cullMaskSharpness);
  assert.equal(ORT_WEBGPU_PREVIEW_KEY, KEYS.ortWebgpu);
  assert.equal(CLOUD_RECIPE_PREVIEW_KEY, KEYS.cloudRecipe);
  for (const [name, key] of Object.entries(WORKFLOW_PREVIEW_KEYS)) assert.equal(key, KEYS[name], name);
  assert.equal(previewKey('panorama'), KEYS.panorama);
  const on = (key: string) => ({ getItem: (k: string) => (k === key ? '1' : null) });
  assert.equal(hdrPreviewOn(on(KEYS.hdrMerge)), true);
  assert.equal(hdrPreviewOn(on(KEYS.panorama)), false);
  assert.equal(cullMaskSharpnessOn(on(KEYS.cullMaskSharpness)), true);
  assert.equal(workflowPreviewOn('editStyle', on(KEYS.editStyle)), true);
  assert.equal(workflowPreviewOn('editStyle', null), false);
  assert.equal(cloudRecipePreviewOn(memory({ [KEYS.cloudRecipe]: '1' })), true);
});
