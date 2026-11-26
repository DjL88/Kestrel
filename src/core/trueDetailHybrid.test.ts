import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { candidateLadder, chooseRegions, judgeRegion, qualifyLearned, regionWeights, scoreRegion, TRUEDETAIL_REGIONS } from './trueDetailHybrid';
import { alphaForArea } from './trueDetailAi';
import { applyMasks, fullContext } from './masks';
import { applyToneMasksRgb16 } from './master16';
import type { Mask } from './maskTypes';
import { runDenoiseAction, regionalDenoiseMasks } from '../engine/denoiseAction';
import type { Pixels } from './colourCheck';

/** A synthetic high-ISO "bird": noisy flat sky, a striped (feather-like) subject square, and a dark eye with a catchlight. */
const SIZE = 96, S0 = 28, S1 = 76, EYE = { x: 60, y: 44, r: 3 };
function bird(noise = 18, seed = 7): Pixels {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const inside = x >= S0 && x < S1 && y >= S0 && y < S1;
    let v = inside ? (x % 3 === 0 ? 70 : 150) : 140;
    const d = Math.hypot(x - EYE.x, y - EYE.y);
    if (d <= EYE.r) v = d < 1 ? 230 : 20;
    const n = rand() * noise;
    data[i] = v + n + rand() * noise * 0.5; data[i + 1] = v + n; data[i + 2] = v + n - rand() * noise * 0.5; data[i + 3] = 255;
  }
  return { data, width: SIZE, height: SIZE };
}
const subjectAlpha = () => {
  const a = new Float32Array(SIZE * SIZE);
  for (let y = S0; y < S1; y++) for (let x = S0; x < S1; x++) a[y * SIZE + x] = 1;
  return a;
};
// A full-coverage grid with a stroke-free subject mask, then the square restriction comes from the alpha we pass.
const grid = (() => {
  const w = 24, h = 24, cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = (x + 0.5) * SIZE / w, py = (y + 0.5) * SIZE / h;
    cells[y * w + x] = px >= S0 && px < S1 && py >= S0 && py < S1 ? 255 : 0;
  }
  return { w, h, data: btoa(String.fromCharCode(...cells)) };
})();

const render = (original: Pixels) => async (_edit: unknown, masks: Mask[]): Promise<Pixels> => {
  const data = new Uint8ClampedArray(original.data);
  applyMasks(data, SIZE, SIZE, masks, fullContext(SIZE, SIZE));
  return { data, width: SIZE, height: SIZE };
};

