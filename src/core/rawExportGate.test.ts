import { describe, expect, it } from 'vitest';
import { requireProvenRaw16Export, type RawDecodeEvidence } from './rawExportGate';

const verified: RawDecodeEvidence = {
  sourceKind: 'full-raw-decode', precision: 'uint16',
  decoder: 'fixture-decoder', decoderVersion: '1.0',
  originalSha256: 'a'.repeat(64), width: 8256, height: 5504,
  decodedFromOriginal: true, exportUsesDevelopedPixels: true,
  outputIccProfile: 'sRGB IEC61966-2.1', compression: 'unknown',
};

describe('RAW 16-bit export provenance gate', () => {
  it('fails closed when evidence is absent', () => {
    expect(requireProvenRaw16Export(null).allowed).toBe(false);
  });
  it.each(['embedded-preview', 'browser-raster', 'external-raster', 'unknown'] as const)(
    'rejects %s even at full sensor dimensions', sourceKind => {
      expect(requireProvenRaw16Export({ ...verified, sourceKind }).allowed).toBe(false);
    },
  );
  it('rejects 8-bit canvas pixels and disconnected export bridges', () => {
    expect(requireProvenRaw16Export({ ...verified, precision: 'rgba8' }).allowed).toBe(false);
    expect(requireProvenRaw16Export({ ...verified, exportUsesDevelopedPixels: false }).allowed).toBe(false);
  });
  it('requires original hash, decoder identity, verified decode and ICC metadata', () => {
    expect(requireProvenRaw16Export({ ...verified, originalSha256: null }).allowed).toBe(false);
    expect(requireProvenRaw16Export({ ...verified, decoderVersion: null }).allowed).toBe(false);
    expect(requireProvenRaw16Export({ ...verified, decodedFromOriginal: false }).allowed).toBe(false);
    expect(requireProvenRaw16Export({ ...verified, outputIccProfile: null }).allowed).toBe(false);
  });
  it('allows fully evidenced 16-bit or float developed data only', () => {
    expect(requireProvenRaw16Export(verified).allowed).toBe(true);
    expect(requireProvenRaw16Export({ ...verified, precision: 'float32' }).allowed).toBe(true);
  });
  it('does not assume HE/HE-star support from a claimed compression mode', () => {
    expect(requireProvenRaw16Export({ ...verified, compression: 'he', decodedFromOriginal: false }).allowed).toBe(false);
    expect(requireProvenRaw16Export({ ...verified, compression: 'he-star', sourceKind: 'embedded-preview' }).allowed).toBe(false);
  });
});
