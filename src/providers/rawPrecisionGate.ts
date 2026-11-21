import type { RawSensorMode } from './rawDevelop';

/** A decoder result is not a patent licence, camera profile, or source hash. */
export interface RawPrecisionEvidence {
  source: 'sensor-rgb16';
  codec: RawSensorMode;
  colour: 'display-encoded-srgb';
  cameraProfileVerified: false;
  commercialHeRightsVerified: false;
  originalHashVerified: false;
}

/** Never allow known Nikon HE/HE* through the experimental precision export.
 * This is a distribution/legal gate, not a claim that the decoder cannot read it.
 * Unknown compression remains unverified and must never be described as cleared. */
export function rawPrecisionEvidence(mode: RawSensorMode): RawPrecisionEvidence {
  if (mode === 'nikon-he' || mode === 'nikon-he-star') {
    throw new Error('Nikon High Efficiency RAW precision export is unavailable until codec patent and commercial distribution rights are cleared. The original remains unchanged.');
  }
  return {
    source: 'sensor-rgb16',
    codec: mode,
    colour: 'display-encoded-srgb',
    cameraProfileVerified: false,
    commercialHeRightsVerified: false,
    originalHashVerified: false,
  };
}
