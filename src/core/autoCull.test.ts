import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoShootFrames, createDemoShootState, applyAutoCullDecisions, undoDecision, redoDecision } from './cullingEngine';
import { limitAutoKeepers, scorePreview, type CullSuggestion } from './autoCull';

test('a flat dark preview is advisory and unavailable images receive no decision', () => {
  const opaqueDark = new Uint8ClampedArray(96 * 96 * 4);
  for (let i = 3; i < opaqueDark.length; i += 4) opaqueDark[i] = 255;
  const result = scorePreview('dark', opaqueDark, 96, 96);
  assert.equal(result.confidence, 'medium');
  assert.equal(result.decision, 'reject');
  assert.equal(scorePreview('small', new Uint8ClampedArray(4), 1, 1).decision, null);
});

test('confidence limit preserves keeper headroom and one automatic pick per burst', () => {
  const photos = generateDemoShootFrames(3).map((frame) => ({ ...frame, isDemo: false, burstGroupId: 'one' }));
  const suggestions: CullSuggestion[] = photos.map((frame, index) => ({
    frameId: frame.id, decision: 'keep', confidence: 'high', reason: 'clearDetail', score: 90 + index,
  }));
  const result = limitAutoKeepers(suggestions, photos, 2);
  assert.deepEqual(result.filter((item) => item.confidence === 'high').map((item) => item.frameId), [photos[2].id]);
});

test('auto-cull only changes undecided originals and supports grouped undo and redo', () => {
  const state = createDemoShootState(3);
  state.frames = state.frames.map((frame, index) => ({ ...frame, isDemo: false, decision: index === 2 ? 'keep' : 'unreviewed' }));
  const moved = applyAutoCullDecisions(state, [
    { frameId: state.frames[0].id, decision: 'keep' },
    { frameId: state.frames[1].id, decision: 'reject' },
    { frameId: state.frames[2].id, decision: 'reject' },
  ]);
  assert.deepEqual(moved.frames.map((frame) => frame.decision), ['keep', 'reject', 'keep']);
  assert.equal(moved.undoStack.length, 1);
  const restored = undoDecision(moved);
  assert.deepEqual(restored.frames.map((frame) => frame.decision), ['unreviewed', 'unreviewed', 'keep']);
  assert.deepEqual(redoDecision(restored).frames, moved.frames);
});

test('malformed preview dimensions and pixel buffers never receive automatic decisions', () => {
  const unavailable = (pixels: Uint8ClampedArray, width: number, height: number) => {
    const result = scorePreview('invalid', pixels, width, height);
    assert.deepEqual({ decision: result.decision, confidence: result.confidence, reason: result.reason },
      { decision: null, confidence: 'low', reason: 'unavailable' });
  };
  unavailable(new Uint8ClampedArray(0), 96, 96);
  unavailable(new Uint8ClampedArray(96 * 96 * 4 - 4), 96, 96);
  unavailable(new Uint8ClampedArray(96 * 96 * 4 + 4), 96, 96);
  unavailable(new Uint8ClampedArray(96 * 96 * 4), NaN, 96);
  unavailable(new Uint8ClampedArray(96 * 96 * 4), 96.5, 96);
  unavailable(new Uint8ClampedArray(0), 100_000, 100_000);
  const opaque = new Uint8ClampedArray(96 * 96 * 4);
  for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
  const valid = scorePreview('valid', opaque, 96, 96);
  assert.equal(valid.reason, 'flat');
});


test('stale or removed frames cannot consume automatic keeper headroom', () => {
  const photos = generateDemoShootFrames(4).map((frame, index) => ({
    ...frame, isDemo: false, burstGroupId: null,
    decision: index === 1 ? 'reject' as const : 'unreviewed' as const,
    ...(index === 0 ? { removedAt: 123 } : {}),
  }));
  const suggestions: CullSuggestion[] = photos.map((frame, index) => ({
    frameId: frame.id, decision: 'keep', confidence: 'high', reason: 'clearDetail', score: 99 - index,
  }));
  const result = limitAutoKeepers(suggestions, photos, 1);
  assert.deepEqual(result.filter((item) => item.confidence === 'high').map((item) => item.frameId), [photos[2].id]);
  assert.equal(result[3].confidence, 'medium');
});


