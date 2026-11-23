import assert from 'node:assert/strict';
import test from 'node:test';
import { splitCompositionGeometry, compositionX, frameLocalX } from './splitCompositionGeometry.ts';

test('crop viewport spans all frames without changing source dimensions', () => {
  for (const count of [1, 2, 3] as const) {
    const geometry = splitCompositionGeometry(1080, 1350, count)!;
    assert.equal(geometry.totalWidth, 1080 * count);
    assert.equal(geometry.totalHeight, 1350);
    assert.deepEqual(geometry.frameOffsets, Array.from({ length: count }, (_, i) => i * 1080));
    for (let i = 0; i < count; i++)
      assert.equal(frameLocalX(compositionX(540, i, geometry)!, i, geometry), 540);
  }
});
test('unsafe composition widths and coordinates fail closed', () => {
  assert.equal(splitCompositionGeometry(8000, 5000, 3), undefined);
  assert.equal(splitCompositionGeometry(0, 5000, 2), undefined);
  assert.equal(splitCompositionGeometry(2000.5, 5000, 2), undefined);
  const geometry = splitCompositionGeometry(1000, 500, 3)!;
  assert.equal(compositionX(0, 3, geometry), undefined);
  assert.equal(frameLocalX(50, 2, geometry), undefined);
});
