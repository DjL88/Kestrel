import assert from 'node:assert/strict';
import test from 'node:test';
import { blendMaskEdges, reviewMaskBlend } from './maskBlendAdvice';
import { createSubjectMask, createMask } from './maskTypes';

const grid = { w: 8, h: 8, data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' };

test('no false claim when a mask has no local edit or a gentle adjustment', () => {
  const mask = { ...createSubjectMask('bird', grid, 'crop', 'high'), edit: { exposure: 0.2 } };
  assert.equal(reviewMaskBlend(mask, 'glide'), null);
  assert.equal(reviewMaskBlend({ ...mask, edit: { exposure: 1.4 } }, 'solo'), null);
});
test('strong subject masking offers a reviewable remedy, not an anatomy claim', () => {
  const mask = { ...createSubjectMask('bird', grid, 'crop', 'high'), feather: 0.2, edit: { exposure: 1.2, clarity: 1.5 } };
  const advice = reviewMaskBlend(mask, 'glide');
  assert.equal(advice?.kind, 'soften-transition');
  assert.equal(advice?.action, 'Blend edges');
  const next = blendMaskEdges(mask);
  assert.ok(next.feather > mask.feather);
  assert.ok((next.edit.clarity ?? 0) < (mask.edit.clarity ?? 0));
  assert.equal(next.id, mask.id);
  assert.equal(next.kind, 'subject');
  assert.deepEqual(mask.edit, { exposure: 1.2, clarity: 1.5 }, 'the original recipe is not mutated');
});
test('manual brush strokes remain intact and non-subject radial masks are not changed', () => {
  const mask = { ...createSubjectMask('bird', grid, 'crop', 'medium'), edit: { exposure: 1.3 }, strokes: [{ points: [0.2, 0.2, 0.3, 0.3], radius: 0.02, erase: false }] };
  assert.deepEqual(blendMaskEdges(mask).strokes, mask.strokes);
  const radial = createMask('radial', 'radius');
  assert.equal(blendMaskEdges(radial), radial);
});