test('removed keepers do not block an active photo in the same burst', () => {
  const photos = generateDemoShootFrames(3).map((frame, index) => ({
    ...frame,
    isDemo: false,
    burstGroupId: 'shared-burst',
    decision: index === 0 ? 'keep' as const : 'unreviewed' as const,
    ...(index === 0 ? { removedAt: 123 } : {}),
  }));
  const suggestions: CullSuggestion[] = photos.slice(1).map((frame, index) => ({
    frameId: frame.id,
    decision: 'keep',
    confidence: 'high',
    reason: 'clearDetail',
    score: 98 - index,
  }));
  const result = limitAutoKeepers(suggestions, photos, 1);
  assert.deepEqual(result.filter((item) => item.confidence === 'high').map((item) => item.frameId), [photos[1].id]);
  assert.equal(result[1].confidence, 'medium');
});


test('a fully transparent preview cannot trigger an automatic flat-image rejection', () => {
  const transparent = new Uint8ClampedArray(96 * 96 * 4);
  const result = scorePreview('transparent', transparent, 96, 96);
  assert.deepEqual({ decision: result.decision, confidence: result.confidence, reason: result.reason },
    { decision: null, confidence: 'low', reason: 'unavailable' });
});


test('partially transparent previews cannot produce confident culling decisions', () => {
  const pixels = new Uint8ClampedArray(96 * 96 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i / 4) % 2 ? 255 : 0;
    pixels[i + 1] = 100;
    pixels[i + 2] = 80;
    pixels[i + 3] = 255;
  }
  // One invisible pixel, one semi-transparent pixel: neither is reliable
  // photographic data for automatic keep/reject.
  for (const alpha of [0, 128, 254]) {
    pixels[3] = alpha;
    const result = scorePreview('partial-alpha', pixels, 96, 96);
    assert.deepEqual(
      { decision: result.decision, confidence: result.confidence, reason: result.reason },
      { decision: null, confidence: 'low', reason: 'unavailable' },
    );
  }
  pixels[3] = 255;
  assert.notEqual(scorePreview('opaque', pixels, 96, 96).reason, 'unavailable');
});

test('invalid or fractional keeper budgets never auto-accept beyond the safe integer ceiling', () => {
  const photos = generateDemoShootFrames(3).map((frame) => ({
    ...frame, isDemo: false, burstGroupId: null, decision: 'unreviewed' as const,
  }));
  const suggestions: CullSuggestion[] = photos.map((frame, index) => ({
    frameId: frame.id, decision: 'keep', confidence: 'high', reason: 'clearDetail', score: 99 - index,
  }));
  for (const budget of [NaN, Infinity, -Infinity, -1, 0, 0.9]) {
    const result = limitAutoKeepers(suggestions, photos, budget);
    assert.equal(result.filter((item) => item.confidence === 'high').length, 0, String(budget));
    assert.equal(result.every((item) => item.decision === 'keep' && item.confidence === 'medium'), true);
  }
  assert.equal(limitAutoKeepers(suggestions, photos, 1.9).filter((item) => item.confidence === 'high').length, 1);
  assert.equal(limitAutoKeepers(suggestions, photos, 2).filter((item) => item.confidence === 'high').length, 2);
});

test('repeated scan suggestions never create duplicate high-confidence keeper actions', () => {
  const photos = generateDemoShootFrames(2).map((frame) => ({
    ...frame, isDemo: false, burstGroupId: null, decision: 'unreviewed' as const,
  }));
  const suggestions: CullSuggestion[] = [
    { frameId: photos[0].id, decision: 'keep', confidence: 'high', reason: 'clearDetail', score: 99 },
    { frameId: photos[0].id, decision: 'keep', confidence: 'high', reason: 'clearDetail', score: 98 },
    { frameId: photos[1].id, decision: 'keep', confidence: 'high', reason: 'clearDetail', score: 97 },
  ];
  const result = limitAutoKeepers(suggestions, photos, 2);
  assert.deepEqual(result.filter((item) => item.confidence === 'high').map((item) => item.frameId),
    [photos[0].id, photos[1].id]);
  assert.equal(result[1].confidence, 'medium');
  assert.equal(suggestions[1].confidence, 'high', 'input suggestions remain unchanged');
});
