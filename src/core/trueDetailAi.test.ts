import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blendLearned, subjectRect, trueDetailAiPlacement, trueDetailAiWeight, validTrueDetailAi, type TrueDetailAi } from './trueDetailAi';
import { fullContext } from './masks';
import { master16Blocker } from './master16';
import { regionalDenoiseMasks, runDenoiseAction } from '../engine/denoiseAction';
import { applyMasks } from './masks';
import { DEFAULT_EDIT } from './photoEdits';
import type { Mask } from './maskTypes';
import type { Pixels } from './colourCheck';

const SIZE = 64;
const full = () => ({ w: 8, h: 8, data: btoa(String.fromCharCode(...new Uint8Array(64).fill(255))) });
const square = () => {
  const cells = new Uint8Array(64);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) cells[y * 8 + x] = 255;
  return { w: 8, h: 8, data: btoa(String.fromCharCode(...cells)) };
};
const ai = (extra: Partial<TrueDetailAi> = {}): TrueDetailAi => ({
  model: 'nafnet-sidd-w32-w16', modelSha256: 'c'.repeat(64), asset: 'a'.repeat(64), framingKey: 'k',
  rect: { x: 0, y: 0, w: 1, h: 1 }, maskId: 'auto-denoise-p', subject: 0.8, eyes: 0.2, ...extra,
});

describe('TrueDetail AI: the stored learned result in the recipe', () => {
  it('validates the stored field strictly', () => {
    assert.equal(validTrueDetailAi(ai()), true);
    assert.equal(validTrueDetailAi(ai({ subject: 1.5 })), false);
    assert.equal(validTrueDetailAi(ai({ asset: 'not-a-hash' })), false);
    assert.equal(validTrueDetailAi(ai({ rect: { x: 0.5, y: 0, w: 0.6, h: 1 } })), false);
    assert.equal(validTrueDetailAi(null), false);
  });

  it('blends only inside the subject, with the eye strength inside an eye, and nothing without its pair', () => {
    const subject = { maskId: 'auto-denoise-p', grid: full(), framingKey: 'k', confidence: 'high' as const, alpha: new Float32Array(0), eyes: [{ x: 0.5, y: 0.5, radius: 0.05 }] };
    const masks = regionalDenoiseMasks(subject, { background: 1, subject: 0, eyes: 0 });
    const weight = trueDetailAiWeight(ai(), masks, SIZE, SIZE, fullContext(SIZE, SIZE));
    const centre = weight[32 * SIZE + 32], corner = weight[2 * SIZE + 2];
    assert.ok(Math.abs(centre - 0.2) < 0.02, `eye centre ${centre}`);
    assert.ok(Math.abs(corner - 0.8) < 0.02, `subject ${corner}`);
    const without = trueDetailAiWeight(ai(), masks.slice(1), SIZE, SIZE, fullContext(SIZE, SIZE));
    assert.ok(without.every(v => v === 0), 'a missing pair applies nothing');
    const outside = trueDetailAiWeight(ai(), regionalDenoiseMasks({ ...subject, grid: square(), eyes: [] }, { background: 1, subject: 0, eyes: 0 }), SIZE, SIZE, fullContext(SIZE, SIZE));
    assert.equal(outside[0], 0, 'background is untouched');
  });

  it('places the stored area in a zoomed view, and blends transparent pixels as no change', () => {
    const place = trueDetailAiPlacement(ai({ rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }), 100, 100, { aspect: 1, view: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    assert.deepEqual(place, { x: 0, y: 0, w: 100, h: 100 });
    const base = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]);
    const learned = new Uint8ClampedArray([200, 200, 200, 255, 0, 0, 0, 0]);
    blendLearned(base, learned, new Float32Array([0.5, 1]));
    assert.deepEqual([...base], [150, 150, 150, 255, 100, 100, 100, 255]);
  });

  it('finds the padded subject area', () => {
    const alpha = new Float32Array(100 * 100);
    for (let y = 40; y < 60; y++) for (let x = 30; x < 50; x++) alpha[y * 100 + x] = 1;
    const rect = subjectRect(alpha, 100, 100)!;
    assert.ok(rect.x < 0.3 && rect.x + rect.w > 0.5 && rect.y < 0.4 && rect.y + rect.h > 0.6);
    assert.equal(subjectRect(new Float32Array(100), 10, 10), null);
  });

  it('the 16-bit TIFF refuses an edit with a stored AI result rather than drop it', () => {
    assert.match(master16Blocker({ ...DEFAULT_EDIT, trueDetailAi: ai() }, undefined) ?? '', /trueDetailAi/);
  });
});

