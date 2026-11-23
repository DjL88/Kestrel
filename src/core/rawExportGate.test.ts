import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireProvenRaw16Export, requireRaw16ExportForOriginal, type RawDecodeEvidence } from './rawExportGate';

const verified: RawDecodeEvidence = {
  sourceKind: 'full-raw-decode', precision: 'uint16',
  decoder: 'fixture-decoder', decoderVersion: '1.0',
  originalSha256: 'a'.repeat(64), width: 8256, height: 5504,
  decodedFromOriginal: true, exportUsesDevelopedPixels: true,
  outputIccProfile: 'sRGB IEC61966-2.1', compression: 'unknown',
  outputFormat: 'tiff', encodedBitsPerChannel: 16,
};

describe('RAW 16-bit export provenance gate', () => {
  it('fails closed when evidence is absent', () => {
    assert.equal(requireProvenRaw16Export(null).allowed, false);
  });
  for (const sourceKind of ['embedded-preview', 'browser-raster', 'external-raster', 'unknown'] as const) {
    it(`rejects ${sourceKind} even at full sensor dimensions`, () => {
      assert.equal(requireProvenRaw16Export({ ...verified, sourceKind }).allowed, false);
    });
  }
  it('rejects 8-bit canvas pixels and disconnected export bridges', () => {
    assert.equal(requireProvenRaw16Export({ ...verified, precision: 'rgba8' }).allowed, false);
    assert.equal(requireProvenRaw16Export({ ...verified, exportUsesDevelopedPixels: false }).allowed, false);
  });
  it('requires original hash, decoder identity, verified decode and ICC metadata', () => {
    assert.equal(requireProvenRaw16Export({ ...verified, originalSha256: null }).allowed, false);
    assert.equal(requireProvenRaw16Export({ ...verified, decoderVersion: null }).allowed, false);
    assert.equal(requireProvenRaw16Export({ ...verified, decodedFromOriginal: false }).allowed, false);
    assert.equal(requireProvenRaw16Export({ ...verified, outputIccProfile: null }).allowed, false);
  });
  it('allows fully evidenced 16-bit or float developed data only', () => {
    assert.equal(requireProvenRaw16Export(verified).allowed, true);
    assert.equal(requireProvenRaw16Export({ ...verified, precision: 'float32' }).allowed, true);
  });
  it('refuses an 8-bit encoder even with a genuine 16-bit RAW intermediate', () => {
    assert.equal(requireProvenRaw16Export({ ...verified, encodedBitsPerChannel: 8 }).allowed, false);
    assert.equal(requireProvenRaw16Export({ ...verified, encodedBitsPerChannel: 'unknown' }).allowed, false);
  });
  it('refuses PNG/JPEG and unknown containers even when labelled 16-bit', () => {
    for (const outputFormat of ['png', 'jpeg', 'unknown'] as const) {
      assert.equal(requireProvenRaw16Export({ ...verified, outputFormat }).allowed, false);
    }
  });
  it('does not assume HE/HE-star support from a claimed compression mode', () => {
    assert.equal(requireProvenRaw16Export({ ...verified, compression: 'he', decodedFromOriginal: false }).allowed, false);
    assert.equal(requireProvenRaw16Export({ ...verified, compression: 'he-star', sourceKind: 'embedded-preview' }).allowed, false);
  });
});

describe('RAW export bound to selected original identity', () => {
  it('accepts independently verified matching SHA-256, case-insensitively', () => {
    assert.equal(requireRaw16ExportForOriginal(verified, 'A'.repeat(64)).allowed, true);
  });
  it('refuses stale developed pixels belonging to another original', () => {
    const result = requireRaw16ExportForOriginal(verified, 'b'.repeat(64));
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.match(result.reason, /different original/);
  });
  it('fails closed when selected original identity is absent or invalid', () => {
    for (const identity of [null, undefined, '', 'a'.repeat(63), 'z'.repeat(64)]) {
      assert.equal(requireRaw16ExportForOriginal(verified, identity).allowed, false);
    }
  });
  it('still refuses previews even if the selected original hash matches', () => {
    assert.equal(requireRaw16ExportForOriginal({ ...verified, sourceKind: 'embedded-preview' }, 'a'.repeat(64)).allowed, false);
  });
});
