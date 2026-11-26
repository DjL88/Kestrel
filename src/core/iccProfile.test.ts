import assert from 'node:assert/strict';
import test from 'node:test';
import { IccProfileError, applyProofLut, buildProofLut, parseIccProfile, proofColour, srgbToLab } from './iccProfile.ts';
import { syntheticPrinterProfile } from './iccTestProfile.ts';

test('a printer profile is read: name, class, relative colorimetric tables', () => {
  const profile = parseIccProfile(syntheticPrinterProfile());
  assert.equal(profile.description, 'Test paper 40C');
  assert.equal(profile.deviceClass, 'prtr');
  assert.equal(profile.intent, 'relative');
});

test('colours the paper can hold come back unchanged; saturated ones are clipped and counted', () => {
  const profile = parseIccProfile(syntheticPrinterProfile());
  for (const grey of [[0.5, 0.5, 0.5], [0.9, 0.85, 0.8], [0.2, 0.25, 0.3]]) {
    const proof = proofColour(profile, grey);
    assert.ok(proof.deltaE < 2, `in-gamut colour moved by ${proof.deltaE.toFixed(2)}`);
  }
  const red = proofColour(profile, [1, 0, 0]);
  assert.ok(red.deltaE > 20, 'pure red is far outside a 40-chroma paper');
  const lab = srgbToLab(red.rgb);
  assert.ok(Math.hypot(lab[1], lab[2]) < 45, 'and the proof shows it clipped');
});

test('a proofed photo marks out-of-reach colour with a pattern and reports its share', () => {
  const lut = buildProofLut(parseIccProfile(syntheticPrinterProfile()), 17);
  const pixels = new Uint8ClampedArray([128, 128, 128, 255, 255, 0, 0, 255, 120, 125, 130, 255, 0, 0, 255, 255]);
  const share = applyProofLut(lut, pixels, 2, true);
  assert.equal(share, 0.5);
  assert.ok(Math.abs(pixels[0] - 128) <= 3, 'grey stays grey');
  assert.ok(pixels[4] === pixels[5] && pixels[5] === pixels[6], 'out-of-gamut pixel shows the neutral stripe, not a colour');
});

test('anything that is not a usable printer profile is refused in words', () => {
  assert.throws(() => parseIccProfile(new Uint8Array(200)), IccProfileError);
  const noTables = syntheticPrinterProfile();
  noTables.set([...'xxxx'].map((c) => c.charCodeAt(0)), 132 + 12); // rename A2B1
  noTables.set([...'yyyy'].map((c) => c.charCodeAt(0)), 132 + 24); // rename B2A1
  assert.throws(() => parseIccProfile(noTables), /no printer colour tables/);
});