/** A noisy striped subject on noisy sky, and its clean version (what an ideal learned denoiser would return). */
function scene(noise: number): Pixels {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  let s = 3;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const inside = x >= 16 && x < 48 && y >= 16 && y < 48;
    const v = inside ? (x % 6 < 3 ? 70 : 150) : 140;
    const n = rand() * noise;
    const i = (y * SIZE + x) * 4;
    data[i] = v + n; data[i + 1] = v + n; data[i + 2] = v + n; data[i + 3] = 255;
  }
  return { data, width: SIZE, height: SIZE };
}

describe('TrueDetail AI in the regional guardian', () => {
  const alpha = () => { const a = new Float32Array(SIZE * SIZE); for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) a[y * SIZE + x] = 1; return a; };
  const subject = () => ({ maskId: 'auto-denoise-p', grid: square(), framingKey: 'k', confidence: 'high' as const, alpha: alpha() });
  const renderWith = (original: Pixels, learned: Pixels) => async (_e: unknown, masks: Mask[], blend?: { subject: number; eyes: number }) => {
    const data = new Uint8ClampedArray(original.data);
    if (blend) {
      const learnedRgba = new Uint8ClampedArray(learned.data);
      blendLearned(data, learnedRgba, trueDetailAiWeight({ maskId: 'auto-denoise-p', ...blend }, masks, SIZE, SIZE, fullContext(SIZE, SIZE)));
    }
    applyMasks(data, SIZE, SIZE, masks, fullContext(SIZE, SIZE));
    return { data, width: SIZE, height: SIZE };
  };

  it('chooses the learned result for the subject when it removes more noise and keeps the feathers', async () => {
    const original = scene(24), clean = scene(0);
    const result = await runDenoiseAction({ original, backgroundDenoise: 0.8, luminancePerStrength: 1, subject: subject(),
      render: renderWith(original, clean), learned: { source: 'nafnet-sidd-w32-w16', strengths: [1, 0.6] } });
    assert.equal(result.verification.ok, true, result.verification.reasons.join(' '));
    const choice = result.regions!.find(r => r.region === 'subject')!;
    assert.equal(choice.source, 'nafnet-sidd-w32-w16', JSON.stringify(choice.verdicts.map(v => [v.source, v.strength, v.reason, v.score])));
    assert.equal(result.learned?.subject, 1);
    assert.equal(result.masks[1].edit.denoise, 0, 'no conventional filter on top of the learned subject');
  });

  it('rejects a learned result that adds texture, and keeps the conventional choice', async () => {
    const original = scene(24);
    const harsh = { ...original, data: new Uint8ClampedArray(original.data) };
    for (let i = 0; i < harsh.data.length; i += 4) for (let c = 0; c < 3; c++) harsh.data[i + c] = 128 + (original.data[i + c] - 128) * 1.8;
    const result = await runDenoiseAction({ original, backgroundDenoise: 0.8, luminancePerStrength: 1, subject: subject(),
      render: renderWith(original, harsh), learned: { source: 'nafnet-sidd-w32-w16', strengths: [1, 0.6] } });
    const choice = result.regions!.find(r => r.region === 'subject')!;
    assert.equal(choice.source, 'conventional');
    assert.ok(choice.verdicts.some(v => v.source !== 'conventional' && !v.ok));
    assert.equal(result.learned, undefined);
  });
});
