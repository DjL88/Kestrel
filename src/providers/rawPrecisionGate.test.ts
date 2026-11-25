import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawPrecisionEvidence } from './rawPrecisionGate';
import { precisionSensorMode } from './rawDevelop';

test('the 16-bit gate passes HE, HE* and other RAWs, and still fails closed when the compression is unknown', () => {
  for (const mode of ['nikon-he', 'nikon-he-star', 'other'] as const) assert.equal(precisionSensorMode(mode), mode);
  assert.throws(() => precisionSensorMode('unknown'), /could not be verified/);
});

test('Nikon HE and HE* take the same 16-bit path, labelled as such and never described as licence-verified', () => {
  for (const mode of ['nikon-he', 'nikon-he-star'] as const) {
    const evidence = rawPrecisionEvidence(mode);
    assert.equal(evidence.codec, mode);
    assert.equal(evidence.source, 'sensor-rgb16');
    assert.equal(evidence.commercialHeRightsVerified, false);
  }
});
test('other mode is not misrepresented as colour-calibrated or legally cleared', () => {
  assert.deepEqual(rawPrecisionEvidence('other'), {
    source: 'sensor-rgb16',
    codec: 'other',
    colour: 'display-encoded-srgb',
    cameraProfileVerified: false,
    commercialHeRightsVerified: false,
    originalHashVerified: false,
  });
});
