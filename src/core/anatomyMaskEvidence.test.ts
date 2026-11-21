import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSubjectMask, validMasks, type SubjectGrid } from './maskTypes';
import { refineObservedAnatomy, type AnatomyEvidence } from './anatomyMaskEvidence';

const sha = 'a'.repeat(64);
const grid = (paint: Record<number, number> = {}): SubjectGrid => {
  const values = new Uint8Array(64);
  for (const [index, value] of Object.entries(paint)) values[Number(index)] = value;
  return { w: 8, h: 8, data: btoa(String.fromCharCode(...values)) };
};
const evidence = (parts: SubjectGrid, occluders: SubjectGrid): AnatomyEvidence => ({
  sourceSha256: sha, framingKey: 'frame', modelId: 'local-segmenter',
  modelVersion: 'fixture-1', partConfidence: 0.95, occluderConfidence: 0.96,
  domain: 'wildlife', observedParts: parts, foregroundOccluders: occluders,
});

test('observed thin appendage added, foreground branch excluded, brush and edits retained', () => {
  const original = createSubjectMask('subject', grid({ 10: 255, 11: 255 }), 'frame', 'high');
  original.strokes.push({ points: [0.2, 0.3, 0.25, 0.35], radius: 0.03, erase: true });
  original.edit = { exposure: 0.2 };
  original.limit = { id: 'foreground', mode: 'subtract' };
  const result = refineObservedAnatomy(original, evidence(grid({ 19: 245 }), grid({ 11: 255 })), sha);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const bytes = atob(result.mask.grid.data);
  assert.equal(bytes.charCodeAt(19), 245); // observed foot/wing/hair/paw
  assert.equal(bytes.charCodeAt(11), 0); // observed foreground branch
  assert.equal(bytes.charCodeAt(10), 255);
  assert.deepEqual(result.mask.strokes, original.strokes);
  assert.notEqual(result.mask.strokes, original.strokes);
  assert.deepEqual(result.mask.edit, original.edit);
  assert.deepEqual(result.mask.limit, original.limit);
  assert.equal(validMasks([result.mask]), true);
  assert.equal(atob(original.grid.data).charCodeAt(11), 255);
});
test('wrong source, stale framing, missing model and uncertain probabilities abstain', () => {
  const mask = createSubjectMask('s', grid({ 4: 255 }), 'frame', 'high');
  const base = evidence(grid({ 5: 255 }), grid());
  for (const modified of [
    { ...base, sourceSha256: 'b'.repeat(64) },
    { ...base, framingKey: 'different' },
    { ...base, modelVersion: '' },
    { ...base, partConfidence: 0.7 },
    { ...base, occluderConfidence: Number.NaN },
  ]) assert.equal(refineObservedAnatomy(mask, modified, sha).ok, false);
});
test('unknown or low-confidence anatomy never invents shapes', () => {
  const mask = createSubjectMask('s', grid({ 4: 255 }), 'frame', 'low');
  assert.deepEqual(refineObservedAnatomy(mask, evidence(grid({ 5: 255 }), grid()), sha),
    { ok: false, reason: 'uncalibrated-evidence' });
});
test('invalid grid and absence of observed changes leave source intact', () => {
  const mask = createSubjectMask('s', grid({ 4: 255 }), 'frame', 'high');
  assert.equal(refineObservedAnatomy(mask, evidence({ ...grid(), data: 'invalid' }, grid()), sha).ok, false);
  assert.deepEqual(refineObservedAnatomy(mask, evidence(grid(), grid()), sha),
    { ok: false, reason: 'no-change' });
});
test('cross-genre evidence uses identical conservative mask rules, not wildlife species labels', () => {
  for (const domain of ['wildlife', 'person', 'pet', 'sport', 'macro', 'general'] as const) {
    const mask = createSubjectMask('s', grid({ 1: 255 }), 'frame', 'medium');
    const result = refineObservedAnatomy(mask, { ...evidence(grid({ 2: 255 }), grid()), domain }, sha);
    assert.equal(result.ok, true, domain);
  }
});

test('contradictory observed anatomy and foreground evidence abstains without altering manual work', () => {
  const mask = createSubjectMask('subject', grid({ 10: 255, 11: 255 }), 'frame', 'high');
  mask.strokes.push({ points: [0.3, 0.4], radius: 0.02, erase: false });
  const before = structuredClone(mask);
  assert.deepEqual(
    refineObservedAnatomy(mask, evidence(grid({ 12: 255 }), grid({ 12: 255 })), sha),
    { ok: false, reason: 'conflicting-evidence' },
  );
  assert.deepEqual(mask, before);
});

test('a broad false-positive appendage map cannot overwrite a small true subject', () => {
  const mask = createSubjectMask('subject', grid({ 10: 255, 11: 255 }), 'frame', 'high');
  const parts: Record<number, number> = {};
  for (let i = 20; i < 36; i++) parts[i] = 255;
  assert.deepEqual(refineObservedAnatomy(mask, evidence(grid(parts), grid()), sha),
    { ok: false, reason: 'excessive-change' });
  assert.equal(atob(mask.grid.data).charCodeAt(20), 0);
});

test('foreground occlusion cannot erase the entire original subject', () => {
  const subject: Record<number, number> = {};
  for (let i = 8; i < 24; i++) subject[i] = 255;
  const mask = createSubjectMask('subject', grid(subject), 'frame', 'high');
  assert.deepEqual(refineObservedAnatomy(mask, evidence(grid(), grid(subject)), sha),
    { ok: false, reason: 'excessive-change' });
  assert.equal(atob(mask.grid.data).charCodeAt(8), 255);
});

test('conservative observed part and separate foreground removal remain allowed', () => {
  const mask = createSubjectMask('subject', grid({ 10: 255, 11: 255, 12: 255 }), 'frame', 'high');
  const result = refineObservedAnatomy(mask, evidence(grid({ 13: 245 }), grid({ 11: 255 })), sha);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(atob(result.mask.grid.data).charCodeAt(13), 245);
    assert.equal(atob(result.mask.grid.data).charCodeAt(11), 0);
  }
});

test('isolated high-confidence appendage is not grafted onto the subject', () => {
  const mask = createSubjectMask('subject', grid({ 10: 255, 11: 255 }), 'frame', 'high');
  const result = refineObservedAnatomy(mask, evidence(grid({ 55: 255 }), grid()), sha);
  assert.deepEqual(result, { ok: false, reason: 'detached-anatomy' });
  assert.equal(atob(mask.grid.data).charCodeAt(55), 0);
});

test('diagonally attached thin subject detail remains editable', () => {
  const mask = createSubjectMask('subject', grid({ 10: 255 }), 'frame', 'high');
  mask.strokes.push({ points: [0.1, 0.1], radius: 0.02, erase: true });
  const result = refineObservedAnatomy(mask, evidence(grid({ 19: 255, 28: 255 }), grid()), sha);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(atob(result.mask.grid.data).charCodeAt(28), 255);
    assert.deepEqual(result.mask.strokes, mask.strokes);
  }
});

test('an occluded bridge does not join an otherwise detached false appendage', () => {
  const mask = createSubjectMask('subject', grid({ 10: 255, 11: 255 }), 'frame', 'high');
  const result = refineObservedAnatomy(mask, evidence(grid({ 12: 255 }), grid({ 11: 255 })), sha);
  assert.deepEqual(result, { ok: false, reason: 'detached-anatomy' });
});
