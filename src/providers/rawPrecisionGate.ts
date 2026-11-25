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

/** Evidence for a precision export. Nikon HE/HE* are included by the owner's decision (19 Nov 2026, extended to 16-bit
 * output on 25 Nov 2026; NOTICE.md): that accepts the patent exposure, it does not verify a licence, so
 * commercialHeRightsVerified stays false and the codec is recorded for honest labelling. */
export function rawPrecisionEvidence(mode: RawSensorMode): RawPrecisionEvidence {
  return {
    source: 'sensor-rgb16',
    codec: mode,
    colour: 'display-encoded-srgb',
    cameraProfileVerified: false,
    commercialHeRightsVerified: false,
    originalHashVerified: false,
  };
}
