import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitDenoiseBySubject, subjectDenoiseMask, runDenoiseAction } from './denoiseAction.ts';
import type { Pixels } from '../core/colourCheck';
import type { SubjectGrid } from '../core/maskTypes';

function flat(size: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

const grid: SubjectGrid = { w: 1, h: 1, data: '' };

describe('splitDenoiseBySubject', () => {
  it('gives the subject a lower strength than the background by default', () => {
    const { background, subject } = splitDenoiseBySubject(1.5);
    assert.equal(background, 1.5);
    assert.ok(subject < background);
    assert.equal(subject, 0.6); // 1.5 * 0.4
  });

  it('clamps background to the real 0-2 PhotoEdit.denoise range', () => {
    assert.equal(splitDenoiseBySubject(5).background, 2);
    assert.equal(splitDenoiseBySubject(-1).background, 0);
  });

  it('a protection of 1 gives the subject the same strength as the background', () => {
    assert.deepEqual(splitDenoiseBySubject(1, 1), { background: 1, subject: 1 });
  });
});

describe('subjectDenoiseMask', () => {
  it('builds a real subject mask carrying its own denoise value', () => {
    const mask = subjectDenoiseMask('m1', grid, 'frame-1', 'high', 0.6);
    assert.equal(mask.kind, 'subject');
    assert.equal(mask.edit.denoise, 0.6);
    assert.equal(mask.id, 'm1');
  });
});

describe('runDenoiseAction', () => {
  it('accepts a result that passes verification on the first attempt', async () => {
    const original = flat(16, [120, 120, 120]);
    const render = async () => flat(16, [121, 121, 121]); // barely changed
    const result = await runDenoiseAction({ backgroundDenoise: 1, original, render });
    assert.equal(result.attempts, 1);
    assert.equal(result.verification.ok, true);
    assert.equal(result.edit.denoise, 1);
    assert.deepEqual(result.masks, []);
  });

  it('includes a lower-strength subject mask when a subject is given', async () => {
    const original = flat(16, [120, 120, 120]);
    const render = async () => flat(16, [121, 121, 121]);
    const result = await runDenoiseAction({
      backgroundDenoise: 1, original, render,
      subject: { maskId: 's1', grid, framingKey: 'f1', confidence: 'high', alpha: new Float32Array(16 * 16).fill(1) },
    });
    assert.equal(result.masks.length, 1);
    assert.equal(result.masks[0].edit.denoise, 0.4);
    assert.equal(result.edit.denoise, 1);
  });

  it('retries at a reduced strength when the result over-smooths, then stops at maxRetries', async () => {
    let calls = 0;
    const original = flat(16, [120, 120, 120]);
    // Every render reports the same over-bright result, so verification never passes - proves it actually
    // retries (background strength only ever goes down) and stops rather than looping forever.
    const render = async () => { calls += 1; return flat(16, [250, 250, 250]); };
    const result = await runDenoiseAction({ backgroundDenoise: 1, original, render, maxRetries: 2 });
    assert.equal(calls, 3); // initial attempt + 2 retries
    assert.equal(result.attempts, 3);
    assert.equal(result.verification.ok, false);
    assert.ok(result.edit.denoise! < 1);
  });
});
