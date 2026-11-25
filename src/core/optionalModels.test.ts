import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFICIENTSAM_TI, RFDETR_NANO, optionalModelConfigured, packAssetId, packFileUrlFromManifest } from './optionalModels';
import type { DataManifest } from './dataUpdateManifest';

const manifestWith = (assets: DataManifest['assets']): DataManifest => ({ schema: 1, revision: 2, assets });
const rf = RFDETR_NANO.files.model;

test('a pack file address comes from the manifest only for its own id, digest and size', () => {
  const asset = { id: 'rfdetr-nano-fp16', kind: 'onnx' as const, version: '1', path: '/data/onnx/rfdetr-nano-fp16/1/rf-detr-nano.onnx', sha256: rf.sha256, bytes: rf.bytes };
  assert.equal(packFileUrlFromManifest(RFDETR_NANO, 'model', manifestWith([asset]), 'https://models.example.test/'), 'https://models.example.test/data/onnx/rfdetr-nano-fp16/1/rf-detr-nano.onnx');
  assert.equal(packFileUrlFromManifest(RFDETR_NANO, 'model', manifestWith([{ ...asset, sha256: 'f'.repeat(64) }]), 'https://m.test'), null, 'another file');
  assert.equal(packFileUrlFromManifest(RFDETR_NANO, 'model', manifestWith([{ ...asset, bytes: 1 }]), 'https://m.test'), null, 'another size');
  assert.equal(packFileUrlFromManifest(RFDETR_NANO, 'model', manifestWith([{ ...asset, id: 'other' }]), 'https://m.test'), null, 'another id');
  assert.equal(packAssetId(EFFICIENTSAM_TI, 'encoder'), 'efficientsam-ti-fp16-encoder');
  assert.equal(packAssetId(RFDETR_NANO, 'model'), 'rfdetr-nano-fp16');
});

test('a pack is offered with its own address, or when the build has the signed manifest; otherwise not', () => {
  const noUrl = { ...RFDETR_NANO, files: { model: { ...rf, url: '' } } };
  assert.equal(optionalModelConfigured(noUrl, false), false);
  assert.equal(optionalModelConfigured(noUrl, true), true);
  assert.equal(optionalModelConfigured({ ...noUrl, files: { model: { ...rf, url: '', sha256: 'nope' } } }, true), false, 'a pin is still required');
});
