import assert from 'node:assert/strict';
import test from 'node:test';
import { admitRaw16, type Raw16Candidate } from './raw16ProvenanceGate';

function fixture(): Raw16Candidate {
  const icc = new Uint8Array(128);
  new DataView(icc.buffer).setUint32(0, 128, false);
  icc.set([97, 99, 115, 112], 36);
  return { source: 'sensor-decoder', pixelFormat: 'rgb-u16le', width: 2, height: 1,
    bytes: new Uint8Array(12), originalSha256: 'a'.repeat(64),
    colourProfile: { kind: 'embedded-icc', bytes: icc }, fullSensorDecode: true };
}
test('admits only complete sensor RGB16 with original identity and ICC', () => {
  const result = admitRaw16(fixture());
  assert.equal(result.kind, 'full-sensor-rgb16');
  assert.equal(result.pixels.byteLength, 12);
});
test('refuses embedded JPEG, canvas RGBA8 and unattested decode', () => {
  for (const source of ['embedded-preview', 'system-jpeg', 'canvas-rgba8'] as const) {
    assert.throws(() => admitRaw16({ ...fixture(), source }), /unavailable/);
  }
  assert.throws(() => admitRaw16({ ...fixture(), fullSensorDecode: false }), /unavailable/);
  assert.throws(() => admitRaw16({ ...fixture(), pixelFormat: 'rgba-u8' }), /unavailable/);
});
test('refuses truncated pixels, invalid dimensions, identity and ICC', () => {
  assert.throws(() => admitRaw16({ ...fixture(), bytes: new Uint8Array(11) }), /incomplete/);
  assert.throws(() => admitRaw16({ ...fixture(), width: 0 }), /dimensions/);
  assert.throws(() => admitRaw16({ ...fixture(), originalSha256: '' }), /SHA-256/);
  assert.throws(() => admitRaw16({ ...fixture(), colourProfile: { kind: 'unknown' } }), /ICC/);
  const broken = fixture();
  if (broken.colourProfile.kind === 'embedded-icc') broken.colourProfile.bytes[36] = 0;
  assert.throws(() => admitRaw16(broken), /malformed/);
});
