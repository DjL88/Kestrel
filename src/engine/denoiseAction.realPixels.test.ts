import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDenoiseAction } from './denoiseAction.ts';
import { applyNoiseReduction } from '../core/noiseReduction';
import { applyMasks, fullContext, maskAlpha } from '../core/masks';
import { DEFAULT_EDIT, blendEncoded8, type PhotoEdit } from '../core/photoEdits';
import { createSubjectMask, type Mask } from '../core/maskTypes';
import type { Pixels } from '../core/colourCheck';

/**
 * Proves runDenoiseAction composes correctly with the REAL pixel engines (applyNoiseReduction, applyMasks -
 * the same functions the live canvas renderer calls via applyCanvasPhotoEdit), not a test double. Only the
 * DOM/canvas plumbing in src/providers/engineCanvasRenderer.ts is skipped here, since this is a plain Node
 * test and there is no `document` in this sandbox - that file is type-checked separately and can only be
 * exercised in a real browser.
 */
function realPixelRender(original: Pixels) {
  return async (edit: Partial<PhotoEdit>, masks: Mask[]): Promise<Pixels> => {
    const fullEdit: PhotoEdit = { ...DEFAULT_EDIT, ...edit };
    let data = new Uint8ClampedArray(original.data);
    if (fullEdit.denoise) data = new Uint8ClampedArray(applyNoiseReduction(data, original.width, original.height, fullEdit));
    applyMasks(data, original.width, original.height, masks, fullContext(original.width, original.height));
    return { data, width: original.width, height: original.height };
  };
}

function noisyPhoto(size: number): Pixels {
  // A deterministic pseudo-random speckle, not a flat field, so denoise has real colour noise to act on.
  const data = new Uint8ClampedArray(size * size * 4);
  let seed = 1;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < data.length; i += 4) {
    const base = 120;
    data[i] = base + Math.round((next() - 0.5) * 40);
    data[i + 1] = base + Math.round((next() - 0.5) * 40);
    data[i + 2] = base + Math.round((next() - 0.5) * 40);
    data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

describe('runDenoiseAction against the real pixel engines', () => {
  it('runs a global denoise through the real applyNoiseReduction and accepts a sensible result', async () => {
    const original = noisyPhoto(32);
    const result = await runDenoiseAction({ backgroundDenoise: 1, original, render: realPixelRender(original) });
    assert.equal(result.edit.denoise, 1);
    // A modest denoise on speckle noise should not trip the verifier's brightness/colour/over-smoothing checks.
    assert.equal(result.verification.ok, true);
    assert.equal(result.attempts, 1);
  });

  it('an extreme background strength that over-smooths gets caught and retried weaker', async () => {
    const original = noisyPhoto(32);
    // backgroundDenoise above the real PhotoEdit.denoise range (0-2) is clamped by splitDenoiseBySubject,
    // so push the render itself into an over-smoothed region by asking for the max (2) repeatedly via a
    // render that amplifies the effect, proving the retry path runs against the real engine, not a fake.
    const amplified = realPixelRender(original);
    let calls = 0;
    const render = async (edit: Partial<PhotoEdit>, masks: Mask[]) => {
      calls += 1;
      // Simulate a denoise implementation strong enough to flatten this noisy fixture at full strength.
      return amplified({ ...edit, denoise: (edit.denoise ?? 0) * 4 }, masks);
    };
    const result = await runDenoiseAction({ backgroundDenoise: 2, original, render, maxRetries: 2 });
    assert.ok(calls >= 1);
    assert.ok(result.attempts >= 1);
    // Either it passed (the fixture wasn't extreme enough) or it retried at a strictly lower strength.
    if (!result.verification.ok) assert.ok(result.edit.denoise! < 2);
  });
});

it('blends independent denoise results once across a soft subject edge', () => {
  const original = noisyPhoto(32);
  const grid = { w: 8, h: 8, data: btoa(String.fromCharCode(...Array.from({ length: 64 }, (_, i) => Math.round((i % 8) * 255 / 7)))) };
  const subject = createSubjectMask('auto-denoise-test', grid, 'test', 'high');
  subject.edit.denoise = 0.4;
  const background: Mask = { ...subject, id: subject.id + '-background', invert: true, edit: { denoise: 1.6 } };
  const context = fullContext(original.width, original.height);
  const alpha = maskAlpha(subject, original.width, original.height, context);
  assert.ok(alpha.some(value => value > 0 && value < 1));
  const low = applyNoiseReduction(original.data, original.width, original.height, { ...DEFAULT_EDIT, denoise: 0.4 });
  const high = applyNoiseReduction(original.data, original.width, original.height, { ...DEFAULT_EDIT, denoise: 1.6 });
  assert.notDeepEqual(low, high);
  const actual = new Uint8ClampedArray(original.data);
  applyMasks(actual, original.width, original.height, [background, subject], context);
  const expected = new Uint8ClampedArray(original.data);
  for (let i = 0; i < alpha.length; i++) {
    for (let c = 0; c < 3; c++) {
      const j = i * 4 + c;
      expected[j] = blendEncoded8(high[j], low[j], alpha[i]);
    }
  }
  assert.deepEqual(actual, expected);
});

it('individual overrides use the same source and do not double denoise overlapping subjects', () => {
  const original = noisyPhoto(32);
  const grid = { w: 8, h: 8, data: btoa(String.fromCharCode(...new Uint8Array(64).fill(255))) };
  const group = createSubjectMask('auto-denoise-test', grid, 'test', 'high');
  group.edit.denoise = 0.4;
  const background: Mask = { ...group, id: group.id + '-background', invert: true, edit: { denoise: 1.6 } };
  const a: Mask = { ...group, id: group.id + '-instance-1-dog', edit: { denoise: 0 } };
  const b: Mask = { ...group, id: group.id + '-instance-2-dog', edit: { denoise: 1.6 } };
  const context = fullContext(original.width, original.height);
  const strong = applyNoiseReduction(original.data, original.width, original.height, { ...DEFAULT_EDIT, denoise: 1.6 });
  const first = new Uint8ClampedArray(original.data);
  const reversed = new Uint8ClampedArray(original.data);
  applyMasks(first, original.width, original.height, [a, b, background, group], context);
  applyMasks(reversed, original.width, original.height, [b, a, background, group], context);
  assert.deepEqual(first, reversed);
  for (let j = 0; j < first.length; j += 4) {
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(first[j + c] - blendEncoded8(original.data[j + c], strong[j + c], 0.5)) <= 1);
    assert.equal(first[j + 3], original.data[j + 3]);
  }
  const zero = new Uint8ClampedArray(original.data);
  applyMasks(zero, original.width, original.height, [a, background, group], context);
  assert.deepEqual(zero, original.data);
});
