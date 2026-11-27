import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseSamMask } from './efficientSam.ts';
import { createSubjectMask, type Mask } from './maskTypes.ts';
import { effectiveAlpha } from './masks.ts';
import { maskCoverageGuide } from './maskCoverageGuide.ts';
import { samMaskDetail, samMaskToGrid } from './tapSelectMask.ts';

/**
 * A close-up puffin (256 x 192 mask pixels) side on, beak to the right: an oval body, and a beak whose underside meets
 * the throat in a concave corner (the notch under the beak and chin, owner's report on _DJL3475, 27 Nov). Distances are
 * signed mask pixels, negative inside, and logits are 1.5 per pixel, the soft edge the model gives.
 */
const W = 256, H = 192;
const body = (x: number, y: number) => (Math.hypot((x - 120) / 75, (y - 105) / 60) - 1) * 60;
function beak(x: number, y: number) {
  const t = (x - 185) / 50;
  const upper = 80 + 12 * t, lower = 100 - 8 * t;
  return Math.max(upper - y, y - lower, 185 - x, x - 235);
}
const bird = (x: number, y: number) => Math.min(body(x, y), beak(x, y));
/** The gap a blobby mask bridges: from the beak's underside at the face, to its tip, to the neck. */
function gap(x: number, y: number) {
  const [ax, ay, bx, by, cx, cy] = [192, 99, 235, 92, 198, 142];
  const side = (px: number, py: number, qx: number, qy: number) => ((qx - px) * (y - py) - (qy - py) * (x - px)) / Math.hypot(qx - px, qy - py);
  return Math.max(-side(ax, ay, bx, by), -side(bx, by, cx, cy), -side(cx, cy, ax, ay));
}
const tap = { x: 150, y: 120, add: true };
/** Points in the notch, outside the bird: one in the middle of it, and one just 5 px from the corner itself. */
const inNotch = [{ x: 207, y: 113 }, { x: 200, y: 103 }];

function candidates(filledScore: number) {
  const plane = W * H;
  const masks = new Float32Array(plane * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    masks[i] = -Math.hypot((x - 150) / 30, (y - 120) / 26) * 30 + 30; // the white chest alone
    masks[plane + i] = -bird(x, y) * 1.5; // the whole bird, following the beak and the chin
    masks[2 * plane + i] = -Math.min(bird(x, y), gap(x, y)) * 1.5; // the whole bird with the notch filled in
  }
  return { masks, scores: Float32Array.from([0.95, 0.88, filledScore]) };
}

test('a first tap takes the whole bird that follows the chin, not the slightly larger one that fills the notch', () => {
  for (const filledScore of [0.86, 0.88, 0.9]) {
    const { masks, scores } = candidates(filledScore);
    const chosen = chooseSamMask(masks, scores, W, H, tap);
    for (const p of inNotch) assert.equal(chosen.data[p.y * W + p.x], 0, `the notch at ${p.x},${p.y} is left out (filled rated ${filledScore})`);
    assert.equal(chosen.data[100 * W + 70], 1, 'the whole bird is still selected');
    assert.equal(chosen.data[90 * W + 220], 1, 'beak included');
  }
});

test('the concave corner under the beak survives the grid, the fine outline and the outline drawn: not smoothed over', () => {
  const { masks, scores } = candidates(0.86);
  const chosen = chooseSamMask(masks, scores, W, H, tap);
  const mask = { ...createSubjectMask('m', samMaskToGrid(chosen), '', 'high', samMaskDetail(chosen)), feather: 0.3 } as Mask;
  const outW = 2048, outH = 1536;
  const alpha = effectiveAlpha(mask, [mask], outW, outH, { aspect: outH / outW, view: { x: 0, y: 0, w: 1, h: 1 } });
  const at = (p: { x: number; y: number }) => alpha[Math.floor(((p.y + 0.5) / H) * outH) * outW + Math.floor(((p.x + 0.5) / W) * outW)];
  for (const p of inNotch) assert.ok(at(p) < 0.5, `the notch at ${p.x},${p.y} is not selected in the editor (${at(p).toFixed(2)})`);
  assert.ok(at({ x: 215, y: 90 }) > 0.5, 'the beak is');
  // The outline drawn follows the beak's underside: going down from the beak at x = 210, the line comes within a few
  // pixels of the underside (y ≈ 96), not 30 px lower where a straight line from the tip to the neck would cross.
  const guide = maskCoverageGuide([mask], 'm', 4000, 3000, 'outline')!;
  const gx = Math.floor((210.5 / W) * guide.width);
  let lineAt = -1;
  for (let gy = Math.floor((96 / H) * guide.height); gy < guide.height && lineAt < 0; gy++) {
    const i = (gy * guide.width + gx) * 4;
    if (guide.rgba[i] === 255 && guide.rgba[i + 3] > 200) lineAt = (gy / guide.height) * H;
  }
  assert.ok(lineAt > 0 && lineAt < 100, `the line under the beak is at y = ${lineAt.toFixed(1)}, the underside is at 96`);
});
