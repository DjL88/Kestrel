import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSubjectMask, type SubjectGrid } from './maskTypes';
import { captureAnatomyMaskSnapshot } from './anatomyMaskEvidence';
import { proposeObservedMaskCorrection, type ObservedMaskRequest } from './observedMaskProposal';

const sha = 'a'.repeat(64);
const grid = (cells: Record<number, number> = {}): SubjectGrid => {
  const bytes = new Uint8Array(100);
  for (const [index, value] of Object.entries(cells)) bytes[Number(index)] = value;
  return { w: 10, h: 10, data: btoa(String.fromCharCode(...bytes)) };
};
function fixture(operation: 'add' | 'subtract' = 'add') {
  const mask = createSubjectMask('subject', grid({ 44: 255, 45: 255, 54: 255, 55: 255 }), 'frame', 'high');
  mask.strokes.push({ erase: true, radius: 0.02, points: [0.1, 0.2] });
  mask.edit = { exposure: 0.2 };
  const request: ObservedMaskRequest = {
    sourceSha256: sha, framingKey: 'frame', recipeRevision: 7,
    maskSnapshot: captureAnatomyMaskSnapshot(mask),
    area: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, operation,
  };
  return { mask, request };
}
test('selected observed pixel proposes add; never mutates source or manual strokes', () => {
  const { mask, request } = fixture();
  const before = structuredClone(mask);
  const result = proposeObservedMaskCorrection(mask, grid({ 46: 250 }), request, sha, 7);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.requiresApproval, true);
  assert.equal(result.changedCells, 1);
  assert.equal(atob(result.after.grid.data).charCodeAt(46), 250);
  assert.deepEqual(result.after.strokes, before.strokes);
  assert.deepEqual(result.after.edit, before.edit);
  assert.deepEqual(mask, before);
});
test('explicit remove spill proposes bounded subtraction', () => {
  const { mask, request } = fixture('subtract');
  const result = proposeObservedMaskCorrection(mask, grid({ 45: 255 }), request, sha, 7);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(atob(result.after.grid.data).charCodeAt(45), 0);
});
test('out-of-selection segmentation cannot alter unrelated subjects', () => {
  const { mask, request } = fixture();
  assert.deepEqual(proposeObservedMaskCorrection(mask, grid({ 11: 255 }), request, sha, 7),
    { ok: false, reason: 'no-change' });
});
test('stale edits, wrong original, changed framing and invalid geometry abstain', () => {
  const { mask, request } = fixture();
  const observed = grid({ 46: 255 });
  assert.equal(proposeObservedMaskCorrection(mask, observed, request, 'b'.repeat(64), 7).ok, false);
  assert.equal(proposeObservedMaskCorrection(mask, observed, request, sha, 8).ok, false);
  assert.equal(proposeObservedMaskCorrection(mask, observed, { ...request, framingKey: 'other' }, sha, 7).ok, false);
  assert.equal(proposeObservedMaskCorrection(mask, observed, { ...request, area: { x: 0.8, y: 0, w: 0.4, h: 1 } }, sha, 7).ok, false);
  mask.strokes.push({ erase: false, radius: 0.01, points: [0.2, 0.3] });
  assert.deepEqual(proposeObservedMaskCorrection(mask, observed, request, sha, 7),
    { ok: false, reason: 'stale' });
});
test('broad mask replacement is rejected even with user-selected area', () => {
  const { mask, request } = fixture();
  const cells: Record<number, number> = {};
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) cells[y * 10 + x] = 255;
  assert.deepEqual(proposeObservedMaskCorrection(mask, grid(cells), request, sha, 7),
    { ok: false, reason: 'too-broad' });
});

test('a higher-resolution full-frame detector grid maps onto the editable mask', () => {
  const { mask, request } = fixture();
  const pixels = new Uint8Array(400);
  // 20x20 detected grid cell covering editable cell (x=6,y=4).
  pixels[9 * 20 + 13] = 255;
  const observed: SubjectGrid = { w: 20, h: 20, data: btoa(String.fromCharCode(...pixels)) };
  const result = proposeObservedMaskCorrection(mask, observed, request, sha, 7);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(atob(result.after.grid.data).charCodeAt(46), 255);
});
