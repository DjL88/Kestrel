import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeNearSimilarKeepers } from './burstDedupe';
import { analyzeSubjectKestrel, perceptualSignature, signatureSimilarity } from './kestrelVision';
import { generateDemoShootFrames } from './cullingEngine';
import type { CullSuggestion } from './autoCull';

function makeSubjectScene(width = 96, height = 96, shiftX = 0, bright = true): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const dx = x - (width / 2 + shiftX);
      const dy = y - height / 2;
      const inSubject = dx * dx + dy * dy <= (width * 0.22) ** 2;
      if (inSubject) {
        const checker = ((x >> 1) + (y >> 1)) % 2 === 0;
        rgba[idx] = bright ? (checker ? 210 : 120) : 110;
        rgba[idx + 1] = bright ? (checker ? 140 : 75) : 70;
        rgba[idx + 2] = bright ? (checker ? 70 : 35) : 40;
      } else {
        rgba[idx] = 150;
        rgba[idx + 1] = 195;
        rgba[idx + 2] = 235;
      }
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

test('kestrelVision detects isolated subject in pixel bounds and produces usable assessment', () => {
  const pixels = makeSubjectScene(96, 96);
  const analysis = analyzeSubjectKestrel(pixels, 96, 96);
  assert.ok(analysis.box, 'subject bounding box detected');
  assert.equal(analysis.assessment.usable, true);
  assert.ok(analysis.box.x >= 0 && analysis.box.x + analysis.box.w <= 96);
  assert.ok(analysis.box.y >= 0 && analysis.box.y + analysis.box.h <= 96);
  assert.ok(analysis.categoryConfidence >= 0.5, `confidence=${analysis.categoryConfidence}`);
});

test('perceptualSignature distinguishes distinct scenes and clusters near-similar burst shots', () => {
  const shotA = makeSubjectScene(64, 64, 0, true);
  const shotB = makeSubjectScene(64, 64, 1, true);
  const sigA = perceptualSignature(shotA, 64, 64);
  const sigB = perceptualSignature(shotB, 64, 64);
  assert.ok(signatureSimilarity(sigA, sigB) > 0.94, 'shifted burst frame stays highly similar');

  // Inverted scene (dark foreground on light sky vs bright gradient)
  const distinct = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const idx = (y * 64 + x) * 4;
      const v = Math.round((x / 63) * 240);
      distinct[idx] = v;
      distinct[idx + 1] = 240 - v;
      distinct[idx + 2] = 120;
      distinct[idx + 3] = 255;
    }
  }
  const sigDistinct = perceptualSignature(distinct, 64, 64);
  assert.ok(signatureSimilarity(sigA, sigDistinct) < 0.7, 'different scene does not falsely cluster');
});

test('dedupeNearSimilarKeepers keeps only the sharpest winner per perceptual burst while keeping distinct scenes', () => {
  const frames = generateDemoShootFrames(3).map((f) => ({ ...f, isDemo: false, burstGroupId: null }));
  const sigA = perceptualSignature(makeSubjectScene(64, 64, 0, true), 64, 64);
  const sigB = perceptualSignature(makeSubjectScene(64, 64, 1, true), 64, 64);
  const distinctPixels = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i += 1) {
    distinctPixels[i * 4] = (i % 64) * 3;
    distinctPixels[i * 4 + 1] = 80;
    distinctPixels[i * 4 + 2] = 200;
    distinctPixels[i * 4 + 3] = 255;
  }
  const sigC = perceptualSignature(distinctPixels, 64, 64);

  const suggestions: CullSuggestion[] = [
    { frameId: frames[0].id, decision: 'keep', confidence: 'high', score: 88, reason: 'subjectSharp' },
    { frameId: frames[1].id, decision: 'keep', confidence: 'high', score: 96, reason: 'subjectSharp' },
    { frameId: frames[2].id, decision: 'keep', confidence: 'high', score: 91, reason: 'subjectSharp' },
  ];
  const signatures = new Map<string, Float32Array>([
    [frames[0].id, sigA],
    [frames[1].id, sigB],
    [frames[2].id, sigC],
  ]);

  const deduped = dedupeNearSimilarKeepers(suggestions, frames, signatures);
  const byId = new Map(deduped.map((r) => [r.frameId, r]));
  assert.equal(byId.get(frames[1].id)?.decision, 'keep');
  assert.equal(byId.get(frames[1].id)?.confidence, 'high');
  assert.equal(byId.get(frames[0].id)?.decision, null, 'softer near-identical burst sibling is held for review');
  assert.equal(byId.get(frames[2].id)?.decision, 'keep', 'distinct sharp frame remains a high-confidence keeper');
});
