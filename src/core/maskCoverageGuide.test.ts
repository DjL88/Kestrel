import assert from 'node:assert/strict';
import test from 'node:test';
import { createMask, type Mask } from './maskTypes.ts';
import { effectiveAlpha } from './masks.ts';
import { maskCoverageGuide } from './maskCoverageGuide.ts';

test('a neutral oval and gradient display exactly the renderer weights, including restrictions', () => {
  const oval = createMask('radial', 'oval');
  const gradient = createMask('linear', 'gradient');
  for (const mode of ['intersect', 'subtract'] as const) {
    const limited: Mask = { ...oval, limit: { id: gradient.id, mode } };
    const masks = [limited, gradient];
    const guide = maskCoverageGuide(masks, oval.id, 120, 80)!;
    const expected = effectiveAlpha(limited, masks, 120, 80, { aspect: 80 / 120, view: { x: 0, y: 0, w: 1, h: 1 } });
    assert.deepEqual(Array.from(guide.rgba.filter((_, i) => i % 4 === 3)), Array.from(expected, a => Math.round(a * 144)));
    assert.ok(guide.rgba.some((a, i) => i % 4 === 3 && a > 0));
  }
});
test('hidden and missing masks do not show and work is bounded for full-size RAW dimensions', () => {
  const oval = createMask('radial', 'oval');
  assert.equal(maskCoverageGuide([{ ...oval, hidden: true }], oval.id, 8256, 5504), null);
  assert.equal(maskCoverageGuide([oval], 'wrong', 8256, 5504), null);
  assert.equal(maskCoverageGuide([oval], oval.id, 0, 5504), null);
  const guide = maskCoverageGuide([oval], oval.id, 8256, 5504)!;
  assert.equal(guide.width, 384);
  assert.equal(guide.height, 256);
  assert.equal(guide.rgba.length, 384 * 256 * 4);
});
