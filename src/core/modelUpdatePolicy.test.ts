import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDataManifest, type DataAsset } from './dataUpdateManifest.ts';
import { MODEL_SLOTS, planModelUpdates } from './modelUpdatePolicy.ts';

const asset = (extra: Partial<DataAsset> = {}): DataAsset => ({
  id: 'yolox-tiny', kind: 'onnx', version: '2026.12.1', path: '/data/onnx/yolox-tiny/2026.12.1/yolox_tiny.onnx', bytes: 100, sha256: 'a'.repeat(64),
  contract: MODEL_SLOTS['yolox-tiny'].contract, ...extra,
});
const manifest = (...assets: DataAsset[]) => ({ schema: 1 as const, revision: 2, assets });

test('a model that keeps its contract is installed; the same one again is not', () => {
  assert.deepEqual(planModelUpdates(manifest(asset()), {}).install.map((a) => a.id), ['yolox-tiny']);
  const have = { 'yolox-tiny': { id: 'yolox-tiny', version: '2026.12.1', sha256: 'a'.repeat(64) } };
  assert.equal(planModelUpdates(manifest(asset()), have).install.length, 0);
  assert.equal(planModelUpdates(manifest(asset({ sha256: 'b'.repeat(64) })), have).install.length, 1, 'same version, different bytes is still an update');
});

test('a changed or missing contract, or a model the app has no slot for, is reported and never installed', () => {
  const plan = planModelUpdates(manifest(
    asset({ contract: 'yolox-tiny-coco80-640/v2' }),
    asset({ id: 'u2netp', path: '/data/onnx/u2netp/1/u.onnx', contract: undefined }),
    asset({ id: 'mystery', path: '/data/onnx/mystery/1/m.onnx' }),
    asset({ id: 'equipment', kind: 'equipment', path: '/data/equipment.json' }),
  ), {});
  assert.equal(plan.install.length, 0);
  assert.deepEqual(plan.skipped.map((s) => [s.id, s.reason]), [
    ['yolox-tiny', 'contract_changed'], ['u2netp', 'contract_missing'], ['mystery', 'not_a_model_slot'], ['equipment', 'not_a_model_slot'],
  ]);
});

test('the manifest carries an optional, well-formed contract and nothing else is allowed', () => {
  const base = { id: 'yolox-tiny', kind: 'onnx', version: '1', path: '/data/onnx/a.onnx', bytes: 1, sha256: 'a'.repeat(64) };
  assert.equal(parseDataManifest({ schema: 1, revision: 1, assets: [base] })?.assets[0]?.contract, undefined);
  assert.equal(parseDataManifest({ schema: 1, revision: 1, assets: [{ ...base, contract: 'yolox-tiny-coco80-416/v1' }] })?.assets[0]?.contract, 'yolox-tiny-coco80-416/v1');
  assert.equal(parseDataManifest({ schema: 1, revision: 1, assets: [{ ...base, contract: '../evil' }] }), null);
  assert.equal(parseDataManifest({ schema: 1, revision: 1, assets: [{ ...base, extra: 1 }] }), null);
});
