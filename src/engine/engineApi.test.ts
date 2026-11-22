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
    assert.equal(response.capability, 'subject-detect');
    if (response.capability !== 'subject-detect') return; // narrows the union for the next line
    assert.equal(response.result.finding, null);
  });

  const cloudGates = { online: true, signedIn: true, userConsent: true };
  const original = flat(16, [120, 120, 120]);

  it('keeps offline, signed-out and unconsented jobs on the device', async () => {
    let cloudRuns = 0;
    for (const gate of ['online', 'signedIn', 'userConsent'] as const) {
      const result = await runEngineCapability({ capability: 'upscale', original, scale: 2 }, {
        ...cloudGates, [gate]: false,
        run: async () => { cloudRuns++; throw new Error('Unexpected cloud attempt'); },
      });
      assert.equal(result.runner, 'device');
    }
    assert.equal(cloudRuns, 0);
  });

  it('runs the device action if the cloud fails or its result is unverified', async () => {
    const request = { capability: 'upscale', original, scale: 2 } as const;
    const local = await runEngineCapability(request);
    assert.equal(local.capability, 'upscale');
    for (const run of [
      async () => { throw new Error('Cloud job unavailable'); },
      async () => ({ capability: 'upscale' as const, result: { ...local.result, verification: { ...local.result.verification, ok: false } } }),
    ]) {
      const result = await runEngineCapability(request, { ...cloudGates, run });
      assert.equal(result.runner, 'device');
      assert.equal(result.capability, 'upscale');
      assert.deepEqual(result.result.pixels, local.result.pixels);
    }
  });

  it('reports the cloud runner only when an eligible job returns a verified result', async () => {
    const request = { capability: 'upscale', original, scale: 2 } as const;
    const result = await runEngineCapability(request);
    assert.equal(result.capability, 'upscale');
    const cloud = await runEngineCapability(request, { ...cloudGates, run: async () => result });
    assert.equal(cloud.runner, 'cloud-processing');
  });

  it('does not start a local retry after the user cancels a cloud job', async () => {
    const controller = new AbortController();
    let localRuns = 0;
    await assert.rejects(runEngineCapability({
      capability: 'denoise', original, backgroundDenoise: 1,
      render: async () => { localRuns++; return original; },
    }, {
      ...cloudGates, signal: controller.signal,
      run: async () => { controller.abort(); throw new Error('Cloud request cancelled'); },
    }), { name: 'AbortError' });
    assert.equal(localRuns, 0);
  });
});
