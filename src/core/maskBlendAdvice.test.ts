import assert from 'node:assert/strict';
import test from 'node:test';
import { blendMaskEdges, inspectMaskBoundary, reviewMaskBlend } from './maskBlendAdvice';
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

test('boundary evidence compares locally edited pixels against the same global render', () => {
  const width = 40, height = 40;
  const global = new Uint8ClampedArray(width * height * 4);
  const adjusted = new Uint8ClampedArray(width * height * 4);
  const alpha = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    const a = x < 20 ? 1 : 0;
    alpha[p] = a;
    for (let c = 0; c < 3; c++) {
      global[p * 4 + c] = 100;
      adjusted[p * 4 + c] = 100 + 60 * a;
    }
    global[p * 4 + 3] = adjusted[p * 4 + 3] = 255;
  }
  const evidence = inspectMaskBoundary(global, adjusted, alpha, width, height);
  assert.ok(evidence);
  assert.ok(evidence.possibleHardEdge, 'large additional contrast across an abrupt subject boundary');
  assert.equal(inspectMaskBoundary(global, global, alpha, width, height)?.possibleHardEdge, false);
  assert.equal(inspectMaskBoundary(global, adjusted, alpha, 2, height), null, 'invalid/undersized preview refuses fake evidence');
});
