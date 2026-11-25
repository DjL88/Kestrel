import test from 'node:test';
import assert from 'node:assert/strict';
import { licenceList, manifestFor, packAssetId, planManifestAssets } from './modelManifestPlan';
import { planModelUpdates } from './modelUpdatePolicy';
import { EFFICIENTSAM_TI, NAFNET_W32, OPTIONAL_MODELS, RFDETR_NANO } from './optionalModels';

const slot = { name: 'yolox-tiny.onnx', bytes: 20_000_000, sha256: 'a'.repeat(64) };
const pinnedFile = (model: typeof RFDETR_NANO, role: string, name: string) => ({ name, bytes: model.files[role].bytes, sha256: model.files[role].sha256 });

test('slot models and every optional pack go into one manifest, each with a licence record', () => {
  const models = [slot, pinnedFile(RFDETR_NANO, 'model', 'rf-detr-nano.onnx'), pinnedFile(NAFNET_W32, 'model', 'nafnet.onnx'),
    pinnedFile(EFFICIENTSAM_TI, 'encoder', 'efficient_sam_vitt_encoder.onnx'), pinnedFile(EFFICIENTSAM_TI, 'decoder', 'efficient_sam_vitt_decoder.onnx')];
  const plan = planManifestAssets({ version: '2026.11.25', models, species: [{ name: 'uk.json', bytes: 1234, sha256: 'b'.repeat(64) }], speciesLicence: { spdx: 'CC-BY-4.0', source: 'https://www.worldbirdnames.org' } });
  assert.ok(plan.ok, JSON.stringify(plan));
  assert.deepEqual(plan.assets.map((a) => [a.id, a.kind]).sort(), [
    ['efficientsam-ti-fp16-decoder', 'onnx'], ['efficientsam-ti-fp16-encoder', 'onnx'], ['nafnet-sidd-w32-w16', 'onnx'], ['rfdetr-nano-fp16', 'onnx'],
    ['species-uk', 'species-library'], ['yolox-tiny', 'onnx'],
  ]);
  const rf = plan.assets.find((a) => a.id === 'rfdetr-nano-fp16')!;
  assert.deepEqual([rf.path, rf.bytes, rf.sha256], ['/data/onnx/rfdetr-nano-fp16/2026.11.25/rf-detr-nano.onnx', RFDETR_NANO.files.model.bytes, RFDETR_NANO.files.model.sha256]);
  assert.equal(plan.assets.find((a) => a.id === 'yolox-tiny')!.contract, 'yolox-tiny-coco80-416/v1');
  const licences = licenceList(plan.assets);
  assert.equal(licences['rfdetr-nano-fp16'].spdx, 'Apache-2.0');
  assert.equal(licences['yolox-tiny'].spdx, 'Apache-2.0');
  assert.equal(licences['species-uk'].spdx, 'CC-BY-4.0');

  // The app's own parser accepts it, and an installed app updates only the slot model: packs are reported, never installed.
  const manifest = manifestFor(plan.assets, 2);
  assert.ok(manifest);
  const update = planModelUpdates(manifest, {});
  assert.deepEqual(update.install.map((a) => a.id), ['yolox-tiny']);
  assert.ok(update.skipped.every((s) => s.reason === 'not_a_model_slot'));
  assert.equal(JSON.stringify(manifest).includes('licence'), false, 'the signed manifest keeps its schema');
});

test('an unknown file, a pack file of the wrong size, half a pack, or a species list without a licence is refused', () => {
  assert.equal(planManifestAssets({ version: '1', models: [{ name: 'mystery.onnx', bytes: 10, sha256: 'c'.repeat(64) }] }).ok, false);
  const wrongSize = planManifestAssets({ version: '1', models: [{ ...pinnedFile(RFDETR_NANO, 'model', 'rf.onnx'), bytes: 5 }] });
  assert.ok(!wrongSize.ok && wrongSize.problems[0].includes('size'));
  const half = planManifestAssets({ version: '1', models: [pinnedFile(EFFICIENTSAM_TI, 'encoder', 'enc.onnx')] });
  assert.ok(!half.ok && half.problems.some((p) => p.includes('missing decoder')));
  const noLicence = planManifestAssets({ version: '1', models: [slot], species: [{ name: 'uk.json', bytes: 1, sha256: 'd'.repeat(64) }] });
  assert.ok(!noLicence.ok && noLicence.problems[0].includes('licence'));
  assert.equal(planManifestAssets({ version: '1', models: [] }).ok, false);
});

test('every optional pack has a licence and ids the manifest accepts', () => {
  for (const model of OPTIONAL_MODELS) {
    assert.ok(model.licence.length > 0, model.id);
    for (const role of Object.keys(model.files)) assert.match(packAssetId(model, role), /^[a-z][a-z0-9-]{0,63}$/);
  }
});
