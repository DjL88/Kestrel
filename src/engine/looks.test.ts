import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runLook, createCustomLook, LIFT_SUBJECT_BLUR_BACKGROUND, BUILTIN_LOOKS, findBuiltinLook, type Look } from './looks.ts';
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
const subjectInput = { maskId: 's1', grid, framingKey: 'f1', confidence: 'high' as const, alpha: new Float32Array(16 * 16).fill(1) };

describe('BUILTIN_LOOKS / findBuiltinLook', () => {
  it('lists the lift-subject-blur-background Look and can find it by id', () => {
    assert.ok(BUILTIN_LOOKS.includes(LIFT_SUBJECT_BLUR_BACKGROUND));
    assert.equal(findBuiltinLook('lift-subject-blur-background')?.name, 'Lift subject, blur background');
    assert.equal(findBuiltinLook('no-such-look'), undefined);
  });
});

describe('createCustomLook', () => {
  it('builds a user-sourced Look with the same shape as a built-in one', () => {
    const look = createCustomLook('my-look', 'My look', 'A custom macro', [
      { label: 'Step 1', capability: 'denoise', background: { denoise: 0.5 } },
    ]);
    assert.equal(look.source, 'user');
    assert.equal(look.steps.length, 1);
  });
});

describe('runLook', () => {
  it('runs a single-step Look that passes verification on the first attempt', async () => {
    const original = flat(16, [120, 120, 120]);
    const render = async () => flat(16, [121, 121, 121]); // barely changed
    const look: Look = createCustomLook('l1', 'Simple', 'one gentle step', [
      { label: 'Gentle denoise', capability: 'denoise', background: { denoise: 0.5 } },
    ]);
    const result = await runLook(look, { original, render });
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].attempts, 1);
    assert.equal(result.steps[0].verification.ok, true);
    assert.equal(result.steps[0].edit.denoise, 0.5);
  });

  it('renders all accepted steps as one cumulative recipe, not the last isolated step', async () => {
    const original = flat(16, [120, 120, 120]);
    const renders: Array<{ denoise?: number; texture?: number }> = [];
    const render = async (edit: { denoise?: number; texture?: number }) => {
      renders.push({ ...edit });
      return flat(16, [121, 121, 121]);
    };
    const look = createCustomLook('l2', 'Two steps', 'combined macro', [
      { label: 'Step A', capability: 'denoise', background: { denoise: 0.3 } },
      { label: 'Step B', capability: 'denoise', background: { texture: 0.2 } },
    ]);
    const result = await runLook(look, { original, render });
    assert.equal(result.steps.length, 2);
    assert.deepEqual(renders, [{ denoise: 0.3 }, { denoise: 0.3, texture: 0.2 }]);
    assert.ok(result.steps.every((step) => step.verification.ok));
  });

  it('applies a subject-only edit via a mask, verified with detailScope "subject"', async () => {
    const original = flat(16, [120, 120, 120]);
    const render = async () => flat(16, [121, 121, 121]);
    const look: Look = createCustomLook('l3', 'Subject lift', 'protect the subject', [
      { label: 'Lift subject', capability: 'mask', background: { texture: -0.3 }, subject: { texture: 0.3, sharpen: 0.2 } },
    ]);
    const result = await runLook(look, { original, render, subject: subjectInput });
    assert.equal(result.steps[0].masks.length, 1);
    assert.equal(result.steps[0].masks[0].edit.texture, 0.3);
    assert.equal(result.steps[0].masks[0].edit.sharpen, 0.2);
  });

  it('retries a step at reduced strength on overshoot, then moves on to the next step unaffected by the first step\'s failure', async () => {
    let calls = 0;
    const original = flat(16, [120, 120, 120]);
    // First step always "overshoots" (reports a far brighter result) so it should retry and reduce
    // strength; a passing second step should then run exactly once, verified against the ORIGINAL input
    // rather than the first step's never-settled output (which would itself look like a big darkening).
    const render = async (edit: { denoise?: number }) => {
      calls += 1;
      return edit.denoise !== undefined ? flat(16, [250, 250, 250]) : flat(16, [121, 121, 121]);
    };
    const look: Look = createCustomLook('l4', 'Retry then move on', 'macro with a flaky first step', [
      { label: 'Overshooting step', capability: 'denoise', background: { denoise: 1 } },
      { label: 'Fine step', capability: 'mask', background: { texture: 0.1 } },
    ]);
    const result = await runLook(look, { original, render, maxRetriesPerStep: 2 });
    assert.equal(result.steps[0].attempts, 3); // initial + 2 retries, never passes
    assert.equal(result.steps[0].verification.ok, false);
    assert.ok(result.steps[0].edit.denoise! < 1);
    assert.equal(result.steps[1].attempts, 1); // rejected first step never enters the recipe
    assert.equal(result.steps[1].verification.ok, true);
    assert.equal(calls, 4);
  });

  it('runs the real built-in lift-subject-blur-background Look end to end', async () => {
    const original = flat(16, [120, 120, 120]);
    const render = async () => flat(16, [122, 122, 122]);
    const result = await runLook(LIFT_SUBJECT_BLUR_BACKGROUND, { original, render, subject: subjectInput });
    assert.equal(result.look.id, 'lift-subject-blur-background');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].masks[0].edit.clarity, 0.2);
  });
});
