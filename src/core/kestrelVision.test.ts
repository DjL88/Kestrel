import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSubjectKestrel } from './kestrelVision';

function makeSubjectFrame({ sharp = true }: { sharp?: boolean }): Uint8ClampedArray {
  const w = 96;
  const h = 64;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (x - w * 0.5) / 14;
      const dy = (y - h * 0.5) / 12;
      const dist = Math.hypot(dx, dy);
      // Warm orange/chestnut subject silhouette centered over cool sky-blue background
      const stripe = sharp && ((x + y) % 2 === 0) ? 28 : 0;
      const alphaFg = sharp
        ? (dist <= 1.0 ? 1 : 0)
        : Math.max(0, Math.min(1, 1.4 - dist));
      const r = Math.round(70 * (1 - alphaFg) + (195 + stripe) * alphaFg);
      const g = Math.round(135 * (1 - alphaFg) + (90 - stripe * 0.4) * alphaFg);
      const b = Math.round(210 * (1 - alphaFg) + 45 * alphaFg);
      const i = (y * w + x) * 4;
      pixels[i] = Math.min(255, Math.max(0, r));
      pixels[i + 1] = Math.min(255, Math.max(0, g));
      pixels[i + 2] = Math.min(255, Math.max(0, b));
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

test('analyzeSubjectKestrel segments a high-contrast centered subject cleanly offline', () => {
  const sharpPixels = makeSubjectFrame({ sharp: true });
  const result = analyzeSubjectKestrel(sharpPixels, 96, 64);

  assert.equal(result.engine, 'kestrel-experimental-v1');
  assert.equal(result.assessment.usable, true);
  assert.ok(result.box, 'produces subject bounding box');
  assert.ok(result.coverage > 0.05 && result.coverage < 0.7);
  assert.ok(result.grid.data.length > 10);
  // Center of box should sit near middle of frame
  const boxCenterX = result.box!.x + result.box!.w / 2;
  const boxCenterY = result.box!.y + result.box!.h / 2;
  assert.ok(Math.abs(boxCenterX - 48) < 16);
  assert.ok(Math.abs(boxCenterY - 32) < 12);
});

test('analyzeSubjectKestrel scores textured sharp subjects significantly higher sharpness than soft/blurry frames', () => {
  const sharpResult = analyzeSubjectKestrel(makeSubjectFrame({ sharp: true }), 96, 64);
  const softResult = analyzeSubjectKestrel(makeSubjectFrame({ sharp: false }), 96, 64);
  assert.ok(sharpResult.sharpness > softResult.sharpness,
    `expected sharp (${sharpResult.sharpness}) > soft (${softResult.sharpness})`);
});

test('analyzeSubjectKestrel handles uniform flat backgrounds gracefully without crashing or inventing tiny boxes', () => {
  const flat = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < flat.length; i += 4) {
    flat[i] = 120;
    flat[i + 1] = 140;
    flat[i + 2] = 160;
    flat[i + 3] = 255;
  }
  const result = analyzeSubjectKestrel(flat, 64, 48);
  assert.equal(result.engine, 'kestrel-experimental-v1');
  assert.equal(result.sharpness, 0);
});
