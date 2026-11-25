import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCaptureDetail, applyCaptureDetailRgb16, captureProfileFor, deconvolutionParams, deconvolutionReach, hasCaptureDetail,
  validCaptureSharpen, validDeblur,
} from './captureSharpen';
import { isNeutralEdit, type PhotoEdit } from './photoEdits';
import { editRgb16, master16Blocker } from './master16';
import { applyRecipePatch, editToRecipe } from '../v2/engineClient/recipeMap';

/** A soft vertical edge: dark to light across a few pixels, blurred like a lens would, in 16-bit RGB. */
function softEdge16(width: number, height: number): Uint16Array {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = 1 / (1 + Math.exp(-(x - width / 2) / 1.1));
      const v = Math.round((0.2 + 0.6 * t) * 65535);
      const i = (y * width + x) * 3;
      data[i] = v; data[i + 1] = v; data[i + 2] = v;
    }
  }
  return data;
}

const toRgba = (rgb: Uint16Array) => {
  const out = new Uint8ClampedArray((rgb.length / 3) * 4);
  for (let p = 0; p < rgb.length / 3; p += 1) {
    for (let c = 0; c < 3; c += 1) out[p * 4 + c] = Math.round(rgb[p * 3 + c] / 257);
    out[p * 4 + 3] = 255;
  }
  return out;
};

const z8: PhotoEdit = { exposure: 0, warmth: 0, colour: 0, captureSharpen: { amount: 1, profile: 'nikon-z8' } };

test('camera models map to the Nikon Z8 and Z5II profiles, and anything else to generic', () => {
  assert.equal(captureProfileFor('NIKON Z 8'), 'nikon-z8');
  assert.equal(captureProfileFor('Nikon Z8'), 'nikon-z8');
  assert.equal(captureProfileFor('NIKON Z5_2'), 'nikon-z5ii');
  assert.equal(captureProfileFor('Nikon Z5II'), 'nikon-z5ii');
  assert.equal(captureProfileFor('NIKON Z 5'), 'generic');
  assert.equal(captureProfileFor('NIKON Z 9'), 'generic');
  assert.equal(captureProfileFor(undefined), 'generic');
});

test('saved values are validated, and an edit with them is not neutral', () => {
  assert.ok(validCaptureSharpen({ amount: 0.5, profile: 'nikon-z5ii' }));
  assert.ok(!validCaptureSharpen({ amount: 2, profile: 'nikon-z8' }));
  assert.ok(!validCaptureSharpen({ amount: 0.5, profile: 'canon' }));
  assert.ok(validDeblur(0.3) && !validDeblur(-0.1) && !validDeblur(Number.NaN));
  assert.ok(!isNeutralEdit(z8));
  assert.ok(isNeutralEdit({ exposure: 0, warmth: 0, colour: 0, captureSharpen: { amount: 0, profile: 'nikon-z8' } }));
  assert.equal(master16Blocker(z8, undefined), null);
  assert.match(master16Blocker({ ...z8, deblur: 3 }, undefined) ?? '', /deblur/);
});

test('the point-spread is in sensor pixels: full-size renders sharpen, fit-to-screen previews are left alone', () => {
  const full = deconvolutionParams(z8, 8256)!;
  assert.ok(Math.abs(full.sigma - 0.55) < 1e-9);
  assert.equal(deconvolutionParams(z8, 2200), null, 'a fit preview is far below one pixel of blur');
  const z5 = deconvolutionParams({ captureSharpen: { amount: 1, profile: 'nikon-z5ii' } }, 6048)!;
  assert.ok(z5.sigma > full.sigma, 'the Z5II profile assumes an anti-aliasing filter, so a wider PSF');
  const blur = deconvolutionParams({ deblur: 1 }, 6000)!;
  assert.ok(blur.sigma > 1.3 && blur.iterations > full.iterations);
});

