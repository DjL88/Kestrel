import assert from 'node:assert/strict';
import { test } from 'node:test';
import { corroborateOcr, validatedMark, readLocalRegion } from './platformOcr';

test('aircraft registration and ring-like formats are conservative', () => {
  assert.equal(validatedMark('G-ABCD'), 'G-ABCD');
  assert.equal(validatedMark('AB 123456'), 'AB 123456');
  for (const value of ['', 'BIRD', 'G-AB1D', 'G-ABCDE', '1234', 'hello world', 'N/A', 'G-ABCD and']) {
    assert.equal(validatedMark(value), null, value);
  }
});
test('two high-confidence identical crops agree, without confirming EXIF', () => {
  assert.deepEqual(corroborateOcr([{ rawValue: 'G-ABCD', confidence: 0.96 }], [{ rawValue: 'g-abcd', confidence: 0.94 }]),
    [{ value: 'G-ABCD', status: 'agreed' }]);
});
test('missing detector confidence cannot masquerade as high-confidence OCR agreement', () => {
  assert.deepEqual(corroborateOcr([{ rawValue: 'G-ABCD' }], [{ rawValue: 'G-ABCD' }]),
    [{ value: 'G-ABCD', status: 'needs-review' }]);
  assert.deepEqual(corroborateOcr([{ rawValue: 'G-ABCD', confidence: 0.98 }], [{ rawValue: 'G-ABCD' }]),
    [{ value: 'G-ABCD', status: 'needs-review' }]);
  assert.equal(validatedMark(42 as unknown as string), null, 'unexpected detector data abstains');
});
test('single read, disagreement, blur-equivalent low confidence and non-text abstain', () => {
  assert.deepEqual(corroborateOcr([{ rawValue: 'G-ABCD' }], []), []);
  assert.deepEqual(corroborateOcr([{ rawValue: 'G-ABCD' }], [{ rawValue: 'G-ABCE' }]), []);
  assert.deepEqual(corroborateOcr([{ rawValue: 'G-ABCD', confidence: 0.3 }], [{ rawValue: 'G-ABCD' }]), []);
  assert.deepEqual(corroborateOcr([{ rawValue: 'KINGFISHER' }], [{ rawValue: 'KINGFISHER' }]), []);
});
test('without explicit consent or an attested local reader, OCR never accesses image or network', async () => {
  const source = { width: 100, height: 100 } as HTMLCanvasElement;
  assert.equal((await readLocalRegion(source, { consent: false, region: { x: 0, y: 0, width: 40, height: 20 } })).reads, 0);
  assert.equal((await readLocalRegion(source, { consent: true, region: { x: 0, y: 0, width: 40, height: 20 } })).reads, 0);
});
test('invalid ROI and busy editor abstain before allocating canvas', async () => {
  const source = { width: 100, height: 100 } as HTMLCanvasElement;
  const reader = { deviceLocal: true as const, detect: async () => [] };
  assert.match((await readLocalRegion(source, { consent: true, reader, region: { x: 99, y: 0, width: 40, height: 20 } })).reason, /Invalid/);
  assert.match((await readLocalRegion(source, { consent: true, reader, isBusy: () => true, region: { x: 0, y: 0, width: 40, height: 20 } })).reason, /busy/);
  assert.match((await readLocalRegion(source, { consent: true, reader, maxPixels: Number.NaN, region: { x: 0, y: 0, width: 40, height: 20 } })).reason, /budget/);
  assert.match((await readLocalRegion(source, { consent: true, reader, maxPixels: 20_000_000, region: { x: 0, y: 0, width: 40, height: 20 } })).reason, /budget/);
});
