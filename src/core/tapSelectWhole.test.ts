import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseSamMask, isWholeSubjectPrompt, wholeSubjectTap } from './efficientSam.ts';
import { createSubjectMask, type Mask } from './maskTypes.ts';
import { effectiveAlpha } from './masks.ts';
import { samMaskDetail, samMaskToGrid } from './tapSelectMask.ts';

/**
 * A synthetic close-up puffin, 256 x 192 mask pixels: a dark oval back with a white oval chest on its lower front. The
 * decoder's three candidates are given as logits (positive inside), as EfficientSAM returns them: the chest alone (rated
 * highest, as it was on _DJL3475), the whole bird (rated a little lower), and the background (most of the frame).
 */
const W = 256, H = 192;
const bird = (x: number, y: number) => Math.hypot((x - 128) / 80, (y - 100) / 60) - 1; // < 0 inside the whole bird
const chest = (x: number, y: number) => Math.hypot((x - 150) / 34, (y - 120) / 30) - 1; // < 0 inside the white chest
function candidates(): { masks: Float32Array; scores: Float32Array } {
  const plane = W * H;
  const masks = new Float32Array(plane * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    // Logits a few pixels wide either side of the edge: the soft edge the model gives after its own upsampling.
    masks[i] = -chest(x, y) * 30;
    masks[plane + i] = -bird(x, y) * 60;
    masks[2 * plane + i] = bird(x, y) * 60 + 4; // everything but the bird (and a little of its edge)
  }
  return { masks, scores: Float32Array.from([0.95, 0.88, 0.9]) };
}
const tapOnChest = { taps: [{ x: 150, y: 120, add: true }] };

test('a first tap on the white chest selects the whole bird, dark back included', () => {
  assert.equal(isWholeSubjectPrompt(tapOnChest), true);
  assert.deepEqual(wholeSubjectTap(tapOnChest), tapOnChest.taps[0]);
  const { masks, scores } = candidates();
  const chosen = chooseSamMask(masks, scores, W, H, tapOnChest.taps[0]);
  // Both regions are inside: a point on the dark back and one on the white chest.
  assert.equal(chosen.data[100 * W + 70], 1, 'the dark back is selected');
  assert.equal(chosen.data[120 * W + 150], 1, 'the white chest is selected');
  assert.equal(chosen.data[5 * W + 5], 0, 'the sky is not');
  assert.ok(chosen.coverage > 0.25 && chosen.coverage < 0.5, `coverage ${chosen.coverage}`);
  assert.ok(Math.abs(chosen.score - 0.88) < 1e-6, 'the score reported is the chosen candidate’s own');
});

test('the background candidate is never taken for a subject, however highly it is rated', () => {
  const { masks } = candidates();
  const chosen = chooseSamMask(masks, Float32Array.from([0.7, 0.72, 0.99]), W, H, tapOnChest.taps[0]);
  assert.equal(chosen.data[5 * W + 5], 0);
  assert.equal(chosen.data[100 * W + 70], 1);
});

test('a whole-object candidate the model rates much lower is not forced; later taps keep the model’s own best', () => {
  const { masks } = candidates();
  assert.equal(chooseSamMask(masks, Float32Array.from([0.95, 0.6, 0.5]), W, H, tapOnChest.taps[0]).data[100 * W + 70], 0, 'only the chest, as rated');
  // A second tap (a refinement) is answered with the model's best candidate, as before.
  const second = { taps: [{ x: 150, y: 120, add: true }, { x: 70, y: 100, add: false }] };
  assert.equal(isWholeSubjectPrompt(second), false);
  assert.equal(isWholeSubjectPrompt({ box: { x: 1, y: 1, w: 9, h: 9 }, taps: [{ x: 5, y: 5, add: true }] }), false);
  assert.equal(chooseSamMask(masks, Float32Array.from([0.95, 0.88, 0.9]), W, H, null).data[100 * W + 70], 0);
});

test('the selection keeps the model’s soft edge and a fine outline over the bird, so the edge drawn is smooth', () => {
  const { masks, scores } = candidates();
  const chosen = chooseSamMask(masks, scores, W, H, tapOnChest.taps[0]);
  assert.ok(chosen.soft, 'the soft edge is kept');
  const grid = samMaskToGrid(chosen, 48); // a deliberately coarse whole-frame grid
  const detail = samMaskDetail(chosen)!;
  assert.ok(detail, 'a fine outline over the bird');
  assert.ok(detail.region.w < 0.8 && detail.region.h < 0.8, 'covering the bird, not the frame');
  // The bird's edge as the editor draws it (1,024 px wide), compared with the true ellipse.
  const mask = createSubjectMask('m', grid, '', 'high', detail) as Mask;
  const outW = 1024, outH = 768;
  const alpha = effectiveAlpha({ ...mask, feather: 0 }, [mask], outW, outH, { aspect: outH / outW, view: { x: 0, y: 0, w: 1, h: 1 } });
  let worst = 0;
  for (let y = 4; y < outH - 4; y += 2) for (let x = 4; x < outW - 4; x += 2) {
    const inside = alpha[y * outW + x] >= 0.5;
    const truth = bird(((x + 0.5) / outW) * W, ((y + 0.5) / outH) * H) < 0;
    if (inside !== truth) {
      // Distance from this pixel to the true edge, in output pixels (the ellipse's level set scaled back).
      const d = Math.abs(bird(((x + 0.5) / outW) * W, ((y + 0.5) / outH) * H)) * 60 * (outW / W);
      worst = Math.max(worst, d);
    }
  }
  // A 48-cell grid alone is 21 px a cell at this size; the fine outline keeps the edge within a few pixels.
  assert.ok(worst < 6, `the edge strays ${worst.toFixed(1)} px`);
});
