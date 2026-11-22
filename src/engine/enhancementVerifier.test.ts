import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEdit } from './enhancementVerifier.ts';
import type { Pixels } from '../core/colourCheck';

function flat(size: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

/** A checkerboard so the detail-ratio gradient check has something real to measure. */
function checkerboard(size: number, a: [number, number, number], b: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const on = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0;
      const rgb = on ? a : b;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

describe('verifyEdit', () => {
  it('accepts a result that barely changed', () => {
    const before = checkerboard(32, [120, 120, 120], [136, 136, 136]);
    const after = checkerboard(32, [122, 122, 122], [138, 138, 138]);
    const result = verifyEdit(before, after);
    assert.equal(result.ok, true);
    assert.equal(result.suggestedStrengthScale, 1);
  });

  it('flags a result that got much brighter and suggests a weaker reapply', () => {
    const before = checkerboard(32, [40, 40, 40], [56, 56, 56]);
    const after = checkerboard(32, [220, 220, 220], [236, 236, 236]);
    const result = verifyEdit(before, after);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => /brighter/.test(r)));
    assert.ok(result.suggestedStrengthScale < 1);
  });

  it('flags a result that got much darker', () => {
    const before = checkerboard(32, [220, 220, 220], [236, 236, 236]);
    const after = checkerboard(32, [20, 20, 20], [36, 36, 36]);
    const result = verifyEdit(before, after);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => /darker/.test(r)));
  });

  it('flags denoising that smoothed away the real detail', () => {
    const before = checkerboard(32, [80, 80, 80], [180, 180, 180]);
    const after = flat(32, [130, 130, 130]); // all detail gone - a stand-in for an over-aggressive denoise
    const result = verifyEdit(before, after);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => /denois/i.test(r)));
    assert.ok(result.suggestedStrengthScale <= 0.5);
  });

  it('flags an oversaturated/clipped result via the real checkColour findings', () => {
    const before = checkerboard(32, [120, 100, 90], [140, 115, 100]);
    const after = checkerboard(32, [255, 0, 0], [255, 10, 5]); // clipped, intensely saturated red
    const result = verifyEdit(before, after);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => /colour/i.test(r)));
  });

  it("with detailScope 'subject', ignores background detail loss outside the mask", () => {
    const before = checkerboard(32, [80, 80, 80], [180, 180, 180]);
    // Left half (x < 16, the "subject") keeps its checkerboard detail; right half (background) is
    // flattened, as a deliberate background blur Look step would do on purpose.
    const after = checkerboard(32, [80, 80, 80], [180, 180, 180]);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 16; x < 32; x += 1) {
        const i = (y * 32 + x) * 4;
        after.data[i] = 130; after.data[i + 1] = 130; after.data[i + 2] = 130;
      }
    }
    const subject = new Float32Array(32 * 32);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 16; x += 1) subject[y * 32 + x] = 1;
    const result = verifyEdit(before, after, subject, 'subject');
    assert.equal(result.ok, true);
  });

  it("with detailScope 'subject', still flags detail loss inside the mask", () => {
    const before = checkerboard(32, [80, 80, 80], [180, 180, 180]);
    const after = flat(32, [130, 130, 130]); // smoothed everywhere, including the subject this time
    const subject = new Float32Array(32 * 32).fill(1); // whole frame counts as subject
    const result = verifyEdit(before, after, subject, 'subject');
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => /subject/i.test(r)));
  });

  it("detailScope 'subject' with no subject mask falls back to whole-frame behaviour", () => {
    const before = checkerboard(32, [80, 80, 80], [180, 180, 180]);
    const after = flat(32, [130, 130, 130]);
    const result = verifyEdit(before, after, undefined, 'subject');
    assert.equal(result.ok, false);
  });
});
