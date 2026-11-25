import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { histogramFromWorking } from './histogram16';

test('the histogram is measured from the rendered 16-bit samples, or not at all when the edit cannot be carried', () => {
  const working = { picture: { width: 2, height: 1, data: new Uint16Array([0, 0, 0, 65535, 65535, 65535]) }, turn: 0 };
  const shown = histogramFromWorking(working, DEFAULT_EDIT, undefined, (w) => w.picture);
  assert.equal(shown?.precision, 'rgb16');
  assert.equal(shown?.shadowClip, 0.5);
  assert.equal(shown?.highlightClip, 0.5);
  assert.equal(histogramFromWorking(working, DEFAULT_EDIT, undefined, () => null), null);
});
