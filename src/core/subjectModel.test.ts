import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSubject, gridSizeFor, normaliseMap, preprocess, toGrid } from './subjectModel';
import { createSubjectMask, validMasks, framingKey } from './maskTypes';
import { maskAlpha, fullContext } from './masks';

const SIZE = 320;
const map = (fill: (x: number, y: number) => number) => {
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) out[y * SIZE + x] = fill(x, y);
  return out;
};
const blob = map((x, y) => Math.hypot(x - 160, y - 160) < 60 ? 1 : 0);

test('preprocessing produces three normalised planes of the right size', () => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
  const input = preprocess(rgba);
  assert.equal(input.length, 3 * SIZE * SIZE);
  assert.ok(Math.abs(input[0] - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(input[SIZE * SIZE] - (1 - 0.456) / 0.224) < 1e-5);
});

test('normalising stretches a faint map and returns zeros for a flat one', () => {
  const stretched = normaliseMap(Float32Array.from([0.2, 0.3, 0.4]));
  assert.equal(stretched[0], 0);
  assert.ok(Math.abs(stretched[2] - 1) < 1e-6);
  assert.deepEqual([...normaliseMap(new Float32Array(4).fill(0.7))], [0, 0, 0, 0]);
});

test('a clear blob is usable with high confidence, nothing or everything is refused', () => {
  const clear = assessSubject(blob);
  assert.equal(clear.usable, true);
  assert.equal(clear.confidence, 'high');
  assert.equal(assessSubject(new Float32Array(1000)).usable, false);
  assert.equal(assessSubject(new Float32Array(1000).fill(1)).usable, false);
  assert.match(assessSubject(new Float32Array(1000)).reason, /No clear subject/);
});

test('a muddy map is flagged as low confidence', () => {
  const muddy = map((x) => 0.2 + (x / SIZE) * 0.6);
  assert.equal(assessSubject(muddy).confidence, 'low');
});

test('a subject grid round-trips into a mask that is full on the subject and clear elsewhere', () => {
  const { w, h } = gridSizeFor(0.75);
  const grid = toGrid(blob, SIZE, w, h);
  const mask = createSubjectMask('s', grid, framingKey(undefined), 'high');
  assert.equal(validMasks([mask]), true);
  const alpha = maskAlpha(mask, 100, 75, fullContext(100, 75));
  assert.ok(alpha[37 * 100 + 50] > 0.95);
  assert.ok(alpha[2 * 100 + 2] < 0.05);
  const background = maskAlpha({ ...mask, invert: true }, 100, 75, fullContext(100, 75));
  assert.ok(background[2 * 100 + 2] > 0.95);
});

test('paint and erase strokes refine a detected subject', () => {
  const { w, h } = gridSizeFor(1);
  const base = createSubjectMask('s', toGrid(blob, SIZE, w, h), 'k', 'high');
  const painted = { ...base, strokes: [{ radius: 0.06, erase: false, points: [0.1, 0.1] }] };
  const erased = { ...base, strokes: [{ radius: 0.08, erase: true, points: [0.5, 0.5] }] };
  const ctx = fullContext(100, 100);
  assert.ok(maskAlpha(painted, 100, 100, ctx)[10 * 100 + 10] > 0.9, 'paint adds area outside the subject');
  assert.ok(maskAlpha(erased, 100, 100, ctx)[50 * 100 + 50] < 0.1, 'erase removes area inside it');
});

test('corrupt subject data is rejected by validation', () => {
  const good = createSubjectMask('s', toGrid(blob, SIZE, 16, 16), 'k', 'high');
  // Corrupt copies of a valid mask.
  assert.equal(validMasks([{ ...good, grid: { ...good.grid, data: 'AAAA' } }]), false);
  assert.equal(validMasks([{ ...good, grid: { ...good.grid, w: 4 } }]), false);
  assert.equal(validMasks([{ ...good, confidence: 'certain' }]), false);
});

test('grid size keeps the photo shape', () => {
  assert.deepEqual(gridSizeFor(1), { w: 192, h: 192 });
  const tall = gridSizeFor(1.5);
  assert.ok(tall.h === 192 && tall.w < 192);
});