describe('TrueDetail regional guardian', () => {
  it('the candidate ladder is strongest first, capped at 2, and scaled by the request', () => {
    const ladder = candidateLadder(0.8);
    assert.deepEqual(ladder, [...ladder].sort((a, b) => b - a));
    assert.equal(ladder[0], 1.6);
    assert.ok(candidateLadder(2).every(v => v <= 2));
  });

  it('region weights always sum to one and eyes sit inside the subject', () => {
    const subject = new Float32Array([0, 0.5, 1, 1]), eyes = new Float32Array([1, 1, 0.5, 0]);
    const w = regionWeights(subject, eyes);
    for (let p = 0; p < 4; p++) assert.ok(Math.abs(w.background[p] + w.subject[p] + w.eyes![p] - 1) < 1e-6);
    assert.equal(w.eyes![0], 0, 'an eye outside the subject is not an eye region');
  });

  it('rejects added texture, detail loss and no improvement, in that order of seriousness', () => {
    const base = { coverage: 1000, noiseBefore: 10, noiseAfter: 5, detail: 1, worstBlock: 1, addedTexture: -0.5 };
    const policy = TRUEDETAIL_REGIONS.subject;
    assert.equal(judgeRegion(base, policy), null);
    assert.equal(judgeRegion({ ...base, addedTexture: 0.2 }, policy), 'added texture that is not in the original');
    assert.equal(judgeRegion({ ...base, detail: 0.5 }, policy), 'lost real detail');
    assert.equal(judgeRegion({ ...base, noiseAfter: 9.9 }, policy), 'did not reduce the noise');
    assert.equal(judgeRegion({ ...base, coverage: 10 }, policy), 'too small to judge');
  });

  it('a sharpened (texture-adding) candidate is measured as adding texture', () => {
    const original = bird();
    const sharp = { ...original, data: new Uint8ClampedArray(original.data) };
    for (let i = 0; i < sharp.data.length; i += 4) for (let c = 0; c < 3; c++) sharp.data[i + c] = 128 + (original.data[i + c] - 128) * 1.6;
    const weight = new Float32Array(SIZE * SIZE).fill(1);
    assert.ok(scoreRegion(original, sharp, weight).addedTexture > 0.03);
  });

  it('chooses per region with the real noise reduction: background strongest, subject gentler, feathers kept', async () => {
    const original = bird();
    const alpha = subjectAlpha();
    const subject = { maskId: 'auto-denoise-t', grid, framingKey: 'k', confidence: 'high' as const, alpha };
    const weights = regionWeights(alpha);
    const choices = await chooseRegions(original, [
      { region: 'background', weight: weights.background }, { region: 'subject', weight: weights.subject },
    ], 0.8, (strength) => render(original)({}, regionalDenoiseMasks(subject, { background: strength, subject: strength, eyes: strength }, 1)));
    const bg = choices.find(c => c.region === 'background')!, fg = choices.find(c => c.region === 'subject')!;
    assert.ok(bg.strength > 0, `background chose a candidate (${bg.kept})`);
    assert.ok(bg.strength > fg.strength, `background ${bg.strength} stronger than subject ${fg.strength}`);
    for (const v of fg.verdicts.filter(v => v.ok)) assert.ok(v.score.detail >= TRUEDETAIL_REGIONS.subject.minDetail);
  });

  it('runs end to end through the denoise action with eye protection, and the result is cleaner where it should be', async () => {
    const original = bird();
    const alpha = subjectAlpha();
    const result = await runDenoiseAction({
      original, backgroundDenoise: 0.8, luminancePerStrength: 1, render: render(original),
      subject: { maskId: 'auto-denoise-t', grid, framingKey: 'k', confidence: 'high', alpha, eyes: [{ x: (EYE.x + 0.5) / SIZE, y: (EYE.y + 0.5) / SIZE, radius: EYE.r / SIZE }] },
    });
    assert.equal(result.verification.ok, true, result.verification.reasons.join(' '));
    const [bg, fg, eye] = result.masks;
    assert.equal(bg.id, 'auto-denoise-t-background');
    assert.equal(eye.kind, 'radial');
    assert.ok(bg.edit.denoise! > fg.edit.denoise!);
    assert.ok(eye.edit.denoise! <= fg.edit.denoise!);
    assert.ok(bg.edit.denoiseLuminance! > 0, 'grain is reduced regionally');
    const after = await render(original)({}, result.masks);
    const sky = regionWeights(alpha).background;
    const s = scoreRegion(original, after, sky);
    assert.ok(s.noiseAfter < s.noiseBefore * 0.95, `sky noise ${s.noiseBefore} → ${s.noiseAfter}`);
    const feathers = scoreRegion(original, after, alpha);
    assert.ok(feathers.detail >= 0.85, `feather structure kept ${feathers.detail}`);
  });

  it('the 8-bit preview and 16-bit master agree on a regional recipe with grain and an eye', () => {
    const original = bird();
    const subject = { maskId: 'auto-denoise-t', grid, framingKey: 'k', confidence: 'high' as const, alpha: subjectAlpha(), eyes: [{ x: 0.63, y: 0.46, radius: 0.04 }] };
    const masks = regionalDenoiseMasks(subject, { background: 1.6, subject: 0.5, eyes: 0.1 }, 1);
    const eight = new Uint8ClampedArray(original.data);
    applyMasks(eight, SIZE, SIZE, masks, fullContext(SIZE, SIZE));
    const sixteen = new Uint16Array(SIZE * SIZE * 3);
    for (let p = 0; p < SIZE * SIZE; p++) for (let c = 0; c < 3; c++) sixteen[p * 3 + c] = original.data[p * 4 + c] * 257;
    // A small strip budget forces many strips, so halo handling is exercised too.
    applyToneMasksRgb16({ width: SIZE, height: SIZE, data: sixteen }, masks, SIZE * 7);
    let worst = 0, changed = 0;
    for (let p = 0; p < SIZE * SIZE; p++) for (let c = 0; c < 3; c++) {
      worst = Math.max(worst, Math.abs(sixteen[p * 3 + c] / 257 - eight[p * 4 + c]));
      if (eight[p * 4 + c] !== original.data[p * 4 + c]) changed++;
    }
    assert.ok(changed > 1000, 'the recipe changed the picture');
    assert.ok(worst <= 3, `largest difference ${worst.toFixed(2)} of 255`);
    // Masks other than the pair stay untouched by the eye layer: it is consumed, not applied twice.
    const once = new Uint8ClampedArray(original.data);
    applyMasks(once, SIZE, SIZE, masks.slice(0, 2), fullContext(SIZE, SIZE));
    assert.ok(once.some((v, i) => v !== eight[i]), 'the eye layer changes its area');
  });

  it('eye protection keeps the eye closer to the original than the subject strength would', () => {
    const original = bird();
    const subject = { maskId: 'auto-denoise-t', grid, framingKey: 'k', confidence: 'high' as const, alpha: subjectAlpha(), eyes: [{ x: (EYE.x + 0.5) / SIZE, y: (EYE.y + 0.5) / SIZE, radius: EYE.r / SIZE }] };
    const diff = (masks: Mask[]) => {
      const data = new Uint8ClampedArray(original.data);
      applyMasks(data, SIZE, SIZE, masks, fullContext(SIZE, SIZE));
      let sum = 0;
      for (let y = EYE.y - 2; y <= EYE.y + 2; y++) for (let x = EYE.x - 2; x <= EYE.x + 2; x++) for (let c = 0; c < 3; c++) {
        const i = (y * SIZE + x) * 4 + c;
        sum += Math.abs(data[i] - original.data[i]);
      }
      return sum;
    };
    const withEye = diff(regionalDenoiseMasks(subject, { background: 1.6, subject: 1.2, eyes: 0 }, 1));
    const without = diff(regionalDenoiseMasks({ ...subject, eyes: [] }, { background: 1.6, subject: 1.2, eyes: 0 }, 1));
    assert.ok(withEye < without, `eye change ${withEye} < ${without}`);
  });
});