test('capture sharpening steepens a soft edge without overshooting into halos', () => {
  const width = 48, height = 8;
  const before = softEdge16(width, height);
  const after = before.slice();
  applyCaptureDetailRgb16(after, width, height, { ...z8, deblur: 0.5 }, 8256);
  const row = (d: Uint16Array) => Array.from({ length: width }, (_, x) => d[(4 * width + x) * 3] / 65535);
  const a = row(before), b = row(after);
  const slope = (r: number[]) => r[width / 2] - r[width / 2 - 1];
  assert.ok(slope(b) > slope(a) * 1.1, `edge is steeper (${slope(a).toFixed(4)} -> ${slope(b).toFixed(4)})`);
  const lo = Math.min(...a), hi = Math.max(...a);
  const range = hi - lo;
  assert.ok(Math.min(...b) >= lo - 0.1 * range - 1e-6 && Math.max(...b) <= hi + 0.1 * range + 1e-6, 'no halo past the neighbour range');
  // Grey stays grey: the change is added equally to every channel.
  for (let p = 0; p < width * height; p += 1) assert.ok(after[p * 3] === after[p * 3 + 1] && after[p * 3 + 1] === after[p * 3 + 2]);
});

test('noise on a flat patch is not sharpened', () => {
  const width = 40, height = 40;
  const data = new Uint16Array(width * height * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let p = 0; p < width * height; p += 1) {
    const v = Math.round((0.5 + (rand() - 0.5) * 0.004) * 65535);
    data[p * 3] = data[p * 3 + 1] = data[p * 3 + 2] = v;
  }
  const spread = (d: Uint16Array) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < d.length; i += 3) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); } return hi - lo; };
  const before = spread(data);
  applyCaptureDetailRgb16(data, width, height, { ...z8, deblur: 1 }, 8256);
  assert.ok(spread(data) <= before * 1.15, `noise spread ${before} -> ${spread(data)}`);
});

test('preview matches export: the 8-bit screen path and banded 16-bit export agree, and bands join exactly', () => {
  const width = 64, height = 150;
  const base = softEdge16(width, height);
  // Add a horizontal soft edge too, so the bands have something to get wrong.
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 3;
    const v = Math.round(base[i] * (0.6 + 0.4 / (1 + Math.exp(-(y - 75) / 1.3))));
    base[i] = base[i + 1] = base[i + 2] = v;
  }
  const edit: PhotoEdit = { ...z8, deblur: 0.4 };
  const p = deconvolutionParams(edit, 8256)!;
  const whole = base.slice();
  applyCaptureDetailRgb16(whole, width, height, edit, 8256, height);
  const banded = base.slice();
  applyCaptureDetailRgb16(banded, width, height, edit, 8256, 2 * deconvolutionReach(p));
  assert.deepEqual(banded, whole, 'banded export equals a one-piece render');

  const screen = toRgba(base);
  applyCaptureDetail(screen, width, height, edit, 8256);
  const exported = toRgba(whole);
  let worst = 0;
  for (let i = 0; i < screen.length; i += 1) worst = Math.max(worst, Math.abs(screen[i] - exported[i]));
  assert.ok(worst <= 2, `screen and export differ by at most 2 levels (got ${worst})`);
});

test('the whole 16-bit export runs it, and the recipe round-trips through the editor sliders', () => {
  // A strip as wide as a full-size generic frame, so the point-spread is at full scale.
  const width = 6000, height = 6;
  const data = softEdge16(width, height);
  const before = data.slice();
  editRgb16({ width, height, data }, { exposure: 0, warmth: 0, colour: 0, deblur: 0.5, captureSharpen: { amount: 0.8, profile: 'generic' } });
  assert.notDeepEqual(data, before);

  const { edit } = applyRecipePatch(undefined, { captureSharpen: 60, captureProfile: 'nikon-z8' });
  assert.deepEqual(edit.captureSharpen, { amount: 0.6, profile: 'nikon-z8' });
  const withBlur = applyRecipePatch(edit, { deblur: 25 }).edit;
  assert.equal(withBlur.deblur, 0.25);
  const recipe = editToRecipe(withBlur);
  assert.equal(recipe.captureSharpen, 60);
  assert.equal(recipe.deblur, 25);
  assert.equal(recipe.captureProfile, 'nikon-z8');
  const off = applyRecipePatch(applyRecipePatch(withBlur, { captureSharpen: 0 }).edit, { deblur: 0 }).edit;
  assert.ok(!('captureSharpen' in off) && !('deblur' in off) && !hasCaptureDetail(off));
});
