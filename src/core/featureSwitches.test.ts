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

test('the default is current behaviour: nothing is off, and no copy means everything as shipped', () => {
  assert.equal(ownerSwitchOff('species-id'), false);
  assert.equal(ownerSwitchOffForModel('u2netp'), false);
  assert.equal(ownerSwitchOffForPreview('enhanceLoop'), false);
  assert.equal(featureAvailable('speciesId', full), true);
  setOwnerSwitches(null);
  assert.deepEqual(parseSwitchDoc(undefined), NO_SWITCHES);
  assert.deepEqual(parseSwitchDoc('x'), NO_SWITCHES);
});

test('a damaged or newer list never breaks an older app: unknown ids, scopes and values are dropped', () => {
  assert.deepEqual(parseSwitchDoc({ 'species-id': { device: false, cloud: false, extra: false }, 'future-thing': { device: false }, 'enhance-loop': { device: true }, 'fine-edge-mask': 'off' }),
    { 'species-id': { device: false } }, 'cloud is not a scope of species-id, true is not an off, and unknown ids are ignored');
});

test('an off switch stops a model by its catalogue or session id, and only that model', () => {
  setOwnerSwitches(parseSwitchDoc({ 'tap-to-select': { device: false } }));
  assert.equal(ownerSwitchOffForModel('efficientsam-ti-fp16'), true);
  assert.equal(ownerSwitchOffForModel('efficientsam-ti-fp16.encoder'), true);
  assert.equal(ownerSwitchOffForModel('u2netp'), false);
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
  setOwnerSwitches(parseSwitchDoc({ 'species-id': { device: false }, 'cloud-processing': { device: false } }));
  assert.equal(featureAvailable('speciesId', full), false);
  assert.equal(evaluateFeature('speciesId', full).reason, 'kill-switch');
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
