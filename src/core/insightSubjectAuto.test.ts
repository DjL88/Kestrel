import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proposeSubjectAwareAuto, type SubjectAutoInput } from './insightSubjectAuto';
import { DEFAULT_EDIT } from './photoEdits';
import { validMasks } from './maskTypes';

function fixture(subjectRgb: [number, number, number], backgroundRgb: [number, number, number]): SubjectAutoInput {
  const width = 48, height = 48, w = 16, h = 16;
  const grid = new Uint8Array(w * h);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= 5 && x < 11 && y >= 5 && y < 11) grid[y * w + x] = 255;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const centre = x >= 15 && x < 33 && y >= 15 && y < 33;
    pixels.set([...(centre ? subjectRgb : backgroundRgb), 255], (y * width + x) * 4);
  }
  return {
    pixels, width, height,
    subjectKind: 'wildlife',
    segmentation: { grid: { w, h, data: btoa(String.fromCharCode(...grid)) }, confidence: 'high' },
    framingKey: 'o|0|0.00|0.5000|0.5000|1.000',
    maskId: 'insight-proposed-1',
    edit: { ...DEFAULT_EDIT, contrast: 0.3 },
  };
}

test('darker wildlife subject receives a bounded reversible local exposure suggestion', () => {
  const input = fixture([70, 80, 70], [195, 200, 195]);
  const before = JSON.stringify({ edit: input.edit, grid: input.segmentation?.grid });
  const pixels = new Uint8ClampedArray(input.pixels);
  const result = proposeSubjectAwareAuto(input);
  assert.equal(result.usedMask, true);
  assert.equal(result.edit.exposure, 0, 'global exposure should not be modified');
  assert.equal(result.edit.contrast, 0.3, 'existing recipe retained');
  assert.equal(result.edit.masks?.length, 1);
  const mask = result.edit.masks![0];
  assert.equal(mask.kind, 'subject');
  assert.ok((mask.edit.exposure ?? 0) >= 0.15 && (mask.edit.exposure ?? 0) <= 0.6);
  assert.ok(validMasks(result.edit.masks), 'proposal must survive real mask schema validation');
  assert.equal(JSON.stringify({ edit: input.edit, grid: input.segmentation?.grid }), before);
  assert.deepEqual(input.pixels, pixels, 'source preview never mutated');
});

test('landscape and unknown categories never receive guessed subject masks', () => {
  for (const subjectKind of ['landscape', 'other'] as const) {
    const input = fixture([65, 70, 80], [200, 202, 205]);
    input.subjectKind = subjectKind;
    const result = proposeSubjectAwareAuto(input);
    assert.equal(result.usedMask, false);
    assert.strictEqual(result.edit, input.edit);
  }
});

test('low-confidence masks are ignored even if the foreground is very dark', () => {
  const input = fixture([30, 30, 30], [200, 200, 200]);
  input.segmentation!.confidence = 'low';
  const result = proposeSubjectAwareAuto(input);
  assert.equal(result.usedMask, false);
});

test('already bright, similarly exposed, or clipping subjects do not get a lift', () => {
  const cases = [
    fixture([190, 190, 190], [195, 195, 195]),
    fixture([230, 230, 230], [245, 245, 245]),
    fixture([255, 0, 0], [210, 210, 210]),
  ];
  assert.ok(cases.every((input) => !proposeSubjectAwareAuto(input).usedMask));
});

test('oversized masks, malformed grid, missing framing and already full mask stacks fail safely', () => {
  const input = fixture([70, 70, 70], [200, 200, 200]);
  const grid = input.segmentation!.grid;
  assert.equal(proposeSubjectAwareAuto({ ...input, segmentation: { grid: { ...grid, data: 'AAAA' }, confidence: 'high' } }).usedMask, false);
  assert.equal(proposeSubjectAwareAuto({ ...input, segmentation: { grid: { w: 16, h: 16, data: 'A'.repeat(grid.data.length) }, confidence: 'high' } }).usedMask, false);
  assert.equal(proposeSubjectAwareAuto({ ...input, framingKey: '' }).usedMask, false);
  const many = Array.from({ length: 12 }, (_, i) => ({
    kind: 'brush' as const, id: 'manual-' + i, strokes: [], invert: false, feather: 0.5, edit: { exposure: 0.1 },
  }));
  const edit = { ...input.edit, masks: many };
  const result = proposeSubjectAwareAuto({ ...input, edit });
  assert.equal(result.usedMask, false);
  assert.strictEqual(result.edit, edit);
});

test('mask decisions are deterministic and never override existing masks or change subject pixels', () => {
  const input = fixture([82, 86, 92], [198, 197, 196]);
  const existing = { kind: 'brush' as const, id: 'manual', strokes: [], invert: false, feather: 0.4, edit: { warmth: 0.2 } };
  input.edit = { ...input.edit, masks: [existing] };
  const before = input.pixels.slice();
  const first = proposeSubjectAwareAuto(input);
  const second = proposeSubjectAwareAuto(input);
  assert.deepEqual(first, second);
  assert.equal(first.edit.masks?.length, 2);
  assert.strictEqual(first.edit.masks?.[0], existing, 'manual mask is not rewritten');
  assert.deepEqual(input.pixels, before);
  assert.equal(proposeSubjectAwareAuto({ ...input, maskId: 'manual' }).usedMask, false);
});
