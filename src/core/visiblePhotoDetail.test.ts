import test from 'node:test';
import assert from 'node:assert/strict';
import { visiblePhotoDetail } from './visiblePhotoDetail';

test('editor zoom requests just the visible source rectangle', () => {
  const detail = visiblePhotoDetail(6000, 4000, 1500, 1000, { zoom: 4, pan: { x: 0, y: 0 } });
  assert.deepEqual(detail?.region, { x: 2250, y: 1500, width: 1500, height: 1000 });
  assert.equal(detail?.scale, 1);
  assert.deepEqual(detail?.style, { left: 562.5, top: 375, width: 375, height: 250 });
  assert.equal(visiblePhotoDetail(6000, 4000, 1500, 1000, { zoom: 1, pan: { x: 0, y: 0 } }), null);
});
