import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runUpscaleAction } from './upscaleAction.ts';
import type { Pixels } from '../core/colourCheck';
import type { PixelBuffer } from '../core/upscaleResample';
import type { TileModel } from '../core/upscaleTiles';

function flat(size: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

/** A trivial, colour-faithful "model": nearest-neighbour duplication at the given scale. Good enough to
 * prove the model path runs and its result passes verification when it genuinely preserves colour. */
function faithfulModel(scale: 2 | 4): TileModel {
  return async (tile: PixelBuffer<Uint8ClampedArray>) => {
    const outW = tile.width * scale, outH = tile.height * scale;
    const data = new Uint8ClampedArray(outW * outH * 3);
    for (let y = 0; y < outH; y += 1) {
      for (let x = 0; x < outW; x += 1) {
        const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
        const si = (sy * tile.width + sx) * 3, di = (y * outW + x) * 3;
        data[di] = tile.data[si]; data[di + 1] = tile.data[si + 1]; data[di + 2] = tile.data[si + 2];
      }
    }
    return { data, width: outW, height: outH, channels: 3 };
  };
}

/** A "model" that always paints its tile a clashing colour, regardless of input - a stand-in for a
 * learned enlarger that has gone wrong, to prove the verify -> fall back to the resampler path. */
function colourShiftingModel(scale: 2 | 4): TileModel {
  return async (tile: PixelBuffer<Uint8ClampedArray>) => {
    const outW = tile.width * scale, outH = tile.height * scale;
    const data = new Uint8ClampedArray(outW * outH * 3);
    for (let i = 0; i < data.length; i += 3) { data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; }
    return { data, width: outW, height: outH, channels: 3 };
  };
}

describe('runUpscaleAction', () => {
  it('upscales with the deterministic resampler alone when no model is given', async () => {
    const original = flat(16, [120, 130, 140]);
    const result = await runUpscaleAction({ original, scale: 2 });
    assert.equal(result.usedModel, false);
    assert.equal(result.attempts, 1);
    assert.equal(result.pixels.width, 32);
    assert.equal(result.pixels.height, 32);
    assert.equal(result.verification.ok, true);
  });

  it('accepts the learned model\'s result when it holds up under verification', async () => {
    const original = flat(16, [120, 130, 140]);
    const result = await runUpscaleAction({ original, scale: 2, model: faithfulModel(2) });
    assert.equal(result.usedModel, true);
    assert.equal(result.attempts, 1);
    assert.equal(result.pixels.width, 32);
    assert.equal(result.verification.ok, true);
  });

  it('falls back to the resampler when the model\'s result fails verification, and reports that', async () => {
    const original = flat(16, [120, 130, 140]);
    const result = await runUpscaleAction({ original, scale: 2, model: colourShiftingModel(2) });
    assert.equal(result.usedModel, false);
    assert.equal(result.attempts, 2);
    assert.equal(result.verification.ok, true); // the resampler fallback preserves colour, so it passes
    assert.equal(result.pixels.width, 32);
    assert.equal(result.pixels.height, 32);
  });

  it('scales to 4x and keeps RGBA with full alpha', async () => {
    const original = flat(8, [50, 60, 70]);
    const result = await runUpscaleAction({ original, scale: 4 });
    assert.equal(result.pixels.width, 32);
    assert.equal(result.pixels.height, 32);
    assert.equal(result.pixels.data[3], 255);
  });
});