describe('learned candidate judged at full size (qualifyLearned)', () => {
  const W = 160;
  /** Feather-like stripes (a real structure step) under noise, plus the clean version and an over-smoothed one. */
  function scene(period: number) {
    let s = 11;
    const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
    const clean = new Uint8ClampedArray(W * W * 4), noisy = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, v = x % period < period / 2 ? 70 : 150;
      clean.set([v, v, v, 255], i);
      const n = rand() * 24;
      noisy.set([v + n, v + n, v + n, 255], i);
    }
    const blurred = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      let sum = 0, count = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(W - 1, Math.max(0, y + dy));
        sum += noisy[(yy * W + xx) * 4]; count++;
      }
      const v = Math.round(sum / count);
      blurred.set([v, v, v, 255], (y * W + x) * 4);
    }
    const px = (data: Uint8ClampedArray): Pixels => ({ data, width: W, height: W });
    return { clean: px(clean), noisy: px(noisy), blurred: px(blurred) };
  }
  const shrink = (p: Pixels, f: number): Pixels => {
    const w = p.width / f, out = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) sum += p.data[((y * f + dy) * p.width + x * f + dx) * 4 + c];
      out[(y * w + x) * 4 + c] = Math.round(sum / (f * f));
    }
    return { data: out, width: w, height: w };
  };

  it('refuses an over-smoothed learned result at every offered strength, even though it looks fine at working size', () => {
    // Feathers finer than the working copy shows them: 4 px stripes at 100%, 1 px once scaled down 4x.
    const { noisy, blurred } = scene(4);
    const alpha = new Float32Array(W * W).fill(1);
    const verdicts = qualifyLearned(noisy, blurred, alpha, [1, 0.6]);
    assert.deepEqual(verdicts.map(v => v.reason), ['lost real detail', 'lost real detail']);
    // The bug this guards against: scaled down 4x, as the 1600 px working copy is, the same result's detail loss is hidden.
    const small = shrink(noisy, 4), smallBlend = shrink(blurred, 4);
    const atWorking = judgeRegion(scoreRegion(small, smallBlend, new Float32Array(small.width * small.height).fill(1)), TRUEDETAIL_REGIONS.subject);
    assert.notEqual(atWorking, 'lost real detail');
  });

  it('accepts a learned result that removes the noise and keeps the structure', () => {
    const { noisy, clean } = scene(16);
    const verdicts = qualifyLearned(noisy, clean, new Float32Array(W * W).fill(1), [1, 0.6]);
    assert.deepEqual(verdicts.map(v => v.reason), [null, null]);
    assert.ok(verdicts[0].score.noiseAfter < verdicts[0].score.noiseBefore * 0.5);
  });

  it('judges only where the subject is', () => {
    const { noisy, blurred } = scene(16);
    assert.equal(qualifyLearned(noisy, blurred, new Float32Array(W * W), [1])[0].reason, 'too small to judge');
  });

  it('maps the working-size subject alpha onto the full-size area', () => {
    // Working copy 10x10 with the subject in its right half; the area is the right half, drawn 4x larger.
    const working = new Float32Array(100);
    for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) working[y * 10 + x] = x >= 7 ? 1 : 0;
    const area = alphaForArea(working, 10, 10, { x: 0.5, y: 0, w: 0.5, h: 1 }, 20, 40);
    assert.equal(area.length, 20 * 40);
    assert.equal(area[0], 0); // left edge of the area: working column 5
    assert.equal(area[19], 1); // right edge: working column 9
    assert.equal(area[39 * 20 + 19], 1);
  });
});
