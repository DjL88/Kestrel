import test from 'node:test';
import assert from 'node:assert/strict';
import { isNeutralWhiteBalance, planckianXy, readAsShotWhite, validWhiteBalance, whiteBalanceGains } from './asShotWhite';
import { applyPhotoEdit, DEFAULT_EDIT, isNeutralEdit } from './photoEdits';
import { master16Blocker } from './master16';

/** A JPEG start with the decoder's comment exactly as crates/kestrel-raw writes it (develop::with_as_shot_comment). */
function tagged(text: string, extraFirst = false): Uint8Array {
  const body = new TextEncoder().encode(text);
  const comment = [0xff, 0xfe, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
  return Uint8Array.from([0xff, 0xd8, ...(extraFirst ? app0 : []), ...comment, 0xff, 0xda, 0x00, 0x02]);
}

test('the as-shot comment is read from a developed JPEG, and anything else gives no number', () => {
  assert.deepEqual(readAsShotWhite(tagged('InFlight-AsShotWhite/1 K=5480 Duv=0.0021')), { kelvin: 5480, duv: 0.0021 });
  assert.deepEqual(readAsShotWhite(tagged('InFlight-AsShotWhite/1 K=3200 Duv=-0.0040', true)), { kelvin: 3200, duv: -0.004 });
  assert.equal(readAsShotWhite(tagged('Some other comment')), null);
  assert.equal(readAsShotWhite(tagged('InFlight-AsShotWhite/1 K=90000 Duv=0.0')), null, 'out of range');
  assert.equal(readAsShotWhite(tagged('InFlight-AsShotWhite/1 K=abc Duv=0')), null);
  assert.equal(readAsShotWhite(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0])), null, 'not a JPEG');
  assert.equal(readAsShotWhite(Uint8Array.from([0xff, 0xd8, 0xff, 0xfe, 0x40, 0x00])), null, 'truncated');
});

test('the Planckian locus passes near D65 and illuminant A', () => {
  const [x65, y65] = planckianXy(6504);
  assert.ok(Math.abs(x65 - 0.3135) < 0.003 && Math.abs(y65 - 0.3237) < 0.006, `${x65}, ${y65}`);
  const [xa, ya] = planckianXy(2856);
  assert.ok(Math.abs(xa - 0.4476) < 0.002 && Math.abs(ya - 0.4074) < 0.002, `${xa}, ${ya}`);
});

test('a higher temperature warms the picture, a lower one cools it, and as shot changes nothing', () => {
  assert.deepEqual(whiteBalanceGains(5500, 5500).map((v) => +v.toFixed(6)), [1, 1, 1]);
  const warmer = whiteBalanceGains(5500, 7500);
  assert.ok(warmer[0] > 1 && warmer[2] < 1, `${warmer}`);
  const cooler = whiteBalanceGains(5500, 3500);
  assert.ok(cooler[0] < 1 && cooler[2] > 1, `${cooler}`);
  for (const gains of [warmer, cooler, whiteBalanceGains(5500, 2000)]) {
    const luma = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
    assert.ok(Math.abs(luma - 1) < 1e-9, 'grey keeps its brightness');
    assert.ok(gains.every((g) => g >= 1 / 8 - 1e-9 && g <= 8 / luma + 1e-9));
  }
});

test('the edit: as shot is neutral, a new temperature changes pixels, malformed values are refused', () => {
  assert.ok(isNeutralEdit({ ...DEFAULT_EDIT, whiteBalance: { asShotK: 5200, kelvin: 5200 } }));
  const pixels = new Uint8ClampedArray([128, 128, 128, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, whiteBalance: { asShotK: 5200, kelvin: 8000 } });
  assert.ok(pixels[0] > pixels[2], 'warmer');
  assert.ok(!validWhiteBalance({ asShotK: 5200, kelvin: 99999 }));
  assert.ok(!validWhiteBalance({ asShotK: 5200, kelvin: 6000, extra: 1 }));
  assert.ok(isNeutralWhiteBalance({ asShotK: 'x' }));
  assert.ok(master16Blocker({ ...DEFAULT_EDIT, whiteBalance: { asShotK: 1, kelvin: 2 } }, undefined));
  assert.equal(master16Blocker({ ...DEFAULT_EDIT, whiteBalance: { asShotK: 5200, kelvin: 6000 } }, undefined), null);
});
