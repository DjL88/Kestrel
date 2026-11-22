import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMaskAction, combineMasks } from './maskAction.ts';
import type { Pixels } from '../core/colourCheck';
import type { Mask } from '../core/maskTypes';

function flat(size: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

const radial = (id: string, edit: Mask['edit'] = {}): Mask =>
  ({ kind: 'radial', id, invert: false, feather: 0.3, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, edit });

describe('combineMasks', () => {
  it('sets a limit against another mask, intersect or subtract', () => {
    const sky = radial('sky');
    const limited = combineMasks(sky, 'subject-1', 'intersect');
    assert.deepEqual(limited.limit, { id: 'subject-1', mode: 'intersect' });
    assert.equal(combineMasks(sky, 'subject-1', 'subtract').limit!.mode, 'subtract');
  });

  it('refuses a mask limiting itself rather than silently accepting a no-op loop', () => {
    const sky = radial('sky');
    assert.throws(() => combineMasks(sky, 'sky', 'intersect'));
  });

  it('leaves the original mask object untouched (returns a new one)', () => {
    const sky = radial('sky');
    const limited = combineMasks(sky, 'other', 'intersect');
    assert.equal(sky.limit, undefined);
    assert.notEqual(limited, sky);
  });
});

describe('runMaskAction', () => {
  it('accepts a result that passes verification on the first attempt', async () => {
    const original = flat(16, [120, 120, 120]);
    const masks = [radial('m1', { exposure: 0.2 })];
    const render = async () => flat(16, [121, 121, 121]);
    const result = await runMaskAction({ masks, original, render });
    assert.equal(result.attempts, 1);
    assert.equal(result.verification.ok, true);
    assert.equal(result.masks, masks, 'unretried masks are returned unchanged');
  });

  it('renders a two-mask intersect/subtract combination as a single pass, unchanged in shape', async () => {
    const original = flat(16, [120, 120, 120]);
    const subject = radial('subject-1');
    const sky = combineMasks(radial('sky', { exposure: -0.3 }), 'subject-1', 'subtract');
    let renderedMasks: Mask[] | null = null;
    const render = async (masks: Mask[]) => { renderedMasks = masks; return flat(16, [121, 121, 121]); };
    const result = await runMaskAction({ masks: [subject, sky], original, render });
    assert.equal(renderedMasks!.length, 2);
    assert.equal(renderedMasks![1].limit!.mode, 'subtract');
    assert.equal(result.verification.ok, true);
  });

  it('judges only inside the subject when a subject alpha is given, not the whole frame', async () => {
    const original = flat(16, [120, 120, 120]);
    // Background goes very bright, subject stays put - should still pass because only the subject matters here.
    const after: Pixels = flat(16, [250, 250, 250]);
    const subjectAlpha = new Float32Array(16 * 16).fill(0); // the "subject" covers nothing in this fixture
    const render = async () => after;
    const result = await runMaskAction({ masks: [radial('bg', { exposure: 1 })], original, render, subject: { alpha: subjectAlpha } });
    assert.equal(result.verification.ok, true);
  });

  it('retries every mask at a reduced strength together on overshoot, then stops at maxRetries', async () => {
    let calls = 0;
    const original = flat(16, [120, 120, 120]);
    const masks = [radial('m1', { exposure: 1, warmth: 0.5 })];
    const render = async () => { calls += 1; return flat(16, [250, 250, 250]); };
    const result = await runMaskAction({ masks, original, render, maxRetries: 2 });
    assert.equal(calls, 3);
    assert.equal(result.attempts, 3);
    assert.equal(result.verification.ok, false);
    assert.ok(result.masks[0].edit.exposure! < 1);
    assert.ok(result.masks[0].edit.warmth! < 0.5);
  });

  it('never touches a mask\'s shape, feather or limit while scaling its edit down', async () => {
    const original = flat(16, [120, 120, 120]);
    const masks = [combineMasks(radial('m1', { exposure: 1 }), 'm2', 'intersect')];
    const render = async () => flat(16, [250, 250, 250]);
    const result = await runMaskAction({ masks, original, render, maxRetries: 1 });
    assert.equal(result.masks[0].kind, 'radial');
    assert.equal(result.masks[0].feather, 0.3);
    assert.deepEqual(result.masks[0].limit, { id: 'm2', mode: 'intersect' });
  });
});
