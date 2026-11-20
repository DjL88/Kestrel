import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessRawMaster, type RawMasterEvidence } from './rawMasterProvenance';

const verified = (): RawMasterEvidence => ({
  originalSha256: 'a'.repeat(64), decoderId: 'rights-cleared-decoder', decoderVersion: '1.0',
  codec: 'NEF', compression: 'lossless', rightsVerified: true, sensorDerived: true,
  intermediate: 'sensor-rgb16', sourceBitsPerChannel: 14, outputBitsPerChannel: 16,
  width: 8256, height: 5504, iccProfileId: 'verified-srgb', colourTransformVerified: true,
  referenceTestVerified: true,
});
test('no evidence is preview only, never a master', () => {
  assert.deepEqual(assessRawMaster(null).state, 'preview-only');
  assert.equal(assessRawMaster(undefined).canExportHighPrecision, false);
});
test('verified sensor source with complete provenance may pass', () => {
  assert.equal(assessRawMaster(verified()).canExportHighPrecision, true);
});
test('16-bit TIFF from JPEG cannot pass', () => {
  assert.equal(assessRawMaster({ ...verified(), intermediate: 'jpeg8', sourceBitsPerChannel: 8 }).canExportHighPrecision, false);
});
test('Nikon HE* requires explicit rights and reference verification', () => {
  const he = { ...verified(), compression: 'nikon-he-star' as const };
  assert.equal(assessRawMaster({ ...he, rightsVerified: false }).canExportHighPrecision, false);
  assert.equal(assessRawMaster({ ...he, referenceTestVerified: false }).canExportHighPrecision, false);
});
test('missing original hash or colour provenance blocks export', () => {
  assert.equal(assessRawMaster({ ...verified(), originalSha256: 'filename.nef' }).canExportHighPrecision, false);
  assert.equal(assessRawMaster({ ...verified(), colourTransformVerified: false }).canExportHighPrecision, false);
});
test('invalid dimensions or invented precision block export', () => {
  assert.equal(assessRawMaster({ ...verified(), width: 0 }).canExportHighPrecision, false);
  assert.equal(assessRawMaster({ ...verified(), outputBitsPerChannel: 8 }).canExportHighPrecision, false);
});
