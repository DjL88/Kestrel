import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEngineCapability } from './engineApi.ts';
import type { Pixels } from '../core/colourCheck';

function flat(size: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

describe('runEngineCapability', () => {
  it('routes a denoise request to the real runDenoiseAction', async () => {
    const original = flat(16, [120, 120, 120]);
    const response = await runEngineCapability({
      capability: 'denoise', backgroundDenoise: 1, original, render: async () => flat(16, [121, 121, 121]),
    });
    assert.equal(response.capability, 'denoise');
    assert.equal(response.result.verification.ok, true);
    assert.equal(response.result.edit.denoise, 1);
  });

  it('routes an upscale request to the real runUpscaleAction', async () => {
    const original = flat(16, [120, 130, 140]);
    const response = await runEngineCapability({ capability: 'upscale', original, scale: 2 });
    assert.equal(response.capability, 'upscale');
    assert.equal(response.result.pixels.width, 32);
  });

  it('routes a subject-detect request to the real runSubjectDetectAction', async () => {
    const response = await runEngineCapability({
      capability: 'subject-detect',
      frameId: 'f1',
      detect: async () => ({ detection: { label: 'bird', classId: 1, score: 0.8, box: { x: 0, y: 0, w: 200, h: 180 } }, sharpness: 20, coverage: 0.3 }),
    });
    assert.equal(response.capability, 'subject-detect');
    assert.equal(response.result.trust.reason, 'subjectSharp');
  });

  it('rejects an unimplemented cloud runner for subject-detect rather than silently running on-device', async () => {
    await assert.rejects(
      () => runEngineCapability({ capability: 'subject-detect', frameId: 'f2', detect: async () => null, runner: 'cloud-gemini' }),
      /no implementation yet/,
    );
  });

  it('allows the device runner for subject-detect explicitly', async () => {
    const response = await runEngineCapability({ capability: 'subject-detect', frameId: 'f3', detect: async () => null, runner: 'device' });
    assert.equal(response.result.finding, null);
  });
});
