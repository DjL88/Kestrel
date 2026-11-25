import assert from 'node:assert/strict';
import test from 'node:test';
import { enlargementPreviewRequest } from './enlargementPreview.ts';
import { planExport } from './exportOps.ts';
import { createDefaultSizes } from '../ui/stub.ts';

test('the enlargement preview plans exactly one lossless export of the chosen photo and format, as export would', () => {
  const request = enlargementPreviewRequest('p1', 'orig-3x2');
  const frames = [{ id: 'p1', filename: 'a.jpg', edit: { exposure: 0, warmth: 0, colour: 0, upscale: 2 as const } }, { id: 'p2', filename: 'b.jpg' }];
  const plan = planExport(request, frames, createDefaultSizes());
  assert.ok(!('error' in plan), JSON.stringify(plan));
  if ('error' in plan) return;
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].frameId, 'p1');
  assert.equal(plan.jobs[0].format.id, 'orig-3x2');
  assert.equal(plan.jobs[0].format.format, 'png');
  assert.deepEqual(plan.jobs[0].variants.map((variant) => variant.kind), ['edited']);
  assert.equal(plan.jobs[0].variants[0].edit.upscale, 2);
  assert.deepEqual(plan.originals, []);
});
