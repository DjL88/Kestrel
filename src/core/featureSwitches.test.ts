import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NO_SWITCHES, SWITCHABLE_FEATURES, assertModelAllowed, ownerSwitchOff, ownerSwitchOffForFeature, ownerSwitchOffForModel, ownerSwitchOffForPreview,
  parseSwitchDoc, setOwnerSwitches, SwitchedOffError, switchableFeature,
} from './featureSwitches';
import { FEATURE_NAMES, evaluateFeature, featureAvailable } from './features';
import { PREVIEW_FEATURES, previewOn } from './previewFeatures';
import { OPTIONAL_MODELS } from './optionalModels';

const full = { fullEditor: true } as never;
test.afterEach(() => setOwnerSwitches(null));

test('the registry has stable unique ids, two scopes at most, and every part is real', () => {
  const ids = SWITCHABLE_FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const previews = new Set(PREVIEW_FEATURES.map((p) => p.id as string));
  for (const f of SWITCHABLE_FEATURES) {
    assert.match(f.id, /^[a-z][a-z0-9-]{2,40}$/);
    assert.ok(f.name && f.description && f.owner && f.offEffect, f.id);
    assert.ok(f.scopes.length >= 1 && f.scopes.every((s) => s === 'device' || s === 'cloud'));
    for (const p of f.previews ?? []) assert.ok(previews.has(p), `${f.id}: unknown preview ${p}`);
    for (const name of f.features ?? []) assert.ok((FEATURE_NAMES as string[]).includes(name), `${f.id}: unknown feature ${name}`);
  }
  // Every optional model pack a build can download is covered by a switch.
  for (const pack of OPTIONAL_MODELS) assert.ok(SWITCHABLE_FEATURES.some((f) => f.modelIds?.includes(pack.id)), `${pack.id} has no switch`);
  assert.ok(ids.includes('cloud-processing') && ids.includes('own-ai-second-opinion') && ids.includes('enhance-loop'));
});

test('with no list at all (offline, first run) amber and green features are as shipped, and licence-red models are OFF', () => {
  setOwnerSwitches(null);
  for (const id of ['subject-mask-model', 'fine-edge-mask', 'tap-to-select', 'species-id']) {
    assert.equal(switchableFeature(id)?.licence.verdict, 'red', id);
    assert.equal(ownerSwitchOff(id), true, `${id} is off by default`);
  }
  for (const name of ['u2netp', 'birefnet-lite-w16', 'efficientsam-ti-fp16', 'efficientsam-ti-fp16.decoder', 'bioclip-image-int8', 'bioclip2-image-fp16']) assert.equal(ownerSwitchOffForModel(name), true, name);
  assert.equal(featureAvailable('speciesId', full), false);
  // Amber and green stay on: denoise, CLIP, detectors, similarity, previews.
  for (const name of ['nafnet-sidd-w32-w16', 'clip-gate', 'clip-vit-b32-text-int8', 'yolox-tiny', 'rfdetr-nano-fp16', 'dinov2-small-fp16', 'markings-reader']) assert.equal(ownerSwitchOffForModel(name), false, name);
  assert.equal(ownerSwitchOffForPreview('enhanceLoop'), false);
  for (const f of SWITCHABLE_FEATURES) {
    assert.ok(f.licence.reason && f.licence.reportDate === '2026-11-28', f.id);
    assert.equal(f.defaultOn === false, f.licence.verdict === 'red', `${f.id}: only red is off by default`);
  }
  assert.equal(switchableFeature('learned-denoise')?.licence.verdict, 'amber');
  assert.equal(switchableFeature('category-gate')?.licence.verdict, 'amber');
});

test('the owner can switch a red feature on explicitly, and reset puts it back off', () => {
  setOwnerSwitches(parseSwitchDoc({ 'species-id': { device: true } }));
  assert.equal(ownerSwitchOffForModel('bioclip-image-int8'), false);
  assert.equal(featureAvailable('speciesId', full), true);
  setOwnerSwitches(parseSwitchDoc({}));
  assert.equal(ownerSwitchOffForModel('bioclip-image-int8'), true);
});

test('the default is current behaviour for the rest, and a missing list is harmless', () => {
  setOwnerSwitches(null);
  assert.deepEqual(parseSwitchDoc(undefined), NO_SWITCHES);
  assert.deepEqual(parseSwitchDoc('x'), NO_SWITCHES);
});

test('a damaged or newer list never breaks an older app: unknown ids, scopes and values are dropped', () => {
  assert.deepEqual(parseSwitchDoc({ 'species-id': { device: false, cloud: false, extra: false }, 'future-thing': { device: false }, 'enhance-loop': { device: true }, 'fine-edge-mask': 'off' }),
    { 'species-id': { device: false }, 'enhance-loop': { device: true } }, 'cloud is not a scope of species-id, and unknown ids and non-booleans are ignored');
});

test('an off switch stops a model by its catalogue or session id, and only that model', () => {
  setOwnerSwitches(parseSwitchDoc({ 'tap-to-select': { device: false }, 'subject-mask-model': { device: true } }));
  assert.equal(ownerSwitchOffForModel('efficientsam-ti-fp16'), true);
  assert.equal(ownerSwitchOffForModel('efficientsam-ti-fp16.encoder'), true);
  assert.equal(ownerSwitchOffForModel('u2netp'), false, 'owner switched the red mask model on');
  assert.equal(ownerSwitchOffForModel('dinov2-small-fp16'), false);
  assert.throws(() => assertModelAllowed('efficientsam-ti-fp16.decoder'), (e: unknown) => e instanceof SwitchedOffError && e.message === 'This is not available right now.');
  assert.doesNotThrow(() => assertModelAllowed('u2netp'));
});

test('an off switch hides a preview even when this device turned it on, and never turns one on', () => {
  const storage = { getItem: (k: string) => (k === 'kestrel.preview.enhance-loop.v1' ? '1' : null) };
  assert.equal(previewOn('enhanceLoop', storage), true);
  setOwnerSwitches(parseSwitchDoc({ 'enhance-loop': { device: false } }));
  assert.equal(previewOn('enhanceLoop', storage), false);
  setOwnerSwitches(parseSwitchDoc({ 'enhance-loop': { device: true } }));
  assert.equal(previewOn('finishBest', { getItem: () => null }), false, 'on-switch alone enables nothing');
  assert.equal(previewOn('enhanceLoop', { getItem: () => null }), false);
});

test('an off switch closes a flagged feature, but never an essential one', () => {
  setOwnerSwitches(parseSwitchDoc({ 'species-id': { device: true }, 'finish-best': { device: false }, 'cloud-processing': { device: false } }));
  assert.equal(featureAvailable('finishBest', full), false);
  assert.equal(evaluateFeature('speciesId', full).on, true);
  assert.equal(evaluateFeature('finishBest', full).reason, 'kill-switch');
  assert.equal(ownerSwitchOffForFeature('cloudAssist'), true);
  for (const essential of ['import', 'basicEditing', 'export', 'localBackup'] as const) assert.equal(featureAvailable(essential, full), true);
  assert.equal(switchableFeature('species-id')?.features?.includes('import' as never), false);
});

test('the device copy is replaced whole by each new verified list, so switching back on works', () => {
  setOwnerSwitches(parseSwitchDoc({ 'photo-similarity': { device: false } }));
  assert.equal(ownerSwitchOffForModel('dinov2-small-fp16'), true);
  setOwnerSwitches(parseSwitchDoc({}));
  assert.equal(ownerSwitchOffForModel('dinov2-small-fp16'), false);
});
