import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawPrecisionEvidence } from './rawPrecisionGate';

test('known Nikon HE and HE* fail closed before precision output', () => {
  for (const mode of ['nikon-he', 'nikon-he-star'] as const) {
    assert.throws(() => rawPrecisionEvidence(mode), /patent and commercial distribution rights/);
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
