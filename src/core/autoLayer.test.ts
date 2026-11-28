import assert from 'node:assert/strict';
import test from 'node:test';
import { stripAutoLayer } from './autoLayer';
import { recordEdit } from './editHistory';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { mergeAutoSuggestion } from './autoEnhance';
import { naturalAuto, sameRecipe } from './naturalAuto';
import { planAuto } from './unifiedAuto';
import { guardHighlights } from './autoHighlightGuard';
import type { PhotoFrame } from './types';

const frameWith = (edit: PhotoEdit | undefined, ...steps: { edit: PhotoEdit; why?: boolean }[]): PhotoFrame => {
  let frame = { id: 'a', edit } as PhotoFrame;
  steps.forEach((step, index) => { frame = recordEdit(frame, { edit: step.edit }, 1000 + index * 1000, step.why ? { by: 'auto' } : undefined); });
  return frame;
};

test('with no Auto step the edit is returned unchanged', () => {
  const frame = frameWith(undefined, { edit: { ...DEFAULT_EDIT, exposure: 0.5 } });
  const layer = stripAutoLayer(frame.edit, frame.editHistory);
  assert.equal(layer.stripped, false);
  assert.equal(layer.base.exposure, 0.5);
});

test('Auto\'s own controls and masks are taken back out; the look before Auto returns', () => {
  const mask = { id: 'm1', kind: 'subject', edit: { exposure: 0.4 } } as never;
  const frame = frameWith(undefined, { edit: { ...DEFAULT_EDIT, exposure: 1.2, shadows: 0.5, masks: [mask] }, why: true });
  const layer = stripAutoLayer(frame.edit, frame.editHistory);
  assert.equal(layer.stripped, true);
  assert.equal(layer.base.exposure, 0);
  assert.equal(layer.base.shadows, undefined);
  assert.equal(layer.base.masks, undefined);
  assert.deepEqual(layer.kept, []);
});

test('a slider the person moved after Auto is kept and reported', () => {
  const frame = frameWith(undefined, { edit: { ...DEFAULT_EDIT, exposure: 1.2, shadows: 0.5 }, why: true }, { edit: { ...DEFAULT_EDIT, exposure: 1.2, shadows: 0.9 } });
  const layer = stripAutoLayer(frame.edit, frame.editHistory);
  assert.equal(layer.base.exposure, 0);
  assert.equal(layer.base.shadows, 0.9);
  assert.deepEqual(layer.kept, ['shadows']);
});

test('a mask the person changed after Auto is kept', () => {
  const mask = { id: 'm1', kind: 'subject', edit: { exposure: 0.4 } } as never;
  const edited = { id: 'm1', kind: 'subject', edit: { exposure: 0.1 } } as never;
  const frame = frameWith(undefined, { edit: { ...DEFAULT_EDIT, masks: [mask] }, why: true }, { edit: { ...DEFAULT_EDIT, masks: [edited] } });
  const layer = stripAutoLayer(frame.edit, frame.editHistory);
  assert.equal(layer.base.masks?.length, 1);
  assert.deepEqual(layer.kept, ['masks']);
});

test('an undone Auto step is not stripped', () => {
  let frame = frameWith(undefined, { edit: { ...DEFAULT_EDIT, exposure: 1 }, why: true });
  frame = { ...frame, edit: undefined, editHistory: { ...frame.editHistory!, cursor: 0 } };
  assert.equal(stripAutoLayer(frame.edit, frame.editHistory).stripped, false);
});

// A dark bird on a pale, nearly burnt sky: lifting the whole frame blows the sky.
const W = 160, H = 120;
function scene(sky: number, ground: number, subject: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inSubject = x > 50 && x < 110 && y > 40 && y < 100;
    const base = inSubject ? subject : y < 50 ? sky : ground;
    const v = Math.min(255, base + ((x * 7 + y * 3) % 9));
    data.set([v, v, Math.min(255, v + 4), 255], (y * W + x) * 4);
  }
  return data;
}

test('Auto twice gives the identical recipe (the previous layer is replaced, not added to)', () => {
  const pixels = scene(100, 60, 30);
  const run = (current: PhotoEdit | undefined, history: PhotoFrame['editHistory']) => {
    const { base } = stripAutoLayer(current, history);
    const natural = naturalAuto({ pixels, width: W, height: H });
    const proposal = mergeAutoSuggestion(base, natural.edit).edit;
    return { base, plan: planAuto({ pixels, width: W, height: H, base, natural, proposal }) };
  };
  const first = run(undefined, undefined);
  const frame = frameWith(undefined, { edit: first.plan.proposal, why: true });
  const second = run(frame.edit, frame.editHistory);
  assert.ok(sameRecipe(first.plan.proposal, second.plan.proposal), 'second Auto reproduces the first recipe');
  assert.ok(sameRecipe(second.base, DEFAULT_EDIT));
  assert.equal(first.plan.verdict.kind, 'improved', 'the dark scene is lifted, so the idempotence check is meaningful');
  // Without taking the layer out, the dark lift is added a second time: this is the bug being guarded against.
  const natural = naturalAuto({ pixels, width: W, height: H });
  const stacked = planAuto({ pixels, width: W, height: H, base: first.plan.proposal, natural, proposal: mergeAutoSuggestion(first.plan.proposal, natural.edit).edit });
  assert.ok(!sameRecipe(stacked.proposal, first.plan.proposal), 'stacking on the old layer would have changed the recipe');
});

test('highlight guard: a big lift on a dark subject under a bright sky does not grow the clipped area', () => {
  const pixels = scene(235, 120, 30);
  const result = guardHighlights({ pixels, width: W, height: H, base: DEFAULT_EDIT, proposal: { ...DEFAULT_EDIT, exposure: 3 } });
  assert.notEqual(result.action, 'none');
  assert.ok(result.clipProposal > result.clipBefore + 0.005, 'the unguarded lift really clips');
  assert.ok(result.satisfied);
  assert.ok(result.clipAfter <= result.clipBefore + 0.005);
  assert.ok((result.edit.exposure ?? 0) <= 3);
});

test('highlight guard: a dark subject on a dark background keeps its whole lift', () => {
  const pixels = scene(40, 30, 25);
  const proposal = { ...DEFAULT_EDIT, exposure: 1.5 };
  const result = guardHighlights({ pixels, width: W, height: H, base: DEFAULT_EDIT, proposal });
  assert.equal(result.action, 'none');
  assert.equal(result.edit, proposal);
});

test('highlight guard: never reports satisfied when the frame is already blown and the lift adds to it', () => {
  const pixels = scene(255, 250, 200);
  const result = guardHighlights({ pixels, width: W, height: H, base: DEFAULT_EDIT, proposal: { ...DEFAULT_EDIT, exposure: 2 } });
  assert.ok(result.clipAfter <= result.clipBefore + 0.01 || !result.satisfied);
});
