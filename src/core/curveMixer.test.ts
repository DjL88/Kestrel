import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCurveLut, curveLut, isNeutralCurve, isNeutralMixer, mixerParams, mixPixel, MIXER_BANDS, NEUTRAL_MIXER,
  validCurve, validMixer, type ColourMixer, type CurvePoint,
} from './curveMixer';
import { applyPhotoEdit, applyPhotoEditLinear, DEFAULT_EDIT, isNeutralEdit } from './photoEdits';
import { master16Blocker } from './master16';

const sCurve: CurvePoint[] = [[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]];

test('a straight curve is neutral and leaves pixels exactly as they were', () => {
  const source = new Uint8ClampedArray([20, 130, 243, 255, 0, 255, 128, 255]);
  const pixels = new Uint8ClampedArray(source);
  const edit = { ...DEFAULT_EDIT, curve: [[0, 0], [0.5, 0.5], [1, 1]] as CurvePoint[] };
  assert.ok(isNeutralEdit(edit));
  applyPhotoEdit(pixels, edit);
  assert.deepEqual(pixels, source);
});

test('the sampled curve passes through its points and never overshoots', () => {
  const lut = curveLut(sCurve);
  for (const [x, y] of sCurve) assert.ok(Math.abs(applyCurveLut(x, lut) - y) < 0.002, `${x} -> ${y}`);
  for (let i = 1; i < lut.length; i += 1) assert.ok(lut[i] >= lut[i - 1] - 1e-7, 'monotone');
  assert.ok(lut.every((v) => v >= 0 && v <= 1));
});

test('an S curve darkens shadows and brightens highlights, and greys stay grey', () => {
  const pixels = new Uint8ClampedArray([60, 60, 60, 255, 200, 200, 200, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, curve: sCurve });
  assert.ok(pixels[0] < 60);
  assert.ok(pixels[4] > 200);
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[4], pixels[6]);
});

test('a raised black point lifts pure black, like a faded film look', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, curve: [[0, 0.1], [1, 1]] });
  assert.equal(pixels[0], Math.round(0.1 * 255));
});

test('malformed curves are refused, not guessed at', () => {
  assert.ok(validCurve(sCurve));
  assert.ok(!validCurve([[0, 0]]));
  assert.ok(!validCurve([[0.5, 0], [0.4, 1]]), 'inputs must increase');
  assert.ok(!validCurve([[0, 0], [1, 1.2]]));
  assert.ok(!validCurve([[0, 0], [1, Number.NaN]]));
  assert.ok(!validCurve(Array.from({ length: 17 }, (_, i) => [i / 16, i / 16])));
  assert.ok(isNeutralCurve('nonsense'), 'renderers ignore a malformed curve');
  assert.ok(master16Blocker({ ...DEFAULT_EDIT, curve: [[0.5, 0], [0.4, 1]] }, undefined));
  assert.equal(master16Blocker({ ...DEFAULT_EDIT, curve: sCurve }, undefined), null);
});

const mixer = (band: number, key: keyof ColourMixer, value: number): ColourMixer => {
  const m = NEUTRAL_MIXER();
  m[key][band] = value;
  return m;
};

test('the mixer only changes the colours in its band', () => {
  const blue = MIXER_BANDS.indexOf('blue');
  const params = mixerParams(mixer(blue, 'saturation', -2));
  const out = new Float32Array(3);
  mixPixel(0.05, 0.1, 0.6, params, out); // a blue sky
  assert.ok(out[2] - out[0] < 0.6 - 0.05, 'blue is less saturated');
  mixPixel(0.6, 0.1, 0.05, params, out); // a red breast
  assert.deepEqual(Array.from(out).map((v) => +v.toFixed(5)), [0.6, 0.1, 0.05]);
});

test('the mixer leaves greys and white plumage untouched', () => {
  const m = NEUTRAL_MIXER();
  m.hue.fill(2); m.saturation.fill(2); m.luminance.fill(2);
  const params = mixerParams(m);
  const out = new Float32Array(3);
  mixPixel(0.8, 0.8, 0.8, params, out);
  assert.deepEqual(Array.from(out), [0.8, 0.8, 0.8].map((v) => Math.fround(v)));
  mixPixel(0.8, 0.79, 0.795, params, out); // almost white
  assert.ok(Math.abs(out[0] - 0.8) < 1e-6 && Math.abs(out[1] - 0.79) < 1e-6);
});

test('mixer luminance darkens a band by up to one stop and hue moves towards the next band', () => {
  const green = MIXER_BANDS.indexOf('green');
  const out = new Float32Array(3);
  mixPixel(0.1, 0.5, 0.1, mixerParams(mixer(green, 'luminance', -2)), out);
  assert.ok(Math.abs(out[1] - 0.25) < 1e-4);
  mixPixel(0.1, 0.5, 0.1, mixerParams(mixer(green, 'hue', -2)), out);
  assert.ok(out[0] > out[2], 'green shifts towards yellow');
});

test('mixer bands blend smoothly: no jump between neighbouring hues', () => {
  const params = mixerParams(mixer(MIXER_BANDS.indexOf('orange'), 'luminance', 2));
  const out = new Float32Array(3);
  let previous = -1;
  for (let g = 0; g <= 0.5; g += 0.01) {
    mixPixel(0.5, g, 0.05, params, out);
    const value = Math.max(out[0], out[1], out[2]);
    if (previous >= 0) assert.ok(Math.abs(value - previous) < 0.06, `step at g=${g.toFixed(2)}`);
    previous = value;
  }
});

test('malformed mixers are refused and ignored by renderers', () => {
  assert.ok(validMixer(NEUTRAL_MIXER()));
  assert.ok(isNeutralMixer(NEUTRAL_MIXER()));
  assert.ok(!validMixer({ hue: [1], saturation: [], luminance: [] }));
  assert.ok(!validMixer({ ...NEUTRAL_MIXER(), saturation: Array(8).fill(3) }));
  assert.ok(!validMixer({ ...NEUTRAL_MIXER(), extra: 1 }));
  assert.ok(master16Blocker({ ...DEFAULT_EDIT, mixer: { hue: [1] } as unknown as ColourMixer }, undefined));
});

test('the 8-bit preview and the high-precision export agree on curve and mixer', () => {
  const edit = { ...DEFAULT_EDIT, curve: sCurve, mixer: mixer(MIXER_BANDS.indexOf('red'), 'saturation', 1.5) };
  const source = new Uint8ClampedArray([180, 60, 40, 255, 30, 120, 200, 255, 128, 128, 128, 255]);
  const pixels = new Uint8ClampedArray(source);
  applyPhotoEdit(pixels, edit);
  const toLinear = (v: number) => { const e = v / 255; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
  const floats = Float32Array.from(source, (v, i) => i % 4 === 3 ? 1 : toLinear(v));
  applyPhotoEditLinear(floats, edit);
  for (let i = 0; i < source.length; i += 1) {
    if (i % 4 === 3) continue;
    assert.ok(Math.abs(floats[i] * 255 - pixels[i]) <= 1, `channel ${i}: ${floats[i] * 255} vs ${pixels[i]}`);
  }
});
